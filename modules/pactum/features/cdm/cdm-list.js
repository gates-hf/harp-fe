// Charge Description Master — the list of everything the hospital can sell.
// Reads and writes go through data/repositories/cdm.js and nowhere else.
//
// This feature also owns the CDM screen's deeper links: /import is the
// importer, /bundles the bundles list and /bundles/<new|id> the builder, so
// the manifest keeps one route for the whole screen.

import * as cdm from '../../../../data/repositories/cdm.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openItemForm } from './cdm-item-form.js';
import { openCdmHistory } from './cdm-history.js';

export const meta = { title: 'CDM' };

const PAGE_SIZE = 12;

export async function render(mount, ctx) {
  const [first, second] = ctx.params;
  if (first === 'import') return (await import('./cdm-import.js')).render(mount, ctx);
  if (first === 'bundles') {
    const feature = second ? './bundle-builder.js' : './bundle-list.js';
    return (await import(feature)).render(mount, ctx);
  }

  const res = await fetch(new URL('./cdm-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load cdm-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { q: '', category: '', status: '', sort: 'chargeCode', dir: 'asc', page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#cd-search');
  const categorySel = $('#cd-category');
  const statusSel = $('#cd-status');

  categorySel.innerHTML =
    '<option value="">All categories</option>' +
    cdm.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  statusSel.innerHTML =
    '<option value="">All statuses</option>' +
    cdm.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');

  function drawMetrics() {
    const c = cdm.counts();
    $('#cd-metrics').innerHTML = [
      metric('Charge lines', c.total, '', 'Items and bundles on file'),
      metric('Active', c.active, '', 'Lines that can be billed today'),
      metric('Inactive', c.inactive, c.inactive > 4 ? 'warning' : '', 'Kept on file, excluded from pickers'),
      metric('Bundles', c.bundles, c.flagged ? 'critical' : '', `${c.flagged} flagged for review`),
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
    const all = cdm.list(state);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('#cd-rows').innerHTML = page.map(rowHtml).join('');

    const empty = $('#cd-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml(state);

    $('#cd-range').textContent = all.length
      ? `${start + 1}–${start + page.length} of ${all.length}`
      : '0 of 0';

    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function emptyHtml(s) {
    const filtered = s.q || s.category || s.status;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'sell'}</span></div>
        <div class="state-view__title">No charge lines found</div>
        <p class="state-view__body">${
          filtered
            ? 'No charge lines match. Change the search text or clear the filters to see the whole catalogue.'
            : 'The catalogue is empty. Add one item, or import a price list to fill it in one pass.'
        }</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <button class="btn btn--primary" data-action="new">Add item</button>
          <a class="btn btn--secondary" href="#/pactum/cdm/import">Bulk import</a>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(line) {
    const active = line.status === 'Active';
    const bundle = cdm.isBundle(line);
    const name = cdm.label(line);
    return `
      <tr data-id="${line.id}" tabindex="0" title="Open ${esc(line.chargeCode)}">
        <td class="t-mono-sm">${esc(line.chargeCode)}</td>
        <td>
          ${esc(name)}
          ${bundle ? '<span class="badge badge--accent">Bundle</span>' : ''}
          ${line.flaggedForReview ? `<span class="badge badge--warning" title="${esc(line.flagReason)}"><span class="dot"></span>Review</span>` : ''}
        </td>
        <td>${esc(line.category)}</td>
        <td>${esc(line.uom)}</td>
        <td class="num t-mono-sm">${usd(line.standardPrice)}</td>
        <td><span class="badge${active ? ' badge--success' : ''}"><span class="dot"></span>${line.status}</span></td>
        <td class="t-mono-sm">${dateTime(line.updatedAt)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit"
                  title="${bundle ? 'Open the bundle builder' : 'View or edit'} ${esc(line.chargeCode)}">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle"
                  title="${active ? 'Deactivate' : 'Activate'} ${esc(line.chargeCode)}">
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

  // A bundle is priced and composed on a page of its own; only items fit a modal.
  async function edit(id) {
    const line = cdm.get(id);
    if (!line) return;
    if (cdm.isBundle(line)) return ctx.navigate(`/pactum/cdm/bundles/${id}`);
    saved(await openItemForm(id));
  }

  async function add() {
    saved(await openItemForm(null));
  }

  function saved(result) {
    draw();
    if (!result) return;
    toast(`${result.row.chargeCode} ${result.created ? 'added' : 'saved'}`, 'success');
  }

  /**
   * Deactivating a line is what breaks a bundle, so it says how many bundles
   * now need a look — the flag itself lands on the bundles list.
   */
  async function toggle(id) {
    const line = cdm.get(id);
    if (!line) return;
    const next = line.status === 'Active' ? 'Inactive' : 'Active';

    if (next === 'Inactive') {
      const parents = cdm.parentsOf(id).length;
      const ok = await confirm({
        title: 'Deactivate charge line',
        body: `${line.chargeCode} stays on file and stays editable, and drops out of every picker.${
          parents ? ` It sits inside ${parents} bundle${parents === 1 ? '' : 's'}, which will be flagged for review.` : ''
        }`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }

    cdm.setStatus(id, next);
    const flagged = next === 'Inactive' ? cdm.flagParents(id, `Component ${line.chargeCode} deactivated`) : 0;
    draw();
    toast(
      flagged
        ? `${line.chargeCode} deactivated, ${flagged} bundle${flagged === 1 ? '' : 's'} flagged`
        : `${line.chargeCode} ${next === 'Active' ? 'activated' : 'deactivated'}`,
      flagged ? 'warning' : 'success',
    );
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    drawRows();
  });

  for (const [el, key] of [[categorySel, 'category'], [statusSel, 'status']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      state.page = 0;
      drawRows();
    });
  }

  mount.addEventListener('click', (e) => {
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
      Object.assign(state, { q: '', category: '', status: '', page: 0 });
      search.value = '';
      categorySel.value = '';
      statusSel.value = '';
      drawRows();
      return;
    }
    if (action === 'new') return void add();

    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') return void toggle(row.dataset.id);
    if (act === 'history') return void openCdmHistory(row.dataset.id);
    edit(row.dataset.id);
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      edit(row.dataset.id);
    }
  });

  markSort();
  draw();
}
