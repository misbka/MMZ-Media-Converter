/**
 * converters/media.js
 * Conversão de vídeo e áudio com fluent-ffmpeg.
 *
 * O app usa o binário `ffmpeg`/`ffprobe` do PATH do sistema, de um diretório
 * local (./ffmpeg/bin) ou de um caminho informado nas configurações.
 */
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

/** Extensões suportadas por categoria. */
const VIDEO_EXT = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'];

/** Tabela extensão -> tipo de mídia (ou null se não suportado). */
function mediaCategory(ext) {
  const e = String(ext || '').toLowerCase().replace('.', '');
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  return null;
}

/**
 * Configura codecs/parâmetros conforme formato de SAÍDA e qualidade.
 * Qualidade: 'high' | 'balanced' | 'small'.
 */
function buildParams(format, category, quality, keepMetadata) {
  const q = {
    high: { crf: 18, abr: '192k' },
    balanced: { crf: 23, abr: '160k' },
    small: { crf: 28, abr: '128k' }
  }[quality] || { crf: 23, abr: '160k' };

  // Metadados: mantém os da origem ou descarta conforme a preferência.
  const params = keepMetadata ? ['-map_metadata', '0'] : ['-map_metadata', '-1'];

  if (category === 'audio') {
    switch (format) {
      case 'mp3': params.push('-c:a', 'libmp3lame', '-b:a', q.abr); break;
      case 'wav': params.push('-c:a', 'pcm_s16le'); break;
      case 'flac': params.push('-c:a', 'flac'); break;
      case 'aac': params.push('-c:a', 'aac', '-b:a', q.abr); break;
      case 'ogg': params.push('-c:a', 'libvorbis', '-b:a', q.abr); break;
      case 'wma': params.push('-c:a', 'wmav2', '-b:a', q.abr); break;
      default: params.push('-c:a', 'copy');
    }
    params.push('-vn'); // descarta trilha de vídeo/capa em conversões de áudio
    return params;
  }

  // Vídeo
  switch (format) {
    case 'mp4':
    case 'mov':
      params.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(q.crf),
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.abr, '-movflags', '+faststart');
      break;
    case 'mkv':
      params.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(q.crf),
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.abr);
      break;
    case 'webm':
      params.push('-c:v', 'libvpx-vp9', '-crf', String(Number(q.crf) + 4), '-b:v', '0',
        '-c:a', 'libopus', '-b:a', q.abr);
      break;
    case 'avi':
      params.push('-c:v', 'mpeg4', '-q:v', String(Math.max(2, Math.round(Number(q.crf) / 4))),
        '-c:a', 'libmp3lame', '-b:a', q.abr);
      break;
    case 'wmv':
      params.push('-c:v', 'wmv2', '-q:v', String(Math.max(2, Math.round(Number(q.crf) / 4))),
        '-c:a', 'wmav2', '-b:a', q.abr);
      break;
    case 'flv':
      params.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(q.crf),
        '-c:a', 'aac', '-b:a', q.abr);
      break;
    default:
      params.push('-c', 'copy');
  }
  return params;
}

/**
 * Converte um arquivo de vídeo/áudio.
 * @param {object} opts
 * @param {string} opts.input Caminho de origem.
 * @param {string} opts.output Caminho de destino.
 * @param {string} opts.format Extensão/formato de saída.
 * @param {string} opts.category 'video' | 'audio'.
 * @param {string} opts.quality 'high' | 'balanced' | 'small'.
 * @param {boolean} opts.keepMetadata
 * @param {string} [opts.ffmpegPath]
 * @param {function} [opts.onProgress] Callback ({ percent, timemark, fps }).
 * @param {function} [opts.onCancellable] Recebe a função que mata o processo.
 */
async function convertMedia(opts) {
  const { input, output, format, category, quality, keepMetadata, ffmpegPath, onProgress, onCancellable } = opts;

  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = ffmpeg(input)
        .output(output)
        .outputOptions(buildParams(format, category, quality, keepMetadata))
        .on('progress', (p) => {
          // `percent` pode vir indefinido em alguns contêineres; normalizamos.
          const percent = Number.isFinite(p.percent)
            ? Math.min(99, Math.max(0, p.percent))
            : null;
          if (onProgress) onProgress({ percent, timemark: p.timemark, fps: p.currentFps });
        })
        .on('error', (err) => {
          // Interrupções manuais chegam como erro; sinalizamos como cancelamento.
          if (err && /SIGKILL|killed|aborted/i.test(String(err.message))) {
            const e = new Error('Conversão cancelada');
            e.canceled = true;
            return reject(e);
          }
          reject(err);
        })
        .on('end', () => resolve());
    } catch (err) {
      return reject(err);
    }

    if (onCancellable) onCancellable(() => proc.kill('SIGKILL'));
  });
}

module.exports = { convertMedia, mediaCategory, VIDEO_EXT, AUDIO_EXT };
