// Seed — claim nullifications (amendment 32). Six withdrawals, one per path
// and gate the feature has: a finalized claim pulled from the batch it was
// waiting in and rebuilt fresh; an acknowledged claim the payer was told
// about through its portal; a claim rejected twice whose chain the desk
// ends; a visit classified on a plan the hospital holds no agreement for,
// re-classified to self-pay; a claim worth more than the threshold, signed
// by two people; and a charge returned to the pool on hold because it was
// captured on the wrong visit.
//
// Every record is written through the repository's own `nullify`, dated, so a
// seeded nullification did to its claim, its batch and its charge lines
// exactly what a live one does — the claim is Void, the lines say where they
// came back from, the replacement was assembled by the engine. data/store.js
// does not import this file: data/repositories/nullifications.js reads it once
// the claim repository's peers have settled and hands it `nullify`.
//
// The claims are found by what they are rather than by number: the assembled
// claims by their visit, the generated ones by their state, and never one
// another seed has already written a trail on.

import { store } from '../store.js';
import * as audit from '../repositories/audit.js';
import * as claims from '../repositories/claims.js';
import * as batches from '../repositories/batches.js';
import { todayIso, compareDates } from '../../shared/format.js';

const DESK = 'Tarek Solh';
const CMO = 'Georges Khoury';

/** The seeded numbers run 13–18, so the first live nullification is NUL-2026-000019. */
const FIRST_NO = 13;

