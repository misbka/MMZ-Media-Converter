'use strict';

/**
 * scripts/smoke-test.js
 * ------------------------------------------------------------------
 * Teste de fumaça dos conversores SEM abrir o Electron.
 *
 * Valida:
 *   1. localização dos binários em `ffmpeg/bin/`;
 *   2. conversão de VÍDEO para todos os formatos de saída;
 *   3. conversão de ÁUDIO para todos os formatos de saída;
 *   4. conversão de IMAGEM (sharp + fallback FFmpeg, incl. BMP/SVG);
 *   5. conversão de DOCUMENTOS (TXT/PDF/DOCX nos dois sentidos);
 *   6. fila de conversão (concorrência, nomenclatura e eventos).
 *
 * Uso:  npm run smoke
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { locateAll, resolveBinDir } = require('../src/main/binaryLocator');
const { runFfmpeg } = require('../src/main/conversion/ffmpegConverter');
const { convertImage } = require('../src/main/conversion/imageConverter');
const { convertDocument } = require('../src/main/conversion/documentConverter');
const { resolveOutputPath } = require('../src/main/conversion/outputNamer');
const { ConversionQueue } = require('../src/main/conversion/queue');
const { FORMATS, CATEGORIES, buildFfmpegArgs } = require('../shared/formats');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(os.tmpdir(), 'mmz-media-converter-smoke');
const START = Date.now();

let passed = 0;
let failed = 0;

/** @param {string} name @param {() => any} fn */
async function check(name, fn) {
  try {
    const detail = await fn();
    passed += 1;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name} — ${err && err.message ? err.message : err}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'asserção falhou');
}

/** Garante que um arquivo existe e não está vazio. */
function assertFile(file, minSize = 1) {
  assert(fs.existsSync(file), `arquivo não gerado: ${file}`);
  const size = fs.statSync(file).size;
  assert(size >= minSize, `arquivo vazio/pequeno (${size} B): ${file}`);
  return `${(size / 1024).toFixed(1)} KB`;
}

