// Seed — denial patterns (amendment 40, Defensio F5). Hand-written intents
// driven through the denial register's own writes, the way the appeal seeds
// build theirs: the pattern engine detects over the register, so the seed's
// job is to put the denials on it that three patterns need and then let the
// pass find them. Nine denials are created on free generated Denied claims
// (no denial, batch, remittance or assembly kind on them) of the payer the
// pattern names — in the category it names, or any — the payer's reason
// restamped from the code the way the register's own seed does, since the
// register is what says why a claim was denied. Dated so that:
//
// - the Ministry (MOPH) has refused three lab panels for a missing
//   pre-authorisation inside the last five weeks, none triaged yet — the
//   New, accelerating pattern the Active risk rule is tied to (the amendment
//   says four on radiology; the free pool holds one radiology claim, so the
//   pattern is three on lab, exactly the threshold, and it fires live on the
//   Ministry's four draft claims that carry lab lines);
// - NSSF refused three lab panels the same way in July, all worked, and
//   DN-0016 this week is a fourth — the pattern Under plan (PP-0002), slowing;
// - NSSF refused a consultation, a prescription and a lab panel on an
//   unspecified diagnosis in May and June, all recoded — the pattern at the
//   any-service level the closed plan (PP-0001) answered, which faded when
//   the plan closed: only this week's recode denial (DN-0020) is inside the
//   window. That record is written by hand (the engine never creates a
//   pattern below the threshold), and the pass that follows keeps it Faded.
//
// Imports nothing from data/: the repository hands `buildPatterns` its own
// API, so data/engines/pattern-engine.js stays a leaf beside it.

const CODER = 'Tarek Solh';

/** One intent per denial, in the order they are picked. `daysAgo` is when it landed; `category` null takes the oldest free claim of the payer. */
export const DENIAL_INTENTS = [
  // B — NSSF · pre-authorisation not obtained · Lab. Three in July, worked; DN-0016 this week is the fourth.
  { key: 'nssf-auth-1', payerId: 'PY-0001', category: 'Lab', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 62, by: CODER,
    triage: { rootCauseId: 'RC-05', class: 'Corrigible', tier: 'Soft', daysAgo: 61, note: 'The fund accepts a retrospective request inside thirty days — asked for one' },
    resolve: { result: 'recovered', daysAgo: 40, reason: 'Retrospective authorisation accepted by the fund; paid on the next cycle' } },
  { key: 'nssf-auth-2', payerId: 'PY-0001', category: 'Lab', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 50, by: CODER,
    triage: { rootCauseId: 'RC-05', class: 'Corrigible', tier: 'Soft', daysAgo: 49, note: 'Same panel, same fund — retrospective request drafted' },
    resolve: { result: 'lost', daysAgo: 30, reason: 'The fund refused the retrospective request — the panel was run outside its thirty days' } },
  { key: 'nssf-auth-3', payerId: 'PY-0001', category: 'Lab', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 46, by: CODER,
    triage: { rootCauseId: 'RC-05', class: 'Corrigible', tier: 'Soft', daysAgo: 45, note: 'Third lab panel this month — the desk never sees the requirement' },
    resolve: { result: 'recovered', daysAgo: 25, reason: 'Retrospective authorisation accepted; paid on the next cycle' } },
  // C — NSSF · unspecified or missing code · any service. A consultation, a prescription and a lab panel, May and June, recoded.
  { key: 'nssf-code-1', payerId: 'PY-0001', category: null, reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 125, by: CODER,
    triage: { rootCauseId: 'RC-09', class: 'Corrigible', daysAgo: 124, note: 'R69 as principal — the note names the finding' },
    resolve: { result: 'recovered', daysAgo: 108, reason: 'Recoded with the specific principal and paid on the next cycle' } },
  { key: 'nssf-code-2', payerId: 'PY-0001', category: null, reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 115, by: CODER,
    triage: { rootCauseId: 'RC-09', class: 'Corrigible', daysAgo: 114, note: 'Unspecified principal again; the chart supports E11.65' },
    resolve: { result: 'recovered', daysAgo: 96, reason: 'Recoded and paid on the next cycle' } },
  { key: 'nssf-code-3', payerId: 'PY-0001', category: null, reason: 'CODE_MISMATCH', code: 'CO-4', daysAgo: 100, by: CODER,
    triage: { rootCauseId: 'RC-09', class: 'Corrigible', daysAgo: 99, note: 'Third this quarter, on a lab panel this time — a plan, not another recode' },
    resolve: { result: 'lost', daysAgo: 80, reason: 'Recoded too late for the fund’s window; below the appeal threshold' } },
  // A — MOPH · pre-authorisation not obtained · Lab. Three lab panels this quarter, none triaged — the accelerating pattern.
  { key: 'moph-auth-1', payerId: 'PY-0002', category: 'Lab', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 36, by: CODER },
  { key: 'moph-auth-2', payerId: 'PY-0002', category: 'Lab', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 21, by: CODER },
  { key: 'moph-auth-3', payerId: 'PY-0002', category: 'Lab', reason: 'PA_MISSING', code: 'CO-197', daysAgo: 8, by: CODER },
];

/** The dimensions the three seeded patterns read on — the plan and rule seeds compute the same ids from them. */
export const PATTERN_DIMS = {
  mophAuthLab: { payerId: 'PY-0002', causeId: 'RC-05', service: { level: 'category', value: 'Lab' } },
  nssfAuthLab: { payerId: 'PY-0001', causeId: 'RC-05', service: { level: 'category', value: 'Lab' } },
  nssfCodeAny: { payerId: 'PY-0001', causeId: 'RC-09', service: { level: 'any', value: '*' } },
};

