'use strict';

/**
 * src/main/i18n.js
 * ------------------------------------------------------------------
 * Carrega os dicionários de tradução (JSON) da pasta `src/i18n`.
 * O renderer recebe o dicionário via IPC — assim ele não precisa de
 * acesso ao sistema de arquivos.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

/** Idiomas disponíveis / available languages */
const AVAILABLE = ['pt-BR', 'es', 'en'];
/** Idioma padrão / default language */
const DEFAULT = 'pt-BR';

/** Cache de dicionários já carregados */
const cache = new Map();

/**
 * @param {string} lang código do idioma (ex.: 'pt-BR')
 * @param {string} i18nDir caminho de `src/i18n`
 * @returns {{lang: string, dict: object}}
 */
function loadDictionary(lang, i18nDir) {
  const resolved = AVAILABLE.includes(lang) ? lang : DEFAULT;
  if (cache.has(resolved)) return { lang: resolved, dict: cache.get(resolved) };

  const file = path.join(i18nDir, `${resolved}.json`);
  let dict = {};
  try {
    dict = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // Fallback: se o arquivo do idioma escolhido quebrar, usa o padrão.
    if (resolved !== DEFAULT) {
      return loadDictionary(DEFAULT, i18nDir);
    }
    // eslint-disable-next-line no-console
    console.error('[i18n] falha ao carregar dicionário:', err.message);
  }
  cache.set(resolved, dict);
  return { lang: resolved, dict };
}

module.exports = { loadDictionary, AVAILABLE, DEFAULT };
