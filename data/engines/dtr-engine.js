// Engine — the daily transaction report (Claima, amendment 34).
//
// The one place a DTR figure is defined. `compute(world)` turns one business
// day's posted rows into five sections, their carried balances and the five
// checks; `select(world, drill)` returns the transactions behind any cell, and
// the section builders use the same selectors, so a row's count is the length
// of the list its drill opens — by construction, not by assertion.
//
// A leaf: it imports nothing from data/. Every register arrives on the world
// object data/repositories/business-days.js builds (the rows themselves, never
// a stored total), which is what lets that repository import this file
// without the two forming a cycle. Nothing here writes.
//
// A row lands on the business day it was written on: the tag the ledger hook
// stamps (`priorDay.postedOn`) when the row's own date was already closed,
// else the row's own timestamp. A reversal counts, negative, on the day it was
// written and never re-opens the day the original was counted on — which is
// what keeps a frozen snapshot true after the correction.

import { usd } from '../../shared/format.js';

export const METHODS = ['Cash', 'Card', 'Transfer', 'Cheque'];

export const SECTIONS = [
  { key: 'charges', label: 'Charges', totalLabel: 'Net charges captured' },
  { key: 'claims', label: 'Claims', totalLabel: 'Submitted to payers' },
  { key: 'payerCash', label: 'Payer cash', totalLabel: 'Cash posted to claims' },
  { key: 'patientCash', label: 'Patient cash', totalLabel: 'Net patient cash' },
  { key: 'adjustments', label: 'Adjustments & write-offs', totalLabel: 'Net adjustments' },
];

/** The carried balances. Opening is the prior closed report's closing; closing = opening + movement. */
export const CATEGORIES = {
  charges: [['captured', 'Charges captured'], ['reversed', 'Charges reversed']],
  claims: [['created', 'Batches created'], ['submitted', 'Batches submitted'], ['acknowledged', 'Batches acknowledged'],
    ['rejected', 'Rejections'], ['nullified', 'Nullifications']],
  payerCash: [['captured', 'Remittances captured'], ['posted', 'Cash posted'], ['adjusted', 'Contractual adjustments'],
    ['denied', 'Denials created'], ['unappliedHeld', 'Unapplied cash held'], ['unappliedReleased', 'Unapplied cash released'],
    ['handoffs', 'Defensio hand-offs']],
  patientCash: [['payments', 'Payments'], ['depositsHeld', 'Deposits held'], ['depositsRefunded', 'Deposits refunded'],
    ['refunds', 'Refunds'], ['reversals', 'Reversals']],
  adjustments: [['patientAdjustments', 'Patient-side adjustments'], ['patientWriteoffs', 'Patient-side write-offs'],
    ['payerWriteoffs', 'Payer-side write-offs'], ['reversals', 'Reversals']],
};

export const CHECKS = [
  { key: 'cashIntegrity', label: 'Cash integrity', hint: 'Σ methods = Σ sessions = patient cash total' },
  { key: 'payerPostingEquation', label: 'Payer posting equation', hint: 'paid + unapplied (+ still to post) = the total of every remittance posted today' },
  { key: 'openingMovementClosing', label: 'Opening + movement = closing', hint: 'per category, carried from the prior closed report' },
  { key: 'writeoffReconciliation', label: 'Write-off reconciliation', hint: 'section 5 payer-side = the register’s posted totals = the denials written off' },
  { key: 'allSessionsClosed', label: 'All sessions closed', hint: 'every cash session on the day is closed' },
];

export const CASH_IN = ['Payment', 'DepositHeld'];
export const CASH_OUT = ['Refund', 'DepositRefund'];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const same = (a, b) => Math.abs(cents(a) - cents(b)) < 0.005;
const day = (ts) => String(ts || '').slice(0, 10);
const sum = (list, f = (x) => x.amount) => cents(list.reduce((n, x) => n + (Number(f(x)) || 0), 0));

/** The business day a ledger row is reported on. */
export const ledgerDay = (row) => row.priorDay?.postedOn || day(row.at);

/** How a ledger row moves the desk's cash: in, out, or not at all. */
export function cashEffect(row) {
  if (CASH_IN.includes(row.type)) return cents(row.amount);
  if (CASH_OUT.includes(row.type)) return -cents(row.amount);
  if (row.type === 'Reversal') {
    const t = row.detail?.reversedType;
    if (CASH_IN.includes(t)) return -cents(row.amount);
    if (CASH_OUT.includes(t)) return cents(row.amount);
  }
  return 0;
}

export const isCashRow = (row) => CASH_IN.includes(row.type) || CASH_OUT.includes(row.type)
  || (row.type === 'Reversal' && (CASH_IN.includes(row.detail?.reversedType) || CASH_OUT.includes(row.detail?.reversedType)));

