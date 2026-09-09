import * as estimates from './data/repositories/estimates.js';
const rows = estimates.all();
console.log('rows', rows.length, estimates.counts());
for (const r of rows) {
  const t = r.result?.totals;
  console.log([
    r.no, r.status, r.subject.kind === 'patient' ? r.subject.mrn : r.subject.name,
    estimates.coverLabel(r), 'valid', r.validUntil,
    t ? `gross ${t.gross} allowed ${t.allowed} payer ${t.payerShare} patient ${t.patientShare} over ${t.overageExposure} held ${t.held}` : 'draft',
    r.result?.contract ? `${r.result.contract.no} v${r.result.contract.version}` : (r.result?.selfPay ? 'self-pay' : ''),
    r.result?.error || '',
    r.result?.preAuthFlags?.length ? `preauth:${r.result.preAuthFlags.map((f) => f.chargeCode).join(',')}` : '',
    r.result?.exclusions?.length ? `excl:${r.result.exclusions.map((f) => f.chargeCode).join(',')}` : '',
    r.result?.limits?.length ? `limits:${r.result.limits.length}` : '',
    r.encounterNo || '', r.supersededBy || '', r.supersedes || '',
  ].join(' | '));
}
console.log('nextNo', estimates.nextNo());
