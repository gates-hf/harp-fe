// Denial resolution engine (amendment 36, Defensio F1). The register writes a
// denial's resolution the moment the register that decides it moves —
// remittances.afterPostHooks recovers it, the write-off feature calls
// resolveWrittenOff, a hand-off's outcome or an appeal's answer lands on it,
// a separation reclassifies it. This engine is the other half of that
// contract: it derives, from those registers alone, what each denial's
// resolution ought to be — the postings that paid the line back, the
// write-offs posted against it, the repeats a later remittance recorded, the
// accrual or the note a separation wrote — and reconciles the derivation
// against the stored figures. The resolution panel reads it as evidence;
// selfCheck() runs it over the whole register on load and asserts the
// ledger identity:
//
//   denied = recovered + lost + writtenOff + reclassified + transferred + open
//
// Pure: no DOM, no writes. It reads four repositories (denials, remittances,
// write-offs, appeal cases) and is read by no repository — the billing
// engine's position in the layering.

import * as denials from '../repositories/denials.js';
import * as remittances from '../repositories/remittances.js';
import * as writeoffs from '../repositories/writeoffs.js';
import * as appealCases from '../repositories/appeal-cases.js';
import * as tpaFeeAccruals from '../repositories/tpa-fee-accruals.js';
import { usd } from '../../shared/format.js';

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, f) => cents(rows.reduce((n, r) => n + (Number(f(r)) || 0), 0));

/**
 * derive(denial) → { postings[], writeoffs[], repeats[], appeal, accrual,
 * note, recovered, writtenOff, outcome, evidence[] }. What the registers say
 * about this denial, read fresh: the remittance postings on its claim after
 * it landed whose lines paid the denied line, the write-offs posted against
 * it, the repeats, and the record its separation wrote. `outcome` is the
 * status those facts imply on their own — Recovered, Partially Recovered,
 * Reopened (denied again since), Written Off, Reclassified, Lost, Manual or
 * Open — which reconcile() compares with the stored one.
 */