/** The four buckets the desk counts in. A bank transfer and an EFT are one thing. */
export function methodOf(row) {
  const m = String(row?.detail?.method || row?.method || '').toLowerCase();
  if (m.includes('card')) return 'Card';
  if (m.includes('transfer') || m.includes('bank') || m === 'eft') return 'Transfer';
  if (m.includes('cheque') || m.includes('check')) return 'Cheque';
  return 'Cash';
}

/** A session's system totals per method over the cash rows attached to it. */
export function systemTotals(session, ledgerRows) {
  const ids = new Set(session.txIds || []);
  const totals = Object.fromEntries(METHODS.map((m) => [m, 0]));
  for (const row of ledgerRows) {
    if (!ids.has(row.id) || !isCashRow(row)) continue;
    totals[methodOf(row)] = cents(totals[methodOf(row)] + cashEffect(row));
  }
  return totals;
}

// --- transaction views ------------------------------------------------------------

const ledgerTx = (world, row, amount = cashEffect(row)) => ({
  id: row.id, at: row.at, repo: 'ledger', amount,
  label: `${row.type === 'Reversal' ? `Reversal of ${row.detail?.reversedType || 'transaction'}` : row.type} · ${world.names.patient(row.patientMrn)}`,
  sub: [row.detail?.receiptNo, isCashRow(row) ? methodOf(row) : null, row.by, row.priorDay ? `taken ${row.priorDay.originalDate}` : null].filter(Boolean).join(' · '),
  href: `#/frontis/accounts/${row.patientMrn}`, priorDay: Boolean(row.priorDay), cashier: row.by,
});

const chargeTx = (world, row, sign = 1) => ({
  id: row.id, at: sign < 0 ? row.reversedAt : row.createdAt, repo: 'charges', amount: cents(sign * (row.pricing?.allowed || 0)),
  label: `${world.names.item(row.itemId)} ×${row.qty} · ${row.encounterNo}`,
  sub: [row.department, row.source?.type, row.flags?.includes('Late') ? 'Late' : null, `service ${row.dateOfService}`].filter(Boolean).join(' · '),
  href: `#/claima/charges?encounter=${row.encounterNo}`, priorDay: row.dateOfService < world.date,
});

const batchTx = (world, b, amount, at) => ({
  id: b.batchNo, at, repo: 'batches', amount, label: `${b.batchNo} · ${world.names.payer(b.payerId)}`,
  sub: `${b.claimNos.length} claim${b.claimNos.length === 1 ? '' : 's'} · ${b.status}`, href: `#/claima/submission/${b.batchNo}`, priorDay: false,
});

// --- selectors: one per drill kind; the section builders read through them -----------

