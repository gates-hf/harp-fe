// The Pre-Auth tab of the contract page: the matrix of what the payer has to
// approve before it is delivered, and a strip that runs one charge through it.
// contract-view.js renders this into a fresh node each time, so the listeners
// bound here retire with it.
//
// Nothing here gates activation — an empty matrix is a contract where every
// service can be delivered on the spot.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';
import { optionsHtml } from './fee-schedule.js';
import { openPreAuthForm } from './preauth-form.js';

const PRECEDENCE = 'Item rows override category rows, which override service-group rows. An item-level "No" '
  + 'exempts it. Blank threshold = always required. Conditional pre-auth (diagnosis, age, LOS…) is configured '
  + 'in the Rules tab and overrides this matrix.';

/** render(host, { contractId, readOnly }) */
export async function render(host, { contractId, readOnly }) {
  const res = await fetch(new URL('./tab-preauth.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tab-preauth.html (${res.status})`);
  host.innerHTML = await res.text();

  const $ = (sel) => host.querySelector(sel);
  const contract = () => contracts.get(contractId);
  const rows = () => contracts.preAuthRows(contract());
  const state = { itemId: '', amount: '' };

  function draw() {
    const c = contract();
    const list = rows();
    $('#tp-banner').innerHTML = `
      <div class="alert alert--info">
        <span class="icon">info</span>
        <div>${esc(PRECEDENCE)}</div>
      </div>`;
    $('#tp-count').textContent = `${list.length} row${list.length === 1 ? '' : 's'}`;
    $('#tp-actions').innerHTML = readOnly
      ? ''
      : `<button class="btn btn--primary btn--sm" data-act="add">
           <span class="icon icon--sm">add</span>Add row
         </button>`;
    $('#tp-rows').innerHTML = list.map(rowHtml).join('');
    $('#tp-table').hidden = list.length === 0;
    $('#tp-empty').hidden = list.length > 0;
    if (!list.length) $('#tp-empty').innerHTML = emptyHtml();
    $('#tp-hint').textContent = readOnly
      ? `This contract is ${c.status.toLowerCase()}, so its pre-authorization matrix is read-only.`
      : '';
    drawCheck();
  }

  function rowHtml(row) {
    const exempt = contracts.isPreAuthExemption(contract(), row);
    return `
      <tr data-id="${esc(row.id)}">
        <td>${esc(row.scopeLevel)}</td>
        <td>${scopeValueHtml(row)}</td>
        <td>
          <span class="badge badge--${row.required ? 'warning' : 'success'}"><span class="dot"></span>${row.required ? 'Yes' : 'No'}</span>
          ${exempt ? '<span class="badge" title="A broader row requires pre-auth, and this row exempts it">Exemption</span>' : ''}
        </td>
        <td class="t-mono-sm">${esc(contracts.thresholdLabel(row))}</td>
        <td>${readOnly ? '' : `
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit this row">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="remove" title="Remove this row">
            <span class="icon icon--sm">delete</span>
          </button>`}
        </td>
      </tr>`;
  }

  /** An item scope names the line it covers; every other level is its value. */
  function scopeValueHtml(row) {
    if (row.scopeLevel !== 'Item') return esc(row.scopeValue);
    const item = cdm.get(row.scopeValue);
    return item
      ? `<span class="t-mono-sm">${esc(item.chargeCode)}</span> ${esc(cdm.label(item))}`
      : esc(row.scopeValue);
  }

  function emptyHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">verified_user</span></div>
        <div class="state-view__title">No pre-authorization requirements</div>
        <p class="state-view__body">All services can be delivered without prior approval.${readOnly
          ? ''
          : ' Add a row for the services this payer wants to approve first.'}</p>
        ${readOnly ? '' : `
        <div class="state-view__actions">
          <button class="btn btn--primary" data-act="add">Add row</button>
        </div>`}
      </div>`;
  }

  // --- check strip ----------------------------------------------------------

  function drawCheck() {
    const items = cdm.findActive();
    if (!state.itemId) state.itemId = items[0]?.id || '';
    $('#tp-check-item').innerHTML = optionsHtml(items, state.itemId);
    const item = cdm.get(state.itemId);
    if (state.amount === '') state.amount = String(item?.standardPrice ?? '');
    $('#tp-check-amount').value = state.amount;
    drawCheckOut();
  }

  function drawCheckOut() {
    const item = cdm.get(state.itemId);
    const box = $('#tp-check-out');
    if (!item) {
      box.innerHTML = '<p class="t-body-sm">Choose a charge line to see whether it needs approval.</p>';
      return;
    }
    const out = contracts.resolvePreAuth(contract(), item, state.amount);
    box.innerHTML = `
      <div class="toolbar">
        <span class="badge badge--${out.required ? 'warning' : 'success'}"><span class="dot"></span>${esc(out.reason)}</span>
      </div>
      <p class="t-body-sm">${out.source
        ? `Resolved row: ${esc(contracts.preAuthLabel(out.source))} — ${esc(contracts.thresholdLabel(out.source))}.
           Checked at ${usd(state.amount)}.`
        : 'No row in the matrix covers this charge, so it goes ahead without approval.'}</p>`;
  }

  // --- actions --------------------------------------------------------------

  async function edit(rowId) {
    const saved = await openPreAuthForm({ contractId, rowId });
    if (saved) draw();
  }

  async function remove(rowId) {
    const row = rows().find((r) => r.id === rowId);
    if (!row) return;
    const ok = await modal.confirm({
      title: 'Remove pre-auth row',
      body: `${contracts.preAuthLabel(row)} stops being decided here. Charges in that scope fall to the next row up, `
        + 'and to no approval at all if none covers them.',
      confirmLabel: 'Remove row',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    contracts.removePreAuth(contractId, rowId);
    toast('Pre-auth row removed', 'success');
    draw();
  }

  // --- events ---------------------------------------------------------------

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || readOnly) return;
    if (act === 'add') return void edit(null);
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (act === 'edit') return void edit(id);
    if (act === 'remove') return void remove(id);
  });

  host.addEventListener('change', (e) => {
    if (e.target.id !== 'tp-check-item') return;
    state.itemId = e.target.value;
    state.amount = String(cdm.get(state.itemId)?.standardPrice ?? '');
    $('#tp-check-amount').value = state.amount;
    drawCheckOut();
  });

  host.addEventListener('input', (e) => {
    if (e.target.id !== 'tp-check-amount') return;
    state.amount = e.target.value;
    drawCheckOut();
  });

  draw();
}
