'use strict';

/**
 * src/renderer/js/toast.js
 * ------------------------------------------------------------------
 * Notificações volantes (toasts) e modal de confirmação.
 * ------------------------------------------------------------------
 */

window.MMZ = window.MMZ || {};

MMZ.toast = (() => {
  const ICONS = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };

  /**
   * Exibe uma notificação.
   * @param {string} message
   * @param {'success'|'error'|'warn'|'info'} [type]
   * @param {number} [duration] ms (0 = não remove automaticamente)
   */
  function show(message, type = 'info', duration = 4000) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.type = type;
    toast.innerHTML = MMZ.icons.get(ICONS[type] || 'info', { size: 16 });

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    stack.appendChild(toast);

    // Limite visual: no máximo 4 toasts por vez.
    while (stack.children.length > 4) stack.removeChild(stack.firstChild);

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 260);
      }, duration);
    }
    return toast;
  }

  /**
   * Modal de confirmação (substitui o `confirm()` nativo).
   * @param {string} title
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  function confirm(title, message) {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('modal-backdrop');
      const titleEl = document.getElementById('modal-title');
      const messageEl = document.getElementById('modal-message');
      const cancelBtn = document.getElementById('modal-cancel');
      const confirmBtn = document.getElementById('modal-confirm');
      if (!backdrop) return resolve(false);

      titleEl.textContent = title;
      messageEl.textContent = message;
      cancelBtn.textContent = MMZ.i18n.t('modal.cancel');
      confirmBtn.textContent = MMZ.i18n.t('modal.confirm');
      backdrop.hidden = false;

      const close = (value) => {
        backdrop.hidden = true;
        cancelBtn.removeEventListener('click', onCancel);
        confirmBtn.removeEventListener('click', onConfirm);
        backdrop.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onCancel = () => close(false);
      const onConfirm = () => close(true);
      const onBackdrop = (event) => { if (event.target === backdrop) close(false); };
      const onKey = (event) => { if (event.key === 'Escape') close(false); };

      cancelBtn.addEventListener('click', onCancel);
      confirmBtn.addEventListener('click', onConfirm);
      backdrop.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      confirmBtn.focus();
    });
  }

  return { show, confirm };
})();
