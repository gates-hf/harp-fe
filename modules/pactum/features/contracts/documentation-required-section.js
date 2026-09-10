// The Documentation Required section of the contract page's Pre-Auth tab: the
// documents the payer wants attached to a claim before it reads it, as a table
// of scoped rows. Amendment 27 — the claim assembler pulls the matching
// clinical documents in by these rows and the scrubber names what is missing.
//
// It sits under Referral Required, the third of the same question — what the
// payer wants in hand before it answers for a charge. It owns its own node and
// its own listener, so tab-preauth.js hands it a div and forgets about it.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { openDocumentationForm } from './documentation-required-form.js';

/** render(host, { contractId, readOnly }) — host is the section's own node. */
export function render(host, { contractId, readOnly }) {
  const contract = () => contracts.get(contractId);
  const rows = () => contracts.documentationRows(contract());

  function draw() {
    const c = contract();
    if (!c) return;
    const list = rows();
    host.innerHTML = `
      <div class="panel panel--sunken">
        <div class="panel-header">
          <span class="t-title-sm">Documentation required</span>
          <span class="spacer"></span>
          <span class="t-body-sm">${list.length} rule${list.length === 1 ? '' : 's'}</span>
          ${readOnly ? '' : `
            <button class="btn btn--primary btn--sm" data-act="dr-add">
              <span class="icon icon--sm">add</span>Add rule
            </button>`}
        </div>
        <div class="panel-body">
          <p class="t-body-sm">Rows add up rather than override each other: every row whose scope covers a claim
            line asks for its documents, and a threshold narrows a row to lines — or, on a Contract row, claims —
            worth more than it. A claim assembled under this version pulls the matching clinical documents in and
            the scrub names what is still missing.</p>
          ${list.length ? tableHtml(list) : emptyHtml()}
          ${readOnly
            ? `<p class="t-body-sm">This contract is ${esc(c.status.toLowerCase())}, so its documentation rules are read-only.</p>`
            : ''}
        </div>
      </div>`;
  }

  function tableHtml(list) {
    return `
      <table class="tbl">
        <thead>
          <tr><th>Scope level</th><th>Scope value</th><th>Documents</th><th>Threshold</th><th></th></tr>
        </thead>
        <tbody>${list.map(rowHtml).join('')}</tbody>
      </table>`;
  }

  function rowHtml(row) {
    return `
      <tr data-dr="${esc(row.id)}">
        <td>${esc(row.scopeLevel)}</td>
        <td>${scopeHtml(row)}</td>
        <td>${(row.docTypes || []).map((t) => `<span class="badge badge--info">${esc(t)}</span>`).join(' ') || '—'}</td>
        <td class="t-mono-sm">${esc(contracts.documentationThresholdLabel(row))}</td>
        <td>${readOnly ? '' : `
          <button class="btn btn--ghost btn--icon btn--sm" data-act="dr-edit" title="Edit this rule">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="dr-remove" title="Remove this rule">
            <span class="icon icon--sm">delete</span>
          </button>`}
        </td>
      </tr>`;
  }

  /** An item scope names the line it covers; a Contract row is the whole agreement. */
  function scopeHtml(row) {
    if (row.scopeLevel === 'Contract') return '<span class="t-body-sm">Whole contract</span>';
    if (row.scopeLevel !== 'Item') return esc(row.scopeValue);
    const item = cdm.get(row.scopeValue);
    return item
      ? `<span class="t-mono-sm">${esc(item.chargeCode)}</span> ${esc(cdm.label(item))}`
      : esc(row.scopeValue);
  }

  function emptyHtml() {
    return `
      <p class="t-body-sm">No documentation rules. A claim under this contract carries whatever the biller attaches
        and the payer asks for nothing in particular.${readOnly
        ? ''
        : ' Add a rule for the whole contract, a service group, a category or one charge line.'}</p>`;
  }

  // --- actions --------------------------------------------------------------

  async function edit(rowId) {
    if (await openDocumentationForm({ contractId, rowId })) draw();
  }

  async function remove(rowId) {
    const row = rows().find((r) => r.id === rowId);
    if (!row) return;
    const ok = await modal.confirm({
      title: 'Remove documentation rule',
      body: `${contracts.documentationLabel(row)} stops asking for ${(row.docTypes || []).join(', ') || 'anything'}. `
        + 'Claims already assembled keep the attachments they pulled in; the next scrub stops naming them as missing.',
      confirmLabel: 'Remove rule',
      tone: 'critical',
      icon: 'delete',
    });
    if (!ok) return;
    contracts.removeDocumentationRequired(contractId, rowId);
    toast('Documentation rule removed', 'success');
    draw();
  }

  host.addEventListener('click', (e) => {
    if (readOnly) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dr-add') return void edit(null);
    const id = e.target.closest('tr[data-dr]')?.dataset.dr;
    if (act === 'dr-edit') return void edit(id);
    if (act === 'dr-remove') return void remove(id);
  });

  draw();
}
