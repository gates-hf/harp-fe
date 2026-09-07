// Payer Master — the list. Reads and writes go through
// data/repositories/payers.js and nowhere else.
//
// This feature also owns the /import deep link: #/pactum/payers/import is the
// same screen in the manifest, so the list hands the mount to the importer.

import * as payers from '../../../../data/repositories/payers.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openPayerForm } from './payer-form.js';
import { openPayerHistory } from './payer-history.js';

export const meta = { title: 'Payer Master' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  if (ctx.params[0] === 'import') {
    const importer = await import('./bulk-import.js');
    return importer.render(mount, ctx);
  }

  const res = await fetch(new URL('./payer-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load payer-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { q: '', type: '', status: '', sort: 'nameEn', dir: 'asc', page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#pm-search');
  const typeSel = $('#pm-type');
  const statusSel = $('#pm-status');

  typeSel.innerHTML =
    '<option value="">All types</option>' +
    payers.TYPES.map((t) => `<option value="${t}">${t}</option>`).join('');
  statusSel.innerHTML =
    '<option value="">All statuses</option>' +
    payers.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');

  ctx.actions.innerHTML = `
    <a class="btn btn--secondary btn--sm" href="#/pactum/payers/import">
      <span class="icon icon--sm">upload_file</span>Bulk import
    </a>`;

  function drawMetrics() {
    const c = payers.counts();
    $('#pm-metrics').innerHTML = [
      metric('Payers', c.total, '', 'Payers on file, active and inactive'),
      metric('Active', c.active, '', 'Payers other modules can bill'),
      metric('Inactive', c.inactive, c.inactive > 2 ? 'warning' : '', 'Excluded from pickers, still editable here'),
      metric('Active plans', c.activePlans, '', 'Active plans across active payers'),
    ].join('');
  }

  function metric(label, value, tone, title) {
    return `
      <div class="metric-rail-card${tone ? ` metric-rail-card--${tone}` : ''}" title="${esc(title)}">
        <span class="metric-rail-card__value">${esc(value)}</span>
        <span class="metric-rail-card__label">${esc(label)}</span>
      </div>`;
  }

  function drawRows() {
    const all = payers.list(state);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('#pm-rows').innerHTML = page.map(rowHtml).join('');

    const empty = $('#pm-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml(state);

    $('#pm-range').textContent = all.length
      ? `${start + 1}–${start + page.length} of ${all.length}`
      : '0 of 0';

    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function emptyHtml(s) {
    const filtered = s.q || s.type || s.status;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'account_balance'}</span></div>
        <div class="state-view__title">No payers found</div>
        <p class="state-view__body">${
          filtered
            ? 'No payers found. Change the search text or clear the filters to see the full list.'
            : "No payers found. Click 'Add new payer' to get started."
        }</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <button class="btn btn--primary" data-action="new">Add new payer</button>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(p) {
    const active = p.status === 'Active';
    const contact = payers.primaryContact(p);
    return `
      <tr data-id="${p.id}" tabindex="0" title="Open ${esc(p.nameEn)}">
        <td>${esc(p.nameEn)}<br><span class="t-body-sm">${esc(p.nameAr)}</span></td>
        <td>${esc(p.type)}</td>
        <td class="t-mono-sm">${p.licenseNo ? esc(p.licenseNo) : '—'}</td>
        <td>${contact ? esc(contact) : '—'}</td>
        <td><span class="badge${active ? ' badge--success' : ''}"><span class="dot"></span>${p.status}</span></td>
        <td class="t-mono-sm">${dateTime(p.updatedAt)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="View or edit ${esc(p.nameEn)}">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle"
                  title="${active ? 'Deactivate' : 'Activate'} ${esc(p.nameEn)}">
            <span class="icon icon--sm">${active ? 'toggle_on' : 'toggle_off'}</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function markSort() {
    for (const btn of mount.querySelectorAll('.sort-btn')) {
      const on = btn.dataset.sort === state.sort;
      btn.querySelector('.icon').textContent = on
        ? (state.dir === 'asc' ? 'arrow_upward' : 'arrow_downward')
        : 'unfold_more';
      btn.closest('th').setAttribute('aria-sort', on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  }

  function draw() {
    drawMetrics();
    drawRows();
  }

  // --- actions --------------------------------------------------------------

  async function edit(id) {
    saved(await openPayerForm(id), 'saved');
  }

  async function add() {
    saved(await openPayerForm(null), 'added');
  }

  // A payer with no contacts saves, and says so: the soft warning replaces the
  // success toast rather than fighting it for the same outlet.
  function saved(payer, verb) {
    draw();
    if (!payer) return;
    if (payer.contacts.length) toast(`${payer.nameEn} ${verb}`, 'success');
    else toast('No contacts added', 'warning');
  }

  async function toggle(id) {
    const payer = payers.get(id);
    if (!payer) return;
    const next = payer.status === 'Active' ? 'Inactive' : 'Active';
    if (next === 'Inactive') {
      const ok = await confirm({
        title: 'Deactivate payer',
        body: `${payer.nameEn} stays on file and stays editable, and drops out of every picker in the platform.`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }
    payers.setStatus(id, next);
    draw();
    toast(`${payer.nameEn} ${next === 'Active' ? 'activated' : 'deactivated'}`, 'success');
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    drawRows();
  });

  for (const [el, key] of [[typeSel, 'type'], [statusSel, 'status']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      drawRows();
    });
  }

  // The shell reuses #page-body across renders, so a listener bound to the
  // mount outlives the markup it was bound for. Assigning the handler keeps
  // one per mount: a second render replaces it instead of stacking on it.
  mount.onclick = (e) => {
    const sort = e.target.closest('.sort-btn');
    if (sort) {
      const key = sort.dataset.sort;
      state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
      state.sort = key;
      markSort();
      drawRows();
      return;
    }

    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      drawRows();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear') {
      Object.assign(state, { q: '', type: '', status: '', page: 0 });
      search.value = '';
      typeSel.value = '';
      statusSel.value = '';
      drawRows();
      return;
    }
    if (action === 'new') return void add();

    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') return void toggle(row.dataset.id);
    if (act === 'history') return void openPayerHistory(row.dataset.id);
    edit(row.dataset.id);
  };

  mount.onkeydown = (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      edit(row.dataset.id);
    }
  };

  markSort();
  draw();

  // Deep link: #/pactum/payers/PY-0007 opens that payer.
  if (ctx.params[0] && payers.get(ctx.params[0])) edit(ctx.params[0]);
}
