// The Methodologies tab of the contract page: every rate row on the contract,
// the default-row banner the activation gate reads, and the precedence line
// that explains which row a claim lands on. contract-view.js renders this into
// a fresh node each time, so the listeners bound here retire with it.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';
import { openMethodologyForm } from './methodology-form.js';
import { cdmIsEmpty, cdmGateHtml } from './cdm-gate.js';

const PRECEDENCE = 'Precedence: a charge takes the narrowest row covering it on the service date — Item, then Category, '
  + 'then Service Group, then Admission Type, then Default.';

/** render(host, { contractId, readOnly, refresh }) */
export async function render(host, { contractId, readOnly, refresh }) {
  // Nothing here can be configured against an empty charge master.
  if (cdmIsEmpty()) {
    host.innerHTML = cdmGateHtml();
    return;
  }

  const res = await fetch(new URL('./tab-methodologies.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tab-methodologies.html (${res.status})`);
  host.innerHTML = await res.text();

  const $ = (sel) => host.querySelector(sel);
  const contract = () => contracts.get(contractId);
  const rows = () => contracts.methodologies(contract());

  function draw() {
    const list = rows();
    $('#tm-banner').innerHTML = bannerHtml(contract());
    $('#tm-count').textContent = `${list.length} row${list.length === 1 ? '' : 's'}`;
    $('#tm-actions').innerHTML = readOnly
      ? ''
      : `<button class="btn btn--primary btn--sm" data-act="add">
           <span class="icon icon--sm">add</span>Add methodology
         </button>`;
    $('#tm-rows').innerHTML = list.map(rowHtml).join('');
    $('#tm-table').hidden = list.length === 0;
    $('#tm-empty').hidden = list.length > 0;
    if (!list.length) $('#tm-empty').innerHTML = emptyHtml();
    $('#tm-hint').textContent = readOnly
      ? `${PRECEDENCE} This contract is ${contract().status.toLowerCase()}, so its rates are read-only.`
      : PRECEDENCE;
  }

  function bannerHtml(c) {
    if (contracts.hasDefaultMethodology(c)) {
      return `
        <div class="alert alert--success">
          <span class="icon">check_circle</span>
          <div><div class="title">Default methodology: set</div>
            Every charge no narrower row covers is paid by the default row.</div>
        </div>`;
    }
    // A closed contract is never activated again, so the gate's wording would
    // ask for something that can no longer happen.
    return `
      <div class="alert alert--warning">
        <span class="icon">priority_high</span>
        <div><div class="title">Default methodology: ${readOnly ? 'none on file' : 'required before activation'}</div>
          ${readOnly
            ? 'This contract ran without a fallback rate — charges it did not name were priced at standard.'
            : 'Add a Default row so a charge the contract does not name still has a rate.'}</div>
      </div>`;
  }

  function rowHtml(row) {
    return `
      <tr data-id="${esc(row.id)}">
        <td>${esc(row.scopeLevel)}</td>
        <td>${scopeValueHtml(row)}</td>
        <td>${esc(row.method)}</td>
        <td class="t-mono-sm">${esc(contracts.methodologySummary(row))}</td>
        <td class="t-mono-sm">${date(row.effectiveFrom)}</td>
        <td class="t-mono-sm">${row.effectiveTo ? date(row.effectiveTo) : '—'}</td>
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
    if (row.scopeLevel === 'Default') return '—';
    if (row.scopeLevel !== 'Item') return esc(row.scopeValue);
    const item = cdm.get(row.scopeValue);
    return item
      ? `<span class="t-mono-sm">${esc(item.chargeCode)}</span> ${esc(cdm.label(item))}`
      : esc(row.scopeValue);
  }

  function emptyHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">payments</span></div>
        <div class="state-view__title">No methodologies yet</div>
        <p class="state-view__body">${readOnly
          ? 'This contract closed without any rate rows on file.'
          : 'Start with a Default row — it prices everything the contract does not name — then add narrower rows for the services that are paid differently.'}</p>
        ${readOnly ? '' : `
        <div class="state-view__actions">
          <button class="btn btn--primary" data-act="add">Add methodology</button>
        </div>`}
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function edit(methodologyId) {
    const saved = await openMethodologyForm({ contractId, methodologyId });
    if (saved) refresh();
  }

  async function remove(methodologyId) {
    const row = rows().find((m) => m.id === methodologyId);
    if (!row) return;
    const policy = contracts.overagePolicyFor(contract(), methodologyId);
    const ok = await modal.confirm({
      title: 'Remove methodology',
      body: `${contracts.scopeLabel(row)} — ${row.method} (${contracts.methodologySummary(row)}) stops pricing this contract.${
        policy ? ' Its overage policy is removed with it.' : ''}`,
      confirmLabel: 'Remove row',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    contracts.removeMethodology(contractId, methodologyId);
    toast('Methodology removed', 'success');
    refresh();
  }

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || readOnly) return;
    if (act === 'add') return void edit(null);
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (act === 'edit') return void edit(id);
    if (act === 'remove') return void remove(id);
  });

  draw();
}
