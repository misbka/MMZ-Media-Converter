/**
 * store.js
 * Mini gerenciador de estado centralizado (padrão pub/sub) para a renderer:
 * guarda configurações, jobs e estado da fila.
 */
const Store = (() => {
  const state = {
    settings: {},          // configurações persistidas
    jobs: new Map(),       // id -> job
    paused: false,         // fila pausada
    running: false,        // há conversões em andamento
    ffmpegOk: true         // disponibilidade do ffmpeg
  };

  const listeners = new Set();

  return {
    /** Retorna o estado completo (referência viva). */
    get: () => state,

    /** Assina mudanças de estado. Retorna função para cancelar a assinatura. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Notifica todos os assinantes. */
    emit() {
      listeners.forEach((fn) => {
        try { fn(state); } catch (err) { console.error('[store]', err); }
      });
    },

    /** Aplica um patch parcial no estado. */
    patch(partial) {
      Object.assign(state, partial);
      this.emit();
    },

    /** Atualiza ou insere um job pelo id. */
    upsertJob(job) {
      state.jobs.set(job.id, { ...(state.jobs.get(job.id) || {}), ...job });
      this.emit();
    },

    /** Remove jobs finalizados da lista em memória. */
    clearFinished() {
      for (const [id, job] of state.jobs) {
        if (['completed', 'error', 'canceled'].includes(job.status)) state.jobs.delete(id);
      }
      this.emit();
    }
  };
})();
