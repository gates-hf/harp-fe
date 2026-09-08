// Bundles — the composition view of the CDM. Reached at #/pactum/cdm/bundles;
// cdm-list.js hands off the mount. A bundle is a CDM row, so everything here
// goes through data/repositories/cdm.js like the rest of the catalogue.

import * as cdm from '../../../../data/repositories/cdm.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openCdmHistory } from './cdm-history.js';
import { treeHtml, handleTreeClick } from './component-tree.js';

export const meta = { title: 'Bundles' };

const COLUMNS = 9;

export async function render(mount, ctx) {
  const res = await fetch(new URL('./bundle-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load bundle-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Bundles');
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'CDM', path: '/pactum/cdm' },
    { label: 'Bundles' },
  ]);

  const state = { q: '', type: '', status: '', open: new Set() };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#bl-search');
  const typeSel = $('#bl-type');
  const statusSel = $('#bl-status');

  typeSel.innerHTML =
    '<option value="">All types</option>' +
    cdm.BUNDLE_TYPES.map((t) => `<option value="${t}">${esc(cdm.bundleTypeLabel(t))}</option>`).join('');
  statusSel.innerHTML =
    '<option value="">All statuses</option>' +
    cdm.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');

  function rows() {
    return cdm
      .list({ q: state.q, status: state.status, kind: 'bundle', sort: 'chargeCode' })
      .filter((b) => !state.type || b.bundleType === state.type);
  }

  function drawMetrics() {
    const c = cdm.counts();
    const all = cdm.list({ kind: 'bundle' });
    $('#bl-metrics').innerHTML = [
      metric('Bundles', all.length, '', 'Promotional offers and procedure compositions'),
      metric('Active', all.filter((b) => b.status === 'Active').length, '', 'Bundles that can be sold today'),
      metric('Flagged', c.flagged, c.flagged ? 'critical' : '', 'A component changed — check the price'),
      metric('Nested', all.filter((b) => b.components.some((x) => cdm.isBundle(cdm.get(x.refId)))).length, '',
        'Bundles that hold another bundle'),
    ].join('');
  }

  function metric(label, value, tone, title) {
    return `
      <div class="metric-rail-card${tone ? ` metric-rail-card--${tone}` : ''}" title="${esc(title)}">
        <span class="metric-rail-card__value">${esc(value)}</span>
        <span class="metric-rail-card__label">${esc(label)}</span>
      </div>`;
  }

  function draw() {
    drawMetrics();
    const list = rows();
    $('#bl-rows').innerHTML = list.map(rowHtml).join('');

    const empty = $('#bl-empty');
    empty.hidden = list.length > 0;
    mount.querySelector('.tbl').hidden = list.length === 0;
    if (!list.length) empty.innerHTML = emptyHtml();
  }

  function emptyHtml() {
    const filtered = state.q || state.type || state.status;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">inventory_2</span></div>
        <div class="state-view__title">No bundles found</div>
        <p class="state-view__body">${filtered
          ? 'No bundles match. Change the search text or clear the filters to see them all.'
          : 'A bundle groups items into one price — a procedure composition or a promotional offer.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/pactum/cdm/bundles/new">New bundle</a>
        </div>
      </div>`;
  }

  function rowHtml(b) {
    const active = b.status === 'Active';
    const open = state.open.has(b.id);
    const sum = cdm.componentSum(b.id);
    const promo = b.bundleType === 'Promotional';
    return `
      <tr data-id="${b.id}">
        <td class="t-mono-sm">
          <button class="btn btn--ghost btn--icon btn--sm" data-act="expand" aria-expanded="${open}"
                  title="${open ? 'Hide components' : 'Show components'}">
            <span class="icon icon--sm">${open ? 'expand_more' : 'chevron_right'}</span>
          </button>${esc(b.chargeCode)}
        </td>
        <td>
          ${esc(cdm.label(b))}
          ${b.flaggedForReview
            ? `<span class="badge badge--warning" title="${esc(b.flagReason)}"><span class="dot"></span>Review</span>`
            : ''}
        </td>
        <td>${esc(cdm.bundleTypeLabel(b.bundleType))}</td>
        <td class="num t-mono-sm">${b.components.length}</td>
        <td class="num t-mono-sm">${usd(b.standardPrice)}</td>
        <td class="num t-mono-sm" title="${esc(gapText(b.standardPrice, sum))}">${usd(sum)}</td>
        <td class="t-mono-sm">${promo ? `${date(b.validFrom)} – ${date(b.validTo)}` : '—'}</td>
        <td><span class="badge${active ? ' badge--success' : ''}"><span class="dot"></span>${b.status}</span></td>
        <td>
          <a class="btn btn--ghost btn--icon btn--sm" href="#/pactum/cdm/bundles/${b.id}"
             title="View or edit ${esc(b.chargeCode)}"><span class="icon icon--sm">edit</span></a>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle"
                  title="${active ? 'Deactivate' : 'Activate'} ${esc(b.chargeCode)}">
            <span class="icon icon--sm">${active ? 'toggle_on' : 'toggle_off'}</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
          ${b.flaggedForReview
            ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="clear-flag" title="Clear the review flag">
                 <span class="icon icon--sm">flag</span>
               </button>`
            : ''}
        </td>
      </tr>
      ${open ? `<tr data-detail="${b.id}"><td colspan="${COLUMNS}">${treeHtml(b.id)}</td></tr>` : ''}`;
  }

  /** The tooltip on the sum column: what the bundle gives away, or adds. */
  function gapText(price, sum) {
    if (!sum) return 'No components priced yet';
    const delta = ((price - sum) / sum) * 100;
    if (Math.abs(delta) < 0.05) return 'Priced at the sum of its components';
    return delta < 0
      ? `${Math.abs(delta).toFixed(1)}% discount on the sum of components`
      : `${delta.toFixed(1)}% markup on the sum of components`;
  }

  // --- actions --------------------------------------------------------------

  async function toggle(id) {
    const b = cdm.get(id);
    if (!b) return;
    const next = b.status === 'Active' ? 'Inactive' : 'Active';

    if (next === 'Inactive') {
      const parents = cdm.parentsOf(id).length;
      const ok = await confirm({
        title: 'Deactivate bundle',
        body: `${b.chargeCode} stays on file and stays editable, and drops out of every picker.${
          parents ? ` It sits inside ${parents} other bundle${parents === 1 ? '' : 's'}, which will be flagged for review.` : ''
        }`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }

    cdm.setStatus(id, next);
    const flagged = next === 'Inactive' ? cdm.flagParents(id, `Component ${b.chargeCode} deactivated`) : 0;
    draw();
    toast(
      flagged
        ? `${b.chargeCode} deactivated, ${flagged} bundle${flagged === 1 ? '' : 's'} flagged`
        : `${b.chargeCode} ${next === 'Active' ? 'activated' : 'deactivated'}`,
      flagged ? 'warning' : 'success',
    );
  }

  function clearFlag(id) {
    const b = cdm.get(id);
    if (!b) return;
    cdm.clearFlag(id);
    draw();
    toast(`Flag cleared on ${b.chargeCode}`, 'success');
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    draw();
  });

  for (const [el, key] of [[typeSel, 'type'], [statusSel, 'status']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      draw();
    });
  }

  mount.addEventListener('click', (e) => {
    if (handleTreeClick(e)) return;

    if (e.target.closest('[data-action="clear"]')) {
      Object.assign(state, { q: '', type: '', status: '' });
      search.value = '';
      typeSel.value = '';
      statusSel.value = '';
      draw();
      return;
    }

    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;

    if (act === 'expand') {
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      draw();
      return;
    }
    if (act === 'toggle') return void toggle(id);
    if (act === 'history') return void openCdmHistory(id);
    if (act === 'clear-flag') return clearFlag(id);
  });

  // Live: a component deactivated in the CDM flags bundles listed here.
  ctx.onData(draw);

  draw();
}
