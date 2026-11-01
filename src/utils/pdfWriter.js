'use strict';

/**
 * src/utils/pdfWriter.js
 * ------------------------------------------------------------------
 * Gerador minimalista de PDF (texto simples) sem dependências externas.
 * Escreve um PDF 1.4 válido em A4 com fonte Helvetica e codificação
 * WinAnsi (suporta acentuação em português, espanhol e inglês).
 *
 * Uso: converter TXT/DOCX/PDF -> PDF mantendo o texto quebrado em
 * parágrafos e linhas.
 * ------------------------------------------------------------------
 */

/** Página A4 em pontos (1pt = 1/72"). */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 10;
const LINE_HEIGHT = 13.5;
/** Largura útil / largura média de caractere (~0.52em em Helvetica). */
const MAX_CHARS = 95;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

/** Substituições Unicode -> cp1252/WinAnsi (necessárias para PDF padrão). */
const WIN_ANSI_MAP = new Map([
  [0x2018, 0x91], [0x2019, 0x92], // ' '
  [0x201c, 0x93], [0x201d, 0x94], // " "
  [0x2013, 0x96], [0x2014, 0x97], // – —
  [0x2022, 0x95], // •
  [0x2026, 0x85], // …
  [0x00a0, 0x20], // espaço não separável
]);

/**
 * Converte uma string Unicode para bytes WinAnsi escapados para PDF.
 * @param {string} text
 * @returns {string} texto pronto para entre parênteses `( ... )`
 */
function escapeForPdf(text) {
  let out = '';
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    let mapped;
    if (code >= 0x20 && code <= 0x7e) mapped = code;
    else if (code >= 0xa0 && code <= 0xff) mapped = code;
    else if (WIN_ANSI_MAP.has(code)) mapped = WIN_ANSI_MAP.get(code);
    else mapped = 0x3f; // '?' para caracteres fora do WinAnsi

    const byte = String.fromCharCode(mapped);
    if (byte === '\\' || byte === '(' || byte === ')') out += `\\${byte}`;
    else out += byte;
  }
  return out;
}

/**
 * Quebra o texto em linhas e páginas.
 * @param {string} text
 * @returns {string[][]} lista de páginas, cada uma com suas linhas
 */
function paginate(text) {
  const lines = [];

  for (const rawLine of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\t/g, '    ');
    if (line.length <= MAX_CHARS) {
      lines.push(line);
      continue;
    }
    // Quebra gulosa preservando palavras quando possível.
    let rest = line;
    while (rest.length > MAX_CHARS) {
      let cut = rest.lastIndexOf(' ', MAX_CHARS);
      if (cut <= 0) cut = MAX_CHARS;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
    if (rest) lines.push(rest);
  }

  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (!pages.length) pages.push(['']);
  return pages;
}

/**
 * Gera o buffer binário de um PDF contendo o texto informado.
 * @param {string} text
 * @returns {Buffer}
 */
function textToPdfBuffer(text) {
  const pages = paginate(text);
  const chunks = [];
  let offset = 0;
  /** offsets[i] = posição do objeto i no arquivo */
  const offsets = [];

  const push = (buf) => {
    chunks.push(buf);
    offset += buf.length;
  };
  const writeObj = (num, body) => {
    offsets[num] = offset;
    push(Buffer.from(`${num} 0 obj\n${body}\nendobj\n`, 'latin1'));
  };

  // Cabeçalho com bytes binários (indica PDF não texto) + nº de objetos.
  push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'));

  const pageCount = pages.length;
  const fontObj = 3;
  const firstPageObj = 4;
  const infoObj = firstPageObj + pageCount * 2;
  const objCount = infoObj; // objetos numerados de 1..infoObj

  // 1: Catalog / 2: Pages / 3: Fonte
  writeObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

  const kids = pages
    .map((_, i) => `${firstPageObj + i * 2} 0 R`)
    .join(' ');
  writeObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  writeObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  // Conteúdo e páginas
  pages.forEach((pageLines, index) => {
    const pageNum = firstPageObj + index * 2;
    const contentNum = pageNum + 1;

    const content = [
      'BT',
      `/F1 ${FONT_SIZE} Tf`,
      `${LINE_HEIGHT} TL`,
      `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`,
      ...pageLines.map((line) => `(${escapeForPdf(line)}) Tj T*`),
      'ET',
      '',
    ].join('\n');

    writeObj(contentNum, `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    writeObj(pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentNum} 0 R >>`);
  });

  // Info (metadados simples)
  const creationDate = pdfDate(new Date());
  writeObj(infoObj,
    `<< /Producer (MMZ Media Converter) /Creator (MMZ Media Converter) ` +
    `/CreationDate (${creationDate}) >>`);

  // Tabela xref
  const xrefOffset = offset;
  const lines = [
    'xref',
    `0 ${objCount + 1}`,
    '0000000000 65535 f \n',
  ];
  for (let i = 1; i <= objCount; i += 1) {
    lines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  push(Buffer.from(lines.join(''), 'latin1'));
  push(Buffer.from(
    `trailer\n<< /Size ${objCount + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`,
    'latin1',
  ));

  return Buffer.concat(chunks);
}

/**
 * Formata uma data no padrão PDF (D:YYYYMMDDHHmmSS).
 * @param {Date} date
 * @returns {string}
 */
function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

module.exports = { textToPdfBuffer, paginate, escapeForPdf, PAGE_WIDTH, PAGE_HEIGHT };
