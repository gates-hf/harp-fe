// The Insurance tab on the patient record, at #/frontis/patients/<mrn>/insurance.
// It answers one question at a glance — who pays first — and holds the chain
// the rest of the platform bills against.
//
// Same shape as the Documents tab: patient-view.js owns the panel and the click
// handler, this file owns the markup and the actions. The frame is fetched once
// and cached, so a redraw stays synchronous.

import * as policies from '../../../../data/repositories/policies.js';
import { date, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { openPolicyForm } from './policy-form.js';
import { openPolicyHistory } from './policy-history.js';
import { askCancel, askReactivate, askSuspend, openReorder } from './policy-actions.js';

/** Amber from here on: a policy running out inside the month needs renewing. */
const EXPIRING_DAYS = 30;

let frame = null;

/** Fetch the tab's frame once. Called by the record page before its first draw. */
export async function loadInsuranceTab() {
  if (frame) return frame;
  const res = await fetch(new URL('./tab-insurance.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tab-insurance.html (${res.status})`);
  frame = await res.text();
  return frame;
}

export const insuranceFrame = () => frame || '';

export const policyCount = (mrn) => policies.byPatient(mrn).length;

/** Fill the frame for one patient. A merged record is read-only: history only. */
export function fillInsurance(root, mrn, { readOnly = false } = {}) {
  const rows = policies.byPatient(mrn);
  const chain = policies.chain(mrn);

  root.querySelector('#ins-summary').innerHTML = summaryHtml(chain);
  root.querySelector('#ins-actions').innerHTML = actionsHtml(mrn, chain, readOnly);
  root.querySelector('#ins-note').innerHTML = noteHtml(rows, readOnly);
  root.querySelector('#ins-rows').innerHTML =
    rows.map((p) => rowHtml(p, readOnly)).join('') + selfPayRow();
}

/**
 * The header chip. The chain's first policy is who pays first; an empty chain
 * is self-pay, which is a fact about the patient rather than a missing record.
 */
function summaryHtml(chain) {
  const primary = chain[0];
  return primary
    ? `Primary: ${esc(policies.payerName(primary))} · ${esc(policies.planName(primary))}
       <span class="badge badge--success"><span class="dot"></span>${chain.length} in chain</span>`
    : 'Coverage <span class="badge">Self-Pay</span>';
}

function actionsHtml(mrn, chain, readOnly) {
  if (readOnly) {
    return `
      <button class="btn btn--secondary btn--sm" disabled title="A merged record is read-only">
        <span class="icon icon--sm">add</span>Add policy
      </button>`;
  }
  const full = !policies.canAddToChain(mrn);
  return `
    <button class="btn btn--secondary btn--sm" data-act="pol-add"${full
      ? ` disabled title="Only three chain positions — suspend or cancel one first"` : ''}>
      <span class="icon icon--sm">add</span>Add policy
    </button>
    <button class="btn btn--secondary btn--sm" data-act="pol-reorder"${chain.length >= 2
      ? '' : ` disabled title="${chain.length ? 'Reordering needs at least two policies in the chain' : 'This patient is self-pay — there is nothing to order'}"`}>
      <span class="icon icon--sm">swap_vert</span>Reorder
    </button>`;
}

function noteHtml(rows, readOnly) {
  if (readOnly) {
    return `
      <div class="alert alert--info">
        <span class="icon">lock</span>
        <div>This record was merged into another, so its policies are read-only — they moved with the patient. The history of each one is still open.</div>
      </div>`;
  }
  if (rows.length) return '';
  return `
    <div class="alert alert--info">
      <span class="icon">payments</span>
      <div>
        <div class="title">No policy on file</div>
        This patient is self-pay. Add a policy and it becomes the primary payer for every encounter opened from here.
      </div>
    </div>`;
}

function rowHtml(p, readOnly) {
  const out = !p.priority;
  const tone = policies.statusTone(p.status);
  const left = policies.daysLeft(p);
  const amber = p.status === 'Active' && left !== null && left <= EXPIRING_DAYS;
  const holder = p.relationship === 'Self' ? '' : ` · ${esc(p.relationship)} of ${esc(p.holderName || '—')}`;

  return `
    <tr data-policy="${esc(p.id)}">
      <td class="t-mono-sm">${out ? '—' : esc(policies.priorityLabel(p.priority))}</td>
      <td>
        <span class="${out ? 't-body-sm' : ''}">${esc(policies.payerName(p))}</span>
        <br><span class="t-body-sm">${esc(policies.planName(p))}${holder}</span>
      </td>
      <td class="t-mono-sm">${esc(p.memberId)}<br><span class="t-body-sm">${p.policyNo ? esc(p.policyNo) : '—'}</span></td>
      <td class="t-mono-sm">
        ${date(p.validFrom)} – ${date(p.validTo)}
        ${amber ? `<br><span class="badge badge--warning"><span class="dot"></span>expires in ${left} ${left === 1 ? 'day' : 'days'}</span>` : ''}
      </td>
      <td>
        <span class="badge${tone ? ` badge--${tone}` : ''}"${p.statusReason ? ` title="${esc(p.statusReason)}"` : ''}>
          <span class="dot"></span>${esc(p.status)}
        </span>
        <br><span class="t-body-sm">${p.lastVerifiedAt ? `verified ${date(p.lastVerifiedAt)}` : 'not verified'}</span>
      </td>
      <td>${rowActionsHtml(p, readOnly)}</td>
    </tr>`;
}

/** A cancelled or expired policy is a record, not a form: history and nothing else. */
function rowActionsHtml(p, readOnly) {
  const settled = p.status === 'Cancelled' || p.status === 'Expired';
  const history = `
    <button class="btn btn--ghost btn--icon btn--sm" data-act="pol-history" title="View history">
      <span class="icon icon--sm">history</span>
    </button>`;
  if (readOnly || settled) {
    return `
      <button class="btn btn--ghost btn--icon btn--sm" data-act="pol-view" title="View policy">
        <span class="icon icon--sm">visibility</span>
      </button>${history}`;
  }

  const suspended = p.status === 'Suspended';
  return `
    <button class="btn btn--ghost btn--icon btn--sm" data-act="pol-edit" title="View or edit policy">
      <span class="icon icon--sm">edit</span>
    </button>
    <button class="btn btn--ghost btn--icon btn--sm" data-act="${suspended ? 'pol-reactivate' : 'pol-suspend'}"
            title="${suspended ? 'Reactivate policy' : 'Suspend policy'}">
      <span class="icon icon--sm">${suspended ? 'play_arrow' : 'pause'}</span>
    </button>
    <button class="btn btn--ghost btn--icon btn--sm" data-act="pol-cancel" title="Cancel policy">
      <span class="icon icon--sm">cancel</span>
    </button>${history}`;
}

/** The one row that is never a record: it always applies and cannot be edited. */
function selfPayRow() {
  return `
    <tr>
      <td class="t-body-sm">—</td>
      <td class="t-body-sm">Self-Pay<br>Fallback (always applies)</td>
      <td class="t-body-sm">—</td>
      <td class="t-body-sm">—</td>
      <td class="t-body-sm">Whatever the chain above does not cover is billed to the patient.</td>
      <td class="t-body-sm">—</td>
    </tr>`;
}

// --- actions ------------------------------------------------------------------

/**
 * The tab's own [data-act] handling. Returns true when the record changed and
 * the page should redraw; the store subscription redraws it anyway, so the
 * return value is what tells a caller a dialog was answered rather than closed.
 */
export async function handleInsurance(act, mrn, policyId) {
  if (act === 'pol-add') return Boolean(await openPolicyForm(mrn, null));
  if (act === 'pol-reorder') return openReorder(mrn);

  const policy = policyId ? policies.get(policyId) : null;
  if (!policy) return false;

  if (act === 'pol-view' || act === 'pol-edit') {
    return Boolean(await openPolicyForm(mrn, policy.id, { readOnly: act === 'pol-view' }));
  }
  if (act === 'pol-history') {
    await openPolicyHistory(policy.id);
    return false;
  }
  if (act === 'pol-suspend') return askSuspend(policy);
  if (act === 'pol-cancel') return askCancel(policy);
  if (act === 'pol-reactivate') {
    // Reactivating into a lapsed validity would only expire again on the next
    // load, so the dates are renewed first and the toast says so.
    if (policies.daysLeft(policy) !== null && policies.daysLeft(policy) < 0) {
      toast('Renew dates first', 'warning');
      return false;
    }
    if (!policies.canAddToChain(mrn)) {
      toast('Only three chain positions — suspend or cancel one first', 'warning');
      return false;
    }
    return askReactivate(policy);
  }
  return false;
}
