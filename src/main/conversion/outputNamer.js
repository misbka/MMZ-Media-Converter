'use strict';

/**
 * src/main/conversion/outputNamer.js
 * ------------------------------------------------------------------
 * Regras de nomenclatura do arquivo de saída:
 *  - manter o nome original ou adicionar um sufixo;
 *  - nunca sobrescrever (gera "nome (1).ext", "nome (2).ext"...);
 *  - nunca sobrescrever o próprio arquivo de origem.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

/** Caracteres inválidos em nomes de arquivo (Windows + Unix). */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Remove caracteres ilegais de um sufixo informado pelo usuário.
 * @param {string} suffix
 * @returns {string}
 */
function sanitizeSuffix(suffix) {
  return String(suffix || '').replace(INVALID_CHARS, '').slice(0, 64);
}

/**
 * Gera um caminho de saída único (não sobrescreve nada existente).
 * @param {string} dir
 * @param {string} base nome sem extensão
 * @param {string} ext extensão sem ponto
 * @returns {string}
 */
function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}.${ext}`);
  let counter = 0;
  while (fs.existsSync(candidate)) {
    counter += 1;
    candidate = path.join(dir, `${base} (${counter}).${ext}`);
  }
  return candidate;
}

/**
 * Calcula o caminho final de um arquivo convertido.
 *
 * @param {object} options
 * @param {string} options.inputPath   caminho do arquivo de origem
 * @param {string} [options.outputDir] diretório de destino ('' = origem)
 * @param {string} options.targetExt   extensão de saída sem ponto
 * @param {'keep'|'suffix'} [options.namingMode]
 * @param {string} [options.suffix]
 * @returns {{outputPath: string, dir: string, base: string, ext: string}}
 */
function resolveOutputPath({ inputPath, outputDir, targetExt, namingMode = 'keep', suffix = '' }) {
  const srcDir = path.dirname(inputPath);
  const srcName = path.basename(inputPath);
  const srcExtPos = srcName.lastIndexOf('.');
  const srcBase = srcExtPos > 0 ? srcName.slice(0, srcExtPos) : srcName;
  const srcExt = srcExtPos > 0 ? srcName.slice(srcExtPos + 1).toLowerCase() : '';

  const dir = outputDir && String(outputDir).trim() ? String(outputDir).trim() : srcDir;
  const cleanSuffix = sanitizeSuffix(suffix);

  let base = srcBase;
  if (namingMode === 'suffix') {
    base = `${srcBase}${cleanSuffix}`;
  }

  // Proteção: se o alvo apontaria para o MESMO arquivo da origem
  // (ex.: foto.jpg -> foto.jpg na mesma pasta), força um sufixo para
  // nunca destruir o arquivo original.
  const sameFileRisk =
    dir === srcDir && String(targetExt).toLowerCase() === srcExt;
  if (sameFileRisk && !base.slice(srcBase.length)) {
    base = `${srcBase}_converted`;
  }

  return { outputPath: uniquePath(dir, base, targetExt), dir, base, ext: targetExt };
}

/**
 * Garante que um diretório exista (cria se necessário).
 * @param {string} dir
 * @returns {boolean}
 */
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { resolveOutputPath, sanitizeSuffix, ensureDir };
