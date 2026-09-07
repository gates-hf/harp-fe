// One payer's contracts, at #/pactum/payers/<payerId>/contracts. The payer
// list hands the mount over on that deep link.
//
// Versions of one agreement are grouped: the newest version holds the row and
// the older ones collapse under it, so a payer with a long history still reads
// as one line per agreement.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { openContractForm } from './contract-form.js';
import { openContractHistory } from './contract-history.js';
import { chooseEditType, askTerminate } from './contract-actions.js';

export const meta = { title: 'Contracts' };

export async function render(mount, ctx) {
  const payerId = ctx.params[0];
  const payer = payers.get(payerId);
  if (!payer) throw new Error(`No payer ${payerId}`);

  const res = await fetch(new URL('./payer-contracts.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load payer-contracts.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader(`${payer.nameEn} — contracts`);
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Payer Master', path: '/pactum/payers' },
    { label: payer.nameEn },
  ]);

  const state = { status: '', open: new Set() };
  const $ = (sel) => mount.querySelector(sel);

  $('#pc-title').textContent = `${payer.nameEn} — contracts`;
  $('#pc-status').innerHTML =
    '<option value="">All statuses</option>' +
    contracts.STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('');

  /** [{ current, older[] }] — one entry per agreement, newest agreement first. */
  function groups() {
    const rows = contracts.byPayer(payerId);
    const seen = new Set();
    const out = [];
    for (const c of rows) {
      if (seen.has(c.lineageId)) continue;
      seen.add(c.lineageId);
      const versions = contracts.versionsOf(c.lineageId);
      const current = versions[versions.length - 1];
      const older = versions.slice(0, -1).reverse();
      if (state.status && current.status !== state.status && !older.some((o) => o.status === state.status)) continue;
      out.push({ current, older });
    }
    return out;
  }

  function draw() {
    const list = groups();
    $('#pc-rows').innerHTML = list.map(groupHtml).join('');
    $('#pc-count').textContent = `${list.length} agreement${list.length === 1 ? '' : 's'}`;

    const empty = $('#pc-empty');
    empty.hidden = list.length > 0;
    mount.querySelector('.tbl').hidden = list.length === 0;
    if (!list.length) empty.innerHTML = emptyHtml();
  }

  function emptyHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">contract</span></div>
        <div class="state-view__title">No contracts yet</div>
        <p class="state-view__body">${state.status
          ? `No ${state.status.toLowerCase()} contracts for this payer. Clear the filter to see them all.`
          : 'A contract sets the plans, dates and — from the next release — the rules you bill this payer under.'}</p>
        <div class="state-view__actions">
          ${state.status ? '<button class="btn btn--secondary" data-action="clear">Clear filter</button>' : ''}
          <button class="btn btn--primary" data-action="new">Add contract</button>
        </div>
      </div>`;
  }

  function groupHtml({ current, older }) {
    const open = state.open.has(current.lineageId);
    const expander = older.length
      ? `<button class="btn btn--ghost btn--sm" data-act="expand" aria-expanded="${open}"
                 title="${open ? 'Hide earlier versions' : 'Show earlier versions'}">
           <span class="icon icon--sm">${open ? 'expand_more' : 'chevron_right'}</span>${older
             .map((o) => `v${o.version}`).join(', ')}
         </button>`
      : '';
    return rowHtml(current, expander) + (open ? older.map((o) => rowHtml(o, '', true)).join('') : '');
  }

  function rowHtml(c, expander = '', older = false) {
    const tone = contracts.statusTone(c.status);
    return `
      <tr data-id="${c.id}" data-lineage="${c.lineageId}"${older ? ' data-older' : ''}>
        <td>${older ? '<span class="t-body-sm">Earlier version — </span>' : ''}${esc(c.name)}${expander ? `<br>${expander}` : ''}</td>
        <td class="t-mono-sm">${esc(c.contractNo)}</td>
        <td class="num t-mono-sm">v${c.version}</td>
        <td class="t-mono-sm">${date(c.startDate)}</td>
        <td class="t-mono-sm">${date(c.endDate)}</td>
        <td><span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${c.status}</span></td>
        <td class="t-mono-sm">${dateTime(c.updatedAt)}</td>
        <td>
          <a class="btn btn--ghost btn--icon btn--sm" href="#/pactum/contracts/${c.id}"
             title="Open ${esc(c.name)}"><span class="icon icon--sm">open_in_new</span></a>
          ${c.status === 'Draft' || c.status === 'Active'
            ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit ${esc(c.name)}">
                 <span class="icon icon--sm">edit</span>
               </button>`
            : `<button class="btn btn--ghost btn--icon btn--sm" disabled
                       title="${c.status} contracts are read-only">
                 <span class="icon icon--sm">edit</span>
               </button>`}
          ${c.status === 'Active'
            ? `<button class="btn btn--ghost btn--icon btn--sm" data-act="terminate" title="Terminate ${esc(c.name)}">
                 <span class="icon icon--sm">block</span>
               </button>`
            : ''}
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  // --- actions --------------------------------------------------------------

  async function add() {
    const saved = await openContractForm({ payerId });
    draw();
    if (saved) toast(`${saved.contractNo} drafted`, 'success');
  }

  async function edit(id) {
    const c = contracts.get(id);
    if (!c) return;
    if (c.status === 'Draft') {
      const saved = await openContractForm({ payerId, contractId: id });
      draw();
      if (saved) toast(`${saved.contractNo} saved`, 'success');
      return;
    }
    const outcome = await chooseEditType(c, { navigate: ctx.navigate });
    if (outcome) draw();
  }

  async function terminate(id) {
    const done = await askTerminate(contracts.get(id));
    if (done) draw();
  }

  // --- events ---------------------------------------------------------------

  $('#pc-status').addEventListener('change', (e) => {
    state.status = e.target.value;
    draw();
  });

  mount.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="new"]')) return void add();
    if (e.target.closest('[data-action="clear"]')) {
      state.status = '';
      $('#pc-status').value = '';
      draw();
      return;
    }

    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'expand') {
      const lineage = row.dataset.lineage;
      if (state.open.has(lineage)) state.open.delete(lineage);
      else state.open.add(lineage);
      draw();
      return;
    }
    if (act === 'edit') return void edit(row.dataset.id);
    if (act === 'terminate') return void terminate(row.dataset.id);
    if (act === 'history') return void openContractHistory(row.dataset.id);
  });

  draw();
}
