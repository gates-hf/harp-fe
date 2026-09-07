// Modal — one dialog shell for the whole app. A module never authors its own.
// Focus trap and opener restore come from design-system/harp-theme.js.

/**
 * open({ title, sub, icon, tone, size, body, foot, note })
 *   tone: '' | 'warning' | 'critical' | 'refusal'
 *   body/foot: HTML strings
 * Returns { el, close(result) , closed: Promise<result> }.
 */
export function open(opts = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `
    <div class="modal modal--${opts.size || 'md'}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal__head${opts.tone ? ` modal__head--${opts.tone}` : ''}">
        ${opts.icon ? `<span class="icon icon--lg">${opts.icon}</span>` : ''}
        <div>
          <div class="modal__title" id="modal-title">${opts.title || ''}</div>
          ${opts.sub ? `<div class="modal__sub">${opts.sub}</div>` : ''}
        </div>
        <span class="spacer"></span>
        <button class="btn btn--ghost btn--icon btn--sm" data-close title="Close">
          <span class="icon">close</span>
        </button>
      </div>
      <div class="modal__body">${opts.body || ''}</div>
      <div class="modal__foot">
        ${opts.note ? `<span class="modal__foot-note${opts.tone === 'critical' ? ' modal__foot-note--critical' : ''}">${opts.note}</span>` : ''}
        <span class="spacer"></span>
        ${opts.foot || '<button class="btn btn--secondary" data-close>Close</button>'}
      </div>
    </div>`;

  document.body.appendChild(scrim);
  const dialog = scrim.querySelector('.modal');
  window.harpModal.trap(dialog);

  let settle;
  const closed = new Promise((resolve) => { settle = resolve; });

  function close(result) {
    if (!scrim.isConnected) return;
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    window.harpModal.release();
    settle(result);
  }

  // Only the topmost dialog answers Escape — dialogs chain (detail -> confirm).
  function onKey(e) {
    if (e.key !== 'Escape') return;
    const stack = document.querySelectorAll('.scrim');
    if (stack[stack.length - 1] === scrim) close(undefined);
  }

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close(undefined);
    const closer = e.target.closest('[data-close]');
    if (closer) close(closer.dataset.close || undefined);
  });
  document.addEventListener('keydown', onKey);

  (dialog.querySelector('[autofocus], input, select, textarea, .btn--primary') || dialog).focus();

  return { el: dialog, close, closed };
}

/** confirm({ title, body, confirmLabel, tone, icon }) -> Promise<boolean> */
export async function confirm({ title, body, confirmLabel = 'Confirm', tone = 'warning', icon = 'priority_high', note }) {
  const dialog = open({
    title,
    tone,
    icon,
    note,
    size: 'sm',
    body: `<p class="modal__lede">${body}</p>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn ${tone === 'critical' ? 'btn--danger' : 'btn--primary'}" data-close="confirm">${confirmLabel}</button>`,
  });
  return (await dialog.closed) === 'confirm';
}
