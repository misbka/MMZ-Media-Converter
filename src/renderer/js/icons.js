'use strict';

/**
 * src/renderer/js/icons.js
 * ------------------------------------------------------------------
 * Conjunto de ícones SVG inline (estilo Lucide) — sem dependências.
 * Apenas SVGs estáticos gerados pelo próprio app são inseridos via
 * innerHTML, portanto é seguro.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.icons = (() => {
  /** @type {Record<string, string>} corpo dos ícones (viewBox 24x24) */
  const paths = {
    logo:
      '<path d="M4 9h11m0 0-3.2-3.2M15 9l-3.2 3.2"/>' +
      '<path d="M20 15H9m0 0 3.2-3.2M9 15l3.2 3.2"/>',
    video:
      '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/>' +
      '<path d="M7.5 5v14M16.5 5v14M2.5 9.5h5M16.5 9.5h5M2.5 14.5h5M16.5 14.5h5"/>',
    audio:
      '<path d="M9 18V5.5l11-2V16"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    image:
      '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/>' +
      '<circle cx="8.7" cy="9.2" r="1.7"/><path d="m21 15.5-4.8-4.8L5.5 21"/>',
    document:
      '<path d="M14 2.5H7A2 2 0 0 0 5 4.5v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z"/>' +
      '<path d="M14 2.5v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/>',
    file:
      '<path d="M14 2.5H7A2 2 0 0 0 5 4.5v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z"/>' +
      '<path d="M14 2.5v5h5"/>',
    inbox:
      '<path d="M21 14.5v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5"/>' +
      '<path d="m7.5 8.5 4.5-5 4.5 5"/><path d="M12 3.5v9"/>',
    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
      '<path d="m7.5 8.5 4.5-5 4.5 5"/><path d="M12 3.5V15"/>',
    play: '<path d="M6.5 4.3 19 12 6.5 19.7z"/>',
    pause: '<rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.4"/>',
    trash:
      '<path d="M3.5 6.5h17"/><path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7"/>' +
      '<path d="M18.2 6.5v12.2a2 2 0 0 1-2 2H7.8a2 2 0 0 1-2-2V6.5"/><path d="M10 11v5.5M14 11v5.5"/>',
    folder:
      '<path d="M4 19.5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h4.6l2 3H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2z"/>',
    folderOpen:
      '<path d="M3.5 18.5V5.8a1.8 1.8 0 0 1 1.8-1.8h3.9l2 2.6h6.5a1.8 1.8 0 0 1 1.8 1.8v1.2"/>' +
      '<path d="M3.5 18.5 5.9 11a1.8 1.8 0 0 1 1.7-1.2h11.6a1.6 1.6 0 0 1 1.5 2.1l-2 5.9a1.8 1.8 0 0 1-1.7 1.2H5.2a1.7 1.7 0 0 1-1.7-1.5z"/>',
    sun:
      '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M21 12.9A8.6 8.6 0 1 1 11.1 3a6.7 6.7 0 0 0 9.9 9.9z"/>',
    globe:
      '<circle cx="12" cy="12" r="8.7"/><path d="M3.4 12h17.2"/>' +
      '<path d="M12 3.3a13.4 13.4 0 0 1 0 17.4 13.4 13.4 0 0 1 0-17.4z"/>',
    check: '<path d="M20 6.5 9.2 17.3 4 12.1"/>',
    alert:
      '<path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' +
      '<path d="M12 9.5v4M12 17.3h.01"/>',
    info: '<circle cx="12" cy="12" r="8.7"/><path d="M12 11v5.2M12 7.6h.01"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    refresh:
      '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5.5H15"/>',
    external:
      '<path d="M14.5 3.5H20.5V9.5"/><path d="M10 14 20.5 3.5"/>' +
      '<path d="M19 14.5v4.3a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4.3"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    chevron: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    spinner: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" stroke-linecap="round"/>',
    target:
      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    settings:
      '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10.4 3v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };

  /**
   * Retorna o markup SVG de um ícone.
   * @param {string} name
   * @param {{size?: number, fill?: boolean}} [opts]
   * @returns {string}
   */
  function get(name, opts = {}) {
    const body = paths[name] || paths.file;
    const size = opts.size || 24;
    const filled = opts.fill === true || name === 'play';
    const attrs = filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${attrs}>` +
      `${body}</svg>`
    );
  }

  /** Ícone específico de cada categoria de arquivo. */
  function forCategory(category) {
    return get(['video', 'audio', 'image', 'document'].includes(category) ? category : 'file');
  }

  return { get, forCategory, names: Object.keys(paths) };
})();
