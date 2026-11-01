'use strict';

/**
 * src/renderer/js/store.js
 * ------------------------------------------------------------------
 * Estado global da UI com assinatura por "escopo":
 *  - settings (tema, idioma, destino, qualidade...)
 *  - queue    (fila, jobs, estatísticas)
 *  - formats  (registro de formatos)
 *  - selection (categoria/seleção ativa)
 * Componentes assinam apenas os escopos de que precisam.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.store = (() => {
  const state = {
    /** app:info (versão, status do FFmpeg) */
    info: null,
    /** configurações persistidas */
    settings: null,
    /** registro de formatos vindo do processo principal */
    formats: null,
    /** snapshot da fila */
    queue: { state: 'idle', jobs: [], stats: { total: 0, queued: 0, running: 0, paused: 0, completed: 0, error: 0, canceled: 0, overallProgress: 0 } },
    /** categoria visível na sidebar */
    activeCategory: 'video',
    /** job selecionado na lista */
    selectedId: null,
    /** último diretório escolhido (para alternar "usar origem") */
    lastOutputDir: '',
  };

  /** @type {Set<(scope: string) => void>} */
  const listeners = new Set();

  /**
   * @param {string} [scope]
   * @returns {typeof state}
   */
  function get() { return state; }

  /**
   * @param {(scope: string) => void} fn
   * @returns {() => void} cancela a assinatura
   */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Atualiza parcialmente o estado e notifica.
   * @param {object} partial
   * @param {string} [scope]
   */
  function set(partial, scope = 'state') {
    Object.assign(state, partial);
    emit(scope);
  }

  /** @param {string} scope */
  function emit(scope = 'state') {
    listeners.forEach((fn) => {
      try { fn(scope); } catch (err) { console.error('[store] listener falhou:', err); }
    });
  }

  /** @param {string} id */
  function findJob(id) {
    return state.queue.jobs.find((job) => job.id === id) || null;
  }

  /** Aplica um snapshot vindo do processo principal. */
  function applySnapshot(snapshot) {
    state.queue = snapshot;
    emit('queue');
  }

  return { get, subscribe, set, emit, findJob, applySnapshot };
})();
