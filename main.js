'use strict';

/**
 * main.js
 * ------------------------------------------------------------------
 * Ponto de entrada do processo principal (Electron main).
 *
 *  - cria a janela do aplicativo;
 *  - carrega configurações, idioma e binários do FFmpeg;
 *  - sobe a fila de conversão e registra os handlers IPC;
 *  - oferece um modo de auto-teste (`--smoke-test`) usado no CI/dev.
 * ------------------------------------------------------------------
 */

const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const { SettingsStore } = require('./src/main/settingsStore');
const { locateAll, resolveBinDir } = require('./src/main/binaryLocator');
const { ConversionQueue } = require('./src/main/conversion/queue');
const { registerIpc } = require('./src/main/ipc');

/** Modos de execução detectados na linha de comando. */
const IS_SMOKE_TEST = process.argv.includes('--smoke-test');
const IS_DEV = process.argv.includes('--dev');

/** @type {BrowserWindow|null} */
let mainWindow = null;

// --- Preferências iniciais (antes do `ready`) --------------------------
const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
nativeTheme.themeSource = settings.get().theme === 'light' ? 'light' : 'dark';

// --- Binários do FFmpeg (locais primeiro, PATH como fallback) ----------
const binDir = resolveBinDir(app.isPackaged, app.getAppPath(), process.resourcesPath);
let binaries = locateAll({ binDir });

/** @type {ConversionQueue} */
const queue = new ConversionQueue({
  getSettings: () => settings.get(),
  getBinaries: () => binaries,
});

/**
 * Cria a janela principal do aplicativo.
 */
function createWindow() {
  const bounds = settings.get().windowBounds || {};
  mainWindow = new BrowserWindow({
    width: bounds.width || 1240,
    height: bounds.height || 820,
    minWidth: 960,
    minHeight: 620,
    x: bounds.x,
    y: bounds.y,
    show: false,
    backgroundColor: settings.get().theme === 'light' ? '#f5f7fa' : '#0f1116',
    title: 'MMZ Media Converter',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV && !IS_SMOKE_TEST) mainWindow.webContents.openDevTools({ mode: 'detach' });
    if (IS_SMOKE_TEST) runSmokeTest();
  });

  // Persiste o tamanho/posição da janela ao fechar.
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    settings.set({ windowBounds: mainWindow.getBounds() });
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);

  // Links externos abrem no navegador padrão (nunca dentro do app).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/**
 * Auto-teste: carrega a UI, espera o renderer sinalizar `__mmzReady`
 * e encerra com código 0 (sucesso) ou 1 (falha).
 *
 *  - `--smoke-test`      : valida o boot da interface;
 *  - `--smoke-test --smoke-full` : além do boot, executa conversões
 *    reais pela fila (IPC -> fila -> FFmpeg/sharp -> UI).
 */
function runSmokeTest() {
  const timeout = setTimeout(() => {
    finishSmokeTest(false, 'timeout waiting for renderer');
  }, 120000);

  const finishSmokeTest = (ok, reason) => {
    clearTimeout(timeout);
    /* eslint-disable no-console */
    console.log(JSON.stringify({ smoke: ok ? 'ok' : 'failed', reason }));
    /* eslint-enable no-console */
    app.exit(ok ? 0 : 1);
  };

  /** Atalho: executa JS no renderer. */
  const evalInRenderer = (code) => mainWindow.webContents.executeJavaScript(code, true);

  setTimeout(async () => {
    try {
      const data = JSON.parse(await evalInRenderer(
        `JSON.stringify({
           ready: window.__mmzReady === true,
           errors: window.__mmzErrors || [],
           title: document.title,
           hasSidebar: !!document.querySelector('.sidebar'),
           jobs: document.querySelectorAll('.file-item').length
         })`,
      ));
      if (!data.ready) return finishSmokeTest(false, `not ready: ${data.errors.join(' | ')}`);
      if (data.errors.length) return finishSmokeTest(false, data.errors.join(' | '));
      if (!data.hasSidebar) return finishSmokeTest(false, 'sidebar missing');

      if (process.argv.includes('--smoke-full')) {
        const ui = await runUiInteractionSmoke(evalInRenderer);
        if (!ui.ok) return finishSmokeTest(false, ui.reason);
        return await runFullConversionSmoke(finishSmokeTest, evalInRenderer);
      }
      return finishSmokeTest(true, 'renderer booted');
    } catch (err) {
      return finishSmokeTest(false, err.message);
    }
  }, 1500);
}

/**
 * Alterna tema e idioma pela UI real e verifica se a tradução aplicou.
 * Ao final restaura as configurações originais do usuário.
 * @param {(code: string) => Promise<any>} evalInRenderer
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function runUiInteractionSmoke(evalInRenderer) {
  const original = settings.get();
  const restore = async () => {
    await settings.set({ language: original.language, theme: original.theme });
    try {
      await evalInRenderer(
        `(async () => {
          const select = document.getElementById('language-select');
          select.value = ${JSON.stringify(original.language)};
          select.dispatchEvent(new Event('change'));
          await new Promise((r) => setTimeout(r, 700));
          return window.MMZ.i18n.lang();
        })()`,
      );
    } catch (err) { /* janela pode já ter encerrado */ }
  };

  const result = JSON.parse(await evalInRenderer(
    `(async () => {
      const out = { errors: [] };
      try {
        const before = document.documentElement.getAttribute('data-theme');
        document.getElementById('theme-toggle').click();
        await new Promise((r) => setTimeout(r, 400));
        out.theme = document.documentElement.getAttribute('data-theme');
        out.themeToggled = out.theme !== before && (out.theme === 'dark' || out.theme === 'light');

        const select = document.getElementById('language-select');
        select.value = 'en';
        select.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 900));

        out.lang = window.MMZ.i18n.lang();
        out.translated = window.MMZ.i18n.t('toolbar.clear');
        out.staticTranslated = document.querySelector('[data-i18n="sidebar.quality"]').textContent;
        out.errors = window.__mmzErrors || [];
      } catch (err) {
        out.errors.push(String(err && err.message ? err.message : err));
      }
      return JSON.stringify(out);
    })()`,
  ));

  if (result.errors.length) { await restore(); return { ok: false, reason: `ui smoke: ${result.errors.join(' | ')}` }; }
  if (!result.themeToggled) { await restore(); return { ok: false, reason: `theme did not toggle (${result.theme})` }; }
  if (result.lang !== 'en') { await restore(); return { ok: false, reason: `language is ${result.lang}` }; }
  if (result.translated !== 'Clear') { await restore(); return { ok: false, reason: `i18n not applied: "${result.translated}"` }; }
  if (result.staticTranslated !== 'Quality') { await restore(); return { ok: false, reason: `static i18n not applied: "${result.staticTranslated}"` }; }

  await restore();
  return { ok: true };
}