const SELECT = {
  chargesByDepartment: (w, f) => captured(w).filter((r) => r.department === f.value).map((r) => chargeTx(w, r)),
  chargesBySource: (w, f) => captured(w).filter((r) => (r.source?.type || 'Manual') === f.value).map((r) => chargeTx(w, r)),
  chargesLate: (w) => captured(w).filter((r) => r.flags?.includes('Late')).map((r) => chargeTx(w, r)),
  chargesReversed: (w) => w.charges.filter((r) => day(r.reversedAt) === w.date).map((r) => chargeTx(w, r, -1)),

  batchesCreated: (w) => w.batches.filter((b) => day(b.createdAt) === w.date).map((b) => batchTx(w, b, b.value, b.createdAt)),
  batchesSubmitted: (w) => w.batches.filter((b) => day(b.submission?.at) === w.date).map((b) => batchTx(w, b, b.value, b.submission.at)),
  batchesAcknowledged: (w) => w.batches.filter((b) => day(b.acknowledgment?.at) === w.date).map((b) => batchTx(w, b, b.value, b.acknowledgment.at)),
  rejections: (w) => w.batches.flatMap((b) => b.rejections.filter((r) => day(r.at) === w.date).map((r) => ({
    id: `${b.batchNo}:${r.claimNo}`, at: r.at, repo: 'batches', amount: w.names.claimValue(r.claimNo),
    label: `${r.claimNo} · ${r.code}`, sub: `${b.batchNo} · ${r.reason}`, href: `#/claima/submission/${b.batchNo}/rejections`, priorDay: false,
  }))),
  nullifications: (w) => w.nullifications.filter((n) => day(n.at) === w.date).map((n) => ({
    id: n.no, at: n.at, repo: 'nullifications', amount: n.valueAtNullification, label: `${n.no} · ${n.claimNo}`,
    sub: `${n.path} · ${n.reasonCode} · ${w.names.payer(n.payerId)}`, href: `#/claima/nullifications/${n.no}`, priorDay: false,
  })),

  remittancesCaptured: (w) => w.remittances.filter((r) => day(r.capture?.at) === w.date).map((r) => ({
    id: r.remittanceNo, at: r.capture.at, repo: 'remittances', amount: r.payment.total, label: `${r.remittanceNo} · ${w.names.payer(r.payerId)}`,
    sub: `${r.capture.mode} · ${r.payment.method} · ${r.status}`, href: `#/claima/remittances/${r.remittanceNo}`, priorDay: false,
  })),
  remittancesPosted: (w) => postings(w).map((p) => postingTx(w, p, 'paid')),
  contractualAdjustments: (w) => postings(w).map((p) => postingTx(w, p, 'adjustment')).filter((t) => t.amount !== 0),
  denialsCreated: (w) => w.denials.filter((d) => day(d.createdAt) === w.date).map((d) => ({
    id: d.id, at: d.createdAt, repo: 'denials', amount: d.amount, label: `${d.id} · ${d.claimNo}`,
    sub: `${d.code || '—'} · ${d.reason} · ${w.names.payer(d.payerId)}`, href: `#/claima/denials/${d.id}`, priorDay: false,
  })),
  unappliedHeld: (w) => w.unapplied.filter((u) => day(u.since) === w.date).map((u) => unappliedTx(w, u, u.amount, u.since, 'Held')),
  unappliedReleased: (w) => w.unapplied.filter((u) => u.resolution && day(u.resolution.at) === w.date)
    .map((u) => unappliedTx(w, u, -u.amount, u.resolution.at, u.status)),
  handoffs: (w) => w.handoffs.filter((h) => day(h.createdAt) === w.date).map((h) => ({
    id: h.id, at: h.createdAt, repo: 'handoffs', amount: h.amount, label: `${h.id} · ${h.claimNo || h.claimId}`,
    sub: `${h.reason} · ${w.names.payer(h.payerId)}`, href: `#/pactum/performance/contracts/${h.contractId}`, priorDay: false,
  })),

  cashByMethod: (w, f) => cashRows(w).filter((r) => methodOf(r) === f.value).map((r) => ledgerTx(w, r)),
  cashBySession: (w, f) => {
    const s = w.sessions.find((x) => x.id === f.value);
    return cashRows(w).filter((r) => s?.txIds.includes(r.id)).map((r) => ledgerTx(w, r));
  },
  cashUnattached: (w) => unattached(w).map((r) => ledgerTx(w, r)),
  ledgerType: (w, f) => onDay(w).filter((r) => r.type === f.value).map((r) => ledgerTx(w, r, isCashRow(r) ? cashEffect(r) : cents(r.amount))),
  cashReversals: (w) => cashRows(w).filter((r) => r.type === 'Reversal').map((r) => ledgerTx(w, r)),

  patientAdjustments: (w) => onDay(w).filter((r) => r.type === 'Adjustment' && !r.detail?.origin?.writeoffId).map((r) => ledgerTx(w, r, cents(r.amount))),
  patientWriteoffs: (w) => onDay(w).filter((r) => r.type === 'Adjustment' && r.detail?.origin?.writeoffId).map((r) => ledgerTx(w, r, cents(r.amount))),
  payerWriteoffs: (w) => w.writeoffs.filter((x) => x.side === 'Payer' && x.posting && day(x.posting.at) === w.date && x.status !== 'Reversed')
    .map((x) => writeoffTx(w, x, x.amountPosted, x.posting.at)),
  adjustmentReversals: (w) => [
    ...onDay(w).filter((r) => r.type === 'Reversal' && r.detail?.reversedType === 'Adjustment').map((r) => ledgerTx(w, r, -cents(r.amount))),
    ...w.writeoffs.filter((x) => x.reversal && day(x.reversal.at) === w.date).map((x) => writeoffTx(w, x, -x.amountPosted, x.reversal.at)),
  ],
};

const onDay = (w) => w.ledger.filter((r) => ledgerDay(r) === w.date);
const cashRows = (w) => onDay(w).filter(isCashRow);
const captured = (w) => w.charges.filter((r) => day(r.createdAt) === w.date);
const attachedIds = (w) => new Set(w.sessions.flatMap((s) => s.txIds || []));
const unattached = (w) => { const ids = attachedIds(w); return cashRows(w).filter((r) => !ids.has(r.id)); };
const livePostings = (rem) => rem.postings.filter((p) => !p.reversal && !p.reversedBy);
const postings = (w) => w.remittances.flatMap((rem) => rem.postings
  .filter((p) => day(p.at) === w.date)
  .map((p) => ({ rem, posting: p, rows: rem.claims.filter((row) => row.postingId === p.id) })));

