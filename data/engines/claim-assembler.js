// Engine — claim assembly (amendment 27). Pure and a leaf: it imports nothing
// from data/, so data/repositories/claims.js can read it without a cycle. Every
// fact it needs about the world arrives through `ctx`, resolved by the
// repository — the contract, the authorisations, the documents the payer wants.
//
// assemble(encounter, coding, charges, ctx) → the claim payload: header, lines,
// the coding snapshot, the attachments pulled in by reference, what was left
// out and why, and the secondary cover the chain names. diff(before, after)
// says what a refresh moved, which is what the claim's history shows.

import { iso } from '../../shared/format.js';

export const KINDS = ['Primary', 'Secondary', 'Supplementary'];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Whether a claim line and a charge line are the same charge. The capture
 * register's id when both carry one, else the ledger rows they share — a claim
 * assembled off the ledger before the register was loaded still matches the
 * register's line for the same posting.
 */
export function sameLine(a, b) {
  if (!a || !b) return false;
  const aId = a.chargeLineId || a.id;
  const bId = b.chargeLineId || b.id;
  if (aId && bId && aId === bId) return true;
  const mine = a.ledgerTxIds || [];
  return mine.length > 0 && (b.ledgerTxIds || []).some((id) => mine.includes(id));
}

/** Whether `line` is one of `list`, by sameLine. */
export const inList = (list, line) => list.some((l) => sameLine(l, line));

/**
 * ctx = {
 *   contract: { id, contractNo, version } | null,
 *   itemOf(itemId) → { id, chargeCode, name, category } | null,
 *   authorizationFor(itemId, amount, on) → { required, reason, auth: { no, authNumber, validTo, remaining } | null },
 *   referralNo: string | null,
 *   clinicalDocs: [{ id, type, title, fileName, date }] | undefined   (undefined: the feature is not loaded),
 *   docsRequired(lines, total) → [{ docType, lineIds, reason }],
 *   takenLines: the lines other claims of the encounter already carry (matched by sameLine),
 *   lateChargeLineIds: iterable of charge-line ids that landed after the claim was first assembled,
 *   nextPolicy: { id, payerId, planId } | null   (the cover behind the one the visit was classified on),
 *   previous: the claim being refreshed, or null,
 * }
 * charges = [{ id, itemId, qty, dateOfService, pricing { gross, allowed, payerShare, patientShare, isOverage }, ledgerTxIds, flags }]
 * coding  = { version, status, codedAt, codedBy, diagnoses[], procedures[] } | null | undefined
 */