/**
 * Conversa real com o app: adiciona arquivos de teste, inicia a fila,
 * aguarda a conclusão e confere arquivos + estado da interface.
 * @param {(ok: boolean, reason: string) => void} finish
 * @param {(code: string) => Promise<any>} evalInRenderer
 */
async function runFullConversionSmoke(finish, evalInRenderer) {
  const os = require('os');
  const dir = path.join(os.tmpdir(), 'mmz-full-smoke');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const inputs = [];

  // TXT (documentos)
  const txt = path.join(dir, 'entrada.txt');
  fs.writeFileSync(txt, 'MMZ smoke test\nlinha de acentuação: çãõéí\n', 'utf8');
  inputs.push(txt);

  // PNG (imagens)
  try {
    const png = path.join(dir, 'entrada.png');
    await require('sharp')({
      create: { width: 160, height: 100, channels: 3, background: { r: 20, g: 160, b: 120 } },
    }).png().toFile(png);
    inputs.push(png);
  } catch (err) { /* segue sem imagem */ }

  // MP4 (vídeo) — gerado pelo próprio FFmpeg local
  if (binaries.ffmpeg.found) {
    const video = path.join(dir, 'entrada.mp4');
    const result = require('child_process').spawnSync(binaries.ffmpeg.path, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=160x120:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video,
    ], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0) inputs.push(video);
  }

  if (!inputs.length) return finish(false, 'no test inputs could be created');

  const driveScript = [
    '(async () => {',
    `  await window.MMZ.app.addPaths(${JSON.stringify(inputs)});`,
    '  await window.mmz.queue.start();',
    '  const started = Date.now();',
    '  while (Date.now() - started < 60000) {',
    '    const snap = await window.mmz.queue.snapshot();',
    '    if (snap.state === "idle" && snap.stats.queued === 0 && snap.stats.running === 0) {',
    '      return JSON.stringify(snap);',
    '    }',
    '    await new Promise((r) => setTimeout(r, 250));',
    '  }',
    '  return JSON.stringify({ timeout: true, ...(await window.mmz.queue.snapshot()) });',
    '})()',
  ].join('\n');

  const snapshot = JSON.parse(await evalInRenderer(driveScript));

  if (snapshot.timeout) return finish(false, 'queue timeout (60s)');
  if (snapshot.stats.queued > 0 || snapshot.stats.running > 0) return finish(false, 'queue did not settle');
  if (snapshot.stats.completed !== snapshot.jobs.length) {
    const broken = snapshot.jobs.filter((job) => job.status !== 'completed');
    return finish(false, `jobs failed: ${JSON.stringify(broken.map((job) => [job.fileName, job.status, job.error]))}`);
  }
  const missing = snapshot.jobs.filter((job) => !fs.existsSync(job.outputPath) || fs.statSync(job.outputPath).size === 0);
  if (missing.length) return finish(false, `output files missing: ${missing.map((job) => job.outputPath).join(', ')}`);

  // A interface deve refletir o estado concluído.
  const ui = JSON.parse(await evalInRenderer(
    `JSON.stringify({
       completed: document.querySelectorAll('.file-item[data-status="completed"]').length,
       badges: document.querySelectorAll('.badge[data-status="completed"]').length,
       overall: document.getElementById('overall-fill').style.width,
       statusText: document.getElementById('overall-status').textContent,
       errors: window.__mmzErrors || []
     })`,
  ));
  if (ui.errors.length) return finish(false, ui.errors.join(' | '));
  if (ui.completed !== snapshot.jobs.length) return finish(false, `ui shows ${ui.completed}/${snapshot.jobs.length} completed`);
  if (ui.overall !== '100%') return finish(false, `overall bar at ${ui.overall}`);

  return finish(true, `converted ${snapshot.jobs.length} files, overall=${ui.overall}`);
}

// --- Instância única ----------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Revalida os binários a cada 60s (usuário pode corrigir a pasta).
    setInterval(() => {
      const next = locateAll({ binDir });
      if (next.ok !== binaries.ok || next.ffmpeg.path !== binaries.ffmpeg.path) {
        binaries = next;
      }
    }, 60000);

    registerIpc({
      settings,
      queue,
      i18nDir: path.join(__dirname, 'src', 'i18n'),
      getBinaries: () => binaries,
      getWindow: () => mainWindow,
      appVersion: require('./package.json').version,
    });

    createWindow();

    app.on('activate', () => {
      // macOS: reabrir janela ao clicar no dock.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Encerra com segurança (mata conversões em andamento).
  app.on('before-quit', () => {
    queue.shutdown();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
