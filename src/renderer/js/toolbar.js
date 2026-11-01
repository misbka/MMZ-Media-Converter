'use strict';

/**
 * src/renderer/js/toolbar.js
 * ------------------------------------------------------------------
 * Botões de ação da fila (Iniciar, Pausar, Continuar, Cancelar,
 * Limpar) + barra de progresso geral.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.toolbar = (() => {
  const t = (...args) => MMZ.i18n.t(...args);
  let refs = {};

  function init() {
    refs = {
      start: document.getElementById('btn-start'),
      pause: document.getElementById('btn-pause'),
      resume: document.getElementById('btn-resume'),
      cancel: document.getElementById('btn-cancel'),
      clear: document.getElementById('btn-clear'),
      fill: document.getElementById('overall-fill'),
      status: document.getElementById('overall-status'),
    };

    refs.start.querySelector('.btn-icon').innerHTML = MMZ.icons.get('play', { size: 15 });
    refs.pause.querySelector('.btn-icon').innerHTML = MMZ.icons.get('pause', { size: 15 });
    refs.resume.querySelector('.btn-icon').innerHTML = MMZ.icons.get('play', { size: 15 });
    refs.cancel.querySelector('.btn-icon').innerHTML = MMZ.icons.get('stop', { size: 15 });
    refs.clear.querySelector('.btn-icon').innerHTML = MMZ.icons.get('trash', { size: 15 });

    refs.start.addEventListener('click', async () => {
      await window.mmz.queue.start();
      MMZ.toast.show(t('toast.started'), 'success', 2400);
    });
    refs.pause.addEventListener('click', async () => {
      await window.mmz.queue.pause();
      MMZ.toast.show(t('toast.paused'), 'warn', 2400);
    });
    refs.resume.addEventListener('click', async () => {
      await window.mmz.queue.resume();
      MMZ.toast.show(t('toast.resumed'), 'success', 2400);
    });
    refs.cancel.addEventListener('click', async () => {
      await window.mmz.queue.cancelAll();
      MMZ.toast.show(t('toast.canceled'), 'warn', 2600);
    });
    refs.clear.addEventListener('click', async () => {
      const state = MMZ.store.get().queue;
      if (!state.jobs.length) return;
      const hasActive = state.stats.running > 0 || state.stats.queued > 0 || state.stats.paused > 0;
      if (hasActive) {
        const ok = await MMZ.toast.confirm(t('modal.clearTitle'), t('modal.clearMessage'));
        if (!ok) return;
      }
      await window.mmz.queue.clear();
      MMZ.toast.show(t('toast.cleared'), 'info', 2400);
    });
  }

  /** Texto descritivo do estado atual da fila. */
  function statusText() {
    const { state, stats } = MMZ.store.get().queue;
    if (state === 'paused') return t('toolbar.paused', { running: stats.running });
    if (state === 'running') {
      return t('toolbar.running', { running: stats.running, total: stats.total });
    }
    if (stats.total > 0 && stats.completed + stats.error + stats.canceled === stats.total) {
      return t('toolbar.done', { done: stats.completed + stats.error, total: stats.total });
    }
    if (stats.queued > 0) return t('toolbar.hasQueued', { queued: stats.queued });
    return t('toolbar.idle');
  }

  /** Desenha botões + barra geral. */
  function render() {
    if (!refs.start) return;
    const { state, stats } = MMZ.store.get().queue;
    const hasQueued = stats.queued > 0;
    const active = state === 'running' || state === 'paused';

    refs.start.hidden = !(state === 'idle' && hasQueued);
    refs.pause.hidden = state !== 'running';
    refs.resume.hidden = state !== 'paused';
    refs.cancel.hidden = !active;
    refs.clear.disabled = stats.total === 0;
    refs.start.disabled = !hasQueued;

    renderOverall();
  }

  /** Atualiza apenas a barra geral (usado pelos eventos de progresso). */
  function renderOverall() {
    const jobs = MMZ.store.get().queue.jobs;
    let sum = 0;
    for (const job of jobs) {
      sum += ['completed', 'error', 'canceled'].includes(job.status) ? 100 : (job.progress || 0);
    }
    const value = jobs.length ? Math.max(0, Math.min(100, sum / jobs.length)) : 0;
    const stats = MMZ.store.get().queue.stats;
    refs.fill.style.width = `${value}%`;
    refs.status.textContent = statusText();

    // Falhas deixam a barra em destaque avermelhado perto do fim.
    if (stats.error > 0 && value >= 99.9) refs.fill.dataset.state = 'error';
    else delete refs.fill.dataset.state;
  }

  return { init, render, renderOverall };
})();