export function assemble(encounter, coding, charges = [], ctx = {}) {
  const financial = encounter?.financial || {};
  if (!financial.payerId) {
    return { selfPay: true, reason: 'Self-Pay — no policy carried the visit, so there is nothing to claim.' };
  }
  const contract = ctx.contract || null;
  const previous = ctx.previous || null;
  const taken = ctx.takenLines || [];
  const late = new Set(ctx.lateChargeLineIds || []);
  const itemOf = ctx.itemOf || (() => null);
  const on = iso(encounter.startAt) || iso(encounter.createdAt);

  // --- lines ------------------------------------------------------------------
  // Released lines with a payer share, each overage line kept as its own row.
  // With no contract nobody priced the split, so every line is kept and the
  // scrub says why the claim cannot go: an absence is not a zero.
  const lines = [];
  const excluded = [];
  const kept = (charge) => (previous?.lines || []).find((l) => sameLine(l, charge)) || null;
  let serial = (previous?.lines || []).reduce((n, l) => Math.max(n, Number(String(l.id).slice(1)) || 0), 0);
  const sorted = [...charges].sort((a, b) =>
    String(a.dateOfService || '').localeCompare(String(b.dateOfService || '')) || String(a.id).localeCompare(String(b.id)));
  for (const charge of sorted) {
    const p = charge.pricing || {};
    if (inList(taken, charge)) {
      excluded.push({ chargeLineId: charge.id, itemId: charge.itemId, reason: 'Carried by another claim of this encounter' });
      continue;
    }
    if (contract && !(Number(p.payerShare) > 0)) {
      excluded.push({
        chargeLineId: charge.id,
        itemId: charge.itemId,
        reason: Number(p.allowed) === 0 ? 'Not billable under the contract' : 'No payer share — the patient carries the whole line',
      });
      continue;
    }
    const before = kept(charge);
    const item = itemOf(charge.itemId);
    const amount = cents(p.allowed);
    const answer = ctx.authorizationFor ? ctx.authorizationFor(charge.itemId, amount, charge.dateOfService || on) : null;
    lines.push({
      id: before?.id || `L${++serial}`,
      chargeLineId: charge.id,
      itemId: charge.itemId,
      chargeCode: item?.chargeCode || charge.chargeCode || null,
      description: item?.name || charge.description || null,
      qty: Number(charge.qty) || 1,
      dateOfService: iso(charge.dateOfService) || on,
      grossBilled: cents(p.gross),
      allowedExpected: amount,
      payerShare: cents(p.payerShare),
      patientShare: cents(p.patientShare),
      isOverage: Boolean(p.isOverage),
      ledgerTxIds: [...(charge.ledgerTxIds || [])],
      preAuthRequired: Boolean(answer?.required),
      authNo: answer?.auth?.no || null,
      authNumber: answer?.auth?.authNumber || null,
      late: late.has(charge.id) || Boolean(before?.late),
    });
  }

  const total = cents(lines.reduce((n, l) => n + l.payerShare, 0));

  // --- coding -----------------------------------------------------------------
  // undefined means the coding feature is not loaded, which is not the same as
  // "not coded": the snapshot already on the claim is kept.
  const codingSnapshot = coding === undefined ? (previous?.coding || null) : snapshotCoding(coding);

  // --- attachments ------------------------------------------------------------
  const requirements = (ctx.docsRequired || (() => []))(
    lines.map((l) => ({ id: l.id, item: itemOf(l.itemId), amount: l.allowedExpected })), total,
  );
  const attachments = assembleAttachments(previous, requirements, ctx.clinicalDocs);

  return {
    selfPay: false,
    header: {
      patientMrn: encounter.patientMrn,
      encounterNo: encounter.no,
      encounterType: encounter.type,
      department: encounter.department || '',
      doctorId: encounter.doctorId || null,
      payerId: financial.payerId,
      planId: financial.planId,
      policyId: financial.policyId || null,
      contractId: contract?.id || null,
      contractNo: contract?.contractNo || null,
      contractVersion: contract?.version ?? null,
      snapshotRef: financial.snapshotRef || null,
      referralNo: ctx.referralNo || encounter.linked?.referralId || null,
      dateOfService: on,
      dateOfServiceTo: iso(encounter.endAt) || on,
    },
    lines,
    excluded,
    lateLineIds: lines.filter((l) => l.late).map((l) => l.id),
    coding: codingSnapshot,
    attachments,
    docRequirements: requirements,
    secondary: ctx.nextPolicy
      ? { payerId: ctx.nextPolicy.payerId, planId: ctx.nextPolicy.planId, policyId: ctx.nextPolicy.id }
      : null,
  };
}

/** The coding version as the claim carries it: one principal, the rest, the procedures. */
export function snapshotCoding(coding) {
  if (!coding) return null;
  const diagnoses = coding.diagnoses || [];
  const principals = diagnoses.filter((d) => d.principal);
  const pick = (d) => ({ code: d.code, desc: d.desc || d.description || '', poa: d.poa ?? null });
  return {
    version: coding.version ?? 1,
    status: coding.status || 'Coded',
    codedAt: coding.codedAt || null,
    codedBy: coding.codedBy || null,
    principal: principals[0] ? pick(principals[0]) : null,
    principalCount: principals.length,
    secondaries: diagnoses.filter((d) => !d.principal).map(pick),
    procedures: (coding.procedures || []).map((p) => ({
      code: p.code,
      desc: p.desc || p.description || '',
      date: iso(p.date) || null,
      doctorId: p.doctorId || null,
      chargeLineIds: [...(p.chargeLineIds || [])],
    })),
  };
}

/**
 * Uploads are kept — a file the biller attached by hand is theirs to remove —
 * and the auto-pulled rows are rebuilt from the clinical record against what
 * the contract asks for. `required` says the row answers a requirement.
 */
