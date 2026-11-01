'use strict';

/**
 * src/main/conversion/ffmpegConverter.js
 * ------------------------------------------------------------------
 * Executa conversões de VÍDEO e ÁUDIO (e fallback de IMAGENS)
 * chamando o FFmpeg encontrado em `ffmpeg/bin/`.
 *
 * Características:
 *  - progresso real via `-progress pipe:1` (não trava a interface);
 *  - duração total obtida com `ffprobe` para calcular o %;
 *  - cancelamento por kill do processo filho;
 *  - mensagens de erro legíveis vindas do stderr do FFmpeg.
 * ------------------------------------------------------------------
 */

const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { buildFfmpegArgs } = require('../../../shared/formats');

/**
 * Token de cancelamento compartilhado com a fila.
 * @typedef {{canceled: boolean, child: import('child_process').ChildProcess|null,
 *            cancel: () => void, throwIfCanceled: () => void}} CancelToken
 */

/**
 * Cria um token de cancelamento simples.
 * @returns {CancelToken}
 */
function createCancelToken() {
  const token = {
    canceled: false,
    child: null,
    cancel() {
      this.canceled = true;
      if (this.child && !this.child.killed) {
        try {
          this.child.kill('SIGKILL');
        } catch (err) {
          /* processo já encerrado */
        }
      }
    },
    throwIfCanceled() {
      if (this.canceled) {
        const err = new Error('canceled');
        err.canceled = true;
        throw err;
      }
    },
  };
  return token;
}

/**
 * Consulta a duração (segundos) de um arquivo de áudio/vídeo via ffprobe.
 * @param {string} ffprobePath
 * @param {string} inputPath
 * @returns {Promise<number|null>} null quando desconhecida (ex.: imagem)
 */
function probeDuration(ffprobePath, inputPath) {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(null);
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ];
    const child = spawn(ffprobePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const value = parseFloat(out.trim());
      resolve(Number.isFinite(value) && value > 0 ? value : null);
    });
  });
}

/**
 * Extrai uma mensagem de erro útil a partir do stderr do FFmpeg.
 * @param {string} stderr
 * @returns {string}
 */
function cleanFfmpegError(stderr) {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return 'ffmpeg_failed';
  // Preferimos linhas que contenham "error"/"invalid"/"no such"
  const interesting = lines.filter((l) => /(error|invalid|no such|unable|failed|not found)/i.test(l));
  const chosen = interesting.length ? interesting : lines.slice(-3);
  return chosen.join('\n').slice(0, 600);
}

/**
 * Converte um arquivo com FFmpeg.
 *
 * @param {object} options
 * @param {string} options.ffmpegPath
 * @param {string} options.ffprobePath
 * @param {string} options.inputPath
 * @param {string} options.outputPath
 * @param {string} options.formatId formato de saída (registro compartilhado)
 * @param {string} options.quality
 * @param {(progress: {progress:number, speed?:string, fps?:number|null}) => void} [options.onProgress]
 * @param {CancelToken} [options.token]
 * @param {string[]} [options.extraArgs] argumentos extras (imagens, etc.)
 * @returns {Promise<{duration: number|null}>}
 */
function runFfmpeg({
  ffmpegPath,
  ffprobePath,
  inputPath,
  outputPath,
  formatId,
  quality,
  onProgress = () => {},
  token = createCancelToken(),
  extraArgs = null,
}) {
  return new Promise((resolve, reject) => {
    token.throwIfCanceled();

    const outputArgs = extraArgs || buildFfmpegArgs(formatId, quality);
    const args = [
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-loglevel', 'error',
      '-y',
      '-progress', 'pipe:1',
      '-i', inputPath,
      ...outputArgs,
      outputPath,
    ];

    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    token.child = child;

    let stderr = '';
    let duration = null;
    let lastEmit = 0;
    let progressEnded = false;

    // `ffprobe` roda em paralelo: não bloqueia o início da conversão.
    probeDuration(ffprobePath, inputPath).then((value) => { duration = value; });

    // Linhas do FFmpeg no formato `chave=valor` (módulo -progress).
    const stdoutLines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutLines.on('line', (line) => {
      const idx = line.indexOf('=');
      if (idx < 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();

      if (key === 'out_time_us' || key === 'out_time_ms') {
        // Observação: `out_time_ms` também é emitido em MICROSEGUNDOS.
        const us = parseInt(value, 10);
        if (!Number.isFinite(us) || us < 0) return;
        let percent = 0;
        if (duration) percent = Math.min(99, (us / 1e6 / duration) * 100);
        const now = Date.now();
        if (now - lastEmit >= 200) {
          lastEmit = now;
          onProgress({ progress: percent });
        }
      } else if (key === 'speed') {
        onProgress({ speed: value });
      } else if (key === 'fps') {
        const fps = parseFloat(value);
        onProgress({ fps: Number.isFinite(fps) ? fps : null });
      } else if (key === 'progress' && value === 'end') {
        progressEnded = true;
        onProgress({ progress: 100 });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });

    child.on('error', (err) => {
      token.child = null;
      reject(new Error(`spawn_failed: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      token.child = null;
      stdoutLines.close();

      if (token.canceled || signal === 'SIGKILL') {
        // Remove o arquivo parcial cancelado.
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
        const err = new Error('canceled');
        err.canceled = true;
        return reject(err);
      }

      if (code !== 0) {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
        const err = new Error(cleanFfmpegError(stderr));
        err.stderr = stderr;
        return reject(err);
      }

      // Validação de sanidade: saída precisa existir e não ser vazia.
      let size = 0;
      try {
        size = fs.statSync(outputPath).size;
      } catch (e) {
        return reject(new Error('output_missing'));
      }
      if (size === 0) {
        try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
        return reject(new Error('output_empty'));
      }

      if (!progressEnded) onProgress({ progress: 100 });
      resolve({ duration });
    });
  });
}

/**
 * Converte um arquivo de áudio/vídeo (atalho semântico usado pela fila).
 * @param {object} params mesmos campos de `runFfmpeg`
 */
async function convertMedia(params) {
  return runFfmpeg(params);
}

module.exports = { runFfmpeg, convertMedia, probeDuration, createCancelToken, cleanFfmpegError };