async function main() {
  console.log(`\n== MMZ Media Converter · smoke test ==\n   pasta: ${WORK}\n`);
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  // ------------------------------------------------------------------
  // 1) Binários do FFmpeg
  // ------------------------------------------------------------------
  const binDir = resolveBinDir(false, ROOT, process.resourcesPath);
  const binaries = locateAll({ binDir });
  await check('FFmpeg localizado em ffmpeg/bin', () => {
    assert(binaries.ffmpeg.found, `ffmpeg não encontrado (procurado em ${binDir})`);
    assert(binaries.ffprobe.found, 'ffprobe não encontrado');
    return `${binaries.ffmpeg.version || 's/versão'} [${binaries.ffmpeg.source}]`;
  });

  const ffmpeg = binaries.ffmpeg.path;
  const ffprobe = binaries.ffprobe.found ? binaries.ffprobe.path : '';

  // ------------------------------------------------------------------
  // 2) Gera mídia de teste com o próprio FFmpeg
  // ------------------------------------------------------------------
  const sampleVideo = path.join(WORK, 'sample.mp4');
  await check('gera vídeo de teste (2s, com áudio)', () => {
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      sampleVideo,
    ], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg falhou');
    return assertFile(sampleVideo);
  });

  const samplePng = path.join(WORK, 'sample.png');
  await check('gera imagem PNG de teste (sharp)', async () => {
    const sharp = require('sharp');
    await sharp({
      create: { width: 320, height: 200, channels: 3, background: { r: 40, g: 120, b: 220 } },
    }).png().toFile(samplePng);
    return assertFile(samplePng);
  });

  const sampleTxt = path.join(WORK, 'sample.txt');
  fs.writeFileSync(sampleTxt,
    'MMZ Media Converter — teste de conversão\n' +
    'Linha com acentuação: çãõéíóú, ¡¿Español!\n\n' +
    'The quick brown fox jumps over the lazy dog.\n'.repeat(4), 'utf8');

  const sampleBmp = path.join(WORK, 'sample.bmp');
  await check('gera imagem BMP de teste (ffmpeg)', () => {
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', samplePng, '-frames:v', '1', sampleBmp,
    ], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg falhou');
    return assertFile(sampleBmp);
  });

  // ------------------------------------------------------------------
  // 3) Conversão de VÍDEO para todos os formatos de saída
  // ------------------------------------------------------------------
  console.log('\n-- vídeo --');
  for (const format of FORMATS.video) {
    await check(`vídeo -> ${format.label}`, async () => {
      const target = path.join(WORK, `out_video.${format.ext}`);
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        ffprobePath: ffprobe,
        inputPath: sampleVideo,
        outputPath: target,
        formatId: format.id,
        quality: 'medium',
      });
      return assertFile(target, 512);
    });
  }

  // ------------------------------------------------------------------
  // 4) Conversão de ÁUDIO para todos os formatos de saída
  // ------------------------------------------------------------------
  console.log('\n-- áudio --');
  for (const format of FORMATS.audio) {
    await check(`áudio -> ${format.label}`, async () => {
      const target = path.join(WORK, `out_audio.${format.ext}`);
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        ffprobePath: ffprobe,
        inputPath: sampleVideo, // extrai a trilha do vídeo
        outputPath: target,
        formatId: format.id,
        quality: 'high',
      });
      return assertFile(target, 256);
    });
  }

  // ------------------------------------------------------------------
  // 5) Conversão de IMAGENS
  // ------------------------------------------------------------------
  console.log('\n-- imagem --');
  const imageBinaries = { ffmpegPath: ffmpeg, ffprobePath: ffprobe };
  for (const format of FORMATS.image.filter((f) => f.id !== 'svg')) {
    await check(`png -> ${format.label}`, async () => {
      const target = path.join(WORK, `out_image.${format.ext}`);
      await convertImage({
        inputPath: samplePng,
        outputPath: target,
        inputExt: 'png',
        outputExt: format.ext,
        quality: 'high',
        binaries: imageBinaries,
      });
      return assertFile(target, 64);
    });
  }

  await check('png -> SVG (container com imagem embutida)', async () => {
    const target = path.join(WORK, 'out_image.svg');
    await convertImage({
      inputPath: samplePng, outputPath: target,
      inputExt: 'png', outputExt: 'svg',
      quality: 'high', binaries: imageBinaries,
    });
    const content = fs.readFileSync(target, 'utf8');
    assert(content.includes('<svg') && content.includes('base64,'), 'SVG inválido');
    return assertFile(target, 128);
  });

  await check('bmp -> jpg (fallback FFmpeg)', async () => {
    const target = path.join(WORK, 'out_from_bmp.jpg');
    await convertImage({
      inputPath: sampleBmp, outputPath: target,
      inputExt: 'bmp', outputExt: 'jpg',
      quality: 'medium', binaries: imageBinaries,
    });
    return assertFile(target, 128);
  });

  // ------------------------------------------------------------------
  // 6) Conversão de DOCUMENTOS
  // ------------------------------------------------------------------
  console.log('\n-- documentos --');
  const pdfFile = path.join(WORK, 'out_doc.pdf');
  const docxFile = path.join(WORK, 'out_doc.docx');
  const txtFromPdf = path.join(WORK, 'out_from_pdf.txt');
  const txtFromDocx = path.join(WORK, 'out_from_docx.txt');
  const pdfFromDocx = path.join(WORK, 'out_from_docx.pdf');
  const docxFromPdf = path.join(WORK, 'out_from_pdf.docx');

  await check('txt -> pdf', async () => {
    await convertDocument({
      inputPath: sampleTxt, outputPath: pdfFile, inputExt: 'txt', outputExt: 'pdf',
    });
    const head = fs.readFileSync(pdfFile).slice(0, 5).toString('latin1');
    assert(head === '%PDF-', 'cabeçalho PDF inválido');
    return assertFile(pdfFile, 256);
  });

  await check('txt -> docx', async () => {
    await convertDocument({
      inputPath: sampleTxt, outputPath: docxFile, inputExt: 'txt', outputExt: 'docx',
    });
    return assertFile(docxFile, 256);
  });

  await check('pdf -> txt (pdf-parse)', async () => {
    await convertDocument({
      inputPath: pdfFile, outputPath: txtFromPdf, inputExt: 'pdf', outputExt: 'txt',
    });
    const text = fs.readFileSync(txtFromPdf, 'utf8');
    assert(text.includes('MMZ Media Converter'), 'texto não extraído do PDF');
    return assertFile(txtFromPdf, 32);
  });

  await check('docx -> txt (mammoth)', async () => {
    await convertDocument({
      inputPath: docxFile, outputPath: txtFromDocx, inputExt: 'docx', outputExt: 'txt',
    });
    const text = fs.readFileSync(txtFromDocx, 'utf8');
    assert(text.includes('MMZ Media Converter'), 'texto não extraído do DOCX');
    return assertFile(txtFromDocx, 32);
  });

  await check('docx -> pdf', async () => {
    await convertDocument({
      inputPath: docxFile, outputPath: pdfFromDocx, inputExt: 'docx', outputExt: 'pdf',
    });
    return assertFile(pdfFromDocx, 256);
  });

  await check('pdf -> docx', async () => {
    await convertDocument({
      inputPath: pdfFile, outputPath: docxFromPdf, inputExt: 'pdf', outputExt: 'docx',
    });
    return assertFile(docxFromPdf, 256);
  });

  // ------------------------------------------------------------------
  // 7) Fila de conversão (concorrência, nomenclatura, eventos)
  // ------------------------------------------------------------------
  console.log('\n-- fila --');
  await check('fila processa múltiplos arquivos', async () => {
    const settings = {
      quality: 'medium',
      outputDir: path.join(WORK, 'saida'),
      namingMode: 'suffix',
      suffix: '_conv',
      defaultFormats: { video: 'mkv', audio: 'mp3', image: 'webp', document: 'txt' },
      concurrency: 2,
    };
    const queue = new ConversionQueue({
      getSettings: () => ({ ...settings }),
      getBinaries: () => binaries,
    });

    let progressEvents = 0;
    queue.on('progress', () => { progressEvents += 1; });

    const audioOnly = path.join(WORK, 'sample_audio.mp3');
    spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', sampleVideo,
      '-vn', '-c:a', 'libmp3lame', audioOnly], { encoding: 'utf8', windowsHide: true });

    const { added, rejected } = queue.add([sampleVideo, audioOnly, samplePng, sampleTxt]);
    assert(added.length === 4, `esperava 4 jobs, obteve ${added.length}`);
    assert(rejected.length === 0, `rejeições inesperadas: ${JSON.stringify(rejected)}`);

    const done = new Promise((resolve) => {
      queue.on('snapshot', (snap) => {
        if (snap.state === 'idle' && snap.stats.queued === 0 && snap.stats.running === 0) resolve(snap);
      });
    });
    queue.start();
    const final = await Promise.race([
      done,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout da fila (60s)')), 60000)),
    ]);

    assert(final.stats.completed === 4, `concluídos=${final.stats.completed} erros=${final.stats.error}`);
    assert(progressEvents > 0, 'nenhum evento de progresso recebido');

    for (const job of final.jobs) {
      assertFile(job.outputPath, 32);
      assert(job.outputPath.includes('_conv'), `sufixo não aplicado: ${job.outputPath}`);
    }
    return `4/4 ok, ${progressEvents} eventos de progresso`;
  });

  await check('nomenclador evita sobrescrever e protege a origem', () => {
    const src = path.join(WORK, 'sample.png');
    const request = {
      inputPath: src, outputDir: WORK, targetExt: 'png', namingMode: 'keep', suffix: '',
    };
    // 1) Mesmo formato/pasta: não pode apontar para o arquivo de origem.
    const first = resolveOutputPath(request);
    assert(first.outputPath !== src, 'deveria renomear para não sobrescrever a origem');
    fs.writeFileSync(first.outputPath, 'placeholder'); // simula saída já existente

    // 2) Saída já existe: gera "nome (1).ext" em vez de sobrescrever.
    const second = resolveOutputPath(request);
    assert(/\(1\)\.png$/.test(second.outputPath), `esperava sufixo (1), veio: ${second.outputPath}`);
    return `${path.basename(first.outputPath)} -> ${path.basename(second.outputPath)}`;
  });

  await check('todos os formatos têm argumentos FFmpeg válidos', () => {
    for (const category of CATEGORIES) {
      for (const format of FORMATS[category]) {
        const args = buildFfmpegArgs(format.id, 'ultra');
        assert(Array.isArray(args), `args inválidos para ${format.id}`);
        if (category === 'video' || category === 'audio') {
          assert(args.length > 0, `sem argumentos FFmpeg para ${format.id}`);
        }
      }
    }
    return `${CATEGORIES.reduce((n, c) => n + FORMATS[c].length, 0)} formatos`;
  });

  // ------------------------------------------------------------------
  console.log(`\n== Resultado: ${passed} ok, ${failed} falha(s) em ${Date.now() - START} ms ==\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nErro inesperado no smoke test:', err);
  process.exit(1);
});
