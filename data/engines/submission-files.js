// Engine — the files a submission batch generates (amendment 28). Pure: it
// reads the registers a claim names and writes nothing. An electronic payer
// gets a submission file (JSON lines, one claim per line, with its lines) and
// a manifest (CSV, one row per claim); a manual payer gets the claim forms
// (one printable page per claim), the cover sheets (the attachments each
// claim travels with) and the batch cover (the manifest as a page).
//
// Every builder returns { kind, fileName, content } and the repository stamps
// the version, the time and the user — a generation is a set of these, kept
// whole, and a regeneration is the next set beside it.

import * as patients from '../repositories/patients.js';
import * as payers from '../repositories/payers.js';
import * as policies from '../repositories/policies.js';
import * as contracts from '../repositories/contracts.js';
import * as cdm from '../repositories/cdm.js';
import { date, esc, usd } from '../../shared/format.js';

export const FILE_KINDS = ['Submission', 'Manifest', 'Forms', 'CoverSheets', 'BatchCover'];

/** The kinds a mode produces, in the order they are listed. */
export const kindsFor = (mode) => (mode === 'Electronic' ? ['Submission', 'Manifest'] : ['Forms', 'CoverSheets', 'BatchCover']);

const EXT = { Submission: 'jsonl', Manifest: 'csv', Forms: 'html', CoverSheets: 'html', BatchCover: 'html' };
const SUFFIX = { Submission: '', Manifest: '_manifest', Forms: '_forms', CoverSheets: '_covers', BatchCover: '_cover' };

export const fileNameFor = (batchNo, kind, version) => `${batchNo}${SUFFIX[kind] ?? ''}_v${version}.${EXT[kind] || 'txt'}`;

/** build(batch, claims, { version, at }) → the files for the batch's mode. */
export function build(batch, claims, { version = 1, at = new Date().toISOString() } = {}) {
  const ctx = { batch, claims, version, at, payer: payers.get(batch.payerId) };
  return kindsFor(batch.mode).map((kind) => ({
    kind,
    fileName: fileNameFor(batch.batchNo, kind, version),
    content: BUILDERS[kind](ctx),
  }));
}

// --- what a claim says about itself ------------------------------------------------

/** The header every file reads a claim by. */
export function claimRecord(claim) {
  const patient = patients.get(claim.patientMrn);
  const policy = claim.policyId ? policies.get(claim.policyId) : null;
  const contract = claim.contractId ? contracts.get(claim.contractId) : null;
  const payer = payers.get(claim.payerId);
  const plan = payer?.plans.find((p) => p.id === claim.planId);
  return {
    claimNo: claim.claimNo,
    cycle: claim.cycle || 1,
    previousCycleNo: claim.previousCycleNo || null,
    kind: claim.kind || 'Primary',
    payer: payer?.nameEn || claim.payerId,
    plan: plan?.name || claim.planId,
    memberId: policy?.memberId || null,
    policyNo: policy?.policyNo || null,
    patient: patient ? { mrn: patient.mrn, name: patient.nameEn, dob: patient.dob, gender: patient.gender } : { mrn: claim.patientMrn },
    encounterNo: claim.encounterNo,
    dateOfService: claim.dateOfService,
    dateOfServiceTo: claim.dateOfServiceTo || claim.dateOfService,
    contractNo: claim.contractNo || contract?.contractNo || null,
    contractVersion: claim.contractVersion ?? contract?.version ?? null,
    diagnoses: claim.coding ? [claim.coding.principal, ...(claim.coding.secondaries || [])].filter(Boolean) : [],
    procedures: claim.coding?.procedures || [],
    lines: claim.lines.map(lineRecord),
    attachments: (claim.attachments || []).map((a) => ({ fileName: a.fileName, type: a.type, lineIds: a.lineIds || [] })),
    totals: { ...claim.totals },
  };
}

function lineRecord(line) {
  const item = cdm.get(line.itemId);
  return {
    id: line.id,
    code: line.chargeCode || item?.chargeCode || line.itemId,
    description: line.description || cdm.label(item) || line.itemId,
    qty: line.qty,
    dateOfService: line.dateOfService || null,
    gross: line.grossBilled,
    allowed: line.allowedExpected,
    payerShare: line.payerShare,
    patientShare: line.patientShare,
    isOverage: Boolean(line.isOverage),
    authNo: line.authNumber || line.authNo || null,
  };
}

// --- electronic ----------------------------------------------------------------------

