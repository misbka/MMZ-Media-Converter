/**
 * app.js
 * Lógica da interface: configurações, drag & drop, lista de arquivos,
 * controles da fila de conversão e feedback visual.
 */
(() => {
  'use strict';

  const api = window.api;

  /** Formatos de saída disponíveis por categoria. */
  const FORMATS = {
    video: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'],
    audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'],
    image: ['jpg', 'png', 'gif', 'webp', 'tiff', 'bmp']
  };
  const DOC_FORMATS = { txt: ['pdf'], docx: ['txt'], pdf: ['txt'] };
  const ALL_EXT = [
    'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm',
    'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma',
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'tiff',
    'pdf', 'docx', 'txt'
  ];

  /** Referências aos elementos do DOM. */
  const el = {};
  const rows = new Map(); // id -> { tr, progress, progressLabel, badge, select }

  /* ------------------------------ Utilitários ------------------------------ */

  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('show');
      setTimeout(() => { el.toast.hidden = true; }, 200);
    }, 2800);
  }

  const ext = (p) => (p.split('.').pop() || '').toLowerCase();
  const fileName = (p) => p.split(/[\\/]/).pop();

  /* ------------------------------ Configurações ---------------------------- */

  /** Aplica as configurações recebidas do processo principal à UI. */
  function applySettings(settings) {
    Store.patch({ settings });

    el.language.value = settings.language;
    el.quality.value = settings.quality;
    el.fileNameMode.value = settings.fileNameMode;
    el.fileNameSuffix.value = settings.fileNameSuffix;
    el.fileNamePrefix.value = settings.fileNamePrefix;
    el.maxConcurrent.value = settings.maxConcurrent;
    el.keepMetadata.checked = !!settings.keepMetadata;
    el.overwriteExisting.checked = !!settings.overwriteExisting;
    el.ffmpegPath.value = settings.ffmpegPath || '';
    el.outputDir.value = settings.outputDir || '—';

    updateThemeButtons(settings.theme);
    toggleNameFields(settings.fileNameMode);
  }

  function updateThemeButtons(theme) {
    document.documentElement.dataset.theme = theme;
    el.themeButtons.forEach((b) => b.classList.toggle('active', b.dataset.value === theme));
  }

  function toggleNameFields(mode) {
    el.fieldSuffix.hidden = mode !== 'suffix';
    el.fieldPrefix.hidden = mode !== 'prefix';
  }

  /** Salva um ajuste parcial e reaplica localmente. */
  async function saveSetting(partial) {
    const updated = await api.setSettings(partial);
    Store.patch({ settings: updated });
    updateThemeButtons(updated.theme);
    toggleNameFields(updated.fileNameMode);
    if ('ffmpegPath' in partial) checkFfmpeg();
  }

  /* --------------------------------- FFmpeg -------------------------------- */

  async function checkFfmpeg() {
    const custom = Store.get().settings.ffmpegPath || '';
    const result = await api.checkFfmpeg(custom || null);
    const ok = !!(result && result.ok);
    Store.patch({ ffmpegOk: ok });

    el.ffmpegBanner.hidden = ok;
    el.ffmpegStatus.textContent = ok
      ? `FFmpeg: ${result.bin || 'ffmpeg'} ✓`
      : I18n.t('sidebar.ffmpegMissing');
    el.ffmpegStatus.className = 'hint ' + (ok ? 'ok' : 'warn');
    el.btnConvert.disabled = !ok || !hasQueuedJobs();
  }

  /* ------------------------------ Lista de jobs ---------------------------- */

  function hasQueuedJobs() {
    return [...Store.get().jobs.values()].some((j) => j.status === 'queued');
  }

  /** Opções de formato de saída para um job. */
  function formatOptions(job) {
    const list = job.category === 'document'
      ? (DOC_FORMATS[job.from] || [])
      : (FORMATS[job.category] || []);
    return list;
  }

  /** Cria (ou recria) todas as linhas da tabela a partir do estado. */
  function renderList() {
    const jobs = Store.get().jobs;
    el.tbody.textContent = '';
    rows.clear();

    if (jobs.size === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 5;
      td.dataset.i18n = 'list.empty';
      td.textContent = I18n.t('list.empty');
      tr.appendChild(td);
      el.tbody.appendChild(tr);
    } else {
      for (const job of jobs.values()) el.tbody.appendChild(createRow(job));
    }
    el.fileCount.textContent = jobs.size ? I18n.t('list.total', { count: jobs.size }) : '';
    updateToolbar();
  }

  /** Monta uma linha da tabela para um job. */
  function createRow(job) {
    const tr = document.createElement('tr');

    // Coluna: arquivo
    const tdName = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'file-name';
    wrap.innerHTML = `<span class="ext-badge"></span>
      <span class="names"><span class="name"></span><span class="target"></span></span>`;
    wrap.querySelector('.ext-badge').textContent = job.from.slice(0, 4);
    const nameEl = wrap.querySelector('.name');
    nameEl.textContent = fileName(job.input);
    nameEl.title = job.input;
    tdName.appendChild(wrap);
    tr.appendChild(tdName);

    // Coluna: formato (de -> para) com seleção editável enquanto na fila
    const tdFormat = document.createElement('td');
    tdFormat.className = 'col-format';
    const arrow = document.createElement('span');
    arrow.className = 'format-arrow';
    arrow.innerHTML = `<span class="from"></span><span class="arrow">→</span>`;
    arrow.querySelector('.from').textContent = job.from;
    const select = document.createElement('select');
    select.style.padding = '4px 6px';
    select.style.fontSize = '12px';
    for (const f of formatOptions(job)) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.toUpperCase();
      select.appendChild(opt);
    }
    select.value = job.to;
    select.disabled = job.status === 'processing';
    select.addEventListener('change', () => api.setJobFormat(job.id, select.value));
    arrow.appendChild(select);
    tdFormat.appendChild(arrow);
    tr.appendChild(tdFormat);

    // Coluna: status
    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const badge = document.createElement('span');
    badge.className = `badge ${job.status}`;
    badge.textContent = I18n.t(`status.${job.status}`);
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // Coluna: progresso
    const tdProgress = document.createElement('td');
    tdProgress.className = 'col-progress';
    const bar = document.createElement('div');
    bar.className = `progress ${job.status}`;
    bar.innerHTML = '<span></span>';
    const label = document.createElement('div');
    label.className = 'progress-label';
    tdProgress.appendChild(bar);
    tdProgress.appendChild(label);
    tr.appendChild(tdProgress);

    // Coluna: ações
    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '4px';

    const btnCancel = iconButton('✕', 'danger', () => api.cancelJob(job.id));
    btnCancel.title = I18n.t('actions.cancel');
    btnCancel.disabled = !['queued', 'processing'].includes(job.status);
    actions.appendChild(btnCancel);

    if (job.status === 'completed') {
      const btnFolder = iconButton('🗂', '', () => api.showItemInFolder(job.output));
      btnFolder.title = I18n.t('actions.showFile');
      actions.appendChild(btnFolder);
    }
    tdActions.appendChild(actions);
    tr.appendChild(tdActions);

    rows.set(job.id, { tr, bar, label, badge, select, btnCancel });
    updateRow(job);
    return tr;
  }

  function iconButton(text, variant, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-icon ${variant}`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  /** Atualiza uma linha existente sem recriar a tabela (usado no progresso). */
  function updateRow(job) {
    const ref = rows.get(job.id);
    if (!ref) return renderList();

    ref.badge.className = `badge ${job.status}`;
    ref.badge.textContent = I18n.t(`status.${job.status}`);
    ref.bar.className = `progress ${job.status}`;
    ref.bar.firstElementChild.style.width = `${job.progress || 0}%`;

    const isDone = ['completed', 'error', 'canceled'].includes(job.status);
    ref.label.textContent = isDone ? (job.message || '') : `${job.progress || 0}%`;

    ref.btnCancel.disabled = !['queued', 'processing'].includes(job.status);
    ref.select.disabled = job.status === 'processing';
    if (ref.select.value !== job.to) ref.select.value = job.to;
    updateToolbar();
  }

  /** Habilita/desabilita os botões da barra inferior conforme o estado. */
  function updateToolbar() {
    const { jobs, paused, ffmpegOk } = Store.get();
    const list = [...jobs.values()];
    const anyQueued = list.some((j) => j.status === 'queued');
    const anyActive = list.some((j) => ['queued', 'processing'].includes(j.status));

    el.btnConvert.disabled = !anyQueued || !ffmpegOk;
    el.btnPause.disabled = !anyQueued;
    el.btnPause.textContent = paused ? I18n.t('actions.resume') : I18n.t('actions.pause');
    el.btnPause.classList.toggle('btn-primary', paused);
    el.btnPause.classList.toggle('btn-secondary', !paused);
    el.btnPause.disabled = !(anyQueued || paused);
    el.btnCancelAll.disabled = !anyActive;
  }

  /* ------------------------------ Adicionar files --------------------------- */

  async function addFiles(paths) {
    const valid = paths.filter((p) => ALL_EXT.includes(ext(p)));
    const skipped = paths.length - valid.length;
    if (!valid.length) {
      if (skipped) toast(I18n.t('toast.unsupported', { count: skipped }));
      return;
    }
    const created = await api.addFiles(valid, {});
    created.forEach((j) => Store.upsertJob(j));
    renderList();
    toast(I18n.t('toast.added', { count: created.length }));
    if (skipped) toast(I18n.t('toast.unsupported', { count: skipped }));
  }

  /* --------------------------------- Eventos -------------------------------- */

  function bindEvents() {
    // Configurações
    el.language.addEventListener('change', () => {
      I18n.setLocale(el.language.value);
      saveSetting({ language: el.language.value });
      renderList();
      checkFfmpeg();
    });

    el.themeButtons.forEach((b) => b.addEventListener('click', () => {
      saveSetting({ theme: b.dataset.value });
    }));

    el.btnPickFolder.addEventListener('click', async () => {
      const dir = await api.pickFolder();
      if (dir) saveSetting({ outputDir: dir });
      el.outputDir.value = Store.get().settings.outputDir || '—';
    });

    el.fileNameMode.addEventListener('change', () => saveSetting({ fileNameMode: el.fileNameMode.value }));
    el.fileNameSuffix.addEventListener('change', () => saveSetting({ fileNameSuffix: el.fileNameSuffix.value || '_convertido' }));
    el.fileNamePrefix.addEventListener('change', () => saveSetting({ fileNamePrefix: el.fileNamePrefix.value || '' }));
    el.quality.addEventListener('change', () => saveSetting({ quality: el.quality.value }));
    el.maxConcurrent.addEventListener('change', () => saveSetting({ maxConcurrent: Math.min(6, Math.max(1, Number(el.maxConcurrent.value) || 2)) }));
    el.keepMetadata.addEventListener('change', () => saveSetting({ keepMetadata: el.keepMetadata.checked }));
    el.overwriteExisting.addEventListener('change', () => saveSetting({ overwriteExisting: el.overwriteExisting.checked }));
    el.ffmpegPath.addEventListener('change', () => saveSetting({ ffmpegPath: el.ffmpegPath.value.trim() }));

    // Adição de arquivos
    el.btnPickFiles.addEventListener('click', async () => addFiles(await api.pickFiles()));
    el.btnAddFiles.addEventListener('click', async () => addFiles(await api.pickFiles()));
    el.dropzone.addEventListener('click', () => el.btnPickFiles.click());

    // Drag & drop
    ['dragenter', 'dragover'].forEach((evt) =>
      el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((evt) =>
      el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.remove('dragover'); }));
    el.dropzone.addEventListener('drop', (e) => {
      const paths = [...(e.dataTransfer?.files || [])]
        .map((f) => api.getPathForFile(f))
        .filter(Boolean);
      if (paths.length) addFiles(paths);
    });
    // Evita que soltar fora da zona abra o arquivo no Electron.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // Controles da fila
    el.btnConvert.addEventListener('click', async () => {
      await api.startQueue();
      Store.patch({ paused: false });
      updateToolbar();
    });

    el.btnPause.addEventListener('click', async () => {
      const { paused } = Store.get();
      if (paused) {
        await api.resumeQueue();
        Store.patch({ paused: false });
      } else {
        await api.pauseQueue();
        Store.patch({ paused: true });
      }
      updateToolbar();
    });

    el.btnCancelAll.addEventListener('click', () => api.cancelAll());
    el.btnClear.addEventListener('click', async () => { await api.clearFinished(); });

    // Eventos vindos do processo principal
    api.onJobUpdate((job) => {
      const isNew = !Store.get().jobs.has(job.id);
      Store.upsertJob(job);
      if (isNew) renderList();
      else updateRow(job);
    });

    api.onQueueState((state) => {
      if (typeof state.paused === 'boolean') Store.patch({ paused: state.paused });
      if (state.idle) {
        updateToolbar();
        if (![...Store.get().jobs.values()].some((j) => j.status === 'processing')) {
          toast(I18n.t('toast.queueDone'));
        }
      }
      updateToolbar();
    });

    api.onQueueCleared(() => {
      Store.clearFinished();
      renderList();
    });
  }

  /* --------------------------------- Init ---------------------------------- */

  async function init() {
    Object.assign(el, {
      toast: document.getElementById('toast'),
      tbody: document.getElementById('file-tbody'),
      fileCount: document.getElementById('file-count'),
      dropzone: document.getElementById('dropzone'),
      btnPickFiles: document.getElementById('btn-pick-files'),
      btnPickFolder: document.getElementById('btn-pick-folder'),
      btnAddFiles: document.getElementById('btn-add-files'),
      btnClear: document.getElementById('btn-clear'),
      btnConvert: document.getElementById('btn-convert'),
      btnPause: document.getElementById('btn-pause'),
      btnCancelAll: document.getElementById('btn-cancel-all'),
      language: document.getElementById('setting-language'),
      quality: document.getElementById('setting-quality'),
      fileNameMode: document.getElementById('setting-fileNameMode'),
      fileNameSuffix: document.getElementById('setting-fileNameSuffix'),
      fileNamePrefix: document.getElementById('setting-fileNamePrefix'),
      fieldSuffix: document.getElementById('field-suffix'),
      fieldPrefix: document.getElementById('field-prefix'),
      maxConcurrent: document.getElementById('setting-maxConcurrent'),
      keepMetadata: document.getElementById('setting-keepMetadata'),
      overwriteExisting: document.getElementById('setting-overwriteExisting'),
      ffmpegPath: document.getElementById('setting-ffmpegPath'),
      ffmpegStatus: document.getElementById('ffmpeg-status'),
      ffmpegBanner: document.getElementById('ffmpeg-banner'),
      outputDir: document.getElementById('setting-outputDir'),
      themeButtons: [...document.querySelectorAll('#setting-theme button')]
    });

    const settings = await api.getSettings();
    I18n.setLocale(settings.language || 'pt-BR');
    applySettings(settings);
    bindEvents();
    renderList();
    checkFfmpeg();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