function postingTx(w, { rem, posting, rows }, field) {
  const sign = posting.reversal ? -1 : 1;
  const lines = posting.reversal ? reversedLines(rem, posting) : rows.flatMap((r) => r.lines);
  const amount = cents(sign * sum(lines, (l) => l[field]));
  return {
    id: `${rem.remittanceNo}:${posting.id}`, at: posting.at, repo: 'remittances', amount,
    label: `${rem.remittanceNo} · ${posting.id}${posting.reversal ? ` reverses ${posting.reverses}` : ''} · ${w.names.payer(rem.payerId)}`,
    sub: posting.summary || `${posting.claimNos.length} claim${posting.claimNos.length === 1 ? '' : 's'}`,
    href: `#/claima/remittances/${rem.remittanceNo}/postings`, priorDay: false,
  };
}

/** The lines a reversal undid are read off the posting it reverses — they are re-opened, so their claim rows no longer name it. */
function reversedLines(rem, reversal) {
  const original = rem.postings.find((p) => p.id === reversal.reverses);
  if (!original) return [];
  return rem.claims.filter((row) => original.claimNos.includes(row.claimNo)).flatMap((r) => r.lines);
}

const unappliedTx = (w, u, amount, at, what) => ({
  id: u.id, at, repo: 'unapplied', amount, label: `${u.id} · ${what} · ${w.names.payer(u.payerId)}`,
  sub: `${u.remittanceNo}${u.resolution ? ` · ${u.resolution.kind}${u.resolution.ref ? ` ${u.resolution.ref}` : ''}` : ''}`,
  href: '#/claima/remittances/unapplied', priorDay: false,
});

const writeoffTx = (w, x, amount, at) => ({
  id: x.id, at, repo: 'writeoffs', amount, label: `${x.id} · ${x.source?.claimNo || x.source?.mrn || ''}`,
  sub: `${x.reasonCode} · ${x.classification} · ${x.source?.kind}`, href: `#/claima/writeoffs/${x.id}`, priorDay: false,
});

/** The transactions behind a drill — the same selector the row was built from. */
export function select(world, drill) {
  const f = drill?.filter || {};
  const fn = SELECT[f.kind];
  if (!fn) return [];
  const txs = fn(world, f);
  return f.priorDay ? txs.filter((t) => t.priorDay) : txs;
}

// --- sections --------------------------------------------------------------------------

function row(world, { key, label, group, kind, value, category = null, inTotal = true, repo }) {
  const filter = { kind, date: world.date, ...(value !== undefined ? { value } : {}) };
  const txs = SELECT[kind](world, filter);
  const prior = txs.filter((t) => t.priorDay);
  return {
    key, label, group, category, inTotal,
    count: txs.length, amount: sum(txs), priorDayCount: prior.length, priorDayAmount: sum(prior),
    drill: { repo: repo || txs[0]?.repo || kind, filter },
  };
}

function section(world, key, rows, totalOf) {
  const def = SECTIONS.find((s) => s.key === key);
  const prior = world.priorSnapshot?.sections?.find((s) => s.key === key);
  const categories = CATEGORIES[key].map(([cat, label]) => {
    const movement = sum(rows.filter((r) => r.category === cat));
    const opening = cents(prior?.categories?.find((c) => c.key === cat)?.closing || 0);
    return { key: cat, label, opening, movement, closing: cents(opening + movement) };
  });
  const total = totalOf ? totalOf(rows) : sum(rows.filter((r) => r.inTotal));
  const openingTotal = cents(prior?.closing || 0);
  return {
    key, label: def.label, totalLabel: def.totalLabel, rows, categories, total,
    count: rows.filter((r) => r.inTotal).reduce((n, r) => n + r.count, 0),
    priorDayAmount: sum(rows.filter((r) => r.inTotal), (r) => r.priorDayAmount),
    opening: openingTotal, closing: cents(openingTotal + total),
  };
}

function chargesSection(w) {
  const rows = [];
  const lines = captured(w);
  for (const dept of [...new Set(lines.map((r) => r.department || '—'))].sort()) {
    rows.push(row(w, { key: `dept:${dept}`, label: dept, group: 'By department', kind: 'chargesByDepartment', value: dept, category: 'captured' }));
  }
  for (const type of ['Order', 'Event', 'Procedure', 'Manual']) {
    rows.push(row(w, { key: `source:${type}`, label: type, group: 'By source', kind: 'chargesBySource', value: type, inTotal: false }));
  }
  rows.push(row(w, { key: 'late', label: 'Late charges', group: 'Late', kind: 'chargesLate', inTotal: false }));
  rows.push(row(w, { key: 'reversals', label: 'Reversals', group: 'Reversals', kind: 'chargesReversed', category: 'reversed' }));
  return section(w, 'charges', rows);
}

