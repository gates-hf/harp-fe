// Engine — the claim scrubber (amendment 27). Pure and a leaf: it reads the
// claim and a `ctx` the repository resolves, and returns findings. Six
// categories, two severities: an Error stops a claim from being finalized, a
// Warning can be acknowledged with a reason by a role that carries the flag.
//
// scrub(claim, ctx) → { result: 'Pass' | 'Warnings' | 'Fail', findings[] }
// finding = { id, category, severity, lineId|null, code, message, jumpTo }
// jumpTo names the tab on the claim page the finding is read on, and the line
// or the anchor inside it.

import { compareDates, date, usd, withinDates } from '../../shared/format.js';

export const CATEGORIES = ['Completeness', 'Financial', 'Authorization', 'Referral', 'Documentation', 'Code Logic'];
export const SEVERITIES = ['Error', 'Warning'];
export const RESULTS = ['Pass', 'Warnings', 'Fail'];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The categories a chart's own procedure lines fall in — a coded procedure is expected beside them. */
const PROCEDURE_CATEGORIES = ['Surgery', 'Procedure'];

/**
 * ctx = {
 *   encounter: { no, type, status, startAt, endAt } | null,
 *   contract: { id, contractNo, version, status } | null,
 *   payerName, planName,
 *   policy: { id, status, startDate, endDate } | null,
 *   itemOf(itemId) → { id, chargeCode, name, category } | null,
 *   reprice(line) → { allowed, payerShare, patientShare } | null   (the engine, at DOS, on the stamped version),
 *   preAuthRequired(line) → { required, reason },
 *   authorizationFor(itemId, on) → { no, authNumber, validFrom, validTo, remaining } | null,
 *   referralRequired: bool, referral: { no, status } | null,
 *   docsRequired: [{ docType, lineIds, reason }],
 *   today: ISO date,
 * }
 */
