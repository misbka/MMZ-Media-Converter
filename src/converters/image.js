/**
 * converters/image.js
 * Conversão de imagens com a biblioteca `sharp`.
 * Saídas não suportadas pelo sharp (ex.: BMP) são roteadas para o ffmpeg.
 */
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');

/** Extensões de imagem reconhecidas. */
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tiff', 'tif'];

/** Formatos que o `sharp` consegue escrever. */
const SHARP_WRITE = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif'];

/**
 * Converte uma imagem.
 * @param {object} opts
 * @param {string} opts.input Caminho de origem.
 * @param {string} opts.output Caminho de destino.
 * @param {string} opts.format Extensão de saída.
 * @param {string} opts.quality 'high' | 'balanced' | 'small'.
 * @param {string} [opts.ffmpegPath] Usado apenas para saídas fora do sharp.
 * @param {function} [opts.onProgress] Callback ({ percent }).
 */
async function convertImage(opts) {
  const { input, output, format, quality, ffmpegPath, onProgress } = opts;
  const fmt = format === 'jpeg' ? 'jpg' : format;
  const report = (percent) => onProgress && onProgress({ percent });

  report(5);

  // BMP (e outros formatos fora do sharp) => usa ffmpeg como fallback.
  if (!SHARP_WRITE.includes(fmt)) {
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .output(output)
        .on('progress', (p) => report(Number.isFinite(p.percent) ? Math.min(99, p.percent) : null))
        .on('error', reject)
        .on('end', resolve)
        .run();
    });
  }

  const q = { high: 95, balanced: 85, small: 70 }[quality] || 85;
  // Animações (GIF/WebP animado) são preservadas quando o alvo suporta.
  const animated = ['gif', 'webp'].includes(fmt);
  let pipeline = sharp(input, animated ? { animated: true } : {});

  switch (fmt) {
    case 'jpg':
      pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: quality === 'small' ? 9 : 6 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: q });
      break;
    case 'gif':
      pipeline = pipeline.gif();
      break;
    case 'tiff':
      pipeline = pipeline.tiff({ quality: q, compression: 'lzw' });
      break;
  }

  report(40);
  await pipeline.toFile(output);
  report(100);
}

module.exports = { convertImage, IMAGE_EXT };