function claimsSection(w) {
  const rows = [
    row(w, { key: 'created', label: 'Batches created', group: 'Batches', kind: 'batchesCreated', category: 'created', inTotal: false }),
    row(w, { key: 'submitted', label: 'Batches submitted', group: 'Batches', kind: 'batchesSubmitted', category: 'submitted' }),
    row(w, { key: 'acknowledged', label: 'Batches acknowledged', group: 'Batches', kind: 'batchesAcknowledged', category: 'acknowledged', inTotal: false }),
    row(w, { key: 'rejections', label: 'Rejections', group: 'Sent back', kind: 'rejections', category: 'rejected', inTotal: false }),
    row(w, { key: 'nullifications', label: 'Nullifications', group: 'Withdrawn', kind: 'nullifications', category: 'nullified', inTotal: false }),
  ];
  return section(w, 'claims', rows);
}

function payerCashSection(w) {
  const rows = [
    row(w, { key: 'captured', label: 'Remittances captured', group: 'Remittances', kind: 'remittancesCaptured', category: 'captured', inTotal: false }),
    row(w, { key: 'posted', label: 'Remittances posted (paid)', group: 'Remittances', kind: 'remittancesPosted', category: 'posted' }),
    row(w, { key: 'adjusted', label: 'Contractual adjustments', group: 'Remittances', kind: 'contractualAdjustments', category: 'adjusted', inTotal: false }),
    row(w, { key: 'denied', label: 'Denials created', group: 'Denials', kind: 'denialsCreated', category: 'denied', inTotal: false }),
    row(w, { key: 'unappliedHeld', label: 'Unapplied cash held', group: 'Unapplied cash', kind: 'unappliedHeld', category: 'unappliedHeld', inTotal: false }),
    row(w, { key: 'unappliedReleased', label: 'Unapplied cash applied / refunded / adjusted', group: 'Unapplied cash', kind: 'unappliedReleased', category: 'unappliedReleased', inTotal: false }),
    row(w, { key: 'handoffs', label: 'Defensio hand-offs', group: 'Hand-offs', kind: 'handoffs', category: 'handoffs', inTotal: false }),
  ];
  const s = section(w, 'payerCash', rows);
  const unposted = w.remittances.filter((r) => r.status === 'Unposted');
  s.unposted = { count: unposted.length, amount: sum(unposted, (r) => r.payment.total) };
  return s;
}

function patientCashSection(w) {
  const rows = [];
  for (const m of METHODS) rows.push(row(w, { key: `method:${m}`, label: m, group: 'By method', kind: 'cashByMethod', value: m }));
  for (const s of w.sessions) {
    rows.push(row(w, { key: `session:${s.id}`, label: `${s.id} · ${s.cashier} (${s.status})`, group: 'By session', kind: 'cashBySession', value: s.id, inTotal: false }));
  }
  rows.push(row(w, { key: 'unattached', label: 'Not attached to a session', group: 'By session', kind: 'cashUnattached', inTotal: false }));
  rows.push(row(w, { key: 'payments', label: 'Payments received', group: 'Payments', kind: 'ledgerType', value: 'Payment', category: 'payments', inTotal: false }));
  rows.push(row(w, { key: 'depositsHeld', label: 'Deposits held', group: 'Deposits', kind: 'ledgerType', value: 'DepositHeld', category: 'depositsHeld', inTotal: false }));
  rows.push(row(w, { key: 'depositsApplied', label: 'Deposits applied to charges', group: 'Deposits', kind: 'ledgerType', value: 'DepositApplied', inTotal: false }));
  rows.push(row(w, { key: 'depositsRefunded', label: 'Deposits refunded', group: 'Deposits', kind: 'ledgerType', value: 'DepositRefund', category: 'depositsRefunded', inTotal: false }));
  rows.push(row(w, { key: 'refunds', label: 'Refunds', group: 'Refunds', kind: 'ledgerType', value: 'Refund', category: 'refunds', inTotal: false }));
  rows.push(row(w, { key: 'reversals', label: 'Reversals of cash', group: 'Refunds', kind: 'cashReversals', category: 'reversals', inTotal: false }));
  return section(w, 'patientCash', rows);
}

function adjustmentsSection(w) {
  const rows = [
    row(w, { key: 'patientAdjustments', label: 'Patient-side adjustments (desk)', group: 'Patient side', kind: 'patientAdjustments', category: 'patientAdjustments' }),
    row(w, { key: 'patientWriteoffs', label: 'Patient-side write-offs (register)', group: 'Patient side', kind: 'patientWriteoffs', category: 'patientWriteoffs' }),
    row(w, { key: 'payerWriteoffs', label: 'Payer-side write-offs (register)', group: 'Payer side', kind: 'payerWriteoffs', category: 'payerWriteoffs' }),
    row(w, { key: 'reversals', label: 'Reversals', group: 'Reversals', kind: 'adjustmentReversals', category: 'reversals' }),
  ];
  return section(w, 'adjustments', rows);
}

