// The Referral Required section of the contract page's Pre-Auth tab: the
// contract-level answer as a toggle, and the scoped exceptions under it.
//
// It sits below the pre-auth matrix rather than in a tab of its own — it is the
// same question one level wider, what the payer wants in hand before it answers
// for a charge — and it reads the same way, narrowest row first. It owns its
// own node and its own listener, so tab-preauth.js hands it a div and forgets
// about it.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { openReferralForm } from './referral-required-form.js';

/** render(host, { contractId, readOnly }) — host is the section's own node. */
export function render(host, { contractId, readOnly }) {
  const contract = () => contracts.get(contractId);
  const rows = () => contracts.referralRows(contract());
  const blanketRow = () => rows().find((r) => r.scopeLevel === 'Contract') || null;

  function draw() {
    const c = contract();
    if (!c) return;
    const scoped = rows().filter((r) => r.scopeLevel !== 'Contract');
    const blanket = blanketRow();
    host.innerHTML = `
      <div class="panel panel--sunken">
        <div class="panel-header">
          <span class="t-title-sm">Referral required</span>
          <span class="spacer"></span>
          <span class="t-body-sm">${scoped.length} scoped rule${scoped.length === 1 ? '' : 's'}</span>
          ${readOnly ? '' : `
            <button class="btn btn--primary btn--sm" data-act="rr-add">
              <span class="icon icon--sm">add</span>Add rule
            </button>`}
        </div>
        <div class="panel-body">
          ${blanketHtml(blanket)}
          ${scoped.length ? tableHtml(scoped, blanket) : emptyHtml(blanket)}
          ${readOnly
            ? `<p class="t-body-sm">This contract is ${esc(c.status.toLowerCase())}, so its referral rules are read-only.</p>`
            : ''}
        </div>
      </div>`;
  }

  /**
   * The contract-level answer, drawn as the toggle it is rather than as a row in
   * the table: it is the one rule about the whole agreement, and every scoped
   * row below it is an exception to it. Not set is a third answer, not a blank
   * one — a contract that says nothing about referrals is different from one
   * that says none is needed.
   */
  function blanketHtml(blanket) {
    const on = Boolean(blanket?.required);
    return `
      <div class="toolbar">
        <span class="t-body-sm">Referral required across the whole contract</span>
        <span class="spacer"></span>
        <span class="segmented" role="group" aria-label="Referral required across the contract">
          <button type="button" data-blanket="yes" aria-pressed="${on}"${readOnly ? ' disabled' : ''}>Yes</button>
          <button type="button" data-blanket="no" aria-pressed="${Boolean(blanket) && !on}"${readOnly ? ' disabled' : ''}>No</button>
          <button type="button" data-blanket="none" aria-pressed="${!blanket}"${readOnly ? ' disabled' : ''}>Not set</button>
        </span>
      </div>
      <p class="t-body-sm">${blanket
        ? on
          ? 'Every charge needs a referral unless a scoped rule below exempts it. The eligibility check raises it as a condition, and an encounter opened without one carries the flag.'
          : 'Nothing needs a referral unless a scoped rule below asks for one.'
        : 'No contract-level answer, so only the scoped rules below decide.'}</p>`;
  }

  function tableHtml(scoped, blanket) {
    return `
      <table class="tbl">
        <thead>
          <tr><th>Scope level</th><th>Scope value</th><th>Referral required</th><th></th></tr>
        </thead>
        <tbody>${scoped.map((row) => rowHtml(row, blanket)).join('')}</tbody>
      </table>`;
  }

  function rowHtml(row, blanket) {
    const exempt = !row.required && blanket?.required;
    return `
      <tr data-rr="${esc(row.id)}">
        <td>${esc(row.scopeLevel)}</td>
        <td>${scopeHtml(row)}</td>
        <td>
          <span class="badge badge--${row.required ? 'warning' : 'success'}">
            <span class="dot"></span>${row.required ? 'Yes' : 'No'}</span>
          ${exempt ? '<span class="badge" title="The contract requires a referral, and this rule exempts it">Exemption</span>' : ''}
        </td>
        <td>${readOnly ? '' : `
          <button class="btn btn--ghost btn--icon btn--sm" data-act="rr-edit" title="Edit this rule">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="rr-remove" title="Remove this rule">
            <span class="icon icon--sm">delete</span>
          </button>`}
        </td>
      </tr>`;
  }

  /** An item scope names the line it covers; every other level is its value. */
  function scopeHtml(row) {
    if (row.scopeLevel !== 'Item') return esc(row.scopeValue);
    const item = cdm.get(row.scopeValue);
    return item
      ? `<span class="t-mono-sm">${esc(item.chargeCode)}</span> ${esc(cdm.label(item))}`
      : esc(row.scopeValue);
  }

  function emptyHtml(blanket) {
    return `
      <p class="t-body-sm">${blanket
        ? 'No exceptions to the contract-level answer above.'
        : 'No referral rules. Every charge is answered for without one.'}${readOnly
        ? ''
        : ' Add a rule for a service group, a category or one charge line.'}</p>`;
  }

  // --- actions --------------------------------------------------------------

  function setBlanket(answer) {
    const blanket = blanketRow();
    if (answer === 'none') {
      if (!blanket) return;
      contracts.removeReferralRequired(contractId, blanket.id);
      toast('Contract-level referral rule removed', 'success');
      return draw();
    }
    if (blanket && blanket.required === (answer === 'yes')) return;
    contracts.saveReferralRequired(contractId, {
      id: blanket?.id || null,
      scopeLevel: 'Contract',
      scopeValue: null,
      required: answer === 'yes',
    });
    toast(`Referral ${answer === 'yes' ? 'required' : 'not required'} across the contract`, 'success');
    draw();
  }

  async function edit(rowId) {
    if (await openReferralForm({ contractId, rowId })) draw();
  }

  async function remove(rowId) {
    const row = rows().find((r) => r.id === rowId);
    if (!row) return;
    const ok = await modal.confirm({
      title: 'Remove referral rule',
      body: `${contracts.referralLabel(row)} stops being decided here. Charges in that scope fall to the next rule `
        + 'up, and to the contract-level answer if there is one.',
      confirmLabel: 'Remove rule',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    contracts.removeReferralRequired(contractId, rowId);
    toast('Referral rule removed', 'success');
    draw();
  }

  host.addEventListener('click', (e) => {
    if (readOnly) return;
    const blanket = e.target.closest('[data-blanket]');
    if (blanket) return setBlanket(blanket.dataset.blanket);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rr-add') return void edit(null);
    const id = e.target.closest('tr[data-rr]')?.dataset.rr;
    if (act === 'rr-edit') return void edit(id);
    if (act === 'rr-remove') return void remove(id);
  });

  draw();
}
