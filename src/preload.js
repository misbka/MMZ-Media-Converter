/**
 * src/preload.js
 * Ponte segura entre o processo principal e a renderer (contextBridge).
 * Também carrega os arquivos de locale, já que a renderer não tem acesso a fs.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const fs = require('fs');
const path = require('path');

/** Lê todos os arquivos de tradução disponíveis. */
function loadLocales() {
  const dir = path.join(__dirname, '..', 'renderer', 'locales');
  const locales = {};
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const code = file.replace('.json', '');
      locales[code] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  } catch (err) {
    console.error('[preload] Falha ao carregar locales:', err);
  }
  return locales;
}

contextBridge.exposeInMainWorld('api', {
  /* --------------------------- Configurações --------------------------- */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickFolder: () => ipcRenderer.invoke('settings:pickFolder'),

  /* ------------------------------ Arquivos ------------------------------ */
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  /** Converte um File de drag-and-drop no caminho absoluto no disco. */
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },

  /* --------------------------- Fila de jobs ----------------------------- */
  addJobs: (files, options) => ipcRenderer.invoke('jobs:add', { files, options }),
  startQueue: () => ipcRenderer.invoke('jobs:start'),
  pauseQueue: () => ipcRenderer.invoke('jobs:pause'),
  resumeQueue: () => ipcRenderer.invoke('jobs:resume'),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  cancelAll: () => ipcRenderer.invoke('jobs:cancelAll'),
  clearFinished: () => ipcRenderer.invoke('jobs:clearFinished'),
  setJobFormat: (id, format) => ipcRenderer.invoke('jobs:setFormat', { id, format }),
  onJobUpdate: (cb) => ipcRenderer.on('job:update', (_e, job) => cb(job)),
  onQueueState: (cb) => ipcRenderer.on('queue:state', (_e, state) => cb(state)),
  onQueueCleared: (cb) => ipcRenderer.on('queue:cleared', () => cb()),

  /* ------------------------------- Sistema ------------------------------ */
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  checkFfmpeg: (customPath) => ipcRenderer.invoke('app:checkFfmpeg', customPath),
  resolveFfmpeg: (customPath) => ipcRenderer.invoke('app:resolveFfmpeg', customPath),

  /* -------------------------------- i18n ------------------------------- */
  locales: loadLocales()
});
