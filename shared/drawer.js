// Drawer — the right-side sheet for reading beside a list: an audit trail, a
// record's history, a preview. A modal interrupts you for a decision; a drawer
// opens next to the thing you are looking at. One shell for the whole app — a
// module never authors its own, exactly as with shared/modal.js.
//
// Focus trap and opener restore come from design-system/harp-theme.js. The
// backdrop is the design system's .scrim, so a drawer and a modal share one
// stack: whichever opened last answers Escape.

/**
 * open({ title, sub, icon, body, foot })
 *   body/foot: HTML strings. Omit foot for a read-only sheet with just Close.
 * Returns { el, close(result), closed: Promise<result> }.
 */
export function open(opts = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim scrim--drawer';
  scrim.innerHTML = `
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1">
      <div class="drawer__head">
        ${opts.icon ? `<span class="icon icon--lg">${opts.icon}</span>` : ''}
        <div>
          <div class="drawer__title" id="drawer-title">${opts.title || ''}</div>
          ${opts.sub ? `<div class="drawer__sub">${opts.sub}</div>` : ''}
        </div>
        <span class="spacer"></span>
        <button class="btn btn--ghost btn--icon btn--sm" data-close title="Close">
          <span class="icon">close</span>
        </button>
      </div>
      <div class="drawer__body">${opts.body || ''}</div>
      <div class="drawer__foot">
        <span class="spacer"></span>
        ${opts.foot || '<button class="btn btn--secondary" data-close>Close</button>'}
      </div>
    </aside>`;

  document.body.appendChild(scrim);
  const panel = scrim.querySelector('.drawer');
  window.harpModal.trap(panel);

  let settle;
  const closed = new Promise((resolve) => { settle = resolve; });

  function close(result) {
    if (!scrim.isConnected) return;
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    window.harpModal.release();
    settle(result);
  }

  // Only the topmost sheet answers Escape — drawers and modals chain.
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

  // A read-only sheet has nothing to type in, so focus lands on the panel
  // itself (tabindex="-1"): the trap needs the focus inside to hold it there.
  (panel.querySelector('[autofocus], input, select, textarea, .btn--primary') || panel).focus();

  return { el: panel, close, closed };
}
