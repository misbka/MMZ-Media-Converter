'use strict';

/**
 * src/renderer/js/i18n.js
 * ------------------------------------------------------------------
 * Sistema de internacionalização no renderer.
 * O dicionário JSON é carregado pelo processo principal via IPC.
 *
 * Uso:  MMZ.i18n.t('toolbar.start')            -> "Iniciar"
 *       MMZ.i18n.t('toast.added', {count: 3})  -> "3 arquivo(s) adicionados"
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.i18n = (() => {
  /** @type {Record<string, string>} */
  let dict = {};
  let lang = 'pt-BR';

  /**
   * Carrega um novo dicionário.
   * @param {Record<string, string>} nextDict
   * @param {string} nextLang
   */
  function init(nextDict, nextLang) {
    dict = nextDict || {};
    lang = nextLang || 'pt-BR';
    document.documentElement.setAttribute('lang', lang);
  }

  /**
   * Traduz uma chave com suporte a placeholders `{{chave}}`.
   * @param {string} key
   * @param {Record<string, any>} [params]
   * @returns {string}
   */
  function t(key, params) {
    let value = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
    if (params) {
      for (const [name, raw] of Object.entries(params)) {
        value = value.split(`{{${name}}}`).join(String(raw));
      }
    }
    return value;
  }

  /**
   * Traduz todos os elementos marcados com data-i18n* de uma raiz.
   * @param {ParentNode} [root]
   */
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.getAttribute('data-i18n-title'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria')));
    });
  }

  return { init, t, apply, lang: () => lang, dict: () => dict };
})();
