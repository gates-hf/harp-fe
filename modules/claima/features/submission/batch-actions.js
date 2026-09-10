// The dialogs a batch moves through: create, add to, generate, mark
// submitted, exclude a claim, record a rejection, close. Every write goes
// through data/repositories/batches.js, which audits it; a dialog only asks.
// The acknowledgment form is acknowledge-dialog.js and Fix & Resubmit is
// fix-dialog.js — each is a page of its own.

import * as batches from '../../../../data/repositories/batches.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';
import { payerName } from './batch-chips.js';

const list = (rows) => rows.map((c) => `${c.claimNo} (${usd(c.totals.payerShare)})`).join(', ');

/** askCreate(payerId) → Promise<batch|null>. */
export async function askCreate(payerId) {
  const queue = batches.readyQueue(payerId);
  if (!queue.length) {
    toast('Nothing Ready for this payer', 'warning');
    return null;
  }
  const mode = batches.modeOf(payerId);
  const ok = await modal.confirm({
    title: `Create a ${mode.toLowerCase()} batch for ${payerName(payerId)}`,
    body: `${queue.length} claim${queue.length === 1 ? '' : 's'} worth ${usd(queue.reduce((n, c) => n + c.totals.payerShare, 0))}: ${list(queue)}. `
      + 'The batch opens with every Ready claim of this payer that is in no other open batch; exclude any before generating.',
    confirmLabel: 'Create batch',
    tone: '',
    icon: 'add',
  });
  if (!ok) return null;
  const row = batches.create(payerId);
  if (row) toast(`${row.batchNo} opened with ${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'}`, 'success');
  return row;
}

/** askAdd(batchNo) → Promise<number>. Adds the payer's queue to its open batch. */
export async function askAdd(batchNo) {
  const batch = batches.get(batchNo);
  const queue = batch ? batches.readyQueue(batch.payerId).filter((c) => !batch.exclusions.some((x) => x.claimNo === c.claimNo)) : [];
  if (!queue.length) {
    toast('Nothing to add — every Ready claim is excluded from this batch or already in it', 'warning');
    return 0;
  }
  const ok = await modal.confirm({
    title: `Add ${queue.length} claim${queue.length === 1 ? '' : 's'} to ${batchNo}`,
    body: `${list(queue)}. ${batch.status === 'Generated' ? 'The batch is Generated: adding to it means generating the files again.' : ''}`,
    confirmLabel: 'Add to batch',
    tone: '',
    icon: 'playlist_add',
  });
  if (!ok) return 0;
  const n = batches.addReady(batchNo);
  if (n) toast(`${n} claim${n === 1 ? '' : 's'} added to ${batchNo}`, 'success');
  return n;
}

/** Generate the files now and say what came out — and what was ejected on the way. */
export function runGenerate(batchNo, { navigate } = {}) {
  const { batch, generation, ejected, error } = batches.generate(batchNo);
  if (error) {
    toast(`${batchNo}: ${error}`, 'warning');
    return null;
  }
  const dialog = modal.open({
    title: `${batchNo} generated — v${generation.version}`,
    sub: `${batch.mode} · ${batch.claimNos.length} claim${batch.claimNos.length === 1 ? '' : 's'} · ${usd(batches.valueOf(batch))}`,
    icon: 'description',
    body: `
      ${ejected.length ? `
        <div class="alert alert--warning">
          <span class="icon">remove_circle</span>
          <div><div class="title">${ejected.length} claim${ejected.length === 1 ? '' : 's'} ejected before generation</div>
            ${ejected.map((e) => `${esc(e.claimNo)} — ${esc(e.cause)}`).join('<br>')}</div>
        </div>` : ''}
      <table class="tbl">
        <thead><tr><th scope="col">File</th><th scope="col">Kind</th><th scope="col">Size</th></tr></thead>
        <tbody>${generation.files.map((f) => `
          <tr><td class="t-mono-sm">${esc(f.fileName)}</td><td>${esc(f.kind)}</td><td class="t-mono-sm">${esc(String(f.content.length))} chars</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="t-body-sm">${generation.version > 1 ? `Version ${generation.version} sits beside the earlier versions; nothing is overwritten. ` : ''}Download or preview the files on the batch page, then mark the batch submitted with the method and the reference used.</p>`,
    foot: `
      <button class="btn btn--secondary" data-close>Close</button>
      <button class="btn btn--primary" data-act="open-files">Open the files</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="open-files"]')) return;
    dialog.close(true);
    if (navigate) navigate(`/claima/submission/${batchNo}/files`);
    else window.location.hash = `#/claima/submission/${batchNo}/files`;
  });
  return generation;
}

