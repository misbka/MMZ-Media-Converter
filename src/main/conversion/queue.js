'use strict';

/**
 * src/main/conversion/queue.js
 * ------------------------------------------------------------------
 * Fila de conversão com concorrência controlada.
 *
 * Responsabilidades:
 *  - criar e validar jobs (caminho de origem, categoria, formato alvo);
 *  - executar N conversões em paralelo (sem travar a interface, pois o
 *    trabalho pesado acontece em processos separados: FFmpeg e sharp);
 *  - pausar/retomar/cancelar a fila e jobs individuais;
 *  - emitir eventos de snapshot + progresso (throttled) para a UI.
 *
 * Semântica de pausa:
 *  - Linux/macOS: processos em execução são realmente suspensos (SIGSTOP);
 *  - Windows: não há suspensão de processos, então a pausa impede novos
 *    jobs de iniciarem e os jobs atuais concluem o arquivo atual.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { categoryFromFileName, getFormat } = require('../../../shared/formats');
const { resolveOutputPath, ensureDir } = require('./outputNamer');
const { runFfmpeg, createCancelToken } = require('./ffmpegConverter');
const { convertImage } = require('./imageConverter');
const { convertDocument } = require('./documentConverter');

const PROGRESS_THROTTLE_MS = 250;

class ConversionQueue extends EventEmitter {
  /**
   * @param {object} deps
   * @param {() => object} deps.getSettings acesso às configurações atuais
   * @param {() => {ffmpeg:object, ffprobe:object}} deps.getBinaries
   */
  constructor({ getSettings, getBinaries }) {
    super();
    this.getSettings = getSettings;
    this.getBinaries = getBinaries;
    /** @type {Array<object>} */
    this.jobs = [];
    /** 'idle' | 'running' | 'paused' */
    this.state = 'idle';
    /** Suporte a suspender processos (SIGSTOP) — indisponível no Windows */
    this.suspendSupported = process.platform !== 'win32';
    this._pumping = false;
    this._lastProgressAt = new Map();
  }

  // ------------------------------------------------------------------
  // Criação / remoção de jobs
  // ------------------------------------------------------------------

  /**
   * Adiciona arquivos à fila.
   * @param {string[]} paths caminhos absolutos selecionados pelo usuário
   * @returns {{added: object[], rejected: {path:string, reason:string}[]}}
   */
  add(paths) {
    const settings = this.getSettings();
    const added = [];
    const rejected = [];

    for (const inputPath of paths || []) {
      const category = categoryFromFileName(inputPath);
      if (!category) {
        rejected.push({ path: inputPath, reason: 'unsupported_format' });
        continue;
      }
      let fileSize = 0;
      try {
        const stat = fs.statSync(inputPath);
        if (!stat.isFile()) {
          rejected.push({ path: inputPath, reason: 'not_a_file' });
          continue;
        }
        fileSize = stat.size;
      } catch (err) {
        rejected.push({ path: inputPath, reason: 'file_not_found' });
        continue;
      }

      // Evita duplicar o mesmo arquivo na fila.
      if (this.jobs.some((job) => job.inputPath === inputPath && job.status !== 'completed')) {
        rejected.push({ path: inputPath, reason: 'duplicate' });
        continue;
      }

      const targetFormat = settings.defaultFormats[category] || null;
      const format = getFormat(targetFormat);
      const ext = path.extname(inputPath).slice(1).toLowerCase();

      const job = {
        id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        inputPath,
        fileName: path.basename(inputPath),
        inputSize: fileSize,
        inputExt: ext,
        category,
        targetFormat,
        targetExt: format ? format.ext : '',
        outputPath: null, // recalculado em refreshPreviews()
        status: 'queued', // queued | running | paused | completed | error | canceled
        progress: 0,
        speed: '',
        fps: null,
        error: null,
        outputSize: 0,
        startedAt: null,
        endedAt: null,
        pausing: false, // Windows: concluirá o arquivo atual antes de pausar
      };
      this.jobs.push(job);
      added.push(job);
    }

    this.refreshPreviews();
    this._emitSnapshot();
    return { added, rejected };
  }

  /**
   * Recalcula os caminhos de saída dos jobs ainda não iniciados
   * (usado após alterações de pasta de destino, sufixo ou formato).
   */
  refreshPreviews() {
    const settings = this.getSettings();
    for (const job of this.jobs) {
      if (job.status !== 'queued') continue;
      const format = getFormat(job.targetFormat);
      if (!format) continue;
      const target = resolveOutputPath({
        inputPath: job.inputPath,
        outputDir: settings.outputDir,
        targetExt: format.ext,
        namingMode: settings.namingMode,
        suffix: settings.suffix,
      });
      job.outputPath = target.outputPath;
      job.targetExt = format.ext;
    }
  }

  /**
   * Remove um job (cancela se estiver em execução).
   * @param {string} id
   */
  remove(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (['running', 'paused'].includes(job.status)) this._abortJob(job);
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this._emitSnapshot();
    this._pump();
  }

  /**
   * Encerra o processo de um job ativo.
   * Se o processo estiver suspenso (SIGSTOP), ele é retomado antes do kill.
   * @param {object} job
   */
  _abortJob(job) {
    if (!job._token) return;
    if (job.paused && job._token.child) {
      try { process.kill(job._token.child.pid, 'SIGCONT'); } catch (err) { /* ignore */ }
      job.paused = false;
    }
    job._token.cancel();
  }

  /** Cancela jobs em execução e limpa toda a lista. */
  clear() {
    for (const job of this.jobs) {
      if (['running', 'paused'].includes(job.status)) this._abortJob(job);
    }
    this.jobs = [];
    this.state = 'idle';
    this._emitSnapshot();
  }

  /**
   * Recoloca um job com falha/cancelado na fila.
   * @param {string} id
   */
  retry(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || !['error', 'canceled'].includes(job.status)) return;
    job.status = 'queued';
    job.progress = 0;
    job.error = null;
    job.speed = '';
    job.fps = null;
    job.startedAt = null;
    job.endedAt = null;
    job.pausing = false;
    this.refreshPreviews();
    this._emitSnapshot();
    this._pump();
  }

  // ------------------------------------------------------------------
  // Controle da fila
  // ------------------------------------------------------------------

  /** Inicia o processamento da fila. */
  start() {
    if (!this.jobs.some((job) => job.status === 'queued')) return;
    this.state = 'running';
    this._emitSnapshot();
    this._pump();
  }

  /** Pausa a fila (ver semântica no cabeçalho do arquivo). */
  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    for (const job of this.jobs) {
      if (job.status !== 'running') continue;
      if (this.suspendSupported && job._token && job._token.child) {
        try {
          process.kill(job._token.child.pid, 'SIGSTOP');
          job.status = 'paused';
          job.paused = true;
        } catch (err) {
          job.pausing = true; // não foi possível suspender: conclui o atual
        }
      } else {
        job.pausing = true;
      }
    }
    this._emitSnapshot();
  }

  /** Retoma a fila. */
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    for (const job of this.jobs) {
      if (job.status === 'paused' && job.paused && job._token && job._token.child) {
        try { process.kill(job._token.child.pid, 'SIGCONT'); } catch (err) { /* ignore */ }
        job.status = 'running';
        job.paused = false;
      }
      job.pausing = false;
    }
    this._emitSnapshot();
    this._pump();
  }

  /**
   * Cancela um job específico.
   * @param {string} id
   */
  cancel(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (['running', 'paused'].includes(job.status) && job._token) {
      this._abortJob(job);
    } else if (job.status === 'queued') {
      job.status = 'canceled';
      job.endedAt = Date.now();
      this._emitSnapshot();
      this._pump();
    }
  }

  /** Cancela tudo que está em execução ou aguardando. */
  cancelAll() {
    // 1) Retoma processos suspensos para que possam ser encerrados.
    if (this.state === 'paused') {
      this.state = 'running';
      for (const job of this.jobs) {
        if (job.status === 'paused' && job._token) {
          if (job.paused && job._token.child) {
            try { process.kill(job._token.child.pid, 'SIGCONT'); } catch (err) { /* ignore */ }
            job.paused = false;
          }
          job.status = 'running';
          job.pausing = false;
        }
      }
    }

    // 2) Encerra/cancela o que ainda não terminou.
    for (const job of this.jobs) {
      if (['running', 'paused'].includes(job.status) && job._token) {
        this._abortJob(job);
      } else if (job.status === 'queued') {
        job.status = 'canceled';
        job.endedAt = Date.now();
      }
    }

    this._emitSnapshot();
    this._pump();
  }

  /**
   * Aplica um formato de saída a todos os jobs pendentes de uma categoria.
   * @param {string} category
   * @param {string} formatId
   */
  applyFormat(category, formatId) {
    const format = getFormat(formatId);
    if (!format || format.category !== category) return;
    for (const job of this.jobs) {
      if (job.category === category && job.status === 'queued') {
        job.targetFormat = formatId;
      }
    }
    this.refreshPreviews();
    this._emitSnapshot();
  }

  /** Encerra imediatamente qualquer processo ativo (usado ao fechar o app). */
  shutdown() {
    this.state = 'idle';
    for (const job of this.jobs) {
      if (['running', 'paused'].includes(job.status)) this._abortJob(job);
    }
  }

  // ------------------------------------------------------------------
  // Execução
  // ------------------------------------------------------------------

  /** Dispara jobs até atingir o limite de concorrência. */
  _pump() {
    if (this._pumping) return;
    this._pumping = true;
    try {
      if (this.state !== 'running') return;
      const concurrency = Math.max(1, Number(this.getSettings().concurrency) || 1);

      // Jobs com falha/cancelada não voltam sozinhos: apenas 'queued'.
      let running = this.jobs.filter((job) => job.status === 'running').length;
      for (const job of this.jobs) {
        if (running >= concurrency) break;
        if (job.status !== 'queued') continue;
        running += 1;
        this._runJob(job); // assíncrono sem await (fire & forget controlado)
      }

      // Fila esgotada -> estado ocioso.
      const hasQueued = this.jobs.some((job) => job.status === 'queued');
      const hasActive = this.jobs.some((job) => ['running', 'paused'].includes(job.status));
      if (!hasQueued && !hasActive && this.state === 'running') {
        this.state = 'idle';
        this._emitSnapshot();
      }
    } finally {
      this._pumping = false;
    }
  }

  /**
   * Executa um job completo.
   * @param {object} job
   */
  async _runJob(job) {
    const settings = this.getSettings();
    const binaries = this.getBinaries();
    const token = createCancelToken();
    job._token = token;
    job.status = 'running';
    job.progress = 0;
    job.error = null;
    job.speed = '';
    job.fps = null;
    job.pausing = false;
    job.paused = false;
    job.startedAt = Date.now();
    job.endedAt = null;
    this._emitSnapshot();

    const onProgress = (payload) => this._handleProgress(job, payload);

    try {
      if (!fs.existsSync(job.inputPath)) throw new Error('input_missing');

      const format = getFormat(job.targetFormat);
      if (!format) throw new Error('invalid_target_format');

      const target = resolveOutputPath({
        inputPath: job.inputPath,
        outputDir: settings.outputDir,
        targetExt: format.ext,
        namingMode: settings.namingMode,
        suffix: settings.suffix,
      });
      if (!ensureDir(target.dir)) throw new Error('output_dir_unwritable');
      job.outputPath = target.outputPath;

      // ---- Execução por categoria ---------------------------------
      if (job.category === 'video' || job.category === 'audio') {
        if (!binaries.ffmpeg.found) throw new Error('ffmpeg_not_found');
        await runFfmpeg({
          ffmpegPath: binaries.ffmpeg.path,
          ffprobePath: binaries.ffprobe.found ? binaries.ffprobe.path : '',
          inputPath: job.inputPath,
          outputPath: target.outputPath,
          formatId: format.id,
          quality: settings.quality,
          onProgress,
          token,
        });
      } else if (job.category === 'image') {
        await convertImage({
          inputPath: job.inputPath,
          outputPath: target.outputPath,
          inputExt: job.inputExt,
          outputExt: format.ext,
          quality: settings.quality,
          binaries: {
            ffmpegPath: binaries.ffmpeg.found ? binaries.ffmpeg.path : '',
            ffprobePath: binaries.ffprobe.found ? binaries.ffprobe.path : '',
          },
          onProgress,
          token,
        });
      } else if (job.category === 'document') {
        token.throwIfCanceled();
        await convertDocument({
          inputPath: job.inputPath,
          outputPath: target.outputPath,
          inputExt: job.inputExt,
          outputExt: format.ext,
          onProgress,
        });
      } else {
        throw new Error('unsupported_category');
      }

      token.throwIfCanceled();

      const stat = fs.statSync(target.outputPath);
      job.outputSize = stat.size;
      job.progress = 100;
      job.status = 'completed';
      job.endedAt = Date.now();
      job.speed = '';
      job.fps = null;
    } catch (err) {
      job.endedAt = Date.now();
      if (err && err.canceled) {
        job.status = 'canceled';
        job.progress = 0;
      } else {
        job.status = 'error';
        job.error = (err && err.message) || 'unknown_error';
      }
    } finally {
      job._token = null;
      job.pausing = false;
      job.paused = false;
      this._lastProgressAt.delete(job.id);
      this._emitSnapshot();
      this._pump(); // libera a vaga para o próximo job
    }
  }

  /**
   * Recebe e limita (throttle) as atualizações de progresso de um job.
   * @param {object} job
   * @param {{progress?:number, speed?:string, fps?:number|null}} payload
   */
  _handleProgress(job, payload) {
    if (typeof payload.progress === 'number') {
      job.progress = Math.max(job.progress, Math.min(100, payload.progress));
    }
    if (typeof payload.speed === 'string') job.speed = payload.speed;
    if (typeof payload.fps === 'number' || payload.fps === null) job.fps = payload.fps;

    const now = Date.now();
    const last = this._lastProgressAt.get(job.id) || 0;
    if (now - last < PROGRESS_THROTTLE_MS) return;
    this._lastProgressAt.set(job.id, now);

    this.emit('progress', {
      id: job.id,
      progress: job.progress,
      speed: job.speed,
      fps: job.fps,
      elapsed: job.startedAt ? now - job.startedAt : 0,
      pausing: job.pausing,
    });
  }

  /** Emite o snapshot completo da fila para a UI. */
  _emitSnapshot() {
    this.emit('snapshot', this.snapshot());
  }

  /**
   * Estado completo (serializável) da fila.
   * @returns {{state:string, jobs:object[], stats:object}}
   */
  snapshot() {
    const stats = {
      total: this.jobs.length,
      queued: 0,
      running: 0,
      paused: 0,
      completed: 0,
      error: 0,
      canceled: 0,
    };
    for (const job of this.jobs) {
      if (Object.prototype.hasOwnProperty.call(stats, job.status)) stats[job.status] += 1;
    }
    // Progresso geral ponderado: concluídos contam 100%.
    let progressSum = 0;
    for (const job of this.jobs) {
      if (['completed', 'error'].includes(job.status)) progressSum += 100;
      else if (job.status === 'canceled') progressSum += 100;
      else progressSum += job.progress;
    }
    stats.overallProgress = stats.total ? progressSum / stats.total : 0;

    return { state: this.state, jobs: this.jobs.map((job) => ({ ...job, _token: undefined })), stats };
  }
}

module.exports = { ConversionQueue };
