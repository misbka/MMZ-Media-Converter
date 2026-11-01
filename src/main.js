/**
 * src/main.js
 * Ponto de entrada do processo principal: janela, IPC, autodetect do FFmpeg
 * e integração com o JobManager.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { SettingsStore } = require('./settings');
const { JobManager } = require('./jobManager');

let win = null;
let settings = null;
let jobs = null;

/** Cria a janela principal com as preferências de segurança modernas. */
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#12141a',
    title: 'MMZ Media Converter',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

/**
 * Resolve o binário do FFmpeg nesta ordem:
 *  1. Caminho configurado pelo usuário;
 *  2. Cópia local em ./ffmpeg/bin (vinda com o projeto);
 *  3. `ffmpeg` do PATH do sistema.
 */
function resolveFfmpegPath(custom) {
  if (custom && String(custom).trim()) return String(custom).trim();

  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    path.join(app.getAppPath(), 'ffmpeg', 'bin', bin),                    // dev / extraído
    path.join(process.resourcesPath || '', 'ffmpeg', 'bin', bin),         // empacotado (extraResources)
    path.join(path.dirname(process.execPath), 'ffmpeg', 'bin', bin)       // ao lado do executável
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

/** Verifica se há um ffmpeg utilizável (com timeout para falhar rápido). */
function checkFfmpeg(customPath) {
  const bin = resolveFfmpegPath(customPath);
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 5000 }, (err) => resolve({ ok: !err, bin }));
  });
}

app.whenReady().then(() => {
  settings = new SettingsStore();
  jobs = new JobManager(() => settings);

  // Encaminha atualizações de job para a renderer.
  jobs.on('update', (job) => {
    if (win && !win.isDestroyed()) win.webContents.send('job:update', job);
  });
  jobs.on('paused', () => win?.webContents.send('queue:state', { paused: true }));
  jobs.on('resumed', () => win?.webContents.send('queue:state', { paused: false }));
  jobs.on('idle', () => win?.webContents.send('queue:state', { idle: true }));
  jobs.on('cleared', () => win?.webContents.send('queue:cleared'));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ----------------------------- IPC: configurações ---------------------------- */

ipcMain.handle('settings:get', () => settings.getAll());

ipcMain.handle('settings:set', (_e, partial) => settings.set(partial));

ipcMain.handle('settings:pickFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Selecionar pasta de destino',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

/* -------------------------------- IPC: arquivos ------------------------------ */

ipcMain.handle('files:pick', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Selecionar arquivos',
    properties: ['openFile', 'multiSelections'],
    filters: [{
      name: 'Mídia e documentos',
      extensions: [
        'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm',
        'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma',
        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tiff',
        'pdf', 'docx', 'txt'
      ]
    }]
  });
  return result.canceled ? [] : result.filePaths;
});

/* --------------------------------- IPC: jobs --------------------------------- */

ipcMain.handle('jobs:add', (_e, { files, options }) => jobs.addFiles(files, options || {}));
ipcMain.handle('jobs:start', () => { jobs.start(); return true; });
ipcMain.handle('jobs:pause', () => { jobs.pause(); return true; });
ipcMain.handle('jobs:resume', () => { jobs.resume(); return true; });
ipcMain.handle('jobs:cancel', (_e, id) => { jobs.cancel(id); return true; });
ipcMain.handle('jobs:cancelAll', () => { jobs.cancelAll(); return true; });
ipcMain.handle('jobs:clearFinished', () => { jobs.clearFinished(); return true; });
ipcMain.handle('jobs:setFormat', (_e, { id, format }) => {
  const job = jobs.setFormat(id, format);
  return job ? { ...job } : null;
});

/* -------------------------- IPC: utilitários do sistema ----------------------- */

ipcMain.handle('shell:showItem', (_e, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('shell:openPath', (_e, dirPath) => {
  if (dirPath && fs.existsSync(dirPath)) shell.openPath(dirPath);
  return true;
});

ipcMain.handle('app:checkFfmpeg', (_e, customPath) => checkFfmpeg(customPath));

/**
 * Resolve o caminho efetivo do ffmpeg para as conversões (chamado pela
 * JobManager via settings). Mantido em `main` para centralizar o autodetect.
 */
ipcMain.handle('app:resolveFfmpeg', (_e, customPath) => resolveFfmpegPath(customPath));
