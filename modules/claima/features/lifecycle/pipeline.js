// Pipeline board at #/claima/pipeline — every claim in the column its status
// puts it in, with the days it has sat there. Nothing is dragged: a card moves
// when the claim does, and the board redraws on the store event that moved it.
// Reads go through data/engines/claim-events.js and nowhere else.
//
// Deep links: ?status=Denied shows that column alone, ?bucket=b3 keeps the
// cards in that days-in-status band — which is how an aging cell opens here —
// and ?payerId=, ?collapse=1 press the matching controls.

import * as lifecycle from '../../../../data/engines/claim-events.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { DEPARTMENTS } from '../../../../data/seed/reference.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { esc, usd } from '../../../../shared/format.js';
import { CONFIG } from '../../../../shared/config.js';
import { boardHtml } from './pipeline-cards.js';

export const meta = { title: 'Pipeline' };

const HIDDEN_KEY = 'harp.claima.pipeline.hidden';

const blank = () => ({
  q: '', payerId: '', department: '', type: '', band: '', age: '', from: '', to: '', status: '', bucket: '',
});

export async function render(mount, ctx) {
  const res = await fetch(new URL('./pipeline.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load pipeline.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...blank(), collapse: false, hidden: readHidden(), expanded: new Set() };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#pb-search');
  const fields = {
    payerId: $('#pb-payer'), department: $('#pb-department'), type: $('#pb-type'), band: $('#pb-band'),
    age: $('#pb-age'), from: $('#pb-from'), to: $('#pb-to'),
  };
  const options = (list, label, first) => `<option value="">${first}</option>${
    list.map((v) => `<option value="${esc(v.value ?? v)}">${esc(label ? label(v) : v)}</option>`).join('')}`;
  fields.payerId.innerHTML = options(payers.all().map((p) => ({ value: p.id, name: p.nameEn })), (p) => p.name, 'Any payer');
  fields.department.innerHTML = options(DEPARTMENTS, null, 'Any department');
  fields.type.innerHTML = options(encounters.TYPES.map((t) => ({ value: t, name: encounters.typeLabel(t) })), (t) => t.name, 'Any visit type');
  fields.band.innerHTML = options(claims.VALUE_BANDS.map((b) => ({ value: b.id, name: b.label })), (b) => b.name, 'Any value');
  fields.age.innerHTML = options(claims.AGE_BANDS.map((b) => ({ value: b.id, name: b.label })), (b) => b.name, 'Any age');

  function syncControls() {
    search.value = state.q;
    for (const [key, el] of Object.entries(fields)) el.value = state[key];
    $('[data-act="collapse"]').setAttribute('aria-pressed', String(state.collapse));
  }

  function draw() {
    const role = currentRole();
    const board = lifecycle.board(state, { collapse: state.collapse, bucket: state.bucket });
    $('#pb-total').textContent = `${board.total.count} · ${usd(board.total.value)}`;
    $('#pb-banner').innerHTML = bannerHtml(board);
    $('#pb-board').innerHTML = boardHtml(board, {
      hidden: state.hidden, expanded: state.expanded, role, statusFilter: state.status,
    });
    drawMenu();
  }

  /** What a deep link narrowed the board to, said out loud with a way back. */
  function bannerHtml(board) {
    const parts = [];
    if (state.status) parts.push(`the ${state.status} column`);
    if (state.bucket) parts.push(`${lifecycle.BUCKETS.find((b) => b.id === state.bucket)?.label || state.bucket} days in status`);
    if (!parts.length) return '';
    return `
      <div class="alert alert--info">
        <span class="icon">filter_alt</span>
        <div>Showing ${parts.join(', ')} — ${board.total.count} claim${board.total.count === 1 ? '' : 's'}, ${esc(usd(board.total.value))}.</div>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="widen">Whole board</button>
      </div>`;
  }

  function drawMenu() {
    $('#pb-columns').innerHTML = `
      <div class="side-group">Columns</div>
      ${lifecycle.BOARD_COLUMNS.map((s) => `
        <div class="menu-item" role="menuitemcheckbox" data-column="${esc(s)}" tabindex="0"
             aria-checked="${!state.hidden.has(s)}" aria-selected="${!state.hidden.has(s)}">
          <span class="icon">${state.hidden.has(s) ? 'check_box_outline_blank' : 'check_box'}</span>${esc(s)}
        </div>`).join('')}
      <div class="menu-sep"></div>
      <div class="menu-item" role="menuitem" data-column="*" tabindex="0">
        <span class="icon">select_all</span>Show every column
      </div>`;
  }

  function toggleMenu(open) {
    const btn = $('#pb-columns-btn');
    const menu = $('#pb-columns');
    const next = open ?? menu.hidden;
    menu.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
  }

  // --- events -----------------------------------------------------------------

  search.addEventListener('input', () => { state.q = search.value; draw(); });
  for (const [key, el] of Object.entries(fields)) {
    el.addEventListener('change', () => { state[key] = el.value; draw(); });
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const columnItem = e.target.closest('[data-column]');
    if (columnItem && columnItem.closest('#pb-columns')) {
      // The menu is redrawn under the click; stop it reaching the document
      // listener, which would read the detached row as a click away.
      e.stopPropagation();
      const s = columnItem.dataset.column;
      if (s === '*') state.hidden.clear();
      else if (state.hidden.has(s)) state.hidden.delete(s);
      else state.hidden.add(s);
      writeHidden(state.hidden);
      return draw();
    }
    if (e.target.closest('#pb-columns-btn')) {
      e.stopPropagation();
      return toggleMenu();
    }
    const expand = e.target.closest('[data-expand]');
    if (expand) {
      state.expanded.add(expand.dataset.expand);
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'collapse') {
      state.collapse = !state.collapse;
      syncControls();
      return draw();
    }
    if (act === 'widen') {
      state.status = '';
      state.bucket = '';
      return draw();
    }
    if (act === 'clear') {
      Object.assign(state, blank());
      syncControls();
      return draw();
    }
    const card = e.target.closest('li[data-no]');
    if (card) ctx.navigate(`/claima/timeline/${card.dataset.no}`);
  });

  mount.addEventListener('keydown', (e) => {
    const card = e.target.closest('li[data-no]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/claima/timeline/${card.dataset.no}`);
    }
    const item = e.target.closest('#pb-columns .menu-item');
    if (item && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      item.click();
    }
    if (e.key === 'Escape' && !$('#pb-columns').hidden) toggleMenu(false);
  });

  // Clicking away closes the menu; the listener retires itself once the board
  // has left the page, since the router replaces the node it sits in.
  const onDocClick = (e) => {
    if (!mount.isConnected) return document.removeEventListener('click', onDocClick);
    if (!e.target.closest('.menu-anchor')) toggleMenu(false);
  };
  document.addEventListener('click', onDocClick);

  // A finalize, a submission, a remittance or a follow-up anywhere lands here
  // without a reload; a change of demo role re-reads the masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  lifecycle.peersReady.then(() => { if (mount.isConnected) draw(); });
  claims.peersReady?.then(() => { if (mount.isConnected) draw(); });

  applyQuery(ctx.query);
  syncControls();
  draw();

  function applyQuery(q = {}) {
    if (lifecycle.BOARD_COLUMNS.includes(q.status)) state.status = q.status;
    if (lifecycle.BUCKETS.some((b) => b.id === q.bucket)) state.bucket = q.bucket;
    if (q.payerId && payers.get(q.payerId)) state.payerId = q.payerId;
    if (DEPARTMENTS.includes(q.department)) state.department = q.department;
    if (encounters.TYPES.includes(q.type)) state.type = q.type;
    if (q.collapse === '1') state.collapse = true;
  }
}

/** The hidden columns, kept for the session; the config's default until the reader changes it. */
function readHidden() {
  try {
    const raw = sessionStorage.getItem(HIDDEN_KEY);
    if (raw) return new Set(JSON.parse(raw).filter((s) => lifecycle.BOARD_COLUMNS.includes(s)));
  } catch { /* private mode or a corrupt value — fall through to the default */ }
  return new Set(CONFIG.claima?.lifecycle?.hiddenColumns || []);
}

function writeHidden(set) {
  try { sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
}
