// Log follow-up — one dialog for one claim or for a selection with the same
// payer: method, who was spoken to, what was said and when to call again. It
// validates, writes through data/repositories/followups.js and says what it
// did; the queue redraws on the commit.

import * as followups from '../../../../data/repositories/followups.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';

/**
 * openLogDialog(claimNos) → resolves with the rows written, or undefined on
 * cancel. Every claim named has to share one payer — a call is made to one
 * desk — and the dialog refuses a mixed selection with the reason.
 */
export async function openLogDialog(claimNos = []) {
  const rows = claimNos.map((no) => claims.get(no)).filter(Boolean);
  if (!rows.length) return undefined;
  const payerIds = [...new Set(rows.map((c) => c.payerId))];
  if (payerIds.length > 1) {
    toast(`Pick claims with one payer — the selection spans ${payerIds.length}`, 'warning');
    return undefined;
  }
  const payer = payers.get(payerIds[0]);
  const total = rows.reduce((n, c) => n + (Number(c.totals?.payerShare) || 0), 0);
  const many = rows.length > 1;
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const dialog = modal.open({
    title: many ? `Log follow-up — ${rows.length} claims` : `Log follow-up — ${rows[0].claimNo}`,
    sub: `${payer?.nameEn || payerIds[0]} · ${usd(total)}${many ? ` over ${rows.length} claims` : ''}`,
    icon: 'call',
    size: 'md',
    body: `
      ${many ? `<p class="modal__lede">One call, logged on each claim: ${rows.map((c) => `<span class="t-mono-sm">${esc(c.claimNo)}</span>`).join(', ')}.</p>` : ''}
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">contact_phone</span>
          <select id="fu-method" aria-label="Method">
            ${followups.METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </label>
        <label class="field field--grow">
          <span class="icon icon--sm">person</span>
          <input id="fu-contact" placeholder="Who you reached — name and desk" aria-label="Contact" maxlength="120">
        </label>
      </div>
      <label class="field field--area">
        <span class="icon icon--sm">notes</span>
        <textarea id="fu-note" rows="3" placeholder="What they said and what was agreed" aria-label="Note" maxlength="600"></textarea>
      </label>
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">event</span>
          <input type="date" id="fu-due" aria-label="Next due" value="${nextWeek}" min="${todayIso()}">
        </label>
        <span class="t-body-sm">Next call due — clear it when nothing is booked.</span>
      </div>
      <div id="fu-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="fu-save">Log follow-up</button>`,
  });

  const $ = (sel) => dialog.el.querySelector(sel);
  $('#fu-save').addEventListener('click', () => {
    const fields = {
      method: $('#fu-method').value,
      contact: $('#fu-contact').value.trim(),
      note: $('#fu-note').value.trim(),
      nextDueAt: $('#fu-due').value || null,
    };
    const problems = [];
    if (!fields.contact) problems.push('Say who you reached.');
    if (!fields.note) problems.push('Write down what was said.');
    if (problems.length) {
      $('#fu-error').innerHTML = `
        <div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>`;
      return;
    }
    const written = followups.logMany(rows.map((c) => c.claimNo), fields);
    toast(`${written.length === 1 ? 'Follow-up' : `${written.length} follow-ups`} logged${fields.nextDueAt ? ` · next due ${date(fields.nextDueAt)}` : ''}`);
    dialog.close(written);
  });

  return dialog.closed;
}
