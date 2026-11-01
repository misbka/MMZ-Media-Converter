'use strict';

/**
 * src/main/conversion/imageConverter.js
 * ------------------------------------------------------------------
 * Conversão de IMAGENS usando a biblioteca `sharp` (rápida, nativa).
 *
 * Regras:
 *  - `sharp` não suporta BMP  -> fallback automático para o FFmpeg;
 *  - SVG de saída a partir de raster é gerado embutindo a imagem
 *    em base64 dentro de um SVG (container válido e leve);
 *  - SVG -> SVG apenas regrava o arquivo;
 *  - animações (GIF/WebP) são preservadas quando o formato alvo suporta.
 *
 * Em caso de falha do `sharp`, tentamos o FFmpeg como último recurso.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const sharp = require('sharp');
const { SHARP_QUALITY_BY_QUALITY, normalizeExt } = require('../../../shared/formats');
const { runFfmpeg, createCancelToken } = require('./ffmpegConverter');

/** Formatos que o `sharp` lê (entrada). */
const SHARP_INPUT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'svg']);
/** Formatos que o `sharp` grava (saída). */
const SHARP_OUTPUT = new Set(['jpg', 'png', 'webp', 'gif', 'tiff', 'avif']);
/** Formatos de saída que suportam animação. */
const ANIMATED_OUTPUT = new Set(['gif', 'webp']);
/** Formatos de entrada animados. */
const ANIMATED_INPUT = new Set(['gif', 'webp']);

/** MIME types usados ao embutir a imagem dentro de um SVG. */
const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
  avif: 'image/avif',
};

/**
 * Escreve um SVG contendo a imagem original embutida em base64.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} inputExt
 */
async function rasterToSvg(inputPath, outputPath, inputExt) {
  const metadata = await sharp(inputPath, { animated: true }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const mime = MIME_BY_EXT[normalizeExt(inputExt)] || 'application/octet-stream';
  const data = fs.readFileSync(inputPath).toString('base64');

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" xlink:href="data:${mime};base64,${data}" ` +
    `href="data:${mime};base64,${data}"/></svg>\n`;
  fs.writeFileSync(outputPath, svg, 'utf8');
}

/**
 * Pipeline `sharp` aplicando qualidade no formato de destino.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} inputExt
 * @param {string} outputExt
 * @param {string} quality nível ('low' | 'medium' | 'high' | 'ultra')
 */
async function sharpPipeline(inputPath, outputPath, inputExt, outputExt, quality) {
  const level = quality in SHARP_QUALITY_BY_QUALITY ? quality : 'medium';
  const percent = SHARP_QUALITY_BY_QUALITY[level];

  const animated = ANIMATED_INPUT.has(normalizeExt(inputExt)) && ANIMATED_OUTPUT.has(normalizeExt(outputExt));
  let pipeline = sharp(inputPath, animated ? { animated: true } : {});

  // Auto-rotação pela orientação EXIF (importante para fotos JPEG -> PNG).
  if (!animated) pipeline = pipeline.rotate();

  switch (outputExt) {
    case 'jpg':
      pipeline = pipeline.jpeg({ quality: percent, mozjpeg: true, progressive: true });
      break;
    case 'png':
      // PNG é sem perda por padrão; abaixo de 100% usamos paleta
      // quantizada para aplicar a qualidade escolhida.
      pipeline = percent < 100
        ? pipeline.png({ palette: true, quality: percent, compressionLevel: 9 })
        : pipeline.png({ compressionLevel: 9 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: percent });
      break;
    case 'gif':
      pipeline = pipeline.gif({ quality: percent, colours: 256 });
      break;
    case 'tiff':
      pipeline = pipeline.tiff({ quality: percent, compression: 'jpeg' });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality: percent });
      break;
    default:
      throw new Error(`unsupported_sharp_output: ${outputExt}`);
  }

  await pipeline.toFile(outputPath);
}

/**
 * Converte uma imagem.
 *
 * @param {object} options
 * @param {string} options.inputPath
 * @param {string} options.outputPath
 * @param {string} options.inputExt
 * @param {string} options.outputExt
 * @param {string} options.quality
 * @param {object} options.binaries {ffmpegPath, ffprobePath}
 * @param {(p: {progress:number}) => void} [options.onProgress]
 * @param {object} [options.token]
 */
async function convertImage({
  inputPath,
  outputPath,
  inputExt,
  outputExt,
  quality,
  binaries,
  onProgress = () => {},
  token = createCancelToken(),
}) {
  const inExt = normalizeExt(inputExt);
  const outExt = normalizeExt(outputExt);
  onProgress({ progress: 5 });

  // 1) SVG de saída a partir de qualquer raster: embute os dados.
  if (outExt === 'svg') {
    if (inExt === 'svg') {
      await fs.promises.copyFile(inputPath, outputPath); // SVG -> SVG: sem re-encode
    } else {
      await rasterToSvg(inputPath, outputPath, inExt);
    }
    token.throwIfCanceled();
    onProgress({ progress: 100 });
    return { engine: 'svg-wrapper' };
  }

  // 2) Caminho principal: `sharp`.
  if (SHARP_INPUT.has(inExt) && SHARP_OUTPUT.has(outExt)) {
    try {
      await sharpPipeline(inputPath, outputPath, inExt, outExt, quality);
      token.throwIfCanceled();
      onProgress({ progress: 100 });
      return { engine: 'sharp' };
    } catch (err) {
      token.throwIfCanceled();
      // Limpa saída parcial antes de tentar o FFmpeg.
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }

      if (!binaries.ffmpegPath) throw err;

      // 3) Fallback: FFmpeg (ex.: BMP que o `sharp` não suporta).
      await runFfmpeg({
        ffmpegPath: binaries.ffmpegPath,
        ffprobePath: binaries.ffprobePath,
        inputPath,
        outputPath,
        formatId: outExt,
        quality,
        onProgress,
        token,
      });
      return { engine: 'ffmpeg-fallback' };
    }
  }

  // 4) Formatos fora do alcance do `sharp` (BMP, etc.): FFmpeg direto.
  if (!binaries.ffmpegPath) {
    throw new Error('ffmpeg_not_found');
  }
  await runFfmpeg({
    ffmpegPath: binaries.ffmpegPath,
    ffprobePath: binaries.ffprobePath,
    inputPath,
    outputPath,
    formatId: outExt,
    quality,
    onProgress,
    token,
  });
  return { engine: 'ffmpeg' };
}

module.exports = { convertImage, SHARP_INPUT, SHARP_OUTPUT };
