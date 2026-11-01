'use strict';

/**
 * shared/formats.js
 * ------------------------------------------------------------------
 * Registro central de formatos suportados pelo MMZ Media Converter.
 * Central format registry used by both the main process (conversion
 * logic, file dialogs) and the renderer (format pickers), exchanged
 * through IPC so the renderer never needs Node.js access.
 * ------------------------------------------------------------------
 */

/** Categorias de mídia suportadas / Supported media categories. */
const CATEGORIES = ['video', 'audio', 'image', 'document'];

/** Níveis de qualidade disponíveis / Available quality levels. */
const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

/** Formatos de saída, agrupados por categoria / Output formats by category. */
const FORMATS = {
  video: [
    { id: 'mp4', label: 'MP4', ext: 'mp4' },
    { id: 'avi', label: 'AVI', ext: 'avi' },
    { id: 'mkv', label: 'MKV', ext: 'mkv' },
    { id: 'mov', label: 'MOV', ext: 'mov' },
    { id: 'wmv', label: 'WMV', ext: 'wmv' },
    { id: 'flv', label: 'FLV', ext: 'flv' },
    { id: 'webm', label: 'WebM', ext: 'webm' },
  ],
  audio: [
    { id: 'mp3', label: 'MP3', ext: 'mp3' },
    { id: 'wav', label: 'WAV', ext: 'wav' },
    { id: 'flac', label: 'FLAC', ext: 'flac' },
    { id: 'aac', label: 'AAC', ext: 'aac' },
    { id: 'ogg', label: 'OGG', ext: 'ogg' },
    { id: 'wma', label: 'WMA', ext: 'wma' },
  ],
  image: [
    { id: 'jpg', label: 'JPG', ext: 'jpg' },
    { id: 'png', label: 'PNG', ext: 'png' },
    { id: 'gif', label: 'GIF', ext: 'gif' },
    { id: 'bmp', label: 'BMP', ext: 'bmp' },
    { id: 'svg', label: 'SVG', ext: 'svg' },
    { id: 'webp', label: 'WebP', ext: 'webp' },
    { id: 'tiff', label: 'TIFF', ext: 'tiff' },
  ],
  document: [
    { id: 'pdf', label: 'PDF', ext: 'pdf' },
    { id: 'docx', label: 'DOCX', ext: 'docx' },
    { id: 'txt', label: 'TXT', ext: 'txt' },
  ],
};

/**
 * Extensões aceitas como ENTRADA, por categoria.
 * Accepted INPUT extensions per category. São deliberadamente mais
 * generosas que as de saída (ex.: .m4v, .opus, .tif, .avif entram,
 * mas não são alvos de conversão).
 */
const INPUT_EXTS = {
  video: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv', 'divx'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'aif', 'aiff', 'amr', 'ape'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tiff', 'tif', 'avif'],
  document: ['pdf', 'docx', 'txt'],
};

/** Mapeia cada extensão para a categoria correspondente / ext -> category. */
const EXT_TO_CATEGORY = Object.create(null);
for (const category of CATEGORIES) {
  for (const ext of INPUT_EXTS[category]) {
    EXT_TO_CATEGORY[ext] = category;
  }
}

/** Índice id -> formato / format id -> format descriptor. */
const FORMAT_BY_ID = Object.create(null);
for (const category of CATEGORIES) {
  for (const format of FORMATS[category]) {
    FORMAT_BY_ID[format.id] = { ...format, category };
  }
}

/** Valores CRF (libx264/libvpx-vp9) por qualidade: menor = melhor. */
const CRF_BY_QUALITY = { low: 30, medium: 23, high: 20, ultra: 17 };

/** Qualidade MPEG-4/WMV2 (q:v): menor = melhor. */
const QV_BY_QUALITY = { low: 8, medium: 5, high: 3, ultra: 2 };

/** Bitrate de áudio por qualidade, para codecs lossy. */
const AUDIO_BITRATE_BY_QUALITY = { low: '96k', medium: '160k', high: '192k', ultra: '320k' };

/** Bitrate para codecs com suporte limitado (wmav2, aac em avi). */
const AUDIO_BITRATE_SMALL_BY_QUALITY = { low: '64k', medium: '128k', high: '160k', ultra: '192k' };

/** -q:a do libvorbis (-1..10). */
const VORBIS_Q_BY_QUALITY = { low: 2, medium: 5, high: 7, ultra: 9 };

/** Qualidade JPEG usada pelo fallback via FFmpeg (q:v 2 = melhor, 31 = pior). */
const FFMPEG_JPEG_QV_BY_QUALITY = { low: 10, medium: 6, high: 4, ultra: 2 };

/** Qualidade em % usada pelo `sharp` para formatos com suporte a perda. */
const SHARP_QUALITY_BY_QUALITY = { low: 60, medium: 75, high: 88, ultra: 95 };

/**
 * Normaliza uma extensão recebida (".MP4", "mp4") para minúsculas sem ponto.
 * @param {string} ext
 * @returns {string}
 */
function normalizeExt(ext) {
  return String(ext || '').toLowerCase().replace(/^\./, '');
}

/**
 * Descobre a categoria de um arquivo pelo nome/extensão.
 * @param {string} filePath
 * @returns {'video'|'audio'|'image'|'document'|null}
 */
