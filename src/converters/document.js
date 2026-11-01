/**
 * converters/document.js
 * Conversões básicas de documentos:
 *   - DOCX -> TXT  (mammoth)
 *   - PDF  -> TXT  (pdf-parse)
 *   - TXT  -> PDF  (pdf-lib, com quebra de linha simples)
 *
 * Bibliotecas pesadas são carregadas sob demanda (require dinâmico) para
 * acelerar a inicialização do app.
 */
const fs = require('fs');
const { StandardFonts, PDFDocument } = require('pdf-lib');

/** Extensões de documento reconhecidas. */
const DOC_EXT = ['pdf', 'docx', 'txt'];

/**
 * Remove/normaliza caracteres fora do conjunto WinAnsi (padrão da fonte
 * Helvetica embutida no pdf-lib), evitando erros com acentos e símbolos.
 */
function toWinAnsi(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove diacríticos
    .replace(/[\u2018\u2019]/g, "'")   // aspas curvas -> reta
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '?');  // resto não mapeado
}

/** Quebra o texto em linhas que caibam na largura da página. */
function wrapText(text, maxChars) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (!line.trim()) {
      out.push('');
      continue;
    }
    while (line.length > maxChars) {
      let cut = line.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      out.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out;
}

/** Gera um PDF simples (A4) a partir de texto puro. */
async function textToPdf(input, output) {
  const text = fs.readFileSync(input, 'utf8');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapText(toWinAnsi(text), 95);
  const fontSize = 11;
  const lineHeight = 14;
  const margin = 50;

  let page = doc.addPage([595.28, 841.89]); // A4 em pontos
  let y = page.getHeight() - margin;

  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage([595.28, 841.89]);
      y = page.getHeight() - margin;
    }
    if (line) page.drawText(line, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  }

  fs.writeFileSync(output, await doc.save());
}

/** Extrai texto de DOCX via mammoth. */
async function docxToText(input, output) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ path: input });
  fs.writeFileSync(output, value, 'utf8');
}

/** Extrai texto de PDF via pdf-parse. */
async function pdfToText(input, output) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(fs.readFileSync(input));
  fs.writeFileSync(output, data.text, 'utf8');
}

/**
 * Converte um documento.
 * @param {object} opts
 * @param {string} opts.input
 * @param {string} opts.output
 * @param {string} opts.from Extensão de origem.
 * @param {string} opts.to Extensão de destino.
 * @param {function} [opts.onProgress] Callback ({ percent }).
 */
async function convertDocument(opts) {
  const { input, output, from, to, onProgress } = opts;
  const report = (percent) => onProgress && onProgress({ percent });
  report(10);

  switch (`${from}->${to}`) {
    case 'txt->pdf': await textToPdf(input, output); break;
    case 'docx->txt': await docxToText(input, output); break;
    case 'pdf->txt': await pdfToText(input, output); break;
    default:
      throw new Error(`Conversão de documentos não suportada: ${from}->${to}`);
  }
  report(100);
}

module.exports = { convertDocument, DOC_EXT };
