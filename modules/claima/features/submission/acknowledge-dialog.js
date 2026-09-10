// The acknowledgment form: what the payer said it received, accepted and
// rejected, against the claims the batch actually holds. The reconciliation
// strip — included n = accepted + rejected + ejected — is redrawn on every
// keystroke and the button stays disabled until it balances, because an
// acknowledgment that does not add up is a question, not a record.
//
// Each claim in the batch takes one answer: accepted, rejected (with a code
// the reason fills in from, and a document), or not received — the last is
// ejected back to the ready queue for the next batch.

import * as batches from '../../../../data/repositories/batches.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';
import { payerName } from './batch-chips.js';

const ANSWERS = [['A', 'Accepted'], ['R', 'Rejected'], ['N', 'Not received']];

/** askAcknowledge(batchNo) → Promise<batch|null>. */
export async function askAcknowledge(batchNo) {
  const batch = batches.get(batchNo);
  if (!batch || !['Submitted', 'Partially Rejected'].includes(batch.status) || batch.acknowledgment) {
    toast(batch?.acknowledgment ? 'Already acknowledged' : 'Submit the batch first', 'warning');
    return null;
  }
  const rows = batches.claimsOf(batch);
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const codes = batches.REJECTION_REASONS.map((r) => `<option value="${esc(r.code)}">${esc(r.code)} — ${esc(r.label)}</option>`).join('');

  const dialog = modal.open({
    title: `Acknowledge ${batchNo}`,
    sub: `${payerName(batch.payerId)} · ${rows.length} claim${rows.length === 1 ? '' : 's'} included · ${usd(batches.valueOf(batch))}`,
    icon: 'mark_email_read',
    size: 'xl',
    body: `
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">tag</span>
          <input id="ak-ref" placeholder="Payer’s acknowledgment reference" aria-label="Payer reference">
        </label>
        <label class="field">
          <span class="icon icon--sm">event</span>
          <input type="datetime-local" id="ak-at" value="${local}" aria-label="Acknowledged at">
        </label>
        <label class="field">
          <span class="icon icon--sm">attach_file</span>
          <input id="ak-doc" placeholder="Document (optional)" aria-label="Document">
        </label>
      </div>
      <div class="toolbar">
        <label class="field">
          <span class="icon icon--sm">inbox</span>
          <input type="number" min="0" id="ak-received" placeholder="Received" aria-label="Received count" value="${rows.length}">
        </label>
        <label class="field">
          <span class="icon icon--sm">check_circle</span>
          <input type="number" min="0" id="ak-accepted" placeholder="Accepted" aria-label="Accepted count">
        </label>
        <label class="field">
          <span class="icon icon--sm">cancel</span>
          <input type="number" min="0" id="ak-rejected" placeholder="Rejected" aria-label="Rejected count">
        </label>
      </div>
      <div id="ak-strip"></div>
      <table class="tbl">
        <thead>
          <tr><th scope="col">Claim</th><th scope="col">Value</th><th scope="col">Answer</th><th scope="col">Code and reason</th></tr>
        </thead>
        <tbody>${rows.map((c) => rowHtml(c, codes)).join('')}</tbody>
      </table>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ack" disabled>Acknowledge</button>`,
  });

  const $ = (sel) => dialog.el.querySelector(sel);
  const read = () => {
    const rejections = [];
    const notReceived = [];
    for (const tr of dialog.el.querySelectorAll('tr[data-claim]')) {
      const answer = tr.querySelector('[data-answer]').value;
      if (answer === 'R') {
        rejections.push({
          claimNo: tr.dataset.claim,
          code: tr.dataset.fixedCode || tr.querySelector('[data-code]')?.value || '',
          reason: tr.querySelector('[data-reason]')?.value.trim() || '',
          document: $('#ak-doc').value.trim() || null,
        });
      } else if (answer === 'N') notReceived.push(tr.dataset.claim);
    }
    return {
      payerRef: $('#ak-ref').value.trim(),
      at: $('#ak-at').value ? new Date($('#ak-at').value).toISOString() : null,
      document: $('#ak-doc').value.trim() || null,
      receivedCount: $('#ak-received').value === '' ? NaN : Number($('#ak-received').value),
      acceptedCount: $('#ak-accepted').value === '' ? NaN : Number($('#ak-accepted').value),
      rejectedCount: $('#ak-rejected').value === '' ? NaN : Number($('#ak-rejected').value),
      rejections,
      notReceived,
    };
  };

  function redraw() {
    const ack = read();
    const r = batches.reconcile(batch, ack);
    const tone = r.ok ? 'success' : 'warning';
    $('#ak-strip').innerHTML = `
      <div class="alert alert--${tone}">
        <span class="icon">${r.ok ? 'task_alt' : 'balance'}</span>
        <div>
          <div class="title">Included ${r.included} = accepted ${fmt(r.accepted)} + rejected ${fmt(r.rejected)} + ejected ${fmt(r.ejected)}</div>
          ${r.ok ? 'The counts reconcile with the answers below.' : r.problems.map((p) => esc(p)).join('<br>')}
        </div>
      </div>`;
    for (const tr of dialog.el.querySelectorAll('tr[data-claim]')) {
      const rejected = tr.querySelector('[data-answer]').value === 'R';
      const detail = tr.querySelector('[data-detail]');
      if (detail) detail.hidden = !rejected;
    }
    $('[data-act="ack"]').disabled = !r.ok || !ack.payerRef || !ack.at;
    $('[data-act="ack"]').title = !ack.payerRef ? 'Enter the payer’s reference' : r.ok ? 'Record the acknowledgment' : 'The counts do not reconcile yet';
  }

  dialog.el.addEventListener('input', redraw);
  dialog.el.addEventListener('change', (e) => {
    const code = e.target.closest('[data-code]');
    if (code) {
      const tr = code.closest('tr');
      const r = batches.rejectionReason(code.value);
      const box = tr.querySelector('[data-reason]');
      if (!box.dataset.typed) box.value = r?.label || '';
    }
    const reason = e.target.closest('[data-reason]');
    if (reason) reason.dataset.typed = '1';
    redraw();
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ack"]')) return;
    const ack = read();
    const { batch: row, error } = batches.acknowledge(batchNo, ack);
    if (error) {
      toast(error, 'warning');
      return;
    }
    dialog.close(row);
    const r = row.acknowledgment;
    toast(`${batchNo} acknowledged — ${r.acceptedCount} accepted, ${r.rejectedCount} rejected${
      r.receivedCount < rows.length ? `, ${rows.length - r.receivedCount} back to the queue` : ''}`, r.rejectedCount ? 'warning' : 'success');
  });
  redraw();
  return dialog.closed;
}

