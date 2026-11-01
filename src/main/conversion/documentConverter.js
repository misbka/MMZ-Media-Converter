'use strict';

/**
 * src/main/conversion/documentConverter.js
 * ------------------------------------------------------------------
 * Conversão básica de documentos: PDF, DOCX e TXT.
 *
 * Matriz suportada:
 *   TXT  -> PDF, DOCX           (geradores próprios)
 *   DOCX -> TXT, PDF            (leitura via `mammoth`)
 *   PDF  -> TXT, DOCX           (extração de texto via `pdf-parse`)
 *   mesmo formato -> cópia com nome único
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { textToPdfBuffer } = require('../../utils/pdfWriter');
const { textToDocxBuffer } = require('../../utils/zipWriter');

/**
 * Lê um arquivo de texto como UTF-8 (remove BOM, se presente).
 * @param {string} filePath
 * @returns {string}
 */
function readTextFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * Extrai texto de um DOCX com `mammoth`.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function docxToText(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.replace(/\r\n/g, '\n');
}

/**
 * Extrai texto de um PDF com `pdf-parse` (pdf.js por baixo).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function pdfToText(filePath) {
  const { PDFParse } = require('pdf-parse');
  const data = await fs.promises.readFile(filePath);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return String(result.text || '').replace(/\r\n/g, '\n');
  } finally {
    try { await parser.destroy(); } catch (err) { /* ignore */ }
  }
}

/**
 * Normaliza o texto extraído (evita milhares de linhas em branco).
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text)
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Converte um documento para o formato de destino.
 *
 * @param {object} options
 * @param {string} options.inputPath
 * @param {string} options.outputPath
 * @param {string} options.inputExt  ('pdf' | 'docx' | 'txt')
 * @param {string} options.outputExt ('pdf' | 'docx' | 'txt')
 * @param {(p: {progress:number}) => void} [options.onProgress]
 * @returns {Promise<{engine: string}>}
 */
async function convertDocument({ inputPath, outputPath, inputExt, outputExt, onProgress = () => {} }) {
  const from = String(inputExt).toLowerCase();
  const to = String(outputExt).toLowerCase();

  onProgress({ progress: 10 });

  // Mesmo formato: apenas copia (o nomenclador já garante nome único).
  if (from === to) {
    await fs.promises.copyFile(inputPath, outputPath);
    onProgress({ progress: 100 });
    return { engine: 'copy' };
  }

  /** @type {'txt'|null} texto intermediário já disponível */
  let text = null;

  if (from === 'txt') {
    text = readTextFile(inputPath);
  } else if (from === 'docx') {
    text = await docxToText(inputPath);
  } else if (from === 'pdf') {
    text = await pdfToText(inputPath);
  } else {
    throw new Error(`unsupported_document_input: ${from}`);
  }

  onProgress({ progress: 60 });

  if (to === 'txt') {
    await fs.promises.writeFile(outputPath, normalizeText(text) + '\n', 'utf8');
  } else if (to === 'pdf') {
    await fs.promises.writeFile(outputPath, textToPdfBuffer(normalizeText(text) + '\n'));
  } else if (to === 'docx') {
    await fs.promises.writeFile(outputPath, textToDocxBuffer(normalizeText(text) + '\n'));
  } else {
    throw new Error(`unsupported_document_output: ${to}`);
  }

  onProgress({ progress: 100 });
  return { engine: 'document' };
}

module.exports = { convertDocument, docxToText, pdfToText, normalizeText };