export function derive(denial) {
  if (!denial) return null;
  const postings = (remittances.byClaim?.(denial.claimNo) || [])
    .filter((p) => String(p.at || '') >= String(denial.createdAt || '') && p.remittanceNo !== denial.remittanceNo)
    .map((p) => {
      const lines = denial.scope === 'Line' ? p.lines.filter((l) => l.lineId === denial.lineId) : p.lines;
      return { remittanceNo: p.remittanceNo, at: p.at, paid: sum(lines, (l) => l.paid), denied: sum(lines, (l) => l.denied) };
    })
    .filter((p) => p.paid > 0 || p.denied > 0);
  const wos = (writeoffs.all?.() || [])
    .filter((w) => w.source?.kind === 'Denial' && w.source.ref === denial.id)
    .map((w) => ({ id: w.id, status: w.status, requested: w.amountRequested, posted: w.status === 'Posted' ? w.amountPosted ?? w.amountRequested : 0, at: w.posting?.at || w.at }));
  const repeats = denial.repeats || [];
  const appeal = denial.route?.kind === 'Appeal' ? appealCases.get(denial.route.ref) : appealCases.byDenial(denial.id)[0] || null;
  const accrual = denial.reclassification?.kind === 'TPA' ? tpaFeeAccruals.get(denial.reclassification.ref) : null;
  const note = denial.reclassification?.kind === 'Contractual' ? denial.reclassification : null;

  const recovered = sum(postings, (p) => p.paid);
  const writtenOff = sum(wos, (w) => w.posted);
  const deniedAgain = postings.some((p) => p.denied > 0 && p.paid <= 0);
  let outcome = 'Open';
  if (note || accrual || denial.separation === 'Contractual' || denial.separation === 'TPA') outcome = 'Reclassified';
  else if (recovered >= denial.amounts.denied - 0.005) outcome = 'Recovered';
  else if (recovered > 0) outcome = 'Partially Recovered';
  else if (writtenOff >= denial.amounts.denied - 0.005) outcome = 'Written Off';
  else if (deniedAgain) outcome = 'Reopened';
  else if (denial.resolution?.manual) outcome = 'Manual';
  else if (denial.resolution?.kind === 'Handoff' || denial.resolution?.kind === 'Appeal') outcome = denial.amounts.lost > 0 ? 'Lost' : denial.status;

  const evidence = [
    ...postings.map((p) => ({ kind: 'Remittance', ref: p.remittanceNo, at: p.at, amount: p.paid || -p.denied,
      label: p.paid > 0 ? `Paid back ${usd(p.paid)} on ${p.remittanceNo}` : `Denied again on ${p.remittanceNo}`, href: `#/claima/remittances/${p.remittanceNo}/postings` })),
    ...wos.map((w) => ({ kind: 'WriteOff', ref: w.id, at: w.at, amount: w.posted,
      label: `${w.id} ${w.status.toLowerCase()}${w.posted ? ` · ${usd(w.posted)} posted` : ` · ${usd(w.requested)} requested`}`, href: `#/claima/writeoffs/${w.id}` })),
    ...(appeal ? [{ kind: 'Appeal', ref: appeal.id, at: appeal.createdAt, amount: appeal.amount, label: `${appeal.id} ${appeal.status.toLowerCase()} · ${usd(appeal.amount)}`, href: `#/defensio/appeals/${appeal.id}` }] : []),
    ...(accrual ? [{ kind: 'TPAFee', ref: accrual.id, at: accrual.createdAt, amount: accrual.amount, label: `${accrual.id} ${accrual.status.toLowerCase()} · ${usd(accrual.amount)}`, href: '#/defensio' }] : []),
    ...(note ? [{ kind: 'Contractual', ref: note.ref, at: note.at, amount: note.amount, label: `${note.ref} · ${usd(note.amount)} reconciled on ${note.claimNo}`, href: `#/claima/claims/${note.claimNo}/history` }] : []),
    ...repeats.map((r) => ({ kind: 'Repeat', ref: r.remittanceNo, at: r.at, amount: -r.amount, label: `Denied again ${r.code || ''} on ${r.remittanceNo || '—'}`, href: r.remittanceNo ? `#/claima/remittances/${r.remittanceNo}/exceptions` : '' })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return { postings, writeoffs: wos, repeats, appeal, accrual, note, recovered, writtenOff, outcome, evidence };
}

/**
 * reconcile(denial) → { pass, problems[] }. The stored figures against the
 * derivation: a remittance the register recovered from has to be on the
 * claim, a write-off it was written off by has to be posted, a
 * reclassification has to have its record, and the six figures have to add
 * up. A resolution the registers cannot see — a hand-off's answer recorded
 * on the page, a manual close — is taken from the record and not disputed.
 */
export function reconcile(denial) {
  const problems = [];
  const a = denial.amounts || {};
  if (!holds(a)) problems.push(`${denial.id}: ${usd(a.denied)} ≠ ${usd(a.recovered)} + ${usd(a.lost)} + ${usd(a.writtenOff)} + ${usd(a.reclassified || 0)} + ${usd(a.transferred || 0)} + ${usd(a.open)}`);
  const d = derive(denial);
  if (!d) return { pass: !problems.length, problems };
  const res = denial.resolution;
  if (res?.kind === 'Remittance' && res.ref && !d.postings.some((p) => p.remittanceNo === res.ref)) problems.push(`${denial.id}: recovered on ${res.ref}, which posted nothing on ${denial.claimNo}`);
  if (res?.kind === 'WriteOff' && res.ref && !d.writeoffs.some((w) => w.id === res.ref && w.status === 'Posted')) problems.push(`${denial.id}: written off by ${res.ref}, which is not posted`);
  if (denial.status === 'Reclassified' && !(d.note || d.accrual)) problems.push(`${denial.id}: reclassified with no reconciliation note or accrual behind it`);
  if (d.accrual && Math.abs(d.accrual.amount - (a.reclassified || 0)) >= 0.005) problems.push(`${denial.id}: ${usd(a.reclassified)} reclassified, accrual ${d.accrual.id} carries ${usd(d.accrual.amount)}`);
  if (d.writtenOff > (a.writtenOff || 0) + 0.005) problems.push(`${denial.id}: ${usd(d.writtenOff)} posted in write-offs, ${usd(a.writtenOff)} on the denial`);
  return { pass: !problems.length, problems };
}

const holds = (a) => Math.abs(cents(a.denied) - cents((a.recovered || 0) + (a.lost || 0) + (a.writtenOff || 0) + (a.reclassified || 0) + (a.transferred || 0) + (a.open || 0))) < 0.005;

/**
 * ledger() → the register's totals: { count, denied, recovered, lost,
 * writtenOff, reclassified, transferred, open, holds } over every denial
 * that stands (a reversed one is out of every sum).
 */
export function ledger() {
  const rows = denials.all().filter((d) => d.status !== 'Reversed');
  const total = (key) => sum(rows, (d) => d.amounts?.[key]);
  const out = {
    count: rows.length,
    denied: total('denied'), recovered: total('recovered'), lost: total('lost'), writtenOff: total('writtenOff'),
    reclassified: total('reclassified'), transferred: total('transferred'), open: total('open'),
  };
  out.holds = holds(out);
  return out;
}

/**
 * selfCheck() → { pass, failures, ledger }. The ledger identity as a
 * console.assert, then every denial reconciled against the registers; one
 * line on the console either way.
 */
export function selfCheck() {
  const l = ledger();
  console.assert(l.holds, `[defensio] denied ${usd(l.denied)} ≠ recovered ${usd(l.recovered)} + lost ${usd(l.lost)} + written off ${usd(l.writtenOff)} + reclassified ${usd(l.reclassified)} + transferred ${usd(l.transferred)} + open ${usd(l.open)}`);
  const failures = [];
  for (const d of denials.all()) {
    if (d.status === 'Reversed') continue;
    const r = reconcile(d);
    if (!r.pass) failures.push(...r.problems);
  }
  if (!l.holds) failures.unshift('ledger identity fails');
  const pass = !failures.length;
  console[pass ? 'info' : 'warn'](`[defensio] resolution self-check ${pass ? 'pass' : 'FAIL'} — ${l.count} denials, ${usd(l.denied)} denied: ${usd(l.recovered)} recovered, ${usd(l.writtenOff)} written off, ${usd(l.lost)} lost, ${usd(l.reclassified)} reclassified, ${usd(l.open)} open`, ...(pass ? [] : [failures]));
  return { pass, failures, ledger: l };
}

/** Runs once the peers and the seed's deferred half have settled, so every seeded row is on the registers. */
export const ready = (denials.all(), Promise.allSettled([denials.peersReady, writeoffs.peersReady, denials.seedReady]).then(selfCheck));
