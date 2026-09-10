// The evidence pane of the workspace — read-only, what the coder codes from:
// who the patient is, what the visit was, the charge lines that were released
// and the documents on file, with the one being read open underneath the
// list. Markup only; coding-workspace.js owns the state and the clicks.

import * as coding from '../../../../data/repositories/coding.js';
import * as docs from '../../../../data/repositories/clinical-docs.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { age, date, dateTime, esc, usd } from '../../../../shared/format.js';

export function evidenceHtml({ enc, patient, lines, documents, draft, docId }) {
  return `
    ${patientHtml(patient, enc)}
    <div class="toolbar"><span class="t-title-sm">Visit</span></div>
    ${visitHtml(enc)}
    <div class="toolbar">
      <span class="t-title-sm">Released charge lines</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${lines.length} line${lines.length === 1 ? '' : 's'} · ${esc(usd(lines.reduce((s, l) => s + l.amount, 0)))}</span>
    </div>
    ${linesHtml(lines, draft)}
    <div class="toolbar">
      <span class="t-title-sm">Documents</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${documents.length} on file</span>
    </div>
    ${documentsHtml(documents, docId)}
    ${previewHtml(docs.get(docId))}`;
}

function patientHtml(patient, enc) {
  if (!patient) return `<p class="t-body-sm">${esc(enc.patientMrn)} is no longer on the register.</p>`;
  return `
    <dl class="dl dl--narrow">
      <dt>Patient</dt><dd>${esc(patient.nameEn)}${patient.vip && !patient.masked ? ' <span class="badge badge--accent">VIP</span>' : ''}
        ${patient.masked ? ' <span class="badge" title="A restricted record reads masked for this role">restricted</span>' : ''}</dd>
      <dt>MRN</dt><dd class="t-mono-sm">${esc(patient.mrn)}</dd>
      <dt>Gender, age</dt><dd>${esc(patient.gender)}${age(patient.dob) === '—' ? '' : `, ${age(patient.dob)}`}
        <span class="t-body-sm">(born ${date(patient.dob)})</span></dd>
    </dl>`;
}

function visitHtml(enc) {
  return `
    <dl class="dl dl--narrow">
      <dt>Type</dt><dd>${esc(encounters.typeLabel(enc.type))}</dd>
      <dt>Department</dt><dd>${esc(enc.department)}</dd>
      <dt>Attending</dt><dd>${esc(doctorName(enc.doctorId))}</dd>
      ${enc.visitReason ? `<dt>Visit reason</dt><dd>${esc(enc.visitReason)}</dd>` : ''}
      <dt>Admitted</dt><dd class="t-mono-sm">${dateTime(enc.startAt)}</dd>
      <dt>${enc.type === 'OP' ? 'Completed' : 'Discharged'}</dt><dd class="t-mono-sm">${dateTime(enc.endAt)}</dd>
      ${enc.los ? `<dt>Length of stay</dt><dd>${enc.los} day${enc.los === 1 ? '' : 's'}</dd>` : ''}
      ${enc.type === 'IP' ? `<dt>Ward</dt><dd>${esc(enc.ward || '—')}${enc.bedClass ? ` · ${esc(enc.bedClass)}` : ''}</dd>` : ''}
    </dl>`;
}

/**
 * Every released line. A line in a linkable category says whether a
 * procedure on the right already accounts for it — the same fact the
 * validation panel blocks on, read here beside the line.
 */
function linesHtml(lines, draft) {
  if (!lines.length) return '<p class="t-body-sm">No charge has been released on this visit.</p>';
  const linked = new Set((draft?.procedures || []).flatMap((p) => p.chargeLineIds || []));
  return `
    <table class="tbl">
      <thead><tr>
        <th scope="col">Code</th><th scope="col">Charge</th><th scope="col">Qty</th>
        <th scope="col">Amount</th><th scope="col">Procedure</th>
      </tr></thead>
      <tbody>
        ${lines.map((l) => `
          <tr data-line="${esc(l.id)}">
            <td class="t-mono-sm">${esc(l.chargeCode)}</td>
            <td>${esc(l.description)}${l.isOverage ? ' <span class="badge">overage</span>' : ''}
              <br><span class="t-body-sm">${esc(l.category)} · ${esc(l.id)}</span></td>
            <td class="t-mono-sm">${esc(l.qty)}</td>
            <td class="t-mono-sm">${esc(usd(l.amount))}</td>
            <td>${coding.isLinkable(l)
              ? (linked.has(l.id)
                ? '<span class="badge badge--success"><span class="dot"></span>Linked</span>'
                : '<span class="badge badge--warning" title="A procedure code has to account for this line before the chart is coded"><span class="dot"></span>Needs code</span>')
              : '<span class="t-body-sm">—</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function documentsHtml(documents, docId) {
  if (!documents.length) {
    return '<p class="t-body-sm">Nothing is on file for this visit. A Missing Documentation query asks the physician for it.</p>';
  }
  return `
    <table class="tbl">
      <thead><tr><th scope="col">Document</th><th scope="col">Date</th><th scope="col">Author</th><th scope="col"></th></tr></thead>
      <tbody>
        ${documents.map((d) => `
          <tr data-doc="${esc(d.id)}" tabindex="0" title="Read ${esc(d.title)}"${d.id === docId ? ' aria-current="true"' : ''}>
            <td><span class="icon icon--sm">${docs.iconOf(d.type)}</span> ${esc(d.type)}<br>
              <span class="t-body-sm">${esc(d.title)}</span></td>
            <td class="t-mono-sm">${date(d.date)}</td>
            <td>${esc(d.author)}</td>
            <td><button class="btn btn--ghost btn--icon btn--sm" data-act="read-doc" title="${d.id === docId ? 'Close' : 'Read'}">
              <span class="icon icon--sm">${d.id === docId ? 'close' : 'visibility'}</span></button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/** The inline viewer: the document's text, a paragraph per blank line. */
function previewHtml(doc) {
  if (!doc) return '';
  const paragraphs = String(doc.textPreview || '').split(/\n\s*\n/).filter(Boolean);
  return `
    <div class="panel panel--sunken" id="cx-doc-preview" tabindex="-1">
      <div class="panel-header">
        <span class="icon icon--sm">${docs.iconOf(doc.type)}</span>
        <span>${esc(doc.title)}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${esc(doc.fileName)} · ${date(doc.date)} · ${esc(doc.author)}</span>
      </div>
      <div class="panel-body">
        ${paragraphs.length
          ? paragraphs.map((p) => `<p class="t-body-sm">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
          : '<p class="t-body-sm">No text preview is available for this file.</p>'}
      </div>
    </div>`;
}
