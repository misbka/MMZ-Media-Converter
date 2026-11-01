'use strict';

/**
 * src/renderer/js/fileList.js
 * ------------------------------------------------------------------
 * Lista central de arquivos: cartões com ícone, caminho de destino,
 * badge de status, barra de progresso individual e ações por job.
 *
 * Performance: a lista é reconstruída apenas em mudanças estruturais
 * (snapshot). Atualizações de progresso alteram direto o DOM do item.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.fileList = (() => {
  const t = (...args) => MMZ.i18n.t(...args);
  const util = MMZ.util;

  /** id -> elemento <li> (para updates diretos de progresso) */
  const nodes = new Map();
  let list = null;
  let emptyState = null;
  let listCount = null;

  function init() {
    list = document.getElementById('file-list');
    emptyState = document.getElementById('empty-state');
    listCount = document.getElementById('list-count');
    document.getElementById('empty-icon').innerHTML = MMZ.icons.get('inbox');

    list.addEventListener('click', (event) => {
      const item = event.target.closest('.file-item');
      if (!item) return;
      const job = MMZ.store.findJob(item.dataset.id);
      if (!job) return;

      const actionBtn = event.target.closest('[data-action]');
      if (actionBtn) {
        runAction(actionBtn.dataset.action, job);
        return;
      }
      select(job);
    });
  }

  /**
   * Ações por item (abrir, revelar, remover, cancelar, tentar de novo).
   * @param {string} action
   * @param {object} job
   */
  async function runAction(action, job) {
    switch (action) {
      case 'open': {
        if (!job.outputPath) return;
        const ok = await window.mmz.shell.open(job.outputPath);
        if (!ok) MMZ.toast.show(t('toast.openFailed'), 'error');
        break;
      }
      case 'folder':
        await window.mmz.shell.reveal(job.outputPath || job.inputPath);
        break;
      case 'remove':
        await window.mmz.queue.remove(job.id);
        break;
      case 'cancel':
        await window.mmz.queue.cancel(job.id);
        break;
      case 'retry':
        await window.mmz.queue.retry(job.id);
        MMZ.toast.show(t('toast.started'), 'info', 2400);
        break;
      default:
        break;
    }
  }

  /** Seleciona um item e sincroniza a sidebar com a categoria dele. */
  function select(job) {
    const state = MMZ.store.get();
    if (state.selectedId === job.id && state.activeCategory === job.category) return;
    MMZ.store.set({ selectedId: job.id, activeCategory: job.category }, 'selection');
  }

  /** Só troca as classes de seleção (sem reconstruir a lista). */
  function updateSelection() {
    const selectedId = MMZ.store.get().selectedId;
    nodes.forEach((node, id) => node.classList.toggle('selected', id === selectedId));
  }

  // ------------------------------------------------------------------
  // Renderização de um job
  // ------------------------------------------------------------------

  /** Rótulo do status (com suporte a "pausa em andamento" no Windows). */
  function statusLabel(job) {
    if (job.pausing) return t('status.pausing');
    return t(`status.${job.status}`);
  }

  /** Texto do caminho de destino exibido no cartão. */
  function targetLabel(job) {
    const out = job.outputPath || '';
    if (!out) return `${t('category.' + job.category)} → .${job.targetExt || ''}`;
    const name = util.baseName(out);
    const outDir = util.dirOf(out);
    const srcDir = util.dirOf(job.inputPath);
    const sep = out.includes('\\') ? '\\' : '/';
    return outDir && outDir !== srcDir ? `${outDir}${sep}${name}` : name;
  }

  /** Linha de metadados (progresso, velocidade, ETA, erro...). */
  function fillMeta(meta, job, elapsed) {
    meta.innerHTML = '';
    const add = (className, text) => meta.appendChild(util.el('span', { class: className, text }));

    if (job.status === 'running' || job.status === 'paused') {
      add('pct', `${Math.round(job.progress || 0)}%`);
      if (job.speed && job.speed !== '1x' && job.speed !== '0x') add('speed', job.speed);
      const remaining = util.estimateRemaining(job.progress || 0, elapsed || (Date.now() - (job.startedAt || Date.now())));
      if (remaining !== null) add('eta', `${util.formatDuration(remaining)} ${t('job.eta')}`);
      if (job.pausing) add('muted', t('status.pausing'));
      return;
    }
    if (job.status === 'completed') {
      add('pct', '100%');
      add('generated', t('job.generated', { size: util.formatBytes(job.outputSize || 0) }));
      return;
    }
    if (job.status === 'error') {
      const dict = MMZ.i18n.dict();
      const key = `errors.${job.error}`;
      const message = dict[key] || job.error || t('errors.unknown_error');
      add('pct', '—');
      add('muted-error', message);
      return;
    }
    if (job.status === 'queued') {
      add('pct', '0%');
      add('muted', t('status.queued'));
      return;
    }
    if (job.status === 'canceled') {
      add('pct', '—');
      add('muted', t('status.canceled'));
    }
  }

  /** Monta os botões de ação disponíveis para o status atual. */
  function actionBar(job) {
    const wrap = util.el('div', { class: 'file-actions' });
    const add = (action, icon, titleKey, extraClass = '') => {
      const btn = util.el('button', {
        class: `icon-btn${extraClass ? ` ${extraClass}` : ''}`,
        title: t(titleKey),
        attrs: { type: 'button', 'data-action': action },
      });
      btn.innerHTML = MMZ.icons.get(icon, { size: 14 });
      wrap.appendChild(btn);
    };

    if (job.status === 'completed') {
      add('open', 'external', 'actions.open');
      add('folder', 'folderOpen', 'actions.openFolder');
    }
    if (job.status === 'error' || job.status === 'canceled') add('retry', 'refresh', 'actions.retry');
    if (job.status === 'running' || job.status === 'paused') add('cancel', 'stop', 'actions.cancelJob');
    add('remove', 'trash', 'actions.remove', 'danger');
    return wrap;
  }

  /** Cria o cartão de um job. */
  function createItem(job) {
    const state = MMZ.store.get();
    const item = util.el('li', {
      class: `file-item${state.selectedId === job.id ? ' selected' : ''}`,
      dataset: { id: job.id, status: job.status, category: job.category },
    });

    // Ícone da categoria
    const icon = util.el('div', { class: 'file-icon', dataset: { category: job.category } });
    icon.innerHTML = MMZ.icons.forCategory(job.category);
    item.appendChild(icon);

    // Bloco principal
    const main = util.el('div', { class: 'file-main' });
    main.appendChild(util.el('div', { class: 'file-name', text: job.fileName, title: job.inputPath }));

    const sub = util.el('div', { class: 'file-sub' });
    sub.appendChild(util.el('span', { text: util.formatBytes(job.inputSize || 0) }));
    sub.appendChild(util.el('span', { class: 'dot' }));
    sub.appendChild(util.el('span', { text: util.dirOf(job.inputPath), title: job.inputPath }));
    main.appendChild(sub);

    const target = util.el('div', { class: 'file-target' });
    target.appendChild(util.el('span', { class: 'arrow', text: '→' }));
    target.appendChild(util.el('span', {
      class: 'target-name',
      text: targetLabel(job),
      title: job.outputPath || '',
    }));
    main.appendChild(target);
    item.appendChild(main);

    // Coluna de status + ações
    const side = util.el('div', { class: 'file-side' });
    const badge = util.el('span', {
      class: 'badge',
      text: statusLabel(job),
      dataset: { status: job.status },
    });
    side.appendChild(badge);
    side.appendChild(actionBar(job));
    item.appendChild(side);

    // Progresso individual
    const progress = util.el('div', { class: 'file-progress' });
    const bar = util.el('div', { class: 'progress-bar' });
    const fill = util.el('div', { class: 'progress-fill' });
    fill.style.width = `${job.progress || 0}%`;
    if (job.status === 'completed') fill.dataset.state = 'ok';
    else if (job.status === 'error') fill.dataset.state = 'error';
    else if (job.status === 'paused') fill.dataset.state = 'paused';
    bar.appendChild(fill);
    progress.appendChild(bar);

    const meta = util.el('div', { class: 'file-meta' });
    fillMeta(meta, job);
    progress.appendChild(meta);
    item.appendChild(progress);

    return item;
  }

  /** Reconstrói a lista completa. */
  function render() {
    if (!list) return;
    const jobs = MMZ.store.get().queue.jobs;
    list.innerHTML = '';
    nodes.clear();

    for (const job of jobs) {
      const node = createItem(job);
      nodes.set(job.id, node);
      list.appendChild(node);
    }

    const isEmpty = jobs.length === 0;
    emptyState.classList.toggle('visible', isEmpty);
    listCount.textContent = t('list.count', { count: jobs.length });
  }

  /**
   * Atualiza apenas a barra/meta de um job (evento de progresso).
   * @param {{id:string, progress:number, speed?:string, elapsed?:number, pausing?:boolean}} payload
   */
  function updateProgress(payload) {
    const job = MMZ.store.findJob(payload.id);
    if (!job) return;
    const node = nodes.get(payload.id);
    if (!node) return;

    const fill = node.querySelector('.progress-fill');
    const pct = Math.max(0, Math.min(100, payload.progress || 0));
    if (fill) fill.style.width = `${pct}%`;

    const meta = node.querySelector('.file-meta');
    if (meta) fillMeta(meta, job, payload.elapsed);
  }

  /** Atualiza o status visual de um job sem reconstruir a lista. */
  function updateJobStatus(job) {
    const node = nodes.get(job.id);
    if (!node) return;
    node.dataset.status = job.status;
    const badge = node.querySelector('.badge');
    if (badge) {
      badge.dataset.status = job.status;
      badge.textContent = statusLabel(job);
    }
    const fill = node.querySelector('.progress-fill');
    if (fill) {
      fill.style.width = `${job.progress || 0}%`;
      if (job.status === 'completed') fill.dataset.state = 'ok';
      else if (job.status === 'error') fill.dataset.state = 'error';
      else if (job.status === 'paused') fill.dataset.state = 'paused';
      else delete fill.dataset.state;
    }
    const meta = node.querySelector('.file-meta');
    if (meta) fillMeta(meta, job);

    // Ações mudam conforme o status: recomposta apenas a coluna lateral.
    const side = node.querySelector('.file-side');
    if (side) {
      const actions = side.querySelector('.file-actions');
      if (actions) side.replaceChild(actionBar(job), actions);
    }
    const target = node.querySelector('.target-name');
    if (target) {
      target.textContent = targetLabel(job);
      target.title = job.outputPath || '';
    }
  }

  return { init, render, updateProgress, updateJobStatus, updateSelection };
})();