function categoryFromFileName(filePath) {
  const clean = String(filePath).split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  return categoryFromExt(clean.slice(dot + 1));
}

/**
 * Descobre a categoria a partir da extensão.
 * @param {string} ext
 */
function categoryFromExt(ext) {
  return EXT_TO_CATEGORY[normalizeExt(ext)] || null;
}

/**
 * @param {string} formatId
 * @returns {object|null}
 */
function getFormat(formatId) {
  return FORMAT_BY_ID[formatId] || null;
}

/**
 * Todas as extensões aceitas como entrada (para diálogos e validação).
 * @returns {string[]}
 */
function allInputExts() {
  return CATEGORIES.flatMap((category) => INPUT_EXTS[category]);
}

/**
 * Filtros prontos para o `dialog.showOpenDialog` (Electron).
 * @returns {{name: string, extensions: string[]}[]}
 */
function fileDialogFilters() {
  const filters = [
    { name: 'Media files / Arquivos de mídia', extensions: allInputExts() },
    { name: 'Video / Vídeo', extensions: INPUT_EXTS.video },
    { name: 'Audio / Áudio', extensions: INPUT_EXTS.audio },
    { name: 'Image / Imagem', extensions: INPUT_EXTS.image },
    { name: 'Document / Documento', extensions: INPUT_EXTS.document },
    { name: 'All files / Todos os arquivos', extensions: ['*'] },
  ];
  return filters;
}

/**
 * Monta os argumentos do FFmpeg que definem o FORMATO DE SAÍDA.
 * Os argumentos são inseridos entre `-i <entrada>` e `<saída>`.
 *
 * Nota: nenhum argumento é passado caso o codec precise apenas de
 * configuração por extensão (imagens BMP), por isso retorna [].
 *
 * @param {string} formatId identificador do formato de saída
 * @param {'low'|'medium'|'high'|'ultra'} quality
 * @returns {string[]}
 */
function buildFfmpegArgs(formatId, quality = 'medium') {
  const q = QUALITY_LEVELS.includes(quality) ? quality : 'medium';
  const crf = String(CRF_BY_QUALITY[q]);
  const qv = String(QV_BY_QUALITY[q]);
  const br = AUDIO_BITRATE_BY_QUALITY[q];
  const brSmall = AUDIO_BITRATE_SMALL_BY_QUALITY[q];
  const vorbisQ = String(VORBIS_Q_BY_QUALITY[q]);

  switch (formatId) {
    // ---- Vídeo ----------------------------------------------------
    case 'mp4':
    case 'mov':
      // H.264 + AAC, compatível com quase todos os players (faststart p/ streaming).
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a', 'aac', '-b:a', br, '-movflags', '+faststart'];
    case 'flv':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a', 'aac', '-b:a', br];
    case 'mkv':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', br];
    case 'webm':
      // VP9 lossless-BR (`-b:v 0` + CRF) + Opus.
      return ['-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-row-mt', '1',
        '-deadline', 'good', '-cpu-used', '2',
        '-c:a', 'libopus', '-b:a', br];
    case 'avi':
      // MPEG-4 Part 2 + MP3: máxima compatibilidade com players legados.
      return ['-c:v', 'mpeg4', '-q:v', qv, '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a', 'libmp3lame', '-b:a', br];
    case 'wmv':
      // WMV2 (Windows Media Video 9) + WMV Audio.
      return ['-c:v', 'wmv2', '-q:v', qv, '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/4)*4:trunc(ih/4)*4',
        '-c:a', 'wmav2', '-b:a', brSmall];

    // ---- Áudio (-vn remove a trilha de vídeo) ----------------------
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-b:a', br];
    case 'wav':
      // Sem perda; ultra usa 24-bit para máxima fidelidade.
      return ['-vn', '-c:a', 'pcm_s16le'].concat(q === 'ultra' ? ['-sample_fmt', 's16'] : []);
    case 'flac':
      return ['-vn', '-c:a', 'flac'];
    case 'aac':
      return ['-vn', '-c:a', 'aac', '-b:a', br];
    case 'ogg':
      return ['-vn', '-c:a', 'libvorbis', '-q:a', vorbisQ];
    case 'wma':
      return ['-vn', '-c:a', 'wmav2', '-b:a', brSmall];

    // ---- Imagens (via FFmpeg apenas como fallback) ----------------
    case 'jpg':
      return ['-frames:v', '1', '-q:v', String(FFMPEG_JPEG_QV_BY_QUALITY[q])];
    case 'png':
    case 'bmp':
    case 'gif':
    case 'webp':
    case 'tiff':
    case 'svg':
      return ['-frames:v', '1'];

    // ---- Documentos (não usam FFmpeg) -----------------------------
    default:
      return [];
  }
}

/**
 * Filtros por categoria usados na UI (quando o usuário adiciona arquivos).
 * @returns {string[]}
 */
function inputExtsFor(category) {
  return INPUT_EXTS[category] ? [...INPUT_EXTS[category]] : [];
}

module.exports = {
  CATEGORIES,
  QUALITY_LEVELS,
  FORMATS,
  INPUT_EXTS,
  SHARP_QUALITY_BY_QUALITY,
  normalizeExt,
  categoryFromExt,
  categoryFromFileName,
  getFormat,
  allInputExts,
  inputExtsFor,
  fileDialogFilters,
  buildFfmpegArgs,
};
