'use strict';

/**
 * preload.js
 * ------------------------------------------------------------------
 * Ponte segura (contextBridge) entre o renderer e o processo principal.
 * Expõe `window.mmz` com a API completa da aplicação.
 *
 * O renderer roda com `contextIsolation: true` e SEM acesso ao Node.
 * ------------------------------------------------------------------
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Resolve o caminho absoluto de um `File` arrastado para a janela.
 * `webUtils.getPathForFile` (Electron >= 29) substituiu `File.path`.
 * @param {File} file
 * @returns {string}
 */
function getPathForFile(file) {
  try {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
  } catch (err) {
    /* fallback abaixo */
  }
  return file && file.path ? file.path : '';
}

contextBridge.exposeInMainWorld('mmz', {
  getPathForFile,

  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },

  i18n: {
    /** @param {string} lang */
    load: (lang) => ipcRenderer.invoke('i18n:load', lang),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    /** @param {object} patch */
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  formats: {
    list: () => ipcRenderer.invoke('formats:list'),
  },

  dialog: {
    pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  },

  queue: {
    /** @param {string[]} paths */
    add: (paths) => ipcRenderer.invoke('queue:add', paths),
    start: () => ipcRenderer.invoke('queue:start'),
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
    /** @param {string} id */
    cancel: (id) => ipcRenderer.invoke('queue:cancel', id),
    cancelAll: () => ipcRenderer.invoke('queue:cancelAll'),
    clear: () => ipcRenderer.invoke('queue:clear'),
    /** @param {string} id */
    remove: (id) => ipcRenderer.invoke('queue:remove', id),
    /** @param {string} id */
    retry: (id) => ipcRenderer.invoke('queue:retry', id),
    /** @param {{category:string, formatId:string}} payload */
    applyFormat: (payload) => ipcRenderer.invoke('queue:applyFormat', payload),
    snapshot: () => ipcRenderer.invoke('queue:snapshot'),
    /**
     * Assina os eventos da fila.
     * @param {(event: {type: string, payload: any}) => void} callback
     * @returns {() => void} função para cancelar a assinatura
     */
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('queue:event', handler);
      return () => ipcRenderer.removeListener('queue:event', handler);
    },
  },

  shell: {
    /** @param {string} target */
    open: (target) => ipcRenderer.invoke('shell:open', target),
    /** @param {string} target */
    reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  },
});
