/**
 * i18n.js
 * Sistema de internacionalização: aplica textos a partir dos arquivos JSON de
 * locale carregados pelo preload (window.api.locales).
 */
const I18n = (() => {
  let locale = 'pt-BR';
  let strings = {};
  let fallback = {};

  /** Busca um valor aninhado ("status.completed") no objeto de tradução. */
  function lookup(obj, key) {
    return key.split('.').reduce((acc, part) => (acc && acc[part] != null ? acc[part] : undefined), obj);
  }

  /** Traduz uma chave, com interpolação simples de {placeholders}. */
  function t(key, vars = {}) {
    let value = lookup(strings, key);
    if (value == null) value = lookup(fallback, key);
    if (value == null) return key;
    return String(value).replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? vars[name] : m));
  }

  /** Define o idioma ativo e reaplica todos os textos da tela. */
  function setLocale(code, root = document) {
    const locales = window.api?.locales || {};
    fallback = locales['pt-BR'] || {};
    strings = locales[code] || fallback;
    locale = code;
    document.documentElement.lang = code;
    apply(root);
  }

  /** Percorre o DOM aplicando data-i18n e data-i18n-placeholder. */
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
  }

  return { t, setLocale, apply, get locale() { return locale; } };
})();
