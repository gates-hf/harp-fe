// Seed — submission batches (amendment 28). Six batches over three payers in
// every state a batch passes through, written as a table of intents — this
// payer, this many claims, sent this way, answered like this — and built by
// the repository's own row factory, so a seeded batch is the same shape a
// live one is. The claims are the generated in-flight rows data/seed/claims.js
// wrote (newest first per payer; the remittance seed takes the oldest), and
// each is stamped with the batch, the cycle and the answer the batch gave it.
//
// data/store.js does not import this file: data/repositories/batches.js reads
// it on first read of an empty table and hands it `rowFor` and `log`. It
// reads the claims repository, which never reads batches, so the graph stays
// acyclic. Nothing here commits — a seed never does.

import { store } from '../store.js';
import * as audit from '../repositories/audit.js';
import * as claims from '../repositories/claims.js';
import { rejectionLabel } from './rejection-reasons.js';

const DESK = 'Tarek Solh';

/** An ISO timestamp `n` days before today, at the given hour. */
function ago(n, time = '09:00') {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.toISOString().slice(0, 10)}T${time}:00`;
}
const day = (at) => String(at).slice(0, 10);

/**
 * One intent per batch. `claims` is how many to take from the payer's pool;
 * `answers` is what the acknowledgment said per position (A accepted,
 * R<code> rejected); `resubmitted` names the position whose rejection was
 * already fixed and which now rides the Open batch as cycle 2.
 */
const INTENTS = [
  { no: 'BAT-2026-000137', payerId: 'PY-0025', claims: 4, createdAt: ago(14, '10:20'),
    generated: [ago(14, '10:25')],
    submitted: { at: ago(12, '11:05'), method: 'Portal upload', reference: 'BUPA-GL-2026-0912' },
    acknowledged: { at: ago(9, '15:40'), payerRef: 'BG-ACK-77120', document: 'bg-ack-77120.pdf' },
    answers: ['A', 'A', 'A', 'A'] },

  { no: 'BAT-2026-000138', payerId: 'PY-0001', claims: 5, createdAt: ago(20, '09:10'),
    generated: [ago(20, '09:15')],
    submitted: { at: ago(18, '08:50'), method: 'API', reference: 'NSSF-E-4471' },
    acknowledged: { at: ago(15, '14:20'), payerRef: 'CNSS-9931', document: 'cnss-9931-ack.pdf' },
    answers: ['A', 'R01', 'A', 'R05', 'R02'],
    notes: {
      R01: 'Member number does not match the fund’s register for this plan',
      R05: 'Received after the 30-day filing window',
      R02: 'Attending doctor missing on line 1',
    },
    resubmitted: { position: 4, fixedAt: ago(3, '10:30'), readyAt: ago(2, '16:10') } },

  { no: 'BAT-2026-000139', payerId: 'PY-0002', claims: 4, createdAt: ago(7, '13:30'),
    generated: [ago(7, '13:40')],
    submitted: { at: ago(6, '09:20'), method: 'Courier', reference: 'DHL 4471 2210 3' } },

  { no: 'BAT-2026-000140', payerId: 'PY-0025', claims: 4, createdAt: ago(5, '10:00'),
    generated: [ago(5, '10:05')],
    submitted: { at: ago(4, '11:30'), method: 'SFTP', reference: 'bupa_20260906_01.jsonl' } },

  { no: 'BAT-2026-000141', payerId: 'PY-0002', claims: 3, createdAt: ago(2, '14:10'),
    generated: [ago(2, '14:15'), ago(1, '09:40')],
    regenerated: 'Cover sheets regenerated after the discharge summary was attached' },

  { no: 'BAT-2026-000142', payerId: 'PY-0001', claims: 2, createdAt: ago(0, '08:40'),
    generated: [],
    exclusions: [
      'Awaiting the discharge summary the fund asks for',
      'Member ID under query with the fund — hold until answered',
    ] },
];

/**
 * buildBatches({ rowFor, log, files }) — pushes the six batches, stamps the
 * claims they hold, writes both trails with the times things happened at.
 */
export function buildBatches({ rowFor, log, files }) {
  const pool = poolOf();
  const entries = audit.all();
  const trail = (claim, at, action, details) => entries.push({
    id: store.nextId('audit', 'AU-'), entity: 'claims', entityId: claim.id, action, user: DESK, at, details,
  });
  let resubmitted = null;

  for (const intent of INTENTS) {
    const row = rowFor(intent.payerId, { batchNo: intent.no, createdAt: intent.createdAt, by: DESK });
    // Every picked claim was finalized the day before the batch opened, so
    // it has to have existed by then.
    const finalizedAt = ago(daysBetween(intent.createdAt) + 1, '16:30');
    const picked = take(pool, intent.payerId, intent.claims + (intent.exclusions?.length || 0), finalizedAt)
      // A member-ID rejection needs a member: the claims with a policy on file lead.
      .sort((a, b) => Number(Boolean(b.policyId)) - Number(Boolean(a.policyId)));
    const included = picked.slice(0, intent.claims);
    const excluded = picked.slice(intent.claims);

    for (const c of picked) {
      Object.assign(c, {
        status: 'Ready', submittedAt: null, submission: null, acknowledgedAt: null, rejection: null,
        cycle: 1, previousCycleNo: null, nextCycleNo: null, cycles: [], rejectedCycle: null,
        finalizedAt, scrubValid: true,
        scrubRuns: [{ id: 'SR-001', at: finalizedAt, by: DESK, contractNo: null, contractVersion: null, findings: [], result: 'Pass', acknowledgments: [] }],
      });
      trail(c, finalizedAt, 'Status', `Draft → Ready — Finalized — Pass`);
    }

    // The cycle-2 claim rides the Open batch; it is the one the rejected batch sent back.
    if (intent.no === 'BAT-2026-000142' && resubmitted) included.unshift(resubmitted);

    for (const c of included) {
      row.claimNos.push(c.claimNo);
      row.claimCycles[c.claimNo] = c.cycle || 1;
      c.batchId = row.batchNo;
      trail(c, intent.createdAt, 'Batched', `Included in ${row.batchNo}${(c.cycle || 1) > 1 ? ` · cycle ${c.cycle}` : ''}`);
    }
    for (const c of excluded) trail(c, intent.createdAt, 'Batched', `Included in ${row.batchNo}`);
    log(row, 'Created', `${row.mode} · ${included.length} claim${included.length === 1 ? '' : 's'} · ${row.claimNos.join(', ')}`, { at: intent.createdAt });

    for (const [i, reason] of (intent.exclusions || []).entries()) {
      const c = excluded[i];
      if (!c) continue;
      const at = ago(0, `08:${52 + i * 3}`);
      row.exclusions.push({ claimNo: c.claimNo, reason, by: DESK, at });
      trail(c, at, 'Unbatched', `Excluded from ${row.batchNo} — ${reason}`);
      log(row, 'Claim excluded', `${c.claimNo} — ${reason}`, { at });
    }

    for (const [i, at] of intent.generated.entries()) {
      const version = i + 1;
      const built = files.build(row, included, { version, at });
      for (const f of built) row.files.push({ version, generatedAt: at, by: DESK, ...f });
      row.status = 'Generated';
      log(row, 'Generated', `v${version} · ${built.map((f) => f.fileName).join(', ')} · ${included.length} claim${included.length === 1 ? '' : 's'}${
        version > 1 && intent.regenerated ? ` — ${intent.regenerated}` : ''}`, { at });
    }

    if (intent.submitted) {
      const s = intent.submitted;
      row.submission = { at: s.at, by: DESK, method: s.method, reference: s.reference, fileVersion: intent.generated.length };
      row.status = 'Submitted';
      for (const c of included) {
        Object.assign(c, { status: 'Submitted', submittedAt: day(s.at), submission: { batchNo: row.batchNo, at: s.at, method: s.method, reference: s.reference } });
        trail(c, s.at, 'Status', `Ready → Submitted — Submitted — ${row.batchNo} · cycle 1 · ${s.method} · ${s.reference}`);
      }
      log(row, 'Submitted', `${s.method} · ${s.reference} · v${row.submission.fileVersion} · ${included.length} claim${included.length === 1 ? '' : 's'}`, { at: s.at });
    }

    if (intent.acknowledged) {
      const a = intent.acknowledged;
      const answers = intent.answers || [];
      const rejectedCount = answers.filter((x) => x !== 'A').length;
      row.acknowledgment = {
        at: a.at, payerRef: a.payerRef, receivedCount: included.length, acceptedCount: included.length - rejectedCount,
        rejectedCount, document: a.document || null, by: DESK,
      };
      for (const [i, c] of included.entries()) {
        const answer = answers[i] || 'A';
        if (answer === 'A') {
          Object.assign(c, { status: 'Acknowledged', acknowledgedAt: a.at });
          trail(c, a.at, 'Status', `Submitted → Acknowledged — Acknowledged — ${row.batchNo} · payer ref ${a.payerRef}`);
          continue;
        }
        const reason = intent.notes?.[answer] || rejectionLabel(answer);
        const at = ago(daysBetween(a.at), '15:55');
        row.rejections.push({ claimNo: c.claimNo, code: answer, reason, document: a.document || null, at, by: DESK });
        Object.assign(c, { status: 'Rejected', rejection: { code: answer, reason, at, batchNo: row.batchNo } });
        trail(c, at, 'Status', `Submitted → Rejected — Rejected ${answer} — ${rejectionLabel(answer)} — ${reason} · ${row.batchNo}`);
        log(row, 'Rejection recorded', `${c.claimNo} — ${answer} ${rejectionLabel(answer)} — ${reason}`, { at });
      }
      row.status = rejectedCount === 0 ? 'Acknowledged' : rejectedCount >= included.length ? 'Rejected' : 'Partially Rejected';
      log(row, 'Acknowledged', `${a.payerRef} · received ${included.length} · accepted ${included.length - rejectedCount} · rejected ${rejectedCount}`, { at: a.at });

      // One rejection was already taken up: fixed at the desk, finalized again,
      // and waiting on the next cycle for the fund's open batch.
      if (intent.resubmitted) {
        const c = included[intent.resubmitted.position];
        const { fixedAt, readyAt } = intent.resubmitted;
        const r = c.rejection;
        trail(c, fixedAt, 'Status', `Rejected → Draft — Fix & resubmit — ${r.code} — ${rejectionLabel(r.code)} · fix: Refresh`);
        trail(c, readyAt, 'Status', `Draft → Ready — Resubmitted as filed — Refresh fix made at the desk`);
        trail(c, readyAt, 'Resubmitted', `Cycle 1 closed (${r.code} — ${rejectionLabel(r.code)}) · cycle 2 Ready`);
        Object.assign(c, {
          status: 'Ready', batchId: null, submittedAt: null, submission: null, acknowledgedAt: null, rejection: null,
          cycle: 2, previousCycleNo: 1, nextCycleNo: null, finalizedAt: readyAt, scrubValid: true,
          scrubRuns: [...c.scrubRuns, { id: 'SR-002', at: readyAt, by: DESK, contractNo: null, contractVersion: null, findings: [], result: 'Pass', acknowledgments: [] }],
          cycles: [{ cycle: 1, batchNo: row.batchNo, submittedAt: intent.submitted.at, acknowledgedAt: null, rejection: { ...r }, nextCycleNo: 2 }],
          rejectedCycle: { cycle: 1, batchNo: row.batchNo, code: r.code, reason: r.reason, at: r.at },
        });
        resubmitted = c;
      }
    }
  }
}

// --- the claims a batch takes -----------------------------------------------------------

/** Generated in-flight claims by payer, newest submission first. */
function poolOf() {
  const pool = new Map();
  const rows = claims.all()
    .filter((c) => !c.encounterNo && !c.batchId && (c.status === 'Submitted' || c.status === 'Acknowledged'))
    .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')) || b.claimNo.localeCompare(a.claimNo));
  for (const c of rows) (pool.get(c.payerId) || pool.set(c.payerId, []).get(c.payerId)).push(c);
  return pool;
}

/**
 * The next `n` of the payer's pool that existed before the batch opened — a
 * claim batched before it was created would read backwards on a timeline.
 * A pool short of such claims gives what it has.
 */
function take(pool, payerId, n, before) {
  const list = pool.get(payerId) || [];
  const out = [];
  let i = 0;
  while (i < list.length && out.length < n) {
    if (String(list[i].createdAt) <= String(before)) out.push(list.splice(i, 1)[0]);
    else i += 1;
  }
  if (out.length < n) out.push(...list.splice(0, n - out.length));
  return out;
}

const daysBetween = (at, on = new Date()) => Math.max(0, Math.round((on - Date.parse(at)) / 86400000));