function assembleAttachments(previous, requirements, docs) {
  const requiredTypes = new Set(requirements.map((r) => r.docType));
  const lineIdsFor = (type) => requirements.find((r) => r.docType === type)?.lineIds || [];
  const kept = (previous?.attachments || [])
    .filter((a) => a.origin === 'Upload')
    .map((a) => ({ ...a, lineIds: [...(a.lineIds || [])], required: requiredTypes.has(a.type) }));
  // Not loaded: the auto rows already on the claim stand, since nothing can say they are gone.
  if (docs === undefined) {
    return [...kept, ...(previous?.attachments || []).filter((a) => a.origin === 'Auto')
      .map((a) => ({ ...a, required: requiredTypes.has(a.type) }))];
  }
  let serial = kept.reduce((n, a) => Math.max(n, Number(String(a.id).slice(1)) || 0), 0);
  const auto = (docs || [])
    .filter((d) => requiredTypes.has(d.type))
    .map((d) => {
      const before = (previous?.attachments || []).find((a) => a.origin === 'Auto' && a.docId === d.id);
      return {
        id: before?.id || `A${++serial}`,
        docId: d.id,
        fileId: null,
        fileName: d.fileName || d.title || d.id,
        type: d.type,
        origin: 'Auto',
        lineIds: before?.lineIds?.length ? [...before.lineIds] : lineIdsFor(d.type),
        required: true,
      };
    });
  return [...kept, ...auto];
}

// --- refresh diff --------------------------------------------------------------

const HEADER_FIELDS = {
  payerId: 'payer', planId: 'plan', policyId: 'policy', contractId: 'contract version',
  dateOfService: 'date of service', dateOfServiceTo: 'end of service', referralNo: 'referral',
};

/**
 * What a refresh changed, as data: header fields that moved, lines added,
 * removed or repriced (matched on the charge line they came from), the coding
 * version, and attachments gained or lost. Empty arrays mean nothing moved.
 */
export function diff(before, after) {
  const header = Object.entries(HEADER_FIELDS)
    .filter(([key]) => String(before?.[key] ?? '') !== String(after?.[key] ?? ''))
    .map(([key, label]) => ({ field: key, label, from: before?.[key] ?? null, to: after?.[key] ?? null }));

  const was = before?.lines || [];
  const now = after?.lines || [];
  const added = now.filter((l) => !inList(was, l));
  const removed = was.filter((l) => !inList(now, l));
  const changed = [];
  for (const line of now) {
    const old = was.find((l) => sameLine(l, line));
    if (!old) continue;
    for (const field of ['qty', 'allowedExpected', 'payerShare', 'patientShare', 'authNumber']) {
      if (String(old[field] ?? '') !== String(line[field] ?? '')) {
        changed.push({ lineId: line.id, field, from: old[field] ?? null, to: line[field] ?? null });
      }
    }
  }

  const codingKey = (c) => (c ? `${c.version}|${c.principal?.code || ''}|${(c.secondaries || []).map((d) => d.code).join(',')}|${
    (c.procedures || []).map((p) => p.code).join(',')}` : '');
  const codingFrom = before?.coding?.version ?? null;
  const codingTo = after?.coding?.version ?? null;
  const codingMoved = codingKey(before?.coding) !== codingKey(after?.coding);
  const key = (a) => a.docId || a.fileId || a.id;
  const hadAtt = new Set((before?.attachments || []).map(key));
  const hasAtt = new Set((after?.attachments || []).map(key));
  const attachments = {
    added: (after?.attachments || []).filter((a) => !hadAtt.has(key(a))),
    removed: (before?.attachments || []).filter((a) => !hasAtt.has(key(a))),
  };

  const totalsFrom = cents(before?.totals?.payerShare);
  const totalsTo = cents((after?.lines || []).reduce((n, l) => n + (Number(l.payerShare) || 0), 0));

  return {
    header,
    lines: { added, removed, changed },
    coding: codingMoved
      ? { from: codingFrom, to: codingTo, principalFrom: before?.coding?.principal?.code || null, principalTo: after?.coding?.principal?.code || null }
      : null,
    attachments,
    totals: totalsFrom === totalsTo ? null : { from: totalsFrom, to: totalsTo },
  };
}

/** Whether a diff moved anything at all. */
export const isEmptyDiff = (d) =>
  !d.header.length && !d.lines.added.length && !d.lines.removed.length && !d.lines.changed.length
  && !d.coding && !d.attachments.added.length && !d.attachments.removed.length && !d.totals;