const BUILDERS = {
  Submission({ batch, claims, version, at }) {
    const header = {
      record: 'BATCH', batchNo: batch.batchNo, version, generatedAt: at, payerId: batch.payerId,
      claims: claims.length, payerShare: sum(claims, 'payerShare'),
    };
    return [header, ...claims.map((c) => ({ record: 'CLAIM', ...claimRecord(c) }))]
      .map((row) => JSON.stringify(row)).join('\n');
  },

  Manifest({ batch, claims, version, at }) {
    const rows = [
      csvLine(['Batch', batch.batchNo, 'Version', version, 'Generated', at]),
      csvLine(['Claim no.', 'Cycle', 'MRN', 'Patient', 'Member ID', 'Encounter', 'Date of service', 'Lines', 'Gross', 'Allowed', 'Payer share', 'Attachments']),
      ...claims.map((c) => {
        const r = claimRecord(c);
        return csvLine([r.claimNo, r.cycle, r.patient.mrn, r.patient.name || '', r.memberId || '', r.encounterNo || '',
          r.dateOfService, r.lines.length, r.totals.gross, r.totals.allowedExpected, r.totals.payerShare, r.attachments.length]);
      }),
      csvLine(['Total', '', '', '', '', '', '', sum(claims, 'lines'), sum(claims, 'gross'), sum(claims, 'allowedExpected'), sum(claims, 'payerShare'), '']),
    ];
    return rows.join('\n');
  },

  // --- manual -------------------------------------------------------------------

  Forms({ batch, claims, version, at, payer }) {
    return docHtml(`Claim forms — ${batch.batchNo}`, claims.map((c) => formHtml(claimRecord(c), batch, payer, version, at)).join('\n'));
  },

  CoverSheets({ batch, claims, version, at, payer }) {
    return docHtml(`Cover sheets — ${batch.batchNo}`, claims.map((c) => coverSheetHtml(claimRecord(c), batch, payer, version, at)).join('\n'));
  },

  BatchCover({ batch, claims, version, at, payer }) {
    const records = claims.map(claimRecord);
    return docHtml(`Batch cover — ${batch.batchNo}`, `
      <section class="doc-page">
        <h2>Batch cover — ${esc(batch.batchNo)}</h2>
        <dl class="dl dl--narrow">
          <dt>To</dt><dd>${esc(payer?.nameEn || batch.payerId)}${payer?.address ? `<br>${esc(payer.address)}` : ''}</dd>
          <dt>From</dt><dd>HARP Hospital — Revenue cycle</dd>
          <dt>Generated</dt><dd>${esc(date(at))} · version ${version}</dd>
          <dt>Claims</dt><dd>${records.length}</dd>
          <dt>Payer share</dt><dd>${esc(usd(sum(claims, 'payerShare')))}</dd>
        </dl>
        <table class="tbl">
          <thead><tr><th>#</th><th>Claim no.</th><th>Cycle</th><th>Patient</th><th>Member ID</th><th>Date of service</th><th>Lines</th><th>Payer share</th><th>Attachments</th></tr></thead>
          <tbody>${records.map((r, i) => `
            <tr><td>${i + 1}</td><td>${esc(r.claimNo)}</td><td>${r.cycle}</td><td>${esc(r.patient.name || r.patient.mrn)}</td>
              <td>${esc(r.memberId || '—')}</td><td>${esc(date(r.dateOfService))}</td><td>${r.lines.length}</td>
              <td>${esc(usd(r.totals.payerShare))}</td><td>${r.attachments.length}</td></tr>`).join('')}
          </tbody>
        </table>
        <p>Received by ________________________  Date ____________  Payer reference ____________</p>
      </section>`);
  },
};