// --- checks --------------------------------------------------------------------------------

function check(key, status, summary, figures = [], offenders = [], world) {
  const def = CHECKS.find((c) => c.key === key);
  const documented = (world.exceptions || []).find((e) => e.checkKey === key) || null;
  return { key, label: def.label, hint: def.hint, status, summary, figures, offenders, documented };
}

function cashIntegrity(w, sections) {
  const s = sections.find((x) => x.key === 'patientCash');
  const byMethod = sum(s.rows.filter((r) => r.group === 'By method'));
  const bySession = sum(s.rows.filter((r) => r.group === 'By session' && r.key !== 'unattached'));
  const total = sum(cashRows(w), cashEffect);
  const loose = unattached(w);
  const ok = !loose.length && same(byMethod, bySession) && same(byMethod, total);
  const offenders = loose.map((r) => ({
    ...ledgerTx(w, r), action: 'attach',
    actionLabel: w.sessions.some((x) => x.cashier === r.by && x.status === 'Open') ? `Attach to ${r.by}’s open session` : `Open a session for ${r.by} and attach`,
  }));
  return check('cashIntegrity', ok ? 'OK' : 'RED',
    ok ? `${usd(byMethod)} by method = ${usd(bySession)} in sessions = ${usd(total)} patient cash`
      : `${loose.length} receipt${loose.length === 1 ? '' : 's'} (${usd(sum(loose, cashEffect))}) in no session — ${usd(bySession)} in sessions against ${usd(total)} patient cash`,
    [['By method', byMethod], ['In sessions', bySession], ['Patient cash total', total], ['Not in a session', sum(loose, cashEffect)]], offenders, w);
}

function payerPostingEquation(w, sections) {
  const s = sections.find((x) => x.key === 'payerCash');
  const touched = [...new Set(postings(w).map((p) => p.rem))];
  const figures = { paid: 0, adjusted: 0, denied: 0, unapplied: 0, pending: 0, total: 0 };
  const offenders = [];
  for (const rem of touched) {
    const live = livePostings(rem).map((p) => p.id);
    const posted = rem.claims.filter((r) => r.posted && live.includes(r.postingId)).flatMap((r) => r.lines);
    const paid = sum(posted, (l) => l.paid);
    const held = sum(w.unapplied.filter((u) => u.remittanceNo === rem.remittanceNo && live.includes(u.postingId)));
    const pending = sum(rem.claims.filter((r) => !r.posted).flatMap((r) => r.lines), (l) => l.paid);
    figures.paid = cents(figures.paid + paid);
    figures.adjusted = cents(figures.adjusted + sum(posted, (l) => l.adjustment));
    figures.denied = cents(figures.denied + sum(posted, (l) => l.denied));
    figures.unapplied = cents(figures.unapplied + held);
    figures.pending = cents(figures.pending + pending);
    figures.total = cents(figures.total + rem.payment.total);
    if (!same(paid + held + pending, rem.payment.total)) {
      offenders.push({
        id: rem.remittanceNo, at: rem.updatedAt, repo: 'remittances', amount: cents(rem.payment.total - paid - held - pending),
        label: `${rem.remittanceNo} · ${w.names.payer(rem.payerId)}`, sub: `${usd(paid)} paid + ${usd(held)} unapplied + ${usd(pending)} to post ≠ ${usd(rem.payment.total)}`,
        href: `#/claima/remittances/${rem.remittanceNo}`, priorDay: false,
      });
    }
  }
  const ok = !offenders.length;
  return check('payerPostingEquation', ok ? 'OK' : 'RED',
    touched.length
      ? `${usd(figures.paid)} paid + ${usd(figures.unapplied)} unapplied${figures.pending ? ` + ${usd(figures.pending)} still to post` : ''} ${ok ? '=' : '≠'} ${usd(figures.total)} over ${touched.length} remittance${touched.length === 1 ? '' : 's'} posted today`
      : `No remittance posted today — ${usd(s.total)} to reconcile`,
    [['Paid', figures.paid], ['Contractual adjustments', figures.adjusted], ['Denied', figures.denied], ['Unapplied', figures.unapplied],
      ['Still to post', figures.pending], ['Remittance totals', figures.total]], offenders, w);
}

