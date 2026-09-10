// The batch page's Files, Submission and Acknowledgment tabs. Files: every
// generation, newest first, each file with Download and Preview — the printed
// kinds open in the shared drawer with a Print button. Submission: the form
// that marks the batch submitted, or the record once it is. Acknowledgment:
// the reconciliation strip and the record, or the button that opens the form.

import * as batches from '../../../../data/repositories/batches.js';
import * as drawer from '../../../../shared/drawer.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc, fileSize, usd } from '../../../../shared/format.js';
import { previewBody } from '../../../../data/engines/submission-files.js';
import { askAcknowledge } from './acknowledge-dialog.js';
import { payerName } from './batch-chips.js';

const MIME = { jsonl: 'application/jsonl', csv: 'text/csv;charset=utf-8;', html: 'text/html;charset=utf-8;' };
const KIND_LABEL = { Submission: 'Submission file', Manifest: 'Manifest', Forms: 'Claim forms', CoverSheets: 'Cover sheets', BatchCover: 'Batch cover' };
const PRINTED = new Set(['Forms', 'CoverSheets', 'BatchCover']);

// --- Files -------------------------------------------------------------------------------

export function renderFiles(host, { batchNo }) {
  const batch = batches.get(batchNo);
  const gens = batches.generations(batch);
  host.innerHTML = gens.length ? gens.map((g, i) => `
    <details${i === 0 ? ' open' : ''}>
      <summary class="panel-header">
        <span>Version ${g.version}</span>
        ${i === 0 ? '<span class="badge badge--success">current</span>' : '<span class="badge">superseded</span>'}
        <span class="spacer"></span>
        <span class="t-body-sm">${dateTime(g.at)} · ${esc(g.by)}</span>
      </summary>
      <table class="tbl">
        <thead><tr><th scope="col">File</th><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Actions</th></tr></thead>
        <tbody>${g.files.map((f) => `
          <tr data-file="${esc(f.fileName)}">
            <td class="t-mono-sm">${esc(f.fileName)}</td>
            <td>${esc(KIND_LABEL[f.kind] || f.kind)}</td>
            <td class="t-mono-sm">${esc(fileSize(new Blob([f.content]).size))}</td>
            <td>
              <button class="btn btn--ghost btn--sm" data-act="preview" title="${PRINTED.has(f.kind) ? 'Preview the printable pages' : 'Preview the file'}">
                <span class="icon icon--sm">${PRINTED.has(f.kind) ? 'print' : 'visibility'}</span>${PRINTED.has(f.kind) ? 'Preview & print' : 'Preview'}</button>
              <button class="btn btn--ghost btn--sm" data-act="download" title="Download ${esc(f.fileName)}">
                <span class="icon icon--sm">download</span>Download</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </details>`).join('') : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">description</span></div>
      <div class="state-view__title">Nothing generated yet</div>
      <p class="state-view__body">${batch.mode === 'Electronic'
    ? 'Generate writes the submission file — one claim per line with its lines — and the manifest the payer reconciles against.'
    : 'Generate writes a printable claim form per claim, a cover sheet listing what each travels with, and the batch cover.'} Each generation is a new version; earlier versions are kept.</p>
    </div>`;

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const name = e.target.closest('tr[data-file]')?.dataset.file;
    if (!act || !name) return;
    const file = batch.files.find((f) => f.fileName === name);
    if (!file) return;
    if (act === 'download') download(file);
    else openPreview(file, batch);
  });
}

