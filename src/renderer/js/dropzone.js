'use strict';

/**
 * src/renderer/js/dropzone.js
 * ------------------------------------------------------------------
 * Área de drag-and-drop + botão de seleção de arquivos.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.dropzone = (() => {
  let zone = null;
  /** profundidade atual de eventos dragenter/dragleave */
  let dragDepth = 0;

  function init() {
    zone = document.getElementById('dropzone');
    const browseBtn = document.getElementById('browse-files');
    document.getElementById('dropzone-icon').innerHTML = MMZ.icons.get('upload');
    document.getElementById('browse-files-icon').innerHTML = MMZ.icons.get('plus', { size: 15 });

    zone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      openPicker();
    });
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPicker();
      }
    });
    browseBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openPicker();
    });

    // Impede que o Chromium abra o arquivo solto fora da janela.
    document.addEventListener('dragover', (event) => event.preventDefault());
    document.addEventListener('drop', (event) => event.preventDefault());

    document.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      dragDepth += 1;
      zone.classList.add('dragover');
    });
    document.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) zone.classList.remove('dragover');
    });
    document.addEventListener('drop', (event) => {
      dragDepth = 0;
      zone.classList.remove('dragover');
      if (!hasFiles(event)) return;
      const paths = Array.from(event.dataTransfer.files || [])
        .map((file) => window.mmz.getPathForFile(file))
        .filter(Boolean);
      if (paths.length) MMZ.app.addPaths(paths);
    });
  }

  /** @returns {boolean} o evento carrega arquivos (não texto/links) */
  function hasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  /** Abre o diálogo nativo de seleção de arquivos. */
  async function openPicker() {
    const paths = await window.mmz.dialog.pickFiles();
    if (paths && paths.length) MMZ.app.addPaths(paths);
  }

  return { init, openPicker };
})();
