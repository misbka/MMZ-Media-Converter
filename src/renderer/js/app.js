'use strict';

/**
 * src/renderer/js/app.js
 * ------------------------------------------------------------------
 * Orquestrador do renderer:
 *  - carrega estado inicial (info, settings, formatos, idioma);
 *  - inicializa componentes e assina o store global;
 *  - processa os eventos da fila vindos do processo principal;
 *  - controla tema, idioma e adição de arquivos.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

(() => {
  const t = (...args) => MMZ.i18n.t(...args);
  const store = MMZ.store;
  const api = window.mmz;

  // Captura erros para o auto-teste (`--smoke-test`) e para diagnóstico.
  window.__mmzErrors = [];
  window.addEventListener('error', (event) => {
    window.__mmzErrors.push(String(event.message || event.error || 'error'));
  });
  window.addEventListener('unhandledrejection', (event) => {
    window.__mmzErrors.push(`rejection: ${String(event.reason)}`);
  });

  // ------------------------------------------------------------------
  // Estado anterior da fila (para detectar conclusões/falhas)
  // ------------------------------------------------------------------
  /** @type {Map<string, string>} */
  let previousStatus = new Map();
  let previousState = 'idle';

  /**
   * Compara o snapshot anterior com o novo e emite avisos de:
   *  - conversão concluída com erro;
   *  - fim da fila (tudo certo / parcial).
   * @param {object} next
   */
  function announceQueueChanges(next) {
    let newErrors = 0;
    let newCompleted = 0;
    for (const job of next.jobs) {
      const before = previousStatus.get(job.id);
      if (!before || before === job.status) continue;
      if (job.status === 'error') {
        newErrors += 1;
        MMZ.toast.show(t('toast.conversionFailed', { name: job.fileName }), 'error', 5200);
      } else if (job.status === 'completed' && before === 'running') {
        newCompleted += 1;
      }
    }

    const finished = previousState === 'running' && next.state === 'idle' && (newCompleted > 0 || newErrors > 0);
    if (finished) {
      if (next.stats.error > 0) {
        MMZ.toast.show(
          t('toast.partialCompleted', { done: next.stats.completed, total: next.stats.total }),
          'warn',
          5000,
        );
      } else {
        MMZ.toast.show(t('toast.allCompleted'), 'success', 4500);
      }
    }

    previousStatus = new Map(next.jobs.map((job) => [job.id, job.status]));
    previousState = next.state;
  }

  // ------------------------------------------------------------------
  // Assinaturas do store -> renderização por escopo
  // ------------------------------------------------------------------
  function renderAll() {
    MMZ.sidebar.render();
    MMZ.fileList.render();
    MMZ.toolbar.render();
    MMZ.statusbar.render();
  }

  function subscribeStore() {
    store.subscribe((scope) => {
      switch (scope) {
        case 'queue':
          MMZ.fileList.render();
          MMZ.toolbar.render();
          MMZ.statusbar.render();
          MMZ.sidebar.render();
          break;
        case 'settings':
          MMZ.sidebar.render();
          MMZ.fileList.render();
          MMZ.toolbar.render();
          break;
        case 'selection':
          MMZ.sidebar.render();
          MMZ.fileList.updateSelection();
          break;
        case 'memory':
          break;
        default:
          renderAll();
      }
    });
  }

  // ------------------------------------------------------------------
  // Eventos da fila (progresso chega sem reconstruir a lista)
  // ------------------------------------------------------------------
  function subscribeQueueEvents() {
    api.queue.onEvent((event) => {
      if (!event) return;

      if (event.type === 'snapshot') {
        announceQueueChanges(event.payload);
        store.applySnapshot(event.payload);
        return;
      }

      if (event.type === 'progress') {
        const payload = event.payload;
        const job = store.findJob(payload.id);
        if (job) {
          if (typeof payload.progress === 'number') job.progress = payload.progress;
          if (payload.speed) job.speed = payload.speed;
          if (payload.fps !== undefined) job.fps = payload.fps;
          if (payload.pausing !== undefined) job.pausing = payload.pausing;
        }
        MMZ.fileList.updateProgress(payload);
        MMZ.toolbar.renderOverall();
      }
    });
  }

  // ------------------------------------------------------------------
  // Adição de arquivos (botão, diálogo e drag-and-drop)
  // ------------------------------------------------------------------

  /** @param {string} reason chave do motivo de rejeição -> chave de toast */
  const REJECT_TOAST = {
    unsupported_format: 'toast.rejectedUnsupported',
    duplicate: 'toast.duplicate',
    file_not_found: 'toast.notFound',
    not_a_file: 'toast.notFound',
  };

  /**
   * Adiciona caminhos de arquivo à fila.
   * @param {string[]} paths
   */
  async function addPaths(paths) {
    const state = store.get();
    const result = await api.queue.add(paths);

    if (result.added > 0) {
      MMZ.toast.show(t('toast.added', { count: result.added }), 'success', 3200);
    }

    const grouped = {};
    for (const item of result.rejected || []) {
      grouped[item.reason] = (grouped[item.reason] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(grouped)) {
      const key = REJECT_TOAST[reason] || 'toast.rejectedUnsupported';
      MMZ.toast.show(t(key, { count }), grouped[reason] === 'duplicate' ? 'warn' : 'error', 4600);
    }

    // Foca a sidebar na categoria dos arquivos recém-adicionados.
    const extToCategory = state.formats ? state.formats.extToCategory : {};
    const categories = (result.added > 0 ? paths : [])
      .map((path) => extToCategory[MMZ.util.extOf(path)])
      .filter(Boolean);
    if (categories.length) {
      const current = state.activeCategory;
      const currentHasJobs = state.queue.jobs.some((job) => job.category === current);
      if (!currentHasJobs && categories[0] !== current) {
        store.set({ activeCategory: categories[0] }, 'selection');
      }
    }
  }

  // ------------------------------------------------------------------
  // Cabeçalho: tema e idioma
  // ------------------------------------------------------------------
  function applyTheme(theme) {
    const resolved = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', resolved);
    document.getElementById('theme-icon').innerHTML = MMZ.icons.get(resolved === 'dark' ? 'sun' : 'moon');
    document.getElementById('theme-toggle').title = t(
      resolved === 'dark' ? 'header.themeLight' : 'header.themeDark',
    );
  }

  /** Popula o <select> de idiomas (nomes nativos). */
  function renderLanguageSelect() {
    const select = document.getElementById('language-select');
    const settings = store.get().settings;
    select.innerHTML = '';
    for (const code of store.get().info.languages) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = t(`lang.${code}`);
      option.selected = settings.language === code;
      select.appendChild(option);
    }
  }

  function renderHeader() {
    applyTheme(store.get().settings.theme);
    renderLanguageSelect();
  }

  function wireHeader() {
    document.getElementById('brand-logo').innerHTML = MMZ.icons.get('logo');
    document.getElementById('lang-icon').innerHTML = MMZ.icons.get('globe', { size: 15 });

    document.getElementById('theme-toggle').addEventListener('click', async () => {
      const current = store.get().settings.theme;
      const next = current === 'dark' ? 'light' : 'dark';
      const settings = await api.settings.set({ theme: next });
      store.set({ settings }, 'settings');
      renderHeader();
    });

    document.getElementById('language-select').addEventListener('change', async (event) => {
      const lang = event.target.value;
      const result = await api.i18n.load(lang);
      MMZ.i18n.init(result.dict, result.lang);

      const settings = await api.settings.set({ language: result.lang });
      store.set({ settings }, 'settings');

      // Reaplica todas as traduções (data-i18n) e redesenha a UI.
      MMZ.i18n.apply(document);
      renderHeader();
      renderAll();
      document.title = t('app.name');
    });
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  async function boot() {
    const settings = await api.settings.get();
    const [info, formats, dictionary] = await Promise.all([
      api.app.info(),
      api.formats.list(),
      api.i18n.load(settings.language),
    ]);

    MMZ.i18n.init(dictionary.dict, dictionary.lang);
    store.set({ info, settings, formats }, 'init');

    // Inicializa componentes e traduz a página estática.
    MMZ.sidebar.init();
    MMZ.dropzone.init();
    MMZ.fileList.init();
    MMZ.toolbar.init();
    MMZ.statusbar.init();
    wireHeader();

    MMZ.i18n.apply(document);
    document.title = t('app.name');

    subscribeStore();
    subscribeQueueEvents();

    // Carrega o estado atual da fila (caso algo tenha mudado no startup).
    const snapshot = await api.queue.snapshot();
    previousStatus = new Map(snapshot.jobs.map((job) => [job.id, job.status]));
    previousState = snapshot.state;
    store.applySnapshot(snapshot);

    renderHeader();
    renderAll();

    // Avisa sobre FFmpeg ausente logo na abertura.
    if (!info.ffmpeg.found) MMZ.toast.show(t('toast.ffmpegMissing'), 'warn', 7000);

    window.__mmzReady = true;
  }

  // API pública usada pelos módulos carregados antes deste arquivo.
  window.MMZ.app = { addPaths };

  boot().catch((err) => {
    window.__mmzErrors.push(`boot: ${String(err && err.message ? err.message : err)}`);
    // Último recurso: mostra algo utilizável mesmo com falha de boot.
    document.body.classList.add('boot-failed');
    console.error('[MMZ] falha no boot:', err);
  });
})();