function openingMovementClosing(w, sections) {
  const offenders = [];
  for (const s of sections) {
    for (const c of s.categories) {
      if (!same(c.opening + c.movement, c.closing)) offenders.push({ id: `${s.key}:${c.key}`, label: `${s.label} · ${c.label}`, sub: `${usd(c.opening)} + ${usd(c.movement)} ≠ ${usd(c.closing)}`, amount: cents(c.closing - c.opening - c.movement), href: '', priorDay: false });
      const prior = w.priorSnapshot?.sections?.find((x) => x.key === s.key)?.categories?.find((x) => x.key === c.key);
      if (prior && !same(prior.closing, c.opening)) offenders.push({ id: `${s.key}:${c.key}:carry`, label: `${s.label} · ${c.label}`, sub: `opening ${usd(c.opening)} ≠ prior closing ${usd(prior.closing)}`, amount: cents(c.opening - prior.closing), href: '', priorDay: false });
    }
  }
  const prev = w.previousDay;
  if (prev && prev.status !== 'Closed') {
    offenders.push({ id: prev.date, label: `Business day ${prev.date} is still ${prev.status.toLowerCase()}`, sub: 'Opening balances are carried from the last closed report — close the earlier day first', amount: 0, href: `#/claima/dtr/${prev.date}`, priorDay: false });
  }
  const carried = w.priorSnapshot ? `carried from ${w.priorSnapshot.date} (${w.priorSnapshot.dtrNo || 'closed'})` : 'first report in the register — opening balances start at zero';
  const n = sections.reduce((k, s) => k + s.categories.length, 0);
  return check('openingMovementClosing', offenders.length ? 'RED' : 'OK',
    offenders.length ? `${offenders.length} categor${offenders.length === 1 ? 'y' : 'ies'} out of step — ${carried}` : `${n} categories reconcile — ${carried}`,
    sections.map((s) => [s.label, s.closing]), offenders, w);
}

function writeoffReconciliation(w, sections) {
  const s = sections.find((x) => x.key === 'adjustments');
  const a = s.rows.find((r) => r.key === 'payerWriteoffs').amount;
  const b = cents(w.writeoffTotals?.payer);
  const denialSourced = cents(w.writeoffTotals?.denialSourced);
  const posted = w.writeoffs.filter((x) => x.side === 'Payer' && x.posting && day(x.posting.at) === w.date && x.status !== 'Reversed' && x.source?.kind === 'Denial');
  const c = sum(posted, (x) => Math.min(x.amountPosted, w.names.denialWrittenOff(x.source.ref)));
  const offenders = [];
  if (!same(a, b)) offenders.push({ id: 'register', label: 'Section 5 payer-side ≠ register posted totals', sub: `${usd(a)} on the report against ${usd(b)} from writeoffs.postedTotals`, amount: cents(a - b), href: '#/claima/writeoffs?status=Posted', priorDay: false });
  for (const x of posted) {
    const ack = w.names.denialWrittenOff(x.source.ref);
    if (ack + 0.005 < x.amountPosted) offenders.push({ ...writeoffTx(w, x, x.amountPosted, x.posting.at), sub: `denial ${x.source.ref} acknowledges ${usd(ack)} of ${usd(x.amountPosted)}` });
  }
  if (!same(denialSourced, c)) offenders.push({ id: 'denials', label: 'Denial-sourced write-offs ≠ denials written off', sub: `${usd(denialSourced)} posted against ${usd(c)} acknowledged on the denials`, amount: cents(denialSourced - c), href: '#/claima/denials?status=Written%20Off', priorDay: false });
  const ok = !offenders.length;
  return check('writeoffReconciliation', ok ? 'OK' : 'RED',
    ok ? `${usd(a)} payer-side = ${usd(b)} register = ${usd(c)} on the denials` : `${usd(a)} payer-side · ${usd(b)} register · ${usd(c)} on the denials`,
    [['Section 5 payer-side', a], ['Register posted totals', b], ['Denial-sourced', denialSourced], ['Denials written off', c]], offenders, w);
}

function allSessionsClosed(w) {
  const open = w.sessions.filter((s) => s.status === 'Open');
  const offenders = open.map((s) => ({
    id: s.id, at: s.openedAt, repo: 'sessions', amount: sum(Object.values(systemTotals(s, w.ledger)), (n) => n),
    label: `${s.id} · ${s.cashier}`, sub: `open since ${String(s.openedAt).slice(11, 16)}`, href: '', priorDay: false, action: 'close-session', actionLabel: 'Close session',
  }));
  return check('allSessionsClosed', open.length ? 'RED' : 'OK',
    open.length ? `${open.length} of ${w.sessions.length} session${w.sessions.length === 1 ? '' : 's'} still open` : `${w.sessions.length} session${w.sessions.length === 1 ? '' : 's'}, all closed`,
    [['Sessions', w.sessions.length, 'count'], ['Open', open.length, 'count']], offenders, w);
}

