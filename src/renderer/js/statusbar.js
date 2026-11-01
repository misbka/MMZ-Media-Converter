'use strict';

/**
 * src/renderer/js/statusbar.js
 * ------------------------------------------------------------------
 * Rodapé: status do FFmpeg, contagens da fila e versão do app.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.statusbar = (() => {
  const t = (...args) => MMZ.i18n.t(...args);
  let refs = {};

  function init() {
    refs = {
      ffmpeg: document.getElementById('status-ffmpeg'),
      ffmpegText: document.getElementById('status-ffmpeg-text'),
      files: document.getElementById('status-files'),
      done: document.getElementById('status-done'),
      errors: document.getElementById('status-errors'),
      version: document.getElementById('status-version'),
      chip: document.getElementById('ffmpeg-chip'),
      chipLabel: document.querySelector('#ffmpeg-chip .chip-label'),
    };
  }

  /** Desenha rodapé + chip do FFmpeg (depende de info/queue/idioma). */
  function render() {
    const state = MMZ.store.get();
    if (!refs.ffmpeg || !state.info) return;

    const ffmpeg = state.info.ffmpeg;
    const ok = ffmpeg && ffmpeg.found;
    const label = ok ? t('header.ffmpegOk') : t('header.ffmpegMissing');
    const title = ok
      ? t('header.ffmpegTooltip', { path: ffmpeg.path })
      : t('header.ffmpegMissingTooltip');

    refs.chip.dataset.state = ok ? 'ok' : 'error';
    refs.chip.title = title;
    refs.chipLabel.textContent = label;

    refs.ffmpeg.dataset.state = ok ? 'ok' : 'error';
    refs.ffmpeg.title = title;
    refs.ffmpegText.textContent = ok
      ? `${t('statusbar.ffmpeg')} ${ffmpeg.version || '✓'}`
      : `${t('statusbar.ffmpeg')} ${t('statusbar.noFfmpeg')}`;

    const stats = state.queue.stats;
    refs.files.textContent = `${t('statusbar.files')}: ${stats.total}`;
    refs.done.textContent = `${t('statusbar.completed')}: ${stats.completed}`;
    refs.errors.textContent = `${t('statusbar.errors')}: ${stats.error}`;
    refs.version.textContent = t('statusbar.version', { version: state.info.version });
  }

  return { init, render };
})();