function formHtml(r, batch, payer, version, at) {
  // A column nothing in the claim fills is left off the form.
  const dated = r.lines.some((l) => l.dateOfService);
  const authed = r.lines.some((l) => l.authNo);
  return `
    <section class="doc-page" data-claim="${esc(r.claimNo)}">
      <h2>Claim form — ${esc(r.claimNo)}${r.cycle > 1 ? ` (cycle ${r.cycle}, resubmission of cycle ${esc(r.previousCycleNo)})` : ''}</h2>
      <dl class="dl dl--narrow">
        <dt>Payer</dt><dd>${esc(payer?.nameEn || batch.payerId)} · ${esc(r.plan)}</dd>
        <dt>Member</dt><dd>${esc(r.memberId || '—')}${r.policyNo ? ` · policy ${esc(r.policyNo)}` : ''}</dd>
        <dt>Patient</dt><dd>${esc(r.patient.name || '—')} · ${esc(r.patient.mrn)}${r.patient.dob ? ` · born ${esc(date(r.patient.dob))}` : ''}${r.patient.gender ? ` · ${esc(r.patient.gender)}` : ''}</dd>
        <dt>Encounter</dt><dd>${esc(r.encounterNo || '—')} · ${esc(date(r.dateOfService))}${r.dateOfServiceTo !== r.dateOfService ? ` – ${esc(date(r.dateOfServiceTo))}` : ''}</dd>
        <dt>Contract</dt><dd>${r.contractNo ? `${esc(r.contractNo)} v${esc(r.contractVersion)}` : '—'}</dd>
        <dt>Diagnoses</dt><dd>${r.diagnoses.length ? r.diagnoses.map((d) => `${esc(d.code)} ${esc(d.desc || '')}`).join('<br>') : '—'}</dd>
        <dt>Procedures</dt><dd>${r.procedures.length ? r.procedures.map((p) => `${esc(p.code)} ${esc(p.desc || '')}${p.date ? ` · ${esc(date(p.date))}` : ''}`).join('<br>') : '—'}</dd>
      </dl>
      <table class="tbl">
        <thead><tr><th>Line</th><th>Code</th><th>Description</th><th>Qty</th>${dated ? '<th>Date</th>' : ''}<th>Gross</th><th>Allowed</th><th>Payer</th><th>Patient</th>${authed ? '<th>Auth</th>' : ''}</tr></thead>
        <tbody>${r.lines.map((l) => `
          <tr><td>${esc(l.id)}</td><td>${esc(l.code)}</td><td>${esc(l.description)}${l.isOverage ? ' (overage)' : ''}</td><td>${l.qty}</td>
            ${dated ? `<td>${l.dateOfService ? esc(date(l.dateOfService)) : '—'}</td>` : ''}<td>${esc(usd(l.gross))}</td><td>${esc(usd(l.allowed))}</td>
            <td>${esc(usd(l.payerShare))}</td><td>${esc(usd(l.patientShare))}</td>${authed ? `<td>${esc(l.authNo || '—')}</td>` : ''}</tr>`).join('')}
        </tbody>
        <tfoot><tr><th colspan="${dated ? 5 : 4}">Total</th><th>${esc(usd(r.totals.gross))}</th><th>${esc(usd(r.totals.allowedExpected))}</th>
          <th>${esc(usd(r.totals.payerShare))}</th><th>${esc(usd(r.totals.patientShare))}</th>${authed ? '<th></th>' : ''}</tr></tfoot>
      </table>
      <p>Batch ${esc(batch.batchNo)} · version ${version} · generated ${esc(date(at))}. Provider signature ________________________</p>
    </section>`;
}

function coverSheetHtml(r, batch, payer, version, at) {
  return `
    <section class="doc-page" data-claim="${esc(r.claimNo)}">
      <h2>Cover sheet — ${esc(r.claimNo)}</h2>
      <dl class="dl dl--narrow">
        <dt>Payer</dt><dd>${esc(payer?.nameEn || batch.payerId)}</dd>
        <dt>Patient</dt><dd>${esc(r.patient.name || '—')} · ${esc(r.patient.mrn)}</dd>
        <dt>Member</dt><dd>${esc(r.memberId || '—')}</dd>
        <dt>Enclosed</dt><dd>${r.attachments.length ? `${r.attachments.length} document${r.attachments.length === 1 ? '' : 's'}` : 'No attachments'}</dd>
      </dl>
      ${r.attachments.length ? `
      <table class="tbl">
        <thead><tr><th>#</th><th>Document</th><th>Type</th><th>For lines</th></tr></thead>
        <tbody>${r.attachments.map((a, i) => `
          <tr><td>${i + 1}</td><td>${esc(a.fileName)}</td><td>${esc(a.type)}</td><td>${esc(a.lineIds.join(', ') || 'whole claim')}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}
      <p>Batch ${esc(batch.batchNo)} · version ${version} · generated ${esc(date(at))}</p>
    </section>`;
}

// --- helpers ----------------------------------------------------------------------------

const sum = (claims, key) => Math.round(claims.reduce((n, c) => n + (key === 'lines' ? c.lines.length : Number(c.totals?.[key]) || 0), 0) * 100) / 100;

/** One CSV row, quoted where it has to be — the fee report's rule. */
export function csvLine(values) {
  return values
    .map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')))
    .join(',');
}

/** A standalone page: the preview drops it into the drawer, the download hands it over whole. */
const docHtml = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body>${body}
</body></html>`;

/** The body of a generated page, for the in-app preview. */
export function previewBody(content) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(String(content || ''));
  return m ? m[1] : String(content || '');
}
