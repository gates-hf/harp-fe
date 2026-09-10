// The Postings tab: the append-only list of what was posted and what was
// reversed, in order, each with its fan-out and its records; a live posting
// carries Reverse, which asks for a reason and writes the reversal as the
// second half of a pair. The File tab beside it shows a file-captured
// remittance's stored file, read-only, with its parse report.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { dateTime, esc, fileSize } from '../../../../shared/format.js';

export function postingsHtml(rem) {
  const rows = rem.postings || [];
  if (!rows.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">receipt_long</span></div>
        <div class="state-view__title">Nothing posted yet</div>
        <p class="state-view__body">Each posting is recorded here with what it did — the claims moved, the denials, the shifts, the hand-offs, the cash held — and stays even after it is reversed.</p>
      </div>`;
  }
  return `
    <table class="tbl">
      <thead><tr><th>Posting</th><th>When</th><th>By</th><th>What it did</th><th>Records</th><th>Action</th></tr></thead>
      <tbody>${rows.map((p) => `
        <tr data-posting="${esc(p.id)}">
          <td class="t-mono-sm">${esc(p.id)}${p.reversal ? `<br><span class="badge badge--critical" title="Reverses ${esc(p.reverses)}"><span class="dot"></span>Reversal</span>` : p.reversedBy ? `<br><span class="badge badge--warning" title="Reversed by ${esc(p.reversedBy)}"><span class="dot"></span>Reversed</span>` : '<br><span class="badge badge--success"><span class="dot"></span>Stands</span>'}</td>
          <td class="t-body-sm">${esc(dateTime(p.at))}</td>
          <td>${esc(p.by)}</td>
          <td class="t-body-sm">${esc(p.summary)}${p.reason ? `<br>${esc(p.reason)}` : ''}</td>
          <td class="t-body-sm">${recordsHtml(p)}</td>
          <td>${!p.reversal && !p.reversedBy && rem.status !== 'Closed'
            ? `<button class="btn btn--secondary btn--sm" data-act="reverse" data-id="${esc(p.id)}" title="Reverse every row this posting wrote, with a reason, and reopen its rows for correction"><span class="icon icon--sm">undo</span>Reverse</button>`
            : '<span class="t-body-sm">—</span>'}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function recordsHtml(p) {
  const parts = [];
  if (p.claimNos.length) parts.push(p.claimNos.map((cn) => `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(cn)}">${esc(cn)}</a>`).join(', '));
  if (p.denialIds.length) parts.push(`denials ${p.denialIds.map((d) => `<span class="t-mono-sm">${esc(d)}</span>`).join(', ')}`);
  if (p.txIds.length) parts.push(`ledger ${p.txIds.map((t) => `<span class="t-mono-sm">${esc(t)}</span>`).join(', ')}`);
  if (p.handoffIds.length) parts.push(`hand-off ${p.handoffIds.map((h) => `<a class="crumb-link t-mono-sm" href="#/defensio">${esc(h)}</a>`).join(', ')}`);
  if (p.secondaryClaimNos.length) parts.push(`secondary ${p.secondaryClaimNos.map((cn) => `<a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(cn)}">${esc(cn)}</a>`).join(', ')}`);
  if (p.unappliedIds.length) parts.push(`unapplied ${p.unappliedIds.map((u) => `<a class="crumb-link t-mono-sm" href="#/claima/remittances/unapplied">${esc(u)}</a>`).join(', ')}`);
  return parts.join('<br>') || '—';
}

/** Reverse a posting: the reason is required, the pair is written, the rows reopen. */
export async function askReverse(no, postingId) {
  const rem = remittances.get(no);
  const p = rem?.postings.find((x) => x.id === postingId);
  if (!p) return false;
  const dialog = modal.open({
    title: `Reverse ${p.id}`,
    sub: `${p.claimNos.length} claim${p.claimNos.length === 1 ? '' : 's'} go back to where they were; every ledger row, denial and unapplied row it wrote is answered`,
    icon: 'undo',
    tone: 'critical',
    body: `
      <p class="modal__lede">${esc(p.summary)}</p>
      ${p.handoffIds.length ? '<p class="t-body-sm">A hand-off already with Defensio is not withdrawn from here — the reversal names it for Defensio to close.</p>' : ''}
      <label class="field field--area">
        <textarea id="rv-reason" rows="3" placeholder="Why — required" aria-label="Reason"></textarea>
      </label>
      <div class="field-error" id="rv-error" hidden></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--danger" id="rv-save"><span class="icon icon--sm">undo</span>Reverse posting</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('#rv-save')) return;
    const reason = dialog.el.querySelector('#rv-reason').value.trim();
    const box = dialog.el.querySelector('#rv-error');
    const { error, reversal } = remittances.reversePosting(no, postingId, reason);
    box.textContent = error;
    box.hidden = !error;
    if (error) return;
    toast(`${p.id} reversed by ${reversal.id}`, 'success');
    dialog.close('done');
  });
  return (await dialog.closed) === 'done';
}

/** The stored file, read-only, with the parse report under it. */
export function fileHtml(rem) {
  const c = rem.capture;
  if (c.mode !== 'File') return '';
  const failed = c.parseReport?.failed || [];
  return `
    <dl class="dl dl--narrow">
      <dt>File</dt><dd>${esc(c.fileName)} · ${fileSize(new Blob([c.storedFile || '']).size)}</dd>
      <dt>Uploaded</dt><dd>${esc(c.by)} · ${esc(dateTime(c.at))}</dd>
      <dt>Parse report</dt><dd>${c.parseReport?.read ?? 0} records read, ${failed.length} failed</dd>
    </dl>
    ${failed.length ? `
      <table class="tbl">
        <thead><tr><th>Row</th><th>Reason</th><th>Record</th></tr></thead>
        <tbody>${failed.map((f) => `<tr><td class="t-mono-sm">${f.row || '—'}</td><td>${esc(f.reason)}</td><td class="t-mono-sm">${esc(f.raw || '')}</td></tr>`).join('')}</tbody>
      </table>
      <p class="t-body-sm">A row the file could not carry is entered by hand on this remittance — Enter lines on the grid.</p>` : ''}
    <label class="field field--area">
      <textarea readonly rows="14" aria-label="Stored file, read-only">${esc(c.storedFile || '')}</textarea>
    </label>`;
}