// --- the report -----------------------------------------------------------------------------

/** compute(world) → the full DTR for world.date. What the archive freezes and the screen draws. */
export function compute(world) {
  const sections = [chargesSection(world), claimsSection(world), payerCashSection(world), patientCashSection(world), adjustmentsSection(world)];
  const checks = [cashIntegrity(world, sections), payerPostingEquation(world, sections), openingMovementClosing(world, sections),
    writeoffReconciliation(world, sections), allSessionsClosed(world)];
  const sessions = world.sessions.map((s) => ({
    id: s.id, cashier: s.cashier, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt, receipts: (s.txIds || []).length,
    systemTotals: s.status === 'Closed' && s.systemTotals ? s.systemTotals : systemTotals(s, world.ledger),
    declared: s.declared, variance: s.variance, varianceReason: s.varianceReason, countersign: s.countersign,
  }));
  return {
    date: world.date, computedAt: new Date().toISOString(), sections, checks, sessions,
    priorDate: world.priorSnapshot?.date || null,
    redCount: checks.filter((c) => c.status === 'RED').length,
    undocumentedReds: checks.filter((c) => c.status === 'RED' && !c.documented).length,
  };
}

/** The compact shape dtr.today() publishes to the module home. */
export function compact(report, dayRow = null) {
  const by = (key) => report.sections.find((s) => s.key === key);
  const patient = by('patientCash');
  return {
    date: report.date,
    status: dayRow?.status || 'Open',
    dtrNo: dayRow?.versions?.slice(-1)[0]?.dtrNo || null,
    version: dayRow?.versions?.length || 0,
    sections: Object.fromEntries(report.sections.map((s) => [s.key, {
      total: s.total, count: s.count, label: s.label, totalLabel: s.totalLabel,
      ...(s.key === 'patientCash' ? { byMethod: Object.fromEntries(METHODS.map((m) => [m, patient.rows.find((r) => r.key === `method:${m}`)?.amount || 0])) } : {}),
      ...(s.key === 'payerCash' ? { unposted: s.unposted } : {}),
    }])),
    checks: report.checks.map((c) => ({ key: c.key, label: c.label, status: c.status, count: c.offenders.length, documented: Boolean(c.documented), summary: c.summary })),
    redCount: report.redCount,
    undocumentedReds: report.undocumentedReds,
    sessions: report.sessions.length,
    openSessions: report.sessions.filter((s) => s.status === 'Open').length,
    computedAt: report.computedAt,
  };
}

/** The Excel export, built from a snapshot alone. */
export function csvOf(snapshot, meta = {}) {
  const line = (vals) => vals.map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))).join(',');
  const out = [line(['Daily transaction report', snapshot.date, meta.dtrNo || '', meta.status || '', meta.closedBy || '', meta.closedAt || ''])];
  out.push(line(['Section', 'Group', 'Row', 'Count', 'Movement', 'Of which prior-day', 'In total']));
  for (const s of snapshot.sections) {
    for (const r of s.rows) out.push(line([s.label, r.group, r.label, r.count, r.amount, r.priorDayAmount, r.inTotal ? 'yes' : 'no']));
    out.push(line([s.label, 'Total', s.totalLabel, s.count, s.total, s.priorDayAmount, 'yes']));
  }
  out.push('');
  out.push(line(['Section', 'Category', 'Opening', 'Movement', 'Closing']));
  for (const s of snapshot.sections) for (const c of s.categories) out.push(line([s.label, c.label, c.opening, c.movement, c.closing]));
  out.push('');
  out.push(line(['Check', 'Status', 'Summary', 'Exception']));
  for (const c of snapshot.checks) out.push(line([c.label, c.status, c.summary, c.documented ? `${c.documented.note} — ${c.documented.by}` : '']));
  out.push('');
  out.push(line(['Session', 'Cashier', 'Status', 'Opened', 'Closed', ...METHODS.map((m) => `System ${m}`), ...METHODS.map((m) => `Declared ${m}`), 'Variance', 'Reason', 'Countersigned by']));
  for (const s of snapshot.sessions) {
    out.push(line([s.id, s.cashier, s.status, s.openedAt, s.closedAt || '', ...METHODS.map((m) => s.systemTotals?.[m] ?? 0),
      ...METHODS.map((m) => s.declared?.[m] ?? ''), s.variance ? s.variance.total : '', s.varianceReason || '', s.countersign?.by || '']));
  }
  return out.join('\n');
}

/** The tone a check's badge wears. */
export const checkTone = (status) => (status === 'RED' ? 'critical' : 'success');