export function scrub(claim, ctx = {}) {
  const findings = [];
  let n = 0;
  const add = (category, severity, message, { lineId = null, code = '', jumpTo = null } = {}) => {
    findings.push({
      id: `F${String(++n).padStart(2, '0')}`,
      category,
      severity,
      lineId,
      code,
      message,
      jumpTo: jumpTo || (lineId ? { tab: 'lines', lineId } : { tab: 'lines' }),
    });
  };
  const itemOf = ctx.itemOf || (() => null);
  const name = (line) => `${line.chargeCode || itemOf(line.itemId)?.chargeCode || line.itemId} ${
    line.description || itemOf(line.itemId)?.name || ''}`.trim();
  const lines = claim.lines || [];
  const today = ctx.today || new Date().toISOString().slice(0, 10);

  // --- Completeness -----------------------------------------------------------
  const header = { tab: 'lines', anchor: 'header' };
  if (!claim.patientMrn) add('Completeness', 'Error', 'No patient on the claim.', { code: 'C01', jumpTo: header });
  if (!claim.payerId) add('Completeness', 'Error', 'No payer on the claim.', { code: 'C02', jumpTo: header });
  if (!claim.planId) add('Completeness', 'Error', 'No plan on the claim.', { code: 'C03', jumpTo: header });
  if (!claim.policyId) {
    add('Completeness', 'Error', 'No policy on the claim — the member number the payer files under is missing.',
      { code: 'C04', jumpTo: header });
  } else if (ctx.policy && ctx.policy.status !== 'Active') {
    add('Completeness', 'Error',
      `Policy ${ctx.policy.id} is ${ctx.policy.status.toLowerCase()} — the payer will not answer under it.`,
      { code: 'C05', jumpTo: header });
  } else if (ctx.policy && !withinDates(claim.dateOfService, ctx.policy.startDate, ctx.policy.endDate)) {
    add('Completeness', 'Error',
      `Policy ${ctx.policy.id} was not in force on ${date(claim.dateOfService)} (${date(ctx.policy.startDate)} – ${
        date(ctx.policy.endDate)}).`, { code: 'C06', jumpTo: header });
  }
  if (!claim.contractId) {
    add('Completeness', 'Error',
      `No contract version stamped — ${ctx.payerName || 'the payer'}${ctx.planName ? ` · ${ctx.planName}` : ''} has no agreement covering ${
        date(claim.dateOfService)}.`, { code: 'C07', jumpTo: header });
  }
  if (!claim.dateOfService) add('Completeness', 'Error', 'No date of service.', { code: 'C08', jumpTo: header });
  if (!lines.length) add('Completeness', 'Error', 'No lines on the claim — nothing to bill.', { code: 'C09' });
  if (!claim.coding) {
    add('Completeness', 'Error', 'No coding on the claim — the chart has not been coded, or the claim was assembled before it was.',
      { code: 'C10', jumpTo: { tab: 'coding' } });
  }
  if (ctx.encounter && ['Planned', 'Active'].includes(ctx.encounter.status)) {
    add('Completeness', 'Warning', `Encounter ${ctx.encounter.no} is still ${ctx.encounter.status.toLowerCase()} — charges may still land on it.`,
      { code: 'C11', jumpTo: header });
  }
  if (claim.stale?.flag) {
    add('Completeness', 'Error', `Stale — ${claim.stale.reason || 'the encounter changed since assembly'}. Refresh the claim.`,
      { code: 'C12', jumpTo: header });
  }

  // --- Financial --------------------------------------------------------------
  const sum = (key) => cents(lines.reduce((s, l) => s + (Number(l[key]) || 0), 0));
  const totals = claim.totals || {};
  if (cents(totals.payerShare) !== sum('payerShare') || cents(totals.gross) !== sum('grossBilled')
    || cents(totals.allowedExpected) !== sum('allowedExpected')) {
    add('Financial', 'Error', 'Totals do not reconcile to the lines.', { code: 'F01', jumpTo: { tab: 'lines', anchor: 'totals' } });
  }
  let zeroShare = 0;
  for (const line of lines) {
    if (cents(line.payerShare + line.patientShare) !== cents(line.allowedExpected)) {
      add('Financial', 'Error', `${name(line)}: payer ${usd(line.payerShare)} + patient ${usd(line.patientShare)} is not the allowed ${
        usd(line.allowedExpected)}.`, { lineId: line.id, code: 'F02' });
    }
    if (!(line.payerShare > 0)) zeroShare += 1;
    if (line.isOverage) continue;
    const now = ctx.reprice ? ctx.reprice(line) : null;
    if (!now) continue;
    const moved = ['allowed', 'payerShare', 'patientShare']
      .map((k) => [k, k === 'allowed' ? line.allowedExpected : line[k], now[k]])
      .filter(([, a, b]) => cents(a) !== cents(b));
    if (moved.length) {
      add('Financial', 'Error', `${name(line)}: ${moved.map(([k, a, b]) => `${k === 'allowed' ? 'allowed' : k === 'payerShare' ? 'payer share' : 'patient share'} ${
        usd(a)} on the claim, ${usd(b)} under ${ctx.contract?.contractNo || 'the contract'} v${ctx.contract?.version ?? '?'} today`).join('; ')}.`,
      { lineId: line.id, code: 'F03' });
    }
  }
  if (lines.length && zeroShare === lines.length) {
    add('Financial', 'Error', 'Payer share is zero on every line — nothing for the payer to answer.', { code: 'F04' });
  }

  // --- Authorization ----------------------------------------------------------
  for (const line of lines) {
    const need = ctx.preAuthRequired ? ctx.preAuthRequired(line) : { required: Boolean(line.preAuthRequired) };
    if (!need?.required) continue;
    const auth = ctx.authorizationFor ? ctx.authorizationFor(line.itemId, line.dateOfService || claim.dateOfService) : null;
    if (!auth) {
      add('Authorization', 'Error', `${name(line)} needs pre-authorisation and none on file covers it on ${
        date(line.dateOfService || claim.dateOfService)}${line.authNo ? ` — ${line.authNo} no longer answers` : ''}.`,
      { lineId: line.id, code: 'A01' });
      continue;
    }
    if (auth.remaining != null && auth.remaining < (Number(line.qty) || 1)) {
      add('Authorization', 'Warning', `${name(line)}: ${auth.authNumber || auth.no} authorises ${auth.remaining} of the ${line.qty} billed.`,
        { lineId: line.id, code: 'A02' });
    }
    if (line.authNumber && line.authNumber !== auth.authNumber) {
      add('Authorization', 'Warning', `${name(line)} is stamped ${line.authNumber}; the authorisation in force is ${auth.authNumber}. Refresh to restamp.`,
        { lineId: line.id, code: 'A03' });
    }
  }

  // --- Referral ---------------------------------------------------------------
  if (ctx.referralRequired) {
    if (!ctx.referral) {
      add('Referral', 'Error', `${ctx.payerName || 'The payer'} requires a referral and none is linked to encounter ${
        claim.encounterNo || ''}.`.trim(), { code: 'R01', jumpTo: header });
    } else if (['Rejected', 'Cancelled'].includes(ctx.referral.status)) {
      add('Referral', 'Error', `Referral ${ctx.referral.no} is ${ctx.referral.status.toLowerCase()}.`, { code: 'R02', jumpTo: header });
    }
  }

  // --- Documentation ----------------------------------------------------------
  const attached = new Set((claim.attachments || []).map((a) => a.type));
  for (const req of ctx.docsRequired || []) {
    if (attached.has(req.docType)) continue;
    add('Documentation', 'Error', `${req.docType} required (${req.reason}) — not attached.`,
      { code: 'D01', lineId: req.lineIds?.[0] || null, jumpTo: { tab: 'attachments', docType: req.docType } });
  }

  // --- Code Logic -------------------------------------------------------------
  const coding = claim.coding;
  const encounterType = ctx.encounter?.type || claim.encounterType;
  const from = (ctx.encounter?.startAt || '').slice(0, 10) || claim.dateOfService;
  const to = (ctx.encounter?.endAt || '').slice(0, 10) || today;
  if (coding) {
    const count = coding.principalCount ?? (coding.principal ? 1 : 0);
    if (count === 0) add('Code Logic', 'Error', 'No principal diagnosis.', { code: 'K01', jumpTo: { tab: 'coding' } });
    if (count > 1) add('Code Logic', 'Error', `${count} diagnoses marked principal — a claim carries one.`, { code: 'K02', jumpTo: { tab: 'coding' } });
    const all = [coding.principal, ...(coding.secondaries || [])].filter(Boolean);
    if (encounterType === 'IP') {
      for (const d of all) {
        if (!d.poa || d.poa === 'U') {
          add('Code Logic', 'Warning', `POA indicator ${d.poa === 'U' ? 'unknown' : 'missing'} on ${d.code} — an inpatient claim carries one per diagnosis.`,
            { code: 'K03', jumpTo: { tab: 'coding' } });
        }
      }
    }
    for (const d of all) {
      if (/\.9$/.test(String(d.code)) || /unspecified/i.test(String(d.desc))) {
        add('Code Logic', 'Warning', `${d.code} ${d.desc || ''} is an unspecified code — payers query these.`.replace('  ', ' '),
          { code: 'K04', jumpTo: { tab: 'coding' } });
      }
    }
    const lineIds = new Set(lines.map((l) => l.id));
    const chargeIds = new Set(lines.map((l) => l.chargeLineId));
    const linkedLines = new Set();
    for (const p of coding.procedures || []) {
      const links = p.chargeLineIds || [];
      if (!links.length) {
        add('Code Logic', 'Error', `Procedure ${p.code} is linked to no charge line.`, { code: 'K05', jumpTo: { tab: 'coding' } });
      }
      for (const id of links) {
        if (lineIds.has(id) || chargeIds.has(id)) linkedLines.add(id);
        else add('Code Logic', 'Warning', `Procedure ${p.code} is linked to charge line ${id}, which is not on this claim.`, { code: 'K06', jumpTo: { tab: 'coding' } });
      }
      if (p.date && !withinDates(p.date, from, to)) {
        add('Code Logic', 'Warning', `Procedure ${p.code} is dated ${date(p.date)}, outside the encounter (${date(from)} – ${date(to)}).`,
          { code: 'K07', jumpTo: { tab: 'coding' } });
      }
    }
    for (const line of lines) {
      const item = itemOf(line.itemId);
      if (!item || !PROCEDURE_CATEGORIES.includes(item.category) || line.isOverage) continue;
      if (!linkedLines.has(line.id) && !linkedLines.has(line.chargeLineId)) {
        add('Code Logic', 'Warning', `${name(line)} has no coded procedure linked to it.`, { lineId: line.id, code: 'K08' });
      }
    }
  }
  for (const line of lines) {
    const dos = line.dateOfService;
    if (!dos) continue;
    if (compareDates(dos, today) > 0) {
      add('Code Logic', 'Error', `${name(line)} is dated ${date(dos)}, in the future.`, { lineId: line.id, code: 'K09' });
    } else if (!withinDates(dos, from, to)) {
      add('Code Logic', 'Warning', `${name(line)} is dated ${date(dos)}, outside the encounter (${date(from)} – ${date(to)}).`,
        { lineId: line.id, code: 'K10' });
    }
  }

  return { result: resultOf(findings), findings };
}

/** Fail on any error, Warnings on any warning, else Pass. */
export function resultOf(findings = []) {
  if (findings.some((f) => f.severity === 'Error')) return 'Fail';
  if (findings.some((f) => f.severity === 'Warning')) return 'Warnings';
  return 'Pass';
}

/** Findings by category, in the fixed order, empty categories left out. */
export function grouped(findings = []) {
  return CATEGORIES
    .map((category) => ({ category, findings: findings.filter((f) => f.category === category) }))
    .filter((g) => g.findings.length);
}

export const resultTone = (result) =>
  (result === 'Pass' ? 'success' : result === 'Warnings' ? 'warning' : result === 'Fail' ? 'critical' : '');
