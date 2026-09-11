// The dispute dialogs: raise one over a same-administrator selection,
// record the administrator's acknowledgment, capture the settlement (what
// came back, and the remainder to a write-off request through Claima's
// creator or accepted with a reason), or write the whole overcharge off.
// Each validates, writes through data/repositories/tpa-disputes.js and says
// what it did; the screens redraw on the commit. The add-administrator
// dialog is re-exported from the schedule dialogs so the ledger has one
// import.

import * as accruals from '../../../../data/repositories/tpa-fee-accruals.js';
import * as disputes from '../../../../data/repositories/tpa-disputes.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';

export { openAddTpaDialog, openAddLinkDialog, openEndLinkDialog, openAddVersionDialog } from './schedule-dialogs.js';

export const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

const REASONS = [['W03', 'Small balance'], ['W01', 'Contractual adjustment'], ['W07', 'Payer non-response'], ['W99', 'Other']];
export const reasonOptions = (selected = 'W03') => REASONS.map(([code, label]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${code} · ${label}</option>`).join('');

/** Raise a dispute over one or several overcharged accruals of one administrator. Resolves true when raised. */
export async function openRaiseDisputeDialog(accrualIds = []) {
  const rows = accrualIds.map((id) => accruals.get(id)).filter(Boolean);
  const why = disputes.raiseBlocker({ accrualIds: rows.map((a) => a.id) });
  if (why) { toast(why, 'warning'); return false; }
  const total = rows.reduce((n, a) => n + accruals.bucketsOf(a).overcharge, 0);
  const dialog = modal.open({
    title: `Dispute with ${accruals.tpaName(rows[0])}`,
    sub: `${usd(total)} over ${rows.length} accrual${rows.length === 1 ? '' : 's'}`,
    icon: 'gavel',
    size: 'md',
    body: `
      <p class="modal__lede">The overcharge is raised with the administrator as computed now — each accrual's actual, expected and the version it was read from are frozen as the evidence.</p>
      <table class="tbl">
        <thead><tr><th>Accrual</th><th>Claim</th><th>Actual</th><th>Expected</th><th>Overcharge</th></tr></thead>
        <tbody>${rows.map((a) => `<tr><td class="t-mono-sm">${esc(a.id)}</td><td class="t-mono-sm">${esc(a.claimNo)}</td><td class="t-mono-sm">${esc(usd(a.actual.amount))}</td><td class="t-mono-sm">${esc(usd(a.expected?.amount || 0))} <span class="t-body-sm">${esc(a.expected?.versionRef || '')}</span></td><td class="t-mono-sm">${esc(usd(accruals.bucketsOf(a).overcharge))}</td></tr>`).join('')}</tbody>
      </table>
      <label class="field field--area">
        <span class="icon icon--sm">notes</span>
        <textarea id="td-note" rows="3" placeholder="What the statement got wrong, in a sentence the administrator will read" aria-label="Note"></textarea>
      </label>
      <div id="td-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="td-save">Raise dispute</button>`,
  });
  dialog.el.querySelector('#td-save').addEventListener('click', () => {
    const r = disputes.raise({ accrualIds: rows.map((a) => a.id), note: dialog.el.querySelector('#td-note').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#td-errors'), [r.error]);
    toast(`${r.id} raised with ${accruals.tpaName(rows[0])} — ${usd(r.totalOvercharge)}`);
    return dialog.close(true);
  });
  return dialog.closed;
}

export async function openAcknowledgeDialog(disputeId) {
  const d = disputes.get(disputeId);
  if (!d) return false;
  const dialog = modal.open({
    title: `${d.id} acknowledged`,
    sub: 'The administrator’s reference for the dispute',
    icon: 'mark_email_read',
    size: 'sm',
    body: `
      <label class="field">
        <span class="icon icon--sm">tag</span>
        <input id="td-ref" placeholder="Administrator’s reference" aria-label="Reference" autofocus>
      </label>
      <div id="td-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="td-save">Record</button>`,
  });
  dialog.el.querySelector('#td-save').addEventListener('click', () => {
    const r = disputes.acknowledge(d.id, { ref: dialog.el.querySelector('#td-ref').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#td-errors'), [r.error]);
    toast(`${d.id} acknowledged under ${r.acknowledgment.ref}`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Capture the settlement: recovered, and what happens to the remainder. */
export async function openSettleDialog(disputeId) {
  const d = disputes.get(disputeId);
  if (!d) return false;
  const target = disputes.writeOffTarget(d, 0.01);
  const dialog = modal.open({
    title: `Settle ${d.id}`,
    sub: `${usd(d.totalOvercharge)} in dispute with ${disputes.accrualsOf(d).length ? accruals.tpaName(disputes.accrualsOf(d)[0]) : ''}`,
    icon: 'handshake',
    size: 'md',
    body: `
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">attach_money</span>
          <input id="td-recovered" type="number" min="0" step="0.01" max="${d.totalOvercharge}" value="${d.totalOvercharge}" aria-label="Recovered">
        </label>
        <span class="t-body-sm" id="td-remainder"></span>
      </div>
      <div id="td-remainder-block">
        <div class="toolbar">
          <span class="t-title-sm">Remainder</span>
          <span class="spacer"></span>
          <div class="segmented" role="group" aria-label="Remainder">
            <button type="button" data-how="writeOff" aria-pressed="true" title="${esc(target ? `A claim-residual write-off request on ${target.claimNo}, decided at Claima’s tiers` : 'No claim in the dispute carries a payer balance to write the remainder off against')}"${target ? '' : ' disabled'}>Request write-off</button>
            <button type="button" data-how="accept" aria-pressed="false" title="Let the remainder go with a reason on the record">Accept with reason</button>
          </div>
        </div>
        <div id="td-wo"><div class="toolbar">
          <label class="field">
            <span class="icon icon--sm">category</span>
            <select id="td-reason-code" aria-label="Write-off reason">${reasonOptions('W03')}</select>
          </label>
        </div></div>
        <label class="field field--area">
          <span class="icon icon--sm">notes</span>
          <textarea id="td-reason" rows="3" placeholder="Why the remainder is not pursued" aria-label="Reason"></textarea>
        </label>
      </div>
      <div id="td-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="td-save">Settle</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  let how = target ? 'writeOff' : 'accept';
  function sync() {
    const got = Number($('#td-recovered').value) || 0;
    const remainder = Math.round(Math.max(0, d.totalOvercharge - got) * 100) / 100;
    $('#td-remainder').textContent = remainder ? `${usd(remainder)} left to account for` : 'Nothing left — recovered in full';
    $('#td-remainder-block').hidden = !remainder;
    for (const b of dialog.el.querySelectorAll('[data-how]')) b.setAttribute('aria-pressed', String(b.dataset.how === how));
    $('#td-wo').hidden = how !== 'writeOff';
    $('#td-reason').placeholder = how === 'writeOff' ? 'Justification for the write-off request' : 'Why the remainder is accepted';
  }
  $('#td-recovered').addEventListener('input', sync);
  dialog.el.addEventListener('click', (e) => { const b = e.target.closest('[data-how]'); if (b && !b.disabled) { how = b.dataset.how; sync(); } });
  $('#td-save').addEventListener('click', () => {
    const text = $('#td-reason').value;
    const r = disputes.settle(d.id, { recovered: Number($('#td-recovered').value) || 0, how, reason: text, justification: text, reasonCode: $('#td-reason-code').value });
    if (r?.error) return errorBox($('#td-errors'), [r.error]);
    toast(`${d.id} settled — ${usd(r.settlement.recovered)} recovered${r.writeOffRequestRef ? `, ${r.writeOffRequestRef} raised` : r.settlement.remainder ? `, ${usd(r.settlement.remainder)} accepted` : ''}`);
    return dialog.close(true);
  });
  sync();
  return dialog.closed;
}

/** Nothing came back: the whole overcharge to a write-off request. */
export async function openWriteOffDialog(disputeId) {
  const d = disputes.get(disputeId);
  if (!d) return false;
  const target = disputes.writeOffTarget(d, d.totalOvercharge);
  if (!target) { toast('No claim in the dispute carries a payer balance the overcharge can be written off against — settle it and accept the remainder instead', 'warning'); return false; }
  const dialog = modal.open({
    title: `Write off ${d.id}`,
    sub: `${usd(d.totalOvercharge)} to a write-off request on ${target.claimNo}`,
    icon: 'money_off',
    tone: 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">The administrator gave nothing back. The whole overcharge is raised as a claim-residual write-off request, decided at Claima’s tiers.</p>
      <label class="field"><span class="icon icon--sm">category</span><select id="td-reason-code" aria-label="Reason">${reasonOptions('W07')}</select></label>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="td-reason" rows="3" placeholder="Justification" aria-label="Justification"></textarea></label>
      <div id="td-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="td-save">Request write-off</button>`,
  });
  dialog.el.querySelector('#td-save').addEventListener('click', () => {
    const text = dialog.el.querySelector('#td-reason').value;
    if (!text.trim()) return errorBox(dialog.el.querySelector('#td-errors'), ['Say why it is written off.']);
    const r = disputes.writeOff(d.id, { justification: text, reason: text, reasonCode: dialog.el.querySelector('#td-reason-code').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#td-errors'), [r.error]);
    toast(`${d.id} written off — ${r.writeOffRequestRef} raised`);
    return dialog.close(true);
  });
  return dialog.closed;
}