/** An ISO timestamp `n` days before today, at the given time. */
function ago(n, time = '09:00') {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.toISOString().slice(0, 10)}T${time}:00`;
}
const day = (at) => String(at).slice(0, 10);
const plusDays = (isoDay, n) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from, to) => Math.round((Date.parse(`${day(to)}T00:00:00Z`) - Date.parse(`${day(from)}T00:00:00Z`)) / 86400000);
const untouched = (c) => !audit.forEntity('claims', c.id).length;
const notBefore = (claim, when) => (String(claim.createdAt) > when ? claim.createdAt : when);

/**
 * buildNullifications({ nullify, get }) → whether anything was written. Runs
 * the six intents in date order, so the numbers read in the order the
 * withdrawals happened; an intent whose claim cannot be found is skipped and
 * the rest still seed.
 */
export function buildNullifications({ nullify, threshold }) {
  let n = 0;
  for (const intent of INTENTS) {
    const claim = intent.pick({ threshold: Number(threshold) || 0 });
    if (!claim) continue;
    intent.prepare?.(claim);
    const res = nullify(claim.claimNo, intent.form(claim), {
      no: `NUL-${intent.at.slice(0, 4)}-${String(FIRST_NO + INTENTS.indexOf(intent)).padStart(6, '0')}`,
      at: intent.at, by: intent.by || DESK, actors: intent.actors || { requestedBy: intent.by || DESK, approvedBy: null },
    });
    if (res.error) {
      console.warn('[nullifications seed]', claim.claimNo, res.error);
      continue;
    }
    intent.after?.(res, claim);
    n += 1;
  }
  return n > 0;
}

/** A trail entry on a claim, dated. */
function trail(claim, when, action, details, user = DESK) {
  audit.all().push({ id: store.nextId('audit', 'AU-'), entity: 'claims', entityId: claim.id, action, user, at: when, details });
}

/** The seed's clock on the last entry of one kind the repository just wrote. */
function restampLast(entity, entityId, action, when, user = DESK) {
  const entries = audit.all();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.entity === entity && e.entityId === entityId && e.action === action) {
      e.at = when;
      e.user = user;
      return;
    }
  }
}

const assembledOn = (encounterNo, status = null) =>
  claims.all().find((c) => c.kind === 'Primary' && c.encounterNo === encounterNo && c.status !== 'Void' && (!status || c.status === status)) || null;

const INTENTS = [
  // 1. End of chain — a generated claim rejected on its second cycle. The
  // first went back for a missing attending doctor, the fix went out after
  // the filing window in the contract had closed, and AXA said it will not
  // take a third. The two cycles are written onto the claim the way the
  // submission feature writes them, with no batch — the generated rows were
  // submitted before batches existed, which is that dataset's own convention.
  {
    at: ago(12, '10:05'),
    pick() {
      const today = todayIso();
      const ok = (c) => claims.isPending(c) && !c.batchId && !c.encounterNo && untouched(c)
        && daysBetween(c.dateOfService, today) >= 60 && daysBetween(c.dateOfService, today) <= 90 && c.totals.payerShare >= 30;
      const pool = claims.all().filter(ok).sort((a, b) => compareDates(b.dateOfService, a.dateOfService) || a.claimNo.localeCompare(b.claimNo));
      return pool.find((c) => c.payerId === 'PY-0008') || pool[0] || null;
    },
    prepare(c) {
      const dos = c.dateOfService;
      const sub1 = notBefore(c, `${plusDays(dos, 4)}T09:20:00`);
      const rej1 = `${plusDays(day(sub1), 7)}T14:10:00`;
      const fixed = `${plusDays(day(rej1), 3)}T10:30:00`;
      const ready = `${plusDays(day(rej1), 4)}T16:05:00`;
      const sub2 = `${plusDays(dos, 33)}T09:40:00`;
      const rej2 = `${plusDays(dos, 41)}T11:15:00`;
      const limit = plusDays(dos, 30);
      Object.assign(c, {
        cycle: 2, previousCycleNo: 1, nextCycleNo: null,
        cycles: [{ cycle: 1, batchNo: null, submittedAt: sub1, acknowledgedAt: null,
          rejection: { code: 'R02', reason: 'Attending doctor missing on line 1', at: rej1, batchNo: null }, nextCycleNo: 2 }],
        submittedAt: day(sub2), submission: { batchNo: null, at: sub2, method: 'Portal upload', reference: `AXA-P-${day(sub2).replace(/-/g, '')}-07` },
        acknowledgedAt: null, rejectedCycle: null, status: 'Rejected',
        rejection: { code: 'R05', reason: `Filing limit exceeded — the 30-day window from the date of service closed on ${limit}`, at: rej2, batchNo: null },
      });
      trail(c, sub1, 'Status', 'Ready → Submitted — Submitted — cycle 1 · Portal upload');
      trail(c, rej1, 'Status', 'Submitted → Rejected — Rejected R02 — Missing or invalid data — Attending doctor missing on line 1');
      trail(c, fixed, 'Status', 'Rejected → Draft — Fix & resubmit — R02 — Missing or invalid data');
      trail(c, ready, 'Status', 'Draft → Ready — Resubmitted as filed — Attending doctor added at the desk');
      trail(c, ready, 'Resubmitted', 'Cycle 1 closed (R02 — Missing or invalid data) · cycle 2 Ready');
      trail(c, sub2, 'Status', 'Ready → Submitted — Submitted — cycle 2 · Portal upload');
      trail(c, rej2, 'Status', `Submitted → Rejected — Rejected R05 — Filing limit exceeded — window closed on ${limit}`);
    },
    form: () => ({
      reasonCode: 'N05', justification: 'AXA rejected cycle 2 for the filing limit and confirmed by phone that no further submission will be taken — the first rejection was ours to fix and the window closed while it waited. Chain ended; the balance goes to write-off review.',
      disposition: 'ReturnToUnbilled', replace: false,
    }),
  },

  // 2. Above the threshold, two signatures — the largest acknowledged claim
  // still with its payer and in no batch: an admission billed off the wrong
  // visit sheet, the earlier admission's claim already paid.
  {
    at: ago(9, '09:40'),
    actors: { requestedBy: DESK, approvedBy: CMO },
    pick({ threshold }) {
      return claims.all()
        .filter((c) => c.status === 'Acknowledged' && !c.batchId && !c.encounterNo && untouched(c) && c.totals.payerShare >= threshold)
        .sort((a, b) => b.totals.payerShare - a.totals.payerShare)[0] || null;
    },
    form: (c) => ({
      reasonCode: 'N03',
      justification: `The charges belong to the patient’s earlier admission, whose claim ${c.payerId === 'PY-0007' ? 'Bankers' : 'the payer'} has already paid — this one was raised off the ward’s discharge list against the wrong visit sheet.`,
      notification: { method: 'Email', reference: `WD-${day(ago(9)).replace(/-/g, '')}-${c.claimNo.slice(-4)}`, date: day(ago(9)),
        note: 'Withdrawal sent to the claims desk with the paid claim’s reference; acknowledged the same morning.' },
      disposition: 'ReturnToUnbilled', replace: false,
    }),
  },

  // 3. Payer notified — an acknowledged Bupa claim in the acknowledged batch,
  // a duplicate of an admission Bupa has already paid, withdrawn on the portal.
  {
    at: ago(6, '11:20'),
    pick() {
      const batch = batches.all().find((b) => b.status === 'Acknowledged' && b.payerId === 'PY-0025') || batches.all().find((b) => b.status === 'Acknowledged');
      const rows = batches.claimsOf(batch).filter((c) => c.status === 'Acknowledged').sort((a, b) => b.totals.payerShare - a.totals.payerShare);
      return rows[0] || null;
    },
    form: (c) => {
      const paid = claims.all().find((o) => o.payerId === c.payerId && o.status === 'Paid' && o.itemId === c.itemId && o.claimNo !== c.claimNo);
      return {
        reasonCode: 'N02',
        justification: `Duplicate — the same admission was already billed${paid ? ` on ${paid.claimNo}, which Bupa paid` : ' and paid'}; this claim was raised again from the ward’s list after the discharge summary was filed late.`,
        notification: { method: 'Portal', reference: `BG-WD-${day(ago(6)).replace(/-/g, '').slice(2)}-0447`, date: day(ago(6)),
          note: 'Withdrawal filed on the Bupa Global provider portal against the batch acknowledgment; ticket closed the next day.' },
        disposition: 'ReturnToUnbilled', replace: false,
      };
    },
  },

  // 4. Wrong payer — the clinic visit classified on the ISF plan Pactum holds
  // no agreement for, whose claim the scrub could never pass. The fund
  // confirms the cover; it does not bill direct. The visit is re-classified
  // to self-pay, the patient settles the account and claims back from the
  // fund, and there is no claim to assemble in its place.
  {
    at: ago(5, '15:30'),
    pick: () => assembledOn('ENC-2026-000404'),
    form: () => ({
      reasonCode: 'N01',
      justification: 'The ISF plan confirms the patient’s cover (eligibility override ref 4471) but holds no direct-billing agreement with the hospital, so the scrub fails on the contract and the claim can never go. Re-classified to self-pay: the patient settles the account and claims back from the fund.',
      disposition: 'ReturnToUnbilled', replace: true, reclassPolicyId: null,
    }),
  },

  // 5. Direct, with a fresh replacement — the finalized MOPH clinic claim was
  // added to the ministry’s monthly batch the afternoon it opened and pulled
  // two hours later: its coding was wrong from the ground up and the chart
  // went back to the coders. The replacement is assembled fresh and scrubbed;
  // it fails on "no coding" because the chart is still in the coding backlog,
  // and A27's coded hook refreshes it the moment the chart is marked coded —
  // which is the path the demo walks. Were the chart coded, it would be
  // finalized here and wait in the ready queue instead.
  {
    at: ago(2, '16:00'),
    pick: () => assembledOn('ENC-2026-000415', 'Ready'),
    prepare(c) {
      const batch = batches.all().find((b) => b.payerId === c.payerId && batches.isOpen(b));
      if (!batch) return;
      const added = ago(2, '14:12');
      batch.claimNos.push(c.claimNo);
      batch.claimCycles[c.claimNo] = claims.cycleOf(c);
      c.batchId = batch.batchNo;
      trail(c, added, 'Batched', `Included in ${batch.batchNo}`);
      audit.all().push({ id: store.nextId('audit', 'AU-'), entity: 'batches', entityId: batch.batchNo, action: 'Claims added', user: DESK, at: added,
        details: `1 · ${c.claimNo} — finalized ${day(c.finalizedAt || c.createdAt)}` });
    },
    form: () => ({
      reasonCode: 'N04',
      justification: 'The coding was wrong from the ground up — the principal diagnosis and both procedure links — and the chart is back with the coders. A refresh would carry the old shape forward, so the claim is withdrawn and assembled fresh; the replacement waits in draft for the recode.',
      disposition: 'ReturnToUnbilled', replace: true,
    }),
    after(res) {
      restampLast('claims', res.record.claimId, 'Unbatched', ago(2, '16:00'));
      // The removal took the batch back to Open; the submission seed's second
      // generation, the next morning, is what made it Generated again.
      const batch = batches.get(res.record.batchRemoved?.batchNo);
      if (batch && batch.files?.length > 1) batch.status = 'Generated';
      const fresh = res.replacement;
      if (!fresh) return;
      const run = claims.runScrub(fresh.id, { at: ago(2, '16:10'), by: DESK, silent: true });
      if (run) {
        const errors = run.findings.filter((f) => f.severity === 'Error').length;
        trail(fresh, ago(2, '16:10'), 'Scrubbed', `${run.result} — ${errors} error${errors === 1 ? '' : 's'}, ${run.findings.length - errors} warning${run.findings.length - errors === 1 ? '' : 's'}`);
      }
      if (claims.canFinalize(fresh).ok && claims.finalize(fresh.id, { at: ago(2, '16:15') })) {
        restampLast('claims', fresh.id, 'Status', ago(2, '16:15'));
      }
    },
  },

  // 6. Return and hold — the Allianz clinic claim whose one line, a blood
  // count, the lab feed captured on the wrong visit. The line goes back to
  // the pool on hold, with the capture desk’s own reason, until it is moved.
  {
    at: ago(1, '09:15'),
    pick: () => assembledOn('ENC-2026-000402', 'Draft'),
    form: () => ({
      reasonCode: 'N03',
      justification: 'The blood count was drawn on the 21 August visit (ENC-2026-000408) and the lab feed captured it here, on the 12 August clinic visit — the consultation on this visit was already reversed as posted on the wrong visit. Returned on hold for the capture desk to move it; nothing on this visit is left to bill.',
      disposition: 'ReturnAndHold', holdReason: 'Wrong encounter suspected', replace: false,
    }),
  },
];