/**
 * Drives the repository. `api` is { today, denials (the register), claims(),
 * idFor, get(id), upsert(record), backdate(row, at), acknowledge(id, { note },
 * { at, by }), log(row, action, details, at, by), recompute() }. Returns the
 * denials it created by key.
 */
export function buildPatterns(api) {
  const out = {};
  const used = new Set();
  for (const intent of DENIAL_INTENTS) {
    const landed = daysAgo(api.today, intent.daysAgo);
    const claim = pickClaim(api, intent, landed, used);
    if (!claim) { console.warn('[patterns seed] no free denied claim for', intent.key); continue; }
    used.add(claim.claimNo);
    const line = claim.lines[0];
    const at = (n, hour = 10) => `${later(daysAgo(api.today, n), landed)}T${String(hour).padStart(2, '0')}:20:00.000Z`;
    const row = api.denials.create({
      claimNo: claim.claimNo, claimId: claim.id, lineId: line?.id || null, remittanceNo: null, payerId: claim.payerId,
      code: intent.code, amount: line?.payerShare ?? claim.totals.payerShare, scope: 'Line',
      at: `${landed}T09:05:00.000Z`, by: intent.by,
    });
    if (!row) continue;
    out[intent.key] = row;
    if (intent.triage) {
      const t = intent.triage;
      const r = api.denials.triage(row.id, { class: t.class, rootCauseId: t.rootCauseId, note: t.note || '', tier: t.tier || null, category: t.category || null, separation: 'True' }, { at: at(t.daysAgo, 11), by: intent.by });
      if (r?.error) console.warn('[patterns seed] triage refused', row.id, r.error);
    }
    if (intent.resolve) {
      const o = intent.resolve;
      const r = api.denials.resolveManual(row.id, { result: o.result, reason: o.reason }, { at: at(o.daysAgo, 16), by: o.by || intent.by });
      if (r?.error) console.warn('[patterns seed] resolve refused', row.id, r.error);
    }
  }

  // C by hand: detected the day the third landed, acknowledged the next
  // morning, held Under plan while PP-0001 ran and faded the day it closed —
  // the May and June denials had long aged out of the window by then.
  const dimsC = PATTERN_DIMS.nssfCodeAny;
  const detectedC = daysAgo(api.today, 100);
  const fadedC = daysAgo(api.today, 1);
  const recordC = api.upsert({
    id: api.idFor(dimsC), dims: dimsC, origin: 'Coding', status: 'Faded',
    acknowledged: { by: CODER, at: `${daysAgo(api.today, 99)}T09:40:00.000Z`, note: 'Three unspecified principals on NSSF claims this quarter — raising a plan with the coding supervisor' },
    firstDetectedAt: detectedC, lastDetectedAt: daysAgo(api.today, 36), fadedAt: fadedC, reactivatedAt: null, seedTag: 'A40',
    createdAt: `${detectedC}T09:05:30.000Z`, updatedAt: `${fadedC}T17:05:00.000Z`,
  });
  api.log(recordC, 'Detected', 'National Social Security Fund · Unspecified or missing code · Any service — 3 in 90 days, accelerating', `${detectedC}T09:05:30.000Z`, 'System');
  api.log(recordC, 'Acknowledged', `New → Acknowledged — ${recordC.acknowledged.note}`, recordC.acknowledged.at, CODER);
  api.log(recordC, 'Status', 'Under plan → Faded — 1 in the window (threshold 3); PP-0001 closed effective', `${fadedC}T17:05:00.000Z`, 'System');

  // The pass finds A and B; their detection is backdated to the day the third denial landed.
  api.recompute();
  for (const key of ['mophAuthLab', 'nssfAuthLab']) {
    const id = api.idFor(PATTERN_DIMS[key]);
    const rec = api.get(id);
    if (!rec?.windowDenialIds) continue;
    const third = rec.windowDenialIds.map((d) => api.denials.get(d)?.createdAt).filter(Boolean).sort()[2];
    if (third) api.backdate(rec, third);
  }
  api.acknowledge(api.idFor(PATTERN_DIMS.nssfAuthLab), { note: 'Three retrospective requests in July — raising a plan with the pre-authorisation desk' },
    { at: `${daysAgo(api.today, 43)}T10:10:00.000Z`, by: CODER });
  return out;
}

/**
 * A free generated Denied claim of the payer in the category (any, when
 * the intent names none), submitted before the denial lands — one already
 * carrying the reason first, then the oldest — never reused; the reason is
 * restamped when it has to be.
 */
function pickClaim(api, intent, landed, used) {
  const taken = new Set([...used, ...api.denials.all().map((d) => d.claimNo)]);
  const pool = api.claims()
    .filter((c) => c.status === 'Denied' && !c.encounterNo && !taken.has(c.claimNo) && !c.batchId && !c.remittanceId && !c.kind
      && c.payerId === intent.payerId && (!intent.category || c.category === intent.category) && String(c.submittedAt || '').slice(0, 10) < landed)
    .sort((x, y) => Number(y.denialReasonCode === intent.reason) - Number(x.denialReasonCode === intent.reason) || String(x.dateOfService).localeCompare(String(y.dateOfService)));
  const hit = pool[0] || null;
  if (hit && hit.denialReasonCode !== intent.reason) {
    hit.denialReasonCode = intent.reason;
    for (const l of hit.lines) if (l.status === 'Denied') l.denialReasonCode = intent.reason;
  }
  return hit;
}

// --- internals -----------------------------------------------------------------------

const daysAfter = (isoDate, n) => {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const daysAgo = (today, n) => daysAfter(today, -n);

const later = (a, b) => (a > b ? a : b);
