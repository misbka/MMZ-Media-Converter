'use strict';

/**
 * src/renderer/js/sidebar.js
 * ------------------------------------------------------------------
 * Sidebar de configurações rápidas: formato de saída (por categoria),
 * qualidade, pasta de destino, nomenclatura e concorrência.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.sidebar = (() => {
  const t = (...args) => MMZ.i18n.t(...args);
  /** @type {Record<string, HTMLElement>} */
  let refs = {};

  function init() {
    refs = {
      tabs: document.getElementById('category-tabs'),
      grid: document.getElementById('format-grid'),
      quality: document.getElementById('quality-select'),
      outputDir: document.getElementById('output-dir'),
      browseDir: document.getElementById('browse-dir'),
      sameSource: document.getElementById('same-source'),
      suffix: document.getElementById('suffix-input'),
      concurrency: document.getElementById('concurrency'),
      concurrencyValue: document.getElementById('concurrency-value'),
    };
    refs.browseDir.innerHTML = MMZ.icons.get('folder', { size: 16 });

    // --- Formato de saída (delegado: os chips são recriados no render)
    refs.tabs.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-category]');
      if (!tab) return;
      MMZ.store.set({ activeCategory: tab.dataset.category }, 'selection');
    });

    refs.grid.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-format]');
      if (!chip) return;
      applyFormat(chip.dataset.format);
    });

    // --- Qualidade
    refs.quality.addEventListener('change', async () => {
      const next = await window.mmz.settings.set({ quality: refs.quality.value });
      MMZ.store.set({ settings: next }, 'settings');
    });

    // --- Pasta de destino
    refs.browseDir.addEventListener('click', pickOutputDir);

    refs.sameSource.addEventListener('change', async () => {
      if (refs.sameSource.checked) {
        await updateSettings({ outputDir: '' });
        return;
      }
      const last = MMZ.store.get().lastOutputDir;
      if (last) {
        await updateSettings({ outputDir: last });
      } else {
        const dir = await window.mmz.dialog.pickDirectory();
        if (dir) {
          MMZ.store.set({ lastOutputDir: dir }, 'memory');
          await updateSettings({ outputDir: dir }, 'toast.dirChanged');
        } else {
          render(); // volta ao estado anterior
        }
      }
    });

    // --- Nomenclatura
    document.querySelectorAll('input[name="naming"]').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        await updateSettings({ namingMode: radio.value });
        if (radio.value === 'suffix') refs.suffix.focus();
      });
    });

    refs.suffix.addEventListener('input', MMZ.util.debounce(async () => {
      await updateSettings({ suffix: refs.suffix.value });
    }, 450));

    // --- Concorrência
    refs.concurrency.addEventListener('input', () => {
      refs.concurrencyValue.textContent = refs.concurrency.value;
    });
    refs.concurrency.addEventListener('change', async () => {
      await updateSettings({ concurrency: parseInt(refs.concurrency.value, 10) });
    });
  }

  /** Atalho: persiste settings e sincroniza o store. */
  async function updateSettings(patch, toastKey) {
    const next = await window.mmz.settings.set(patch);
    MMZ.store.set({ settings: next }, 'settings');
    if (toastKey) MMZ.toast.show(t(toastKey), 'success', 2600);
    return next;
  }

  /** Abre o seletor de pasta de destino. */
  async function pickOutputDir() {
    const dir = await window.mmz.dialog.pickDirectory();
    if (!dir) return;
    MMZ.store.set({ lastOutputDir: dir }, 'memory');
    await updateSettings({ outputDir: dir }, 'toast.dirChanged');
  }

  /**
   * Aplica um formato à categoria ativa (na fila e nos próximos jobs).
   * @param {string} formatId
   */
  async function applyFormat(formatId) {
    const state = MMZ.store.get();
    const category = state.activeCategory;
    const format = state.formats.formats.find((f) => f.id === formatId);
    if (!format) return;

    await updateSettings({
      defaultFormats: { ...state.settings.defaultFormats, [category]: formatId },
    });
    await window.mmz.queue.applyFormat({ category, formatId });

    MMZ.toast.show(
      t('toast.formatApplied', {
        format: format.label,
        category: t(`category.${category}`),
      }),
      'success',
      2600,
    );
    render();
  }

  /** Desenha os abas de categoria. */
  function renderTabs() {
    const state = MMZ.store.get();
    const counts = {};
    for (const job of state.queue.jobs) {
      if (job.status === 'queued') counts[job.category] = (counts[job.category] || 0) + 1;
    }

    refs.tabs.innerHTML = '';
    for (const category of state.formats.categories) {
      const tab = MMZ.util.el('button', {
        class: `tab${state.activeCategory === category ? ' active' : ''}`,
        attrs: { type: 'button', 'data-category': category, role: 'tab' },
      });
      tab.innerHTML = MMZ.icons.forCategory(category);
      tab.appendChild(MMZ.util.el('span', { text: t(`category.${category}`) }));

      if (counts[category]) {
        const badge = MMZ.util.el('span', { class: 'tab-count', text: String(counts[category]) });
        badge.style.position = 'absolute';
        tab.style.position = 'relative';
        badge.style.top = '4px';
        badge.style.right = '6px';
        badge.style.fontSize = '9.5px';
        badge.style.fontWeight = '700';
        badge.style.background = 'var(--accent)';
        badge.style.color = '#fff';
        badge.style.borderRadius = '999px';
        badge.style.padding = '0 5px';
        tab.appendChild(badge);
      }
      refs.tabs.appendChild(tab);
    }
  }

  /** Desenha os chips de formato da categoria ativa. */
  function renderFormats() {
    const state = MMZ.store.get();
    const category = state.activeCategory;
    const selected = state.settings.defaultFormats[category];

    refs.grid.innerHTML = '';
    for (const format of state.formats.formats.filter((f) => f.category === category)) {
      const chip = MMZ.util.el('button', {
        class: `format-chip${selected === format.id ? ' active' : ''}`,
        text: format.label,
        attrs: { type: 'button', 'data-format': format.id },
      });
      chip.title = `.${format.ext}`;
      refs.grid.appendChild(chip);
    }
  }

  /** Desenha os demais controles (evita mexer no campo em foco). */
  function renderControls() {
    const settings = MMZ.store.get().settings;
    const focused = document.activeElement;

    if (focused !== refs.quality) refs.quality.value = settings.quality;
    if (focused !== refs.outputDir) {
      refs.outputDir.value = settings.outputDir || t('sidebar.destinationSame');
      refs.outputDir.title = settings.outputDir || t('sidebar.destinationSame');
    }
    if (focused !== refs.suffix) refs.suffix.value = settings.suffix || '';
    if (focused !== refs.concurrency) {
      refs.concurrency.value = String(settings.concurrency);
      refs.concurrencyValue.textContent = String(settings.concurrency);
    }
    refs.sameSource.checked = !settings.outputDir;

    document.querySelectorAll('input[name="naming"]').forEach((radio) => {
      radio.checked = radio.value === settings.namingMode;
    });
    refs.suffix.disabled = settings.namingMode !== 'suffix';
    refs.suffix.style.opacity = settings.namingMode === 'suffix' ? '1' : '.5';
  }

  function render() {
    if (!refs.tabs || !MMZ.store.get().settings || !MMZ.store.get().formats) return;
    renderTabs();
    renderFormats();
    renderControls();
  }

  return { init, render };
})();
