// Floating action bar — the round button in the corner that holds a screen's
// create-actions, and the menu it opens. Any module can mount one; the design
// system styles it (.fab in design-system/components.css), this file is the
// behaviour: open and close, drag to move, and remember where it was put.
//
// It mounts into the screen's own node, so it retires when the router replaces
// that node — the same rule every other listener on a screen follows. The
// position outlives the screen, because it is the reader's choice and not the
// screen's: it is kept for the session and clamped back into view whenever the
// window changes size.

import { esc } from './format.js';

const KEY = 'harp.demo.fab';
/** How much of the button must stay on screen, in px. */
const EDGE = 8;
/** How far a press has to travel before it is a drag and not a click. */
const SLOP = 4;

let seq = 0;

/**
 * mountFab(mount, { actions, label, icon }) -> { el, close() }
 * actions: [{ label, icon, act }] for a button row, or
 *          [{ label, icon, href }] for one that navigates.
 * An `act` row carries `data-act`, so the screen's own delegated handler picks
 * it up exactly as it would a button in a panel header.
 */
export function mountFab(mount, { actions = [], label = 'Actions', icon = 'add' } = {}) {
  if (!mount || !actions.length) return null;

  const id = `fab-menu-${++seq}`;
  const el = document.createElement('div');
  el.className = 'fab';
  el.innerHTML = `
    <div class="menu fab__menu" id="${id}" role="menu" hidden>
      ${actions.map(itemHtml).join('')}
    </div>
    <button class="btn btn--primary fab__toggle" type="button"
            aria-haspopup="menu" aria-expanded="false" aria-controls="${id}"
            title="${esc(label)} — drag to move">
      <span class="icon">${esc(icon)}</span>
    </button>`;
  mount.appendChild(el);

  const toggle = el.querySelector('.fab__toggle');
  const menu = el.querySelector('.fab__menu');
  const glyph = toggle.querySelector('.icon');

  // --- open / close ---------------------------------------------------------

  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    glyph.textContent = open ? 'close' : icon;
    if (open) menu.querySelector('.menu-item')?.focus();
  }
  const close = () => setOpen(false);

  el.addEventListener('click', (e) => {
    // Any action closes the bar; the action itself is the screen's to handle.
    if (e.target.closest('.menu-item')) close();
  });

  // A row authored as a div is not a button, so it needs its own key handler;
  // an anchor row already answers Enter itself.
  el.addEventListener('keydown', (e) => {
    const item = e.target.closest('.menu-item[data-act]');
    if (item && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      item.click();
    }
  });

  // Clicking away and Escape close it, the way the topbar's menu does.
  // The router drops this bar by replacing the node it sits in, which cannot
  // take the document-level listeners with it — so they retire themselves the
  // first time they fire after the bar has left the page.
  function detach() {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', onResize);
  }
  const onDocClick = (e) => {
    if (!el.isConnected) return detach();
    if (!el.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (!el.isConnected) return detach();
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      toggle.focus();
    }
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  // --- drag -----------------------------------------------------------------

  let drag = null;
  // A drag ends in a click the browser fires anyway; the bar must not open on
  // it. Opening is bound to `click` and not to `pointerup` so that a keyboard
  // Enter or Space — which fires no pointer events at all — still works.
  let suppressClick = false;

  toggle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    suppressClick = false;
    const box = el.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      dx: e.clientX - box.left,
      dy: e.clientY - box.top,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
    };
    // The capture keeps the moves coming when the pointer outruns the button.
    try {
      toggle.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone — the drag still tracks, just unclamped */
    }
  });

  toggle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < SLOP) return;
      drag.moved = true;
      el.classList.add('fab--dragging');
      close();
    }
    place(e.clientX - drag.dx, e.clientY - drag.dy);
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // A press that never moved is a click on the button, not a drag of it.
    suppressClick = drag.moved;
    drag = null;
    el.classList.remove('fab--dragging');
    if (suppressClick) save();
  };
  toggle.addEventListener('pointerup', endDrag);
  toggle.addEventListener('pointercancel', endDrag);

  toggle.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setOpen(menu.hidden);
  });

  /** Put the bar's top-left at (x, y), kept inside the window. */
  function place(x, y) {
    const box = el.getBoundingClientRect();
    const left = clamp(x, EDGE, innerWidth - box.width - EDGE);
    const top = clamp(y, EDGE, innerHeight - box.height - EDGE);
    el.style.insetBlockEnd = 'auto';
    el.style.insetInlineEnd = 'auto';
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // The menu opens into whatever room is left, so a bar dragged to the top
    // or to the left never opens off-screen.
    el.classList.toggle('fab--down', top + box.height / 2 < innerHeight / 2);
    el.classList.toggle('fab--start', left + box.width / 2 < innerWidth / 2);
  }

  const save = () => write({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) });

  // A window narrowed since the bar was dropped would leave it off-screen.
  const onResize = () => {
    if (!el.isConnected) return detach();
    if (!el.style.left) return;
    place(parseFloat(el.style.left), parseFloat(el.style.top));
  };
  addEventListener('resize', onResize);

  const saved = read();
  if (saved) place(saved.left, saved.top);

  return { el, close, detach };
}

// --- internals ---------------------------------------------------------------

function itemHtml(action) {
  const inner = `<span class="icon">${esc(action.icon || 'chevron_right')}</span>${esc(action.label)}`;
  return action.href
    ? `<a class="menu-item" role="menuitem" href="${esc(action.href)}">${inner}</a>`
    : `<div class="menu-item" role="menuitem" tabindex="0" data-act="${esc(action.act)}">${inner}</div>`;
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    return Number.isFinite(pos?.left) && Number.isFinite(pos?.top) ? pos : null;
  } catch {
    return null; // private mode or a corrupt value — the corner default stands
  }
}

function write(pos) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pos));
  } catch {
    /* private mode — the bar still sits where it was dropped for this screen */
  }
}
