'use strict';

/**
 * src/main/ipc.js
 * ------------------------------------------------------------------
 * Registra todos os canais IPC entre renderer e processo principal.
 * O renderer nunca acessa Node.js diretamente (contextIsolation).
 * ------------------------------------------------------------------
 */

const { ipcMain, dialog, shell } = require('electron');
const formats = require('../../shared/formats');
const { loadDictionary, AVAILABLE } = require('./i18n');
const { ensureDir } = require('./conversion/outputNamer');

/** Chaves de settings aceitas do renderer (whitelist de segurança). */
const SETTING_KEYS = [
  'language', 'theme', 'quality', 'outputDir', 'namingMode', 'suffix',
  'defaultFormats', 'concurrency', 'windowBounds',
];

/**
 * @param {object} ctx
 * @param {import('./settingsStore').SettingsStore} ctx.settings
 * @param {import('./conversion/queue').ConversionQueue} ctx.queue
 * @param {string} ctx.i18nDir
 * @param {() => object} ctx.getBinaries
 * @param {() => import('electron').BrowserWindow|null} ctx.getWindow
 * @param {string} ctx.appVersion
 */
function registerIpc({ settings, queue, i18nDir, getBinaries, getWindow, appVersion }) {
  /** Envia eventos da fila para a janela (quando ela existir). */
  const send = (payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('queue:event', payload);
    }
  };
  queue.on('snapshot', (snap) => send({ type: 'snapshot', payload: snap }));
  queue.on('progress', (payload) => send({ type: 'progress', payload }));

  // ------------------------------------------------------------------
  // App / infra
  // ------------------------------------------------------------------
  ipcMain.handle('app:info', () => ({
    version: appVersion,
    platform: process.platform,
    ffmpeg: getBinaries().ffmpeg,
    ffprobe: getBinaries().ffprobe,
    languages: AVAILABLE,
    suspendSupported: process.platform !== 'win32',
  }));

  ipcMain.handle('i18n:load', (_event, lang) => loadDictionary(lang, i18nDir));

  // ------------------------------------------------------------------
  // Configurações
  // ------------------------------------------------------------------
  ipcMain.handle('settings:get', () => settings.get());

  ipcMain.handle('settings:set', (_event, patch) => {
    const clean = {};
    for (const key of SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, key)) clean[key] = patch[key];
    }
    // Validações básicas de segurança/sanidade.
    if (clean.outputDir !== undefined) clean.outputDir = String(clean.outputDir || '');
    if (clean.suffix !== undefined) clean.suffix = String(clean.suffix || '').slice(0, 64);
    if (clean.concurrency !== undefined) {
      clean.concurrency = Math.max(1, Math.min(8, parseInt(clean.concurrency, 10) || 1));
    }
    if (clean.quality && !formats.QUALITY_LEVELS.includes(clean.quality)) delete clean.quality;
    if (clean.namingMode && !['keep', 'suffix'].includes(clean.namingMode)) delete clean.namingMode;
    if (clean.theme && !['dark', 'light'].includes(clean.theme)) delete clean.theme;
    if (clean.language && !AVAILABLE.includes(clean.language)) delete clean.language;

    const next = settings.set(clean);
    // Pastas/sufixo/formato alterados refletem imediatamente na fila.
    queue.refreshPreviews();
    queue.emit('snapshot', queue.snapshot());
    return next;
  });

  // ------------------------------------------------------------------
  // Diálogos
  // ------------------------------------------------------------------
  ipcMain.handle('dialog:pickFiles', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'select_files',
      properties: ['openFile', 'multiSelections'],
      filters: formats.fileDialogFilters(),
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'select_output_dir',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] || null);
  });

  // ------------------------------------------------------------------
  // Formatos
  // ------------------------------------------------------------------
  ipcMain.handle('formats:list', () => ({
    categories: formats.CATEGORIES,
    qualityLevels: formats.QUALITY_LEVELS,
    formats: formats.CATEGORIES.flatMap((category) =>
      formats.FORMATS[category].map((f) => ({ ...f, category })),
    ),
    inputExtsByCategory: Object.fromEntries(
      formats.CATEGORIES.map((c) => [c, formats.inputExtsFor(c)]),
    ),
    extToCategory: Object.fromEntries(
      formats.allInputExts().map((ext) => [ext, formats.categoryFromExt(ext)]),
    ),
  }));

  // ------------------------------------------------------------------
  // Fila de conversão
  // ------------------------------------------------------------------
  ipcMain.handle('queue:add', (_event, paths) => {
    const result = queue.add(Array.isArray(paths) ? paths : []);
    return { added: result.added.length, rejected: result.rejected };
  });

  ipcMain.handle('queue:start', () => { queue.start(); return queue.snapshot(); });
  ipcMain.handle('queue:pause', () => { queue.pause(); return queue.snapshot(); });
  ipcMain.handle('queue:resume', () => { queue.resume(); return queue.snapshot(); });
  ipcMain.handle('queue:cancel', (_event, id) => { queue.cancel(id); return queue.snapshot(); });
  ipcMain.handle('queue:cancelAll', () => { queue.cancelAll(); return queue.snapshot(); });
  ipcMain.handle('queue:clear', () => { queue.clear(); return queue.snapshot(); });
  ipcMain.handle('queue:remove', (_event, id) => { queue.remove(id); return queue.snapshot(); });
  ipcMain.handle('queue:retry', (_event, id) => { queue.retry(id); return queue.snapshot(); });

  ipcMain.handle('queue:applyFormat', (_event, payload) => {
    const { category, formatId } = payload || {};
    queue.applyFormat(category, formatId);
    return queue.snapshot();
  });

  ipcMain.handle('queue:snapshot', () => queue.snapshot());

  // ------------------------------------------------------------------
  // Sistema de arquivos / shell
  // ------------------------------------------------------------------
  ipcMain.handle('shell:open', async (_event, target) => {
    if (!target) return false;
    const error = await shell.openPath(String(target));
    return error === ''; // '' significa sucesso
  });

  ipcMain.handle('shell:reveal', (_event, target) => {
    if (!target) return false;
    shell.showItemInFolder(String(target));
    return true;
  });

  ipcMain.handle('fs:ensureDir', (_event, dir) => ensureDir(String(dir || '')));
}

module.exports = { registerIpc };
