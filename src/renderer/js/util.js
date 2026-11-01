'use strict';

/**
 * src/renderer/js/util.js
 * ------------------------------------------------------------------
 * Helpers utilitários do renderer (formatação, DOM, etc.).
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.util = (() => {
  /**
   * Cria um elemento já configurado.
   * @param {string} tag
   * @param {object} [props] {class, text, title, dataset, attrs}
   * @param {Node[]} [children]
   * @returns {HTMLElement}
   */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.title !== undefined) node.title = props.title;
    if (props.dataset) Object.assign(node.dataset, props.dataset);
    if (props.attrs) {
      for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  /**
   * Formata bytes em unidade legível.
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** i;
    return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  /**
   * Formata milissegundos como mm:ss (ou hh:mm:ss).
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '--:--';
    const total = Math.round(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  /** Última pasta de um caminho (sem dependência de path). */
  function dirOf(filePath) {
    const clean = String(filePath || '').replace(/[\\/]+$/, '');
    const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    return idx >= 0 ? clean.slice(0, idx) : clean;
  }

  /** Nome do arquivo de um caminho. */
  function baseName(filePath) {
    const clean = String(filePath || '');
    const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    return idx >= 0 ? clean.slice(idx + 1) : clean;
  }

  /** Nome sem extensão. */
  function stem(filePath) {
    const name = baseName(filePath);
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  /** Extensão (minúsculas, sem ponto). */
  function extOf(filePath) {
    const name = baseName(filePath);
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
  }

  /**
   * Calcula o tempo estimado restante de uma conversão.
   * @param {number} progress 0..100
   * @param {number} elapsedMs
   * @returns {number|null} ms restantes (ou null quando indeterminado)
   */
  function estimateRemaining(progress, elapsedMs) {
    if (!progress || progress <= 1 || !elapsedMs) return null;
    if (progress >= 99.5) return 0;
    const elapsedPerPercent = elapsedMs / progress;
    return Math.max(0, elapsedPerPercent * (100 - progress));
  }

  /** Debounce simples. */
  function debounce(fn, delay = 120) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  return { el, formatBytes, formatDuration, dirOf, baseName, stem, extOf, estimateRemaining, debounce };
})();