function download(file) {
  const ext = file.fileName.split('.').pop();
  const url = URL.createObjectURL(new Blob([file.content], { type: MIME[ext] || 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * The preview in the shared drawer. A printed kind gets a Print button that
 * hands the printer the pages alone: `app/app.css` drops anything marked
 * `data-print="hide"`, so the page behind the drawer and the drawer's own
 * chrome are marked while it is open — the receipt's pattern.
 */
function openPreview(file, batch) {
  const printed = PRINTED.has(file.kind);
  const page = document.querySelector('.main');
  if (printed) page?.setAttribute('data-print', 'hide');
  const sheet = drawer.open({
    title: `${KIND_LABEL[file.kind] || file.kind} — ${esc(batch.batchNo)} v${file.version}`,
    sub: `${esc(file.fileName)} · generated ${esc(dateTime(file.generatedAt))} by ${esc(file.by)}`,
    icon: printed ? 'print' : 'description',
    body: printed ? previewBody(file.content) : `<pre class="t-mono-sm">${esc(file.content)}</pre>`,
    foot: `
      <button class="btn btn--secondary" data-close data-print="hide">Close</button>
      ${printed ? '<button class="btn btn--primary" data-act="print" data-print="hide"><span class="icon icon--sm">print</span>Print</button>' : ''}`,
  });
  if (printed) {
    for (const part of sheet.el.querySelectorAll('.drawer__head, .drawer__foot')) part.setAttribute('data-print', 'hide');
    sheet.el.querySelector('[data-act="print"]')?.addEventListener('click', () => window.print());
    sheet.closed.then(() => page?.removeAttribute('data-print'));
  }
}

// --- Submission ---------------------------------------------------------------------------------

export function renderSubmission(host, { batchNo, redraw }) {
  const batch = batches.get(batchNo);
  const s = batch.submission;
  if (s) {
    host.innerHTML = `
      <dl class="dl dl--narrow">
        <dt>Submitted</dt><dd>${dateTime(s.at)}</dd>
        <dt>By</dt><dd>${esc(s.by)}</dd>
        <dt>Method</dt><dd>${esc(s.method)}</dd>
        <dt>Reference</dt><dd class="t-mono-sm">${esc(s.reference || '—')}</dd>
        <dt>Files</dt><dd>Version ${s.fileVersion ?? '—'}</dd>
        <dt>Claims</dt><dd>${batch.claimNos.length} · <span class="t-mono-sm">${esc(usd(batches.valueOf(batch)))}</span> payer share</dd>
      </dl>
      <p class="t-body-sm">Every claim in the batch moved to Submitted on this date and reads this batch and this method on its cycle.</p>`;
    return;
  }
  const why = batches.submitBlocker(batch);
  const methods = batches.methodsFor(batch.payerId);
  const gen = batches.latestGeneration(batch);
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  host.innerHTML = `
    ${why ? `<div class="alert alert--info"><span class="icon">info</span><div>${esc(why)}. ${batch.status === 'Open' ? 'The files have to exist before the batch can be marked as sent.' : ''}</div></div>` : ''}
    <div class="toolbar">
      <span class="t-title-sm">Mark submitted</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${gen ? `files v${gen.version}` : 'no files yet'} · ${esc(payerName(batch.payerId))} · ${esc(batch.mode)}</span>
    </div>
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">${batch.mode === 'Electronic' ? 'cloud_upload' : 'local_shipping'}</span>
        <select id="bt-method" aria-label="Method"${why ? ' disabled' : ''}>${methods.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
      </label>
      <label class="field field--grow">
        <span class="icon icon--sm">tag</span>
        <input id="bt-reference" placeholder="${batch.mode === 'Electronic' ? 'Portal or transfer reference' : 'Courier or delivery reference'}" aria-label="Reference"${why ? ' disabled' : ''}>
      </label>
      <label class="field">
        <span class="icon icon--sm">event</span>
        <input type="datetime-local" id="bt-at" value="${local}" aria-label="Submitted at"${why ? ' disabled' : ''}>
      </label>
      <button class="btn btn--primary btn--sm" data-act="submit"${why ? ' disabled' : ''} title="${esc(why || 'Every claim moves to Submitted on this date')}">
        <span class="icon icon--sm">send</span>Mark submitted
      </button>
    </div>
    <div class="field-error" id="bt-error" hidden></div>
    <p class="t-body-sm">The reference is what the payer's acknowledgment will quote — the portal's receipt number, or the courier's.</p>`;

  host.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="submit"]')) return;
    const reference = host.querySelector('#bt-reference').value.trim();
    const at = host.querySelector('#bt-at').value;
    const box = host.querySelector('#bt-error');
    if (!reference) {
      box.textContent = 'A reference is required.';
      box.hidden = false;
      return;
    }
    if (!at || Date.parse(at) > Date.now() + 60000) {
      box.textContent = 'The submission date cannot be in the future.';
      box.hidden = false;
      return;
    }
    const row = batches.markSubmitted(batchNo, { method: host.querySelector('#bt-method').value, reference, at: new Date(at).toISOString() });
    if (row) toast(`${batchNo} submitted — ${row.claimNos.length} claim${row.claimNos.length === 1 ? '' : 's'} now with ${payerName(batch.payerId)}`, 'success');
    redraw();
  });
}

// --- Acknowledgment -----------------------------------------------------------------------------

export function renderAcknowledgment(host, { batchNo, redraw }) {
  const batch = batches.get(batchNo);
  const a = batch.acknowledgment;
  const notReceived = batch.ejected.filter((x) => x.cause === 'Not received by the payer');
  const included = batch.claimNos.length + notReceived.length;
  const ackable = ['Submitted', 'Partially Rejected'].includes(batch.status) && !a;
  host.innerHTML = `
    <div class="alert alert--${a ? 'success' : 'info'}">
      <span class="icon">${a ? 'task_alt' : 'balance'}</span>
      <div>
        <div class="title">Included ${included} = accepted ${a ? a.acceptedCount : '?'} + rejected ${a ? a.rejectedCount : '?'} + ejected ${a ? notReceived.length : '?'}</div>
        ${a ? 'The counts reconciled with the answers when the acknowledgment was recorded.'
    : 'The acknowledgment is recorded against what was sent: what the payer received, accepted and rejected has to add up to what the batch held, and a claim the payer never received goes back to the queue.'}
      </div>
    </div>
    ${a ? `
    <dl class="dl dl--narrow">
      <dt>Acknowledged</dt><dd>${dateTime(a.at)}</dd>
      <dt>Payer ref</dt><dd class="t-mono-sm">${esc(a.payerRef || '—')}</dd>
      <dt>Received</dt><dd>${a.receivedCount} of ${included}</dd>
      <dt>Accepted</dt><dd>${a.acceptedCount}</dd>
      <dt>Rejected</dt><dd>${a.rejectedCount}${batch.rejections.length ? ` — ${batch.rejections.map((r) => `${esc(r.claimNo)} (${esc(r.code)})`).join(', ')}` : ''}</dd>
      ${notReceived.length ? `<dt>Not received</dt><dd>${notReceived.map((x) => esc(x.claimNo)).join(', ')} — back to the queue</dd>` : ''}
      <dt>Document</dt><dd>${a.document ? `<span class="icon icon--sm">attach_file</span>${esc(a.document)}` : '—'}</dd>
      <dt>Recorded by</dt><dd>${esc(a.by)}</dd>
    </dl>` : `
    <div class="toolbar">
      <span class="t-body-sm">${batch.submission ? `Submitted ${date(batch.submission.at)} · ${esc(batch.submission.method)} · ${esc(batch.submission.reference || '')}` : 'Not submitted yet'}</span>
      <span class="spacer"></span>
      <button class="btn btn--primary btn--sm" data-act="acknowledge"${ackable ? '' : ' disabled'} title="${
        ackable ? 'Record the payer’s acknowledgment' : batch.submission ? `A ${batch.status.toLowerCase()} batch is not acknowledged` : 'Submit the batch first'}">
        <span class="icon icon--sm">mark_email_read</span>Record acknowledgment
      </button>
    </div>`}`;

  host.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="acknowledge"]')) return;
    await askAcknowledge(batchNo);
    redraw();
  });
}
