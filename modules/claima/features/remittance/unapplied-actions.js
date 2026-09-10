// The three ways unapplied cash leaves: applied to one of the payer's claims
// (a lookup over what is still owed), refunded to the payer (a role and a
// reason) or adjusted (a role and a reason). Each is one dialog and one
// audited write on the row.

import * as unapplied from '../../../../data/repositories/unapplied.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { payerName } from './remittance-chips.js';

/** Apply to a claim: the payer's claims still owed something, narrowed by a lookup. */
export async function askApply(id) {
  const row = unapplied.get(id);
  if (!row || row.status !== 'Held') return false;
  const pool = claims.all().filter((c) => c.payerId === row.payerId && (claims.isPending(c) || c.status === 'Partially Paid'))
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const dialog = modal.open({
    title: `Apply ${usd(row.amount)} to a claim`,
    sub: `${payerName(row.payerId)} · from ${row.remittanceNo} · ${pool.length} claim${pool.length === 1 ? '' : 's'} still owed something`,
    icon: 'input',
    size: 'xxl',
    body: `
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">search</span>
          <input type="text" id="ua-q" placeholder="Narrow by claim no., patient or MRN" aria-label="Narrow the claims">
        </label>
      </div>
      <label class="field field--area">
        <textarea id="ua-reason" rows="2" placeholder="Why this claim (optional)" aria-label="Reason"></textarea>
      </label>
      <div id="ua-body">${tableHtml(pool, row)}</div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });
  dialog.el.addEventListener('input', (e) => {
    if (e.target.id !== 'ua-q') return;
    const q = e.target.value.trim().toLowerCase();
    dialog.el.querySelector('#ua-body').innerHTML = tableHtml(pool.filter((c) => {
      const p = patients.get(c.patientMrn);
      return !q || [c.claimNo, c.patientMrn, p?.nameEn, p?.nameAr].some((v) => String(v || '').toLowerCase().includes(q));
    }), row);
  });
  dialog.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-apply]');
    if (!btn) return;
    const { error, claim } = unapplied.apply(id, btn.dataset.apply, { reason: dialog.el.querySelector('#ua-reason').value.trim() });
    if (error) return void toast(error, 'critical');
    toast(`${usd(row.amount)} applied — ${claim.claimNo} is ${claim.status.toLowerCase()}`, 'success');
    dialog.close('done');
  });
  return (await dialog.closed) === 'done';
}

function tableHtml(pool, row) {
  if (!pool.length) {
    return `<div class="state-view"><div class="state-view__glyph"><span class="icon">search_off</span></div>
      <div class="state-view__title">Nothing to apply it to</div>
      <p class="state-view__body">This payer has no claim still owed anything. Refund the cash, or adjust it.</p></div>`;
  }
  const role = currentRole();
  return `
    <table class="tbl">
      <thead><tr><th>Claim</th><th>Patient</th><th>Status</th><th>Expected</th><th>Paid so far</th><th>Balance</th><th></th></tr></thead>
      <tbody>${pool.map((c) => {
        const p = patients.view(patients.get(c.patientMrn), role);
        const whole = c.totals.balance <= row.amount + 0.005;
        return `
          <tr>
            <td class="t-mono-sm">${esc(c.claimNo)}</td>
            <td title="${esc(c.patientMrn)}">${esc(p?.nameEn || c.patientMrn)}</td>
            <td><span class="badge badge--${claims.statusTone(c.status)}" title="Service ${esc(date(c.dateOfService))}"><span class="dot"></span>${esc(c.status)}</span></td>
            <td class="t-mono-sm">${esc(usd(c.totals.payerShare))}</td>
            <td class="t-mono-sm">${esc(usd(c.totals.paid))}</td>
            <td class="t-mono-sm">${esc(usd(c.totals.balance))}${whole ? ' <span class="badge badge--success" title="The cash settles this claim whole">settles</span>' : ''}</td>
            <td><button class="btn btn--primary btn--sm" data-apply="${esc(c.claimNo)}">Apply</button></td>
          </tr>`;
      }).join('')}</tbody>
    </table>`;
}

/** Refund to the payer or adjust: one reason dialog, the role gate on the caller's button. */
export async function askResolve(id, kind) {
  const row = unapplied.get(id);
  if (!row || row.status !== 'Held') return false;
  const refund = kind === 'Refunded';
  const dialog = modal.open({
    title: refund ? `Refund ${usd(row.amount)} to ${payerName(row.payerId)}` : `Adjust ${usd(row.amount)}`,
    sub: `from ${row.remittanceNo} · held ${unapplied.ageDays(row)} day${unapplied.ageDays(row) === 1 ? '' : 's'}`,
    icon: refund ? 'undo' : 'tune',
    tone: 'warning',
    body: `
      <p class="modal__lede">${refund
        ? 'The cash goes back to the payer. The reference is the refund instruction the finance office raises.'
        : 'The hospital keeps the cash against nothing in particular — a correction written on with a reason.'}</p>
      ${refund ? `<label class="field"><span class="icon icon--sm">tag</span><input id="ur-ref" placeholder="Refund reference" aria-label="Refund reference"></label>` : ''}
      <label class="field field--area">
        <textarea id="ur-reason" rows="3" placeholder="Why — required" aria-label="Reason"></textarea>
      </label>
      <div class="field-error" id="ur-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="ur-save"><span class="icon icon--sm">check</span>${refund ? 'Refund' : 'Adjust'}</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('#ur-save')) return;
    const reason = dialog.el.querySelector('#ur-reason').value.trim();
    const box = dialog.el.querySelector('#ur-error');
    const { error } = refund
      ? unapplied.refund(id, { reason, reference: dialog.el.querySelector('#ur-ref')?.value.trim() })
      : unapplied.adjust(id, { reason });
    box.textContent = error;
    box.hidden = !error;
    if (error) return;
    toast(`${usd(row.amount)} ${refund ? 'refunded' : 'adjusted'}`, 'success');
    dialog.close('done');
  });
  return (await dialog.closed) === 'done';
}
