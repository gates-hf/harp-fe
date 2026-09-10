// The Lines and Coding tabs of the claim page — read-only markup. Lines shows
// every line with its overage rows, the authorisation stamped on it and a Late
// chip; Coding is the snapshot the claim was assembled with and a link to the
// chart it came from.

import * as claims from '../../../../data/repositories/claims.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { doctorName } from '../../../../data/seed/reference.js';

/** linesHtml(claim, { highlight }) — `highlight` is a line id a scrub finding jumped to. */
export function linesHtml(claim, { highlight = null } = {}) {
  const lines = claim.lines || [];
  const late = new Set(claim.lateLineIds || []);
  if (!lines.length) return noLinesHtml(claim);
  return `
    <table class="tbl" data-line="header">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Date</th>
          <th scope="col">Charge</th>
          <th scope="col">Qty</th>
          <th scope="col">Gross</th>
          <th scope="col">Allowed</th>
          <th scope="col">Payer</th>
          <th scope="col">Patient</th>
          <th scope="col">Pre-auth</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map((line) => `
          <tr data-line="${esc(line.id)}"${line.id === highlight ? ' aria-selected="true"' : ''}>
            <td class="t-mono-sm">${esc(line.id)}</td>
            <td>${date(line.dateOfService || claim.dateOfService)}</td>
            <td>
              ${line.isOverage ? '<span class="badge badge--warning" title="An overage line — consumption beyond what the package includes">Overage</span> ' : ''}
              <span class="t-mono-sm">${esc(line.chargeCode || cdm.get(line.itemId)?.chargeCode || line.itemId)}</span>
              ${esc(line.description || cdm.label(cdm.get(line.itemId)) || '')}
              ${late.has(line.id) || line.late ? ' <span class="badge badge--warning" title="Landed after the claim was first assembled">Late</span>' : ''}
            </td>
            <td class="t-mono-sm">${esc(line.qty)}</td>
            <td class="t-mono-sm">${esc(usd(line.grossBilled))}</td>
            <td class="t-mono-sm">${esc(usd(line.allowedExpected))}</td>
            <td class="t-mono-sm">${esc(usd(line.payerShare))}</td>
            <td class="t-mono-sm">${esc(usd(line.patientShare))}</td>
            <td>${authHtml(line)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot data-line="totals">
        <tr>
          <td colspan="4"><strong>Totals</strong></td>
          <td class="t-mono-sm">${esc(usd(claim.totals.gross))}</td>
          <td class="t-mono-sm">${esc(usd(claim.totals.allowedExpected))}</td>
          <td class="t-mono-sm"><strong>${esc(usd(claim.totals.payerShare))}</strong></td>
          <td class="t-mono-sm">${esc(usd(claim.totals.patientShare))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    ${excludedHtml(claim)}`;
}

function authHtml(line) {
  if (line.authNumber) {
    return `<span class="badge badge--success" title="Authorisation ${esc(line.authNo || '')} covers this line">${esc(line.authNumber)}</span>`;
  }
  if (line.preAuthRequired) return '<span class="badge badge--critical" title="The contract requires pre-authorisation and none on file covers this line">Required — none</span>';
  return '<span class="t-body-sm">Not required</span>';
}

/** What the assembler left out of the claim, and why — the reader asks. */
function excludedHtml(claim) {
  const rows = claim.excluded || [];
  if (!rows.length) return '';
  return `
    <details>
      <summary class="t-body-sm">${rows.length} released line${rows.length === 1 ? '' : 's'} not on this claim</summary>
      <table class="tbl">
        <thead><tr><th>Charge</th><th>Why</th></tr></thead>
        <tbody>${rows.map((r) => {
    const item = cdm.get(r.itemId);
    return `<tr><td><span class="t-mono-sm">${esc(item?.chargeCode || r.itemId)}</span> ${esc(cdm.label(item) || '')}</td><td>${esc(r.reason)}</td></tr>`;
  }).join('')}</tbody>
      </table>
    </details>`;
}

function noLinesHtml(claim) {
  const secondary = claims.kindOf(claim) === 'Secondary';
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${secondary ? 'account_tree' : 'receipt_long'}</span></div>
      <div class="state-view__title">${secondary ? 'No lines until the primary is remitted' : 'No lines'}</div>
      <p class="state-view__body">${secondary
        ? 'A secondary claim is defined at assembly and filled by the primary’s remittance: what the first payer leaves unpaid becomes its lines.'
        : 'Nothing released on the visit carried a payer share. Refresh once charges are released.'}</p>
    </div>
    ${excludedHtml(claim)}`;
}

// --- coding -------------------------------------------------------------------

export function codingHtml(claim) {
  const c = claim.coding;
  const open = claim.encounterNo
    ? `<a class="btn btn--secondary btn--sm" href="#/claima/coding/${esc(claim.encounterNo)}"><span class="icon icon--sm">open_in_new</span>Open coding</a>`
    : '';
  if (!c) {
    return `
      <div class="toolbar"><span class="t-title-sm">Coding snapshot</span><span class="spacer"></span>${open}</div>
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">medical_information</span></div>
        <div class="state-view__title">Not coded</div>
        <p class="state-view__body">The claim carries no coding. Once the chart is marked coded, refresh the claim to take the version in.</p>
      </div>`;
  }
  const dxRow = (d, principal) => `
    <tr>
      <td class="t-mono-sm">${esc(d.code)}</td>
      <td>${esc(d.desc || '')}</td>
      <td>${principal ? '<span class="badge badge--accent">Principal</span>' : ''}</td>
      <td>${claim.encounterType === 'IP' ? poaHtml(d.poa) : '<span class="t-body-sm">—</span>'}</td>
    </tr>`;
  const lineOf = (id) => (claim.lines || []).find((l) => l.id === id || l.chargeLineId === id);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Coding snapshot</span>
      <span class="badge">v${esc(c.version)}</span>
      <span class="t-body-sm">${c.codedAt ? `coded ${dateTime(c.codedAt)} by ${esc(c.codedBy || '—')}` : 'not yet marked coded'}</span>
      <span class="spacer"></span>
      ${open}
    </div>
    <p class="t-body-sm">What the claim was assembled with. The chart may have moved on — a refresh takes the newest coded version in and shows what changed.</p>
    <table class="tbl">
      <thead><tr><th>Diagnosis</th><th>Description</th><th></th><th>POA</th></tr></thead>
      <tbody>
        ${c.principal ? dxRow(c.principal, true) : '<tr><td colspan="4"><span class="badge badge--critical">No principal diagnosis</span></td></tr>'}
        ${(c.secondaries || []).map((d) => dxRow(d, false)).join('')}
      </tbody>
    </table>
    ${(c.procedures || []).length ? `
      <div class="toolbar"><span class="t-title-sm">Procedures</span></div>
      <table class="tbl">
        <thead><tr><th>Code</th><th>Description</th><th>Date</th><th>Doctor</th><th>Linked lines</th></tr></thead>
        <tbody>${c.procedures.map((p) => `
          <tr>
            <td class="t-mono-sm">${esc(p.code)}</td>
            <td>${esc(p.desc || '')}</td>
            <td>${p.date ? date(p.date) : '—'}</td>
            <td>${esc(doctorName(p.doctorId))}</td>
            <td>${(p.chargeLineIds || []).map((id) => {
    const line = lineOf(id);
    return line
      ? `<span class="badge" title="${esc(line.description || '')}">${esc(line.id)} · ${esc(line.chargeCode || '')}</span>`
      : `<span class="badge badge--warning" title="Not a line on this claim">${esc(id)}</span>`;
  }).join(' ') || '<span class="badge badge--critical">None</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="t-body-sm">No procedures coded.</p>'}`;
}

const poaHtml = (poa) => (poa
  ? `<span class="badge${poa === 'Y' ? ' badge--success' : poa === 'N' ? '' : ' badge--warning'}">${esc(poa)}</span>`
  : '<span class="badge badge--warning" title="POA indicator missing">—</span>');
