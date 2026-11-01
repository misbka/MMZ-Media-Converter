'use strict';

/**
 * src/utils/zipWriter.js
 * ------------------------------------------------------------------
 * Gerador minimalista de arquivos ZIP (método "store", sem compressão)
 * usado para produzir DOCX de forma nativa e sem dependências.
 *
 * Um .DOCX é um ZIP contendo:
 *   [Content_Types].xml
 *   _rels/.rels
 *   word/document.xml
 *   word/_rels/document.xml.rels
 * ------------------------------------------------------------------
 */

/** Tabela CRC-32 (padrão IEEE 802.3), pré-calculada. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Calcula o CRC-32 de um buffer.
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Data/hora DOS (formato exigido pelo cabeçalho ZIP). */
function dosDateTime(date = new Date()) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

/**
 * Monta um arquivo ZIP com entradas armazenadas (sem compressão).
 * @param {{name: string, data: Buffer|string}[]} entries
 * @returns {Buffer}
 */
function createZipBuffer(entries) {
  const { time, day } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  const FLAG_UTF8 = 0x0800; // nomes de arquivo em UTF-8

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(dataBuf);

    // ---- Cabeçalho local (PK\x03\x04) ----
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // versão mínima
    local.writeUInt16LE(FLAG_UTF8, 6); // flags
    local.writeUInt16LE(0, 8);         // método: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);        // extra len
    localParts.push(local, nameBuf, dataBuf);

    // ---- Entrada do diretório central (PK\x01\x02) ----
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);      // version made by
    central.writeUInt16LE(20, 6);      // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10);      // método
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);      // extra len
    central.writeUInt16LE(0, 32);      // comment len
    central.writeUInt16LE(0, 34);      // disco inicial
    central.writeUInt16LE(0, 36);      // attrs internos
    central.writeUInt32LE(0, 38);      // attrs externos
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuf);

    localOffset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);

  // ---- Fim do diretório central (PK\x05\x06) ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** Escapa caracteres especiais de XML. */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converte texto simples em um documento DOCX (ZIP).
 * Cada linha vira um parágrafo.
 *
 * @param {string} text
 * @returns {Buffer}
 */
function textToDocxBuffer(text) {
  const paragraphs = String(text).replace(/\r\n/g, '\n').split('\n');
  const body = paragraphs
    .map((line) => {
      if (!line.length) return '<w:p/>';
      return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
    })
    .join('');

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`;

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

  return createZipBuffer([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ]);
}

module.exports = { createZipBuffer, textToDocxBuffer, crc32, escapeXml };