const fmt = (n) => (Number.isFinite(n) ? n : '?');

/** One claim, one answer. A claim the payer already sent back is fixed on Rejected. */
function rowHtml(c, codes) {
  const already = c.status === 'Rejected';
  return `
    <tr data-claim="${esc(c.claimNo)}"${already ? ` data-fixed-code="${esc(c.rejection.code)}"` : ''}>
      <td><span class="t-mono-sm">${esc(c.claimNo)}</span>${(c.cycle || 1) > 1 ? ` <span class="badge badge--accent">cycle ${c.cycle}</span>` : ''}</td>
      <td><span class="t-mono-sm">${esc(usd(c.totals.payerShare))}</span></td>
      <td>
        <label class="field">
          <select data-answer aria-label="Answer for ${esc(c.claimNo)}"${already ? ' disabled' : ''}>
            ${ANSWERS.map(([v, l]) => `<option value="${v}"${(already ? v === 'R' : v === 'A') ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </td>
      <td>
        ${already
    ? `<span class="badge badge--critical">${esc(c.rejection.code)}</span> <span class="t-body-sm">${esc(c.rejection.reason)} — already recorded</span>
           <span data-detail hidden></span>`
    : `<div data-detail hidden>
             <div class="toolbar">
               <label class="field"><select data-code aria-label="Rejection code">${codes}</select></label>
               <label class="field field--grow"><input data-reason aria-label="Reason" value="${esc(batches.REJECTION_REASONS[0].label)}"></label>
             </div>
           </div>`}
      </td>
    </tr>`;
}
