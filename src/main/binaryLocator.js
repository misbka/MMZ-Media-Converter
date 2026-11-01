'use strict';

/**
 * src/main/binaryLocator.js
 * ------------------------------------------------------------------
 * Localiza automaticamente os binários do FFmpeg/FFprobe.
 *
 * Ordem de busca / Search order:
 *   1. `ffmpeg/bin/` dentro do projeto (ou `resources/ffmpeg/bin/` empacotado)
 *   2. Variável PATH do sistema (fallback)
 *
 * Assim o usuário NÃO precisa instalar o FFmpeg globalmente.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * @typedef {object} BinaryInfo
 * @property {boolean} found
 * @property {string} path
 * @property {'bundled'|'system'|null} source
 * @property {string} version
 * @property {string} error
 */

/** @returns {BinaryInfo} */
function notFound(error) {
  return { found: false, path: '', source: null, version: '', error };
}

/**
 * Verifica se um caminho é um executável existente.
 * @param {string} file
 */
function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (err) {
    // Em alguns sistemas o bit de execução não está setado (ex.: binários
    // baixados/extraídos no Windows e usados via WSL). Tentamos corrigir.
    try {
      if (process.platform !== 'win32' && fs.existsSync(file)) {
        fs.chmodSync(file, 0o755);
        return true;
      }
    } catch (chmodErr) {
      return false;
    }
    return false;
  }
}

/**
 * Lê a versão reportada por um binário (`-version`).
 * @param {string} binPath
 * @returns {string}
 */
function readVersion(binPath) {
  // Duas tentativas: na primeira execução o AV/antivírus pode atrasar o spawn.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = spawnSync(binPath, ['-version'], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
      });
      const out = `${result.stdout || ''}${result.stderr || ''}`;
      // Ex.: "ffmpeg version 7.1-essentials_build-www.gyan.dev ..."
      const match = out.match(/\bversion\s+(\S+)/i);
      if (match && match[1]) return match[1];
      if (!result.error) return '';
    } catch (err) {
      /* tenta de novo */
    }
  }
  return '';
}

/**
 * Procura o executável dentro de um diretório.
 * @param {string} dir
 * @param {string} name nome base ('ffmpeg' | 'ffprobe')
 * @returns {string|null}
 */
function findInDir(dir, name) {
  const candidates =
    process.platform === 'win32'
      ? [`${name}.exe`, name] // primeiro com extensão, depois sem
      : [name, `${name}.exe`];
  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full) && isExecutable(full)) return full;
  }
  return null;
}

/**
 * Procura o executável no PATH do sistema.
 * @param {string} name
 * @returns {string|null}
 */
function findInSystemPath(name) {
  if (process.platform === 'win32') {
    const result = spawnSync('where', [name], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const lines = (result.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (result.status === 0 && lines.length) return lines[0];
    return null;
  }
  const result = spawnSync('which', [name], { encoding: 'utf8', timeout: 5000 });
  const line = (result.stdout || '').trim();
  if (result.status === 0 && line) return line;
  for (const dir of ['/usr/bin', '/usr/local/bin', '/snap/bin']) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Localiza um binário (ffmpeg/ffprobe).
 * @param {string} binDir diretório `ffmpeg/bin`
 * @param {string} name nome base
 * @returns {BinaryInfo}
 */
function locateBinary(binDir, name) {
  const bundled = findInDir(binDir, name);
  if (bundled) {
    return {
      found: true,
      path: bundled,
      source: 'bundled',
      version: readVersion(bundled),
      error: '',
    };
  }
  const fromSystem = findInSystemPath(name);
  if (fromSystem) {
    return {
      found: true,
      path: fromSystem,
      source: 'system',
      version: readVersion(fromSystem),
      error: '',
    };
  }
  return notFound('not_found');
}

/**
 * Descobre a raiz do projeto considerando execução em dev e app empacotado.
 * @param {boolean} isPackaged
 * @param {string} appPath
 * @param {string} resourcesPath
 * @returns {string}
 */
function resolveBinDir(isPackaged, appPath, resourcesPath) {
  return isPackaged
    ? path.join(resourcesPath, 'ffmpeg', 'bin') // electron-builder: extraResources
    : path.join(appPath, 'ffmpeg', 'bin'); // dev: repositório
}

/**
 * Resolve FFmpeg + FFprobe de uma só vez.
 * @param {{binDir: string}} options
 * @returns {{ffmpeg: BinaryInfo, ffprobe: BinaryInfo, ok: boolean}}
 */
function locateAll({ binDir }) {
  const ffmpeg = locateBinary(binDir, 'ffmpeg');
  const ffprobe = locateBinary(binDir, 'ffprobe');
  return { ffmpeg, ffprobe, ok: ffmpeg.found };
}

module.exports = { locateAll, resolveBinDir, locateBinary, readVersion };
