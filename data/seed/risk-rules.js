// Seed — risk rules (amendment 40, Defensio F5). Two rules, hand-written and
// driven through the repository's own writes with the dates the events
// happened on:
//
// - RR-0001, retired: written in June off NSSF's unspecified-diagnosis pattern
//   at the any-service level, so it warned on every NSSF claim in assembly.
//   It fired twenty-four times: three claims were fixed before they went
//   out, twenty-one warnings were acknowledged and the claims sent as they
//   were, and the fund paid twenty of those — one was denied. Flagged for
//   retirement on the follow-through (one of twenty-one) and retired
//   by the CMO at the end of August: a poor predictor. Its hit statistics are
//   history, kept on the counters; the live hits start empty.
// - RR-0002, active: written the day the Ministry's third lab-panel refusal
//   landed, off the accelerating pattern. Five claims fired it in a week:
//   two were fixed first, three went out over the warning and two of those
//   were denied anyway —
//   the rule is right, and it fires live on the Ministry's draft claims
//   that carry lab lines.
//
// Imports nothing from data/: the repository hands `buildRules` its own API.
// The pattern ids are computed from the dimensions the pattern seed names.

import { PATTERN_DIMS } from './denial-patterns.js';

const CODER = 'Tarek Solh';
const CMO = 'Georges Khoury';

/** Drives the repository. `api` is { today, patternId(dims), get, create, update, suspend, retire, log }. */
export function buildRules(api) {
  const out = {};
  const at = (n, hour = 10) => `${daysAgo(api.today, n)}T${String(hour).padStart(2, '0')}:45:00.000Z`;

  const retired = api.create({
    patternId: api.patternId(PATTERN_DIMS.nssfCodeAny),
    message: 'NSSF refused three claims this quarter on an unspecified principal diagnosis — check the principal is specific before this claim goes out.',
    hitStats: { fired: 24, ackSubmitted: 21, fixedPreSubmission: 3, deniedAnyway: 1, paid: 20 },
    seedTag: 'A40',
  }, { at: at(98, 11), by: CODER, commit: false });
  if (retired?.id) {
    out.retired = retired;
    api.log(retired, 'Flagged', 'Fired 24, 1 of 21 sent out as warned was denied (5%) — below the 10% follow-through the config retires at', at(14, 8), 'System');
    api.retire(retired.id, 'Poor predictor — the warning fired on every NSSF claim in assembly and the fund paid twenty of the twenty-one sent out over it', { at: at(12, 16), by: CMO, commit: false });
  }

  const live = api.create({
    patternId: api.patternId(PATTERN_DIMS.mophAuthLab),
    message: 'The Ministry has refused three lab panels in five weeks for a missing pre-authorisation — confirm the approval is on file, or attach the request, before this claim goes out.',
    hitStats: { fired: 5, ackSubmitted: 3, fixedPreSubmission: 2, deniedAnyway: 2, paid: 1 },
    seedTag: 'A40',
  }, { at: at(7, 9), by: CODER, commit: false });
  if (live?.id) out.active = live;
  return out;
}

const daysAfter = (isoDate, n) => {
  const d = new Date(`${String(isoDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const daysAgo = (today, n) => daysAfter(today, -n);