/** askSubmit(batchNo) → Promise<batch|null>: method, reference, date. */
export async function askSubmit(batchNo) {
  const batch = batches.get(batchNo);
  const why = batches.submitBlocker(batch);
  if (why) {
    toast(why, 'warning');
    return null;
  }
  const methods = batches.methodsFor(batch.payerId);
  const gen = batches.latestGeneration(batch);
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const dialog = modal.open({
    title: `Mark ${batchNo} submitted`,
    sub: `${payerName(batch.payerId)} · ${batch.mode} · files v${gen?.version || '—'} · ${batch.claimNos.length} claim${batch.claimNos.length === 1 ? '' : 's'}`,
    icon: 'send',
    body: `
      <p class="t-body-sm">Say how the files went out. Every claim in the batch moves to Submitted on this date, and the payer's acknowledgment is recorded against it.</p>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">${batch.mode === 'Electronic' ? 'cloud_upload' : 'local_shipping'}</span>
          <select id="bs-method" aria-label="Method">${methods.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
        </label>
      </div>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">tag</span>
          <input id="bs-reference" placeholder="${batch.mode === 'Electronic' ? 'Portal or transfer reference' : 'Courier or delivery reference'}" aria-label="Reference">
        </label>
      </div>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">event</span>
          <input type="datetime-local" id="bs-at" value="${local}" aria-label="Submitted at">
        </label>
      </div>
      <div class="field-error" id="bs-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="submit">Mark submitted</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="submit"]')) return;
    const method = dialog.el.querySelector('#bs-method').value;
    const reference = dialog.el.querySelector('#bs-reference').value.trim();
    const at = dialog.el.querySelector('#bs-at').value;
    const box = dialog.el.querySelector('#bs-error');
    if (!reference) {
      box.textContent = 'A reference is required — the payer’s portal number, or the courier’s.';
      box.hidden = false;
      return;
    }
    if (!at || Date.parse(at) > Date.now() + 60000) {
      box.textContent = 'The submission date cannot be in the future.';
      box.hidden = false;
      return;
    }
    const row = batches.markSubmitted(batchNo, { method, reference, at: new Date(at).toISOString() });
    dialog.close(row);
    if (row) toast(`${batchNo} submitted — ${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'} now with ${payerName(batch.payerId)}`, 'success');
  });
  return dialog.closed;
}

/** askExclude(batchNo, claimNo) → Promise<batch|null>. A reason is required. */
export async function askExclude(batchNo, claimNo) {
  const batch = batches.get(batchNo);
  if (!batch || !batches.isOpen(batch)) {
    toast('Only an open batch lets a claim go', 'warning');
    return null;
  }
  const dialog = modal.open({
    title: `Exclude ${claimNo} from ${batchNo}`,
    sub: 'The claim goes back to the ready queue for the next batch',
    icon: 'remove_circle',
    tone: 'warning',
    body: `
      <p class="t-body-sm">Say why. The reason is written to the batch’s history and the claim’s.${
        batch.status === 'Generated' ? ' The batch is Generated, so the files are generated again afterwards.' : ''}</p>
      <label class="field field--area">
        <textarea id="be-reason" rows="3" placeholder="Reason for excluding" aria-label="Reason"></textarea>
      </label>
      <div class="field-error" id="be-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="exclude">Exclude claim</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="exclude"]')) return;
    const reason = dialog.el.querySelector('#be-reason').value.trim();
    if (!reason) {
      const box = dialog.el.querySelector('#be-error');
      box.textContent = 'A reason is required.';
      box.hidden = false;
      return;
    }
    const row = batches.exclude(batchNo, claimNo, reason);
    dialog.close(row);
    if (row) toast(`${claimNo} excluded — back in the queue`, 'success');
  });
  return dialog.closed;
}

/** askReject(batchNo, claimNo?) → Promise<batch|null>: claim, code → reason autofill, document. */
export async function askReject(batchNo, claimNo = '') {
  const batch = batches.get(batchNo);
  if (!batch || !batches.ANSWERABLE.includes(batch.status)) {
    toast('A batch takes rejections once it has gone out', 'warning');
    return null;
  }
  const open = batches.claimsOf(batch).filter((c) => ['Submitted', 'Acknowledged'].includes(c.status));
  if (!open.length) {
    toast('Every claim in this batch has already been answered', 'warning');
    return null;
  }
  const dialog = modal.open({
    title: `Record a rejection on ${batchNo}`,
    sub: `${payerName(batch.payerId)} · ${open.length} claim${open.length === 1 ? '' : 's'} still open to an answer`,
    icon: 'assignment_return',
    tone: 'critical',
    body: `
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">description</span>
          <select id="br-claim" aria-label="Claim">${open.map((c) => `<option value="${esc(c.claimNo)}"${c.claimNo === claimNo ? ' selected' : ''}>${
    esc(c.claimNo)} · ${esc(usd(c.totals.payerShare))}</option>`).join('')}</select>
        </label>
      </div>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">rule</span>
          <select id="br-code" aria-label="Rejection code">${batches.REJECTION_REASONS.map((r) => `<option value="${esc(r.code)}">${esc(r.code)} — ${esc(r.label)}</option>`).join('')}</select>
        </label>
      </div>
      <label class="field field--area">
        <textarea id="br-reason" rows="3" aria-label="Reason">${esc(batches.REJECTION_REASONS[0].label)}</textarea>
      </label>
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">attach_file</span>
          <input id="br-document" placeholder="Rejection notice file name (optional)" aria-label="Document">
        </label>
      </div>
      <p class="t-body-sm" id="br-fix">${esc(batches.REJECTION_REASONS[0].fixLabel)}</p>
      <div class="field-error" id="br-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--danger" data-act="reject">Record rejection</button>`,
  });
  const codeSel = dialog.el.querySelector('#br-code');
  const reasonBox = dialog.el.querySelector('#br-reason');
  codeSel.addEventListener('change', () => {
    const r = batches.rejectionReason(codeSel.value);
    reasonBox.value = r?.label || '';
    dialog.el.querySelector('#br-fix').textContent = r?.fixLabel || '';
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="reject"]')) return;
    const no = dialog.el.querySelector('#br-claim').value;
    const reason = reasonBox.value.trim();
    if (!reason) {
      const box = dialog.el.querySelector('#br-error');
      box.textContent = 'Say what the payer said.';
      box.hidden = false;
      return;
    }
    const row = batches.reject(batchNo, no, codeSel.value, reason, dialog.el.querySelector('#br-document').value.trim() || null);
    dialog.close(row);
    if (row) toast(`${no} rejected — ${codeSel.value} ${batches.rejectionLabel(codeSel.value)}`, 'critical');
  });
  return dialog.closed;
}

/** askClose(batchNo) → Promise<batch|null>. */
export async function askClose(batchNo) {
  const batch = batches.get(batchNo);
  const why = batches.closeBlocker(batch);
  if (why) {
    toast(why, 'warning');
    return null;
  }
  const ok = await modal.confirm({
    title: `Close ${batchNo}`,
    body: `${batch.claimNos.length} claim${batch.claimNos.length === 1 ? '' : 's'} answered, ${batch.rejections.length} rejection${
      batch.rejections.length === 1 ? '' : 's'} taken up. A closed batch is read-only; its claims carry on in Remittance.`,
    confirmLabel: 'Close batch',
    tone: '',
    icon: 'inventory_2',
  });
  if (!ok) return null;
  const row = batches.close(batchNo);
  if (row) toast(`${batchNo} closed`, 'success');
  return row;
}

/** The claim a row names, resolved — for the tabs that list them. */
export const claimOf = (claimNo) => claims.get(claimNo);
