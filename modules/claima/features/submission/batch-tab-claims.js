// The batch page's Claims and Rejections tabs. Claims: what the batch holds,
// each row with its cycle, its status and Exclude while the batch is open,
// then what was excluded and what was ejected, each with its reason. Rejections:
// what the payer sent back, with the fix each code points at, and Add rejection.

import * as batches from '../../../../data/repositories/batches.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { cycleBadge, cycleStripHtml } from './batch-chips.js';
import { askExclude, askReject } from './batch-actions.js';
import { askFixAndResubmit } from './fix-dialog.js';

const statusHtml = (claim) => {
  const tone = claims.statusTone(claim.status);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(claim.status)}</span>`;
};

function patientCell(claim) {
  const patient = patients.view(patients.get(claim.patientMrn), currentRole());
  return patient
    ? `<a class="crumb-link" href="#/frontis/patients/${esc(claim.patientMrn)}">${esc(patient.nameEn)}</a><br><span class="t-mono-sm">${esc(claim.patientMrn)}</span>`
    : `<span class="t-mono-sm">${esc(claim.patientMrn || '—')}</span>`;
}

const masked = (claim) => Boolean(patients.view(patients.get(claim.patientMrn), currentRole())?.masked);

// --- Claims -------------------------------------------------------------------------------

export function renderClaims(host, { batchNo, redraw }) {
  const batch = batches.get(batchNo);
  const rows = batches.claimsOf(batch);
  const open = batches.isOpen(batch);
  host.innerHTML = `
    ${rows.length ? `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Claim no.</th>
          <th scope="col">Patient</th>
          <th scope="col">Date of service</th>
          <th scope="col">Lines</th>
          <th scope="col">Payer share</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((c) => {
    // The row is this batch's cycle of the claim: a claim that went round
    // again since reads what this batch said, and where it is now.
    const here = batch.claimCycles?.[c.claimNo] || 1;
    const said = batch.rejections.find((r) => r.claimNo === c.claimNo);
    const movedOn = said && claims.cycleOf(c) > here;
    return `
        <tr data-claim="${esc(c.claimNo)}">
          <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(c.claimNo)}">${esc(c.claimNo)}</a>${cycleBadge(c)}${
    claims.cycleOf(c) > 1 ? `<br>${cycleStripHtml(c, { compact: true })}` : ''}</td>
          <td>${patientCell(c)}</td>
          <td>${date(c.dateOfService)}</td>
          <td>${c.lines.length}</td>
          <td>${masked(c) ? '<span class="badge">withheld</span>' : `<span class="t-mono-sm">${esc(usd(c.totals.payerShare))}</span>`}</td>
          <td>${movedOn
    ? `<span class="badge badge--critical" title="${esc(said.reason)}">Rejected ${esc(said.code)}</span><br><span class="t-body-sm">now ${esc(c.status)} · cycle ${claims.cycleOf(c)}</span>`
    : `${statusHtml(c)}${c.rejection ? ` <span class="badge badge--critical" title="${esc(c.rejection.reason)}">${esc(c.rejection.code)}</span>` : ''}`}</td>
          <td>
            ${open ? `<button class="btn btn--ghost btn--sm" data-act="exclude" title="Take the claim out of this batch — it goes back to the queue">
                <span class="icon icon--sm">remove_circle</span>Exclude</button>`
    : c.status === 'Rejected' ? `<button class="btn btn--ghost btn--sm" data-act="fix" title="Fix & resubmit — ${esc(batches.fixRouteOf(c.rejection?.code))}">
                <span class="icon icon--sm">build</span>Fix & resubmit</button>`
      : ['Submitted', 'Acknowledged'].includes(c.status) && batches.ANSWERABLE.includes(batch.status)
        ? `<button class="btn btn--ghost btn--sm" data-act="reject" title="Record a rejection on this claim"><span class="icon icon--sm">assignment_return</span>Reject</button>`
        : '<span class="t-body-sm">—</span>'}
          </td>
        </tr>`;
  }).join('')}
      </tbody>
    </table>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">inventory_2</span></div>
      <div class="state-view__title">Nothing in the batch</div>
      <p class="state-view__body">Every claim was excluded or ejected. Add the payer's Ready claims from the header, or leave the batch and let the next one take them.</p>
    </div>`}
    ${listHtml('Excluded', 'remove_circle', batch.exclusions, (x) => `${esc(x.claimNo)} — ${esc(x.reason)} <span class="t-body-sm">· ${esc(x.by)} · ${dateTime(x.at)}</span>`,
    'Taken out by hand before generation; each is back in the ready queue.')}
    ${listHtml('Ejected', 'sync_problem', batch.ejected, (x) => `${esc(x.claimNo)} — ${esc(x.cause)} <span class="t-body-sm">· ${dateTime(x.at)}</span>`,
    'Dropped by validation or by the acknowledgment; each went back to the portfolio or the queue with the cause.')}`;

  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    const claimNo = e.target.closest('tr[data-claim]')?.dataset.claim;
    if (!act || !claimNo) return;
    if (act === 'exclude') await askExclude(batchNo, claimNo);
    else if (act === 'reject') await askReject(batchNo, claimNo);
    else if (act === 'fix') await askFixAndResubmit(claimNo);
    redraw();
  });
}

function listHtml(title, icon, rows, line, note) {
  if (!rows.length) return '';
  return `
    <div class="toolbar">
      <span class="t-title-sm">${esc(title)}</span>
      <span class="badge">${rows.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(note)}</span>
    </div>
    <ol class="journey">${rows.map((x) => `
      <li class="journey__row">
        <span class="journey__at"><span class="icon icon--sm">${icon}</span></span>
        <span class="journey__action"><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(x.claimNo)}">${esc(x.claimNo)}</a></span>
        <span class="journey__actor"></span>
        <span class="journey__detail">${line(x)}</span>
      </li>`).join('')}
    </ol>`;
}

// --- Rejections -------------------------------------------------------------------------------

export function renderRejections(host, { batchNo, redraw }) {
  const batch = batches.get(batchNo);
  const rows = batch.rejections;
  const answerable = batches.ANSWERABLE.includes(batch.status);
  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Rejections</span>
      <span class="badge">${rows.length}</span>
      <span class="spacer"></span>
      <button class="btn btn--secondary btn--sm" data-act="add"${answerable ? '' : ' disabled'} title="${
        answerable ? 'Record a rejection the payer sent on one claim' : 'A batch takes rejections once it has gone out'}">
        <span class="icon icon--sm">add</span>Add rejection
      </button>
    </div>
    ${rows.length ? `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Claim</th>
          <th scope="col">Code</th>
          <th scope="col">Reason</th>
          <th scope="col">Fix</th>
          <th scope="col">Recorded</th>
          <th scope="col">Now</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => {
    const c = claims.get(r.claimNo);
    const reason = batches.rejectionReason(r.code);
    return `
        <tr data-claim="${esc(r.claimNo)}">
          <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(r.claimNo)}">${esc(r.claimNo)}</a></td>
          <td><span class="badge badge--critical" title="${esc(reason?.label || '')}">${esc(r.code)}</span></td>
          <td>${esc(r.reason)}${r.document ? `<br><span class="t-body-sm"><span class="icon icon--sm">attach_file</span>${esc(r.document)}</span>` : ''}</td>
          <td><span class="badge badge--accent">${esc(reason?.fixRoute || 'Review')}</span><br><span class="t-body-sm">${esc(reason?.fixLabel || '')}</span></td>
          <td><span class="t-body-sm" title="${esc(dateTime(r.at))}">${date(r.at)}</span><br><span class="t-body-sm">${esc(r.by)}</span></td>
          <td>${c ? `${statusHtml(c)}${claims.cycleOf(c) > 1 ? `<br>${cycleStripHtml(c, { compact: true })}` : ''}` : '—'}</td>
          <td>${c?.status === 'Rejected'
    ? `<button class="btn btn--ghost btn--sm" data-act="fix" title="Fix & resubmit"><span class="icon icon--sm">build</span>Fix & resubmit</button>`
    : `<span class="t-body-sm">${c ? `taken up — cycle ${claims.cycleOf(c)}` : '—'}</span>`}</td>
        </tr>`;
  }).join('')}
      </tbody>
    </table>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">assignment_return</span></div>
      <div class="state-view__title">No rejections</div>
      <p class="state-view__body">${answerable ? 'Nothing in this batch has been sent back. A rejection recorded here, or through the acknowledgment, puts its claim on the rejections worklist.' : 'A batch takes rejections once it has gone out.'}</p>
    </div>`}`;

  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add') { await askReject(batchNo); return redraw(); }
    const claimNo = e.target.closest('tr[data-claim]')?.dataset.claim;
    if (act === 'fix' && claimNo) { await askFixAndResubmit(claimNo); redraw(); }
  });
}
