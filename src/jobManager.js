/**
 * jobManager.js
 * Motor de fila de conversões: limite de concorrência, pausa, retomada,
 * cancelamento e tratamento de erros. Emite 'update' a cada mudança.
 */
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { convertMedia, mediaCategory } = require('./converters/media');
const { convertImage, IMAGE_EXT } = require('./converters/image');
const { convertDocument, DOC_EXT } = require('./converters/document');

class JobManager extends EventEmitter {
  /**
   * @param {function} getSettings Retorna as configurações atuais do app.
   */
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.jobs = new Map();    // id -> job
    this.order = [];          // ids na ordem de entrada
    this.running = new Set(); // ids em execução
    this.paused = false;
  }

  /**
   * Cria os jobs a partir de caminhos de arquivo.
   * @param {string[]} filePaths
   * @param {object} options { outputDir, fileNameMode, fileNameSuffix, fileNamePrefix, quality }
   * @returns {object[]} jobs criados
   */
  addFiles(filePaths, options = {}) {
    const settings = this.getSettings();
    const created = [];

    for (const input of filePaths) {
      const ext = path.extname(input).slice(1).toLowerCase();
      const category = this._detectCategory(ext);
      if (!category) continue; // extensão não suportada

      const format = options.formats?.[ext] || this._defaultFormat(ext, category);
      const output = this._buildOutputPath(input, format, { ...settings, ...options });

      const job = {
        id: crypto.randomUUID(),
        input,
        output,
        category,                    // 'video' | 'audio' | 'image' | 'document'
        from: ext,
        to: format,
        quality: options.quality || settings.quality,
        status: 'queued',            // queued | processing | completed | error | canceled
        progress: 0,
        message: '',
        cancellable: null            // registrado pelo converter para cancelamento
      };
      this.jobs.set(job.id, job);
      this.order.push(job.id);
      created.push({ ...job });
    }

    created.forEach((j) => this._emit(this.jobs.get(j.id)));
    return created;
  }

  /** Categorias aceitas por extensão. */
  _detectCategory(ext) {
    if (mediaCategory(ext)) return mediaCategory(ext);
    if (IMAGE_EXT.includes(ext)) return 'image';
    if (DOC_EXT.includes(ext)) return 'document';
    return null;
  }

  /** Formato padrão de saída por extensão de entrada. */
  _defaultFormat(ext, category) {
    const map = {
      avi: 'mp4', flv: 'mp4', mkv: 'mp4', mov: 'mp4', wmv: 'mp4', webm: 'mp4', mp4: 'mkv',
      wav: 'mp3', flac: 'mp3', aac: 'mp3', ogg: 'mp3', wma: 'mp3', mp3: 'wav',
      jpg: 'png', jpeg: 'png', png: 'jpg', gif: 'png', bmp: 'png', svg: 'png',
      webp: 'png', tiff: 'png', tif: 'png',
      docx: 'txt', pdf: 'txt', txt: 'pdf'
    };
    return map[ext] || (category === 'audio' ? 'mp3' : 'mp4');
  }

  /** Monta o caminho de saída respeitando o modo de nome e evitando colisões. */
  _buildOutputPath(input, format, opts) {
    const dir = opts.outputDir || this.getSettings().resolveOutputDir();
    const base = path.basename(input, path.extname(input));
    const mode = opts.fileNameMode || 'keep';

    let name = base;
    if (mode === 'suffix') name = base + (opts.fileNameSuffix ?? '_convertido');
    if (mode === 'prefix') name = (opts.fileNamePrefix ?? '') + base;

    let candidate = path.join(dir, `${name}.${format}`);
    let counter = 1;
    // Evita sobrescrever: acrescenta " (1)", " (2)"... quando já existe.
    while (fs.existsSync(candidate) && !opts.overwriteExisting) {
      candidate = path.join(dir, `${name} (${counter++}).${format}`);
    }
    return candidate;
  }

  /** Inicia o processamento da fila. */
  start() {
    this.paused = false;
    this.emit('resumed');
    this._pump();
  }

  /** Pausa: não inicia novos jobs; os em execução terminam normalmente. */
  pause() {
    this.paused = true;
    this.emit('paused');
  }

  /** Retoma a fila após pausa. */
  resume() {
    this.paused = false;
    this.emit('resumed');
    this._pump();
  }

  /** Cancela um job específico (na fila ou em execução). */
  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === 'processing' && typeof job.cancellable === 'function') {
      job.cancellable(); // interrompe o processo ffmpeg
    } else if (job.status === 'queued') {
      job.status = 'canceled';
      job.message = 'Cancelado';
      this._emit(job);
    }
  }

  /** Cancela todos os jobs pendentes e em execução. */
  cancelAll() {
    for (const id of [...this.order]) {
      const job = this.jobs.get(id);
      if (job && ['queued', 'processing'].includes(job.status)) this.cancel(id);
    }
  }

  /**
   * Altera o formato de saída de um job ainda não em execução,
   * recalculando o caminho de destino.
   */
  setFormat(jobId, format) {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'processing') return job;

    job.to = format;
    job.output = this._buildOutputPath(job.input, format, this.getSettings());
    job.status = 'queued';
    job.progress = 0;
    job.message = '';
    this._emit(job);
    this._pump();
    return job;
  }

  /** Remove da lista os jobs concluídos/errados/cancelados. */
  clearFinished() {
    this.order = this.order.filter((id) => {
      const job = this.jobs.get(id);
      if (job && ['completed', 'error', 'canceled'].includes(job.status)) {
        this.jobs.delete(id);
        return false;
      }
      return true;
    });
    this.emit('cleared');
  }

  /** Inicia novos jobs respeitando pausa e concorrência máxima. */
  _pump() {
    if (this.paused) return;
    const { maxConcurrent } = this.getSettings();

    for (const id of this.order) {
      if (this.running.size >= maxConcurrent) break;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      this._run(job);
    }

    // Sinaliza "fila ociosa" quando não há mais nada rodando ou pendente.
    const pending = this.order.some((id) => {
      const j = this.jobs.get(id);
      return j && ['queued', 'processing'].includes(j.status);
    });
    if (!pending) this.emit('idle');
  }

  /** Executa um job, reportando progresso, erros e cancelamentos. */
  async _run(job) {
    this.running.add(job.id);
    job.status = 'processing';
    job.progress = 0;
    job.message = 'Convertendo...';
    this._emit(job);

    const settings = this.getSettings();
    const onProgress = ({ percent }) => {
      if (typeof percent === 'number') {
        job.progress = Math.round(percent);
        this._emit(job);
      }
    };
    const onCancellable = (fn) => { job.cancellable = fn; };

    try {
      fs.mkdirSync(path.dirname(job.output), { recursive: true });

      if (job.category === 'video' || job.category === 'audio') {
        await convertMedia({
          input: job.input,
          output: job.output,
          format: job.to,
          category: job.category,
          quality: job.quality,
          keepMetadata: settings.keepMetadata,
          ffmpegPath: settings.ffmpegPath,
          onProgress,
          onCancellable
        });
      } else if (job.category === 'image') {
        await convertImage({
          input: job.input,
          output: job.output,
          format: job.to,
          quality: job.quality,
          ffmpegPath: settings.ffmpegPath,
          onProgress
        });
      } else {
        await convertDocument({
          input: job.input,
          output: job.output,
          from: job.from,
          to: job.to,
          onProgress
        });
      }

      job.status = 'completed';
      job.progress = 100;
      job.message = 'OK';
    } catch (err) {
      if (err && err.canceled) {
        job.status = 'canceled';
        job.message = 'Cancelado';
      } else {
        job.status = 'error';
        job.message = err?.message || 'Erro desconhecido';
        // Remove a saída parcial para não poluir o diretório de destino.
        try { if (fs.existsSync(job.output)) fs.unlinkSync(job.output); } catch { /* ignora */ }
      }
    } finally {
      job.cancellable = null;
      this.running.delete(job.id);
      this._emit(job);
      this._pump(); // libera a vaga para o próximo da fila
    }
  }

  _emit(job) {
    if (job) this.emit('update', { ...job });
  }
}

module.exports = { JobManager };
