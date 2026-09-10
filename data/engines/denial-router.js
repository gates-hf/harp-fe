// Denial router — the one place a denial's class, route and deadline are
// decided (amendment 31). Pure: no DOM, no writes, and it reads nothing from a
// repository — the root-cause catalogue, the payer's reason codes and the
// config are its whole world, which is what lets data/repositories/denials.js
// wrap it without a cycle. The repository resolves the facts a suggestion
// needs (does the claim have a visit, a capture line, is the write-off feature
// loaded) and hands them in; the screen shows the answer and lets the desk
// override it.

import {
  CLASSES, ROUTES, ROOT_CAUSES, DEFAULT_ROOT_CAUSE, ROOT_CAUSE_BY_CODE, rootCause,
} from '../seed/root-causes.js';
import { denialCode, reasonOf } from '../seed/denials.js';
import { CONFIG } from '../../shared/config.js';
import { compareDates, iso, todayIso } from '../../shared/format.js';

export { CLASSES, ROUTES };

export const STATUSES = [
  'Untriaged', 'Triaged', 'Routed', 'In Progress', 'Recovered', 'Partially Recovered', 'Written Off', 'Lost',
  'Deadline Passed', 'Manually Resolved',
];
/** Still the desk's: money is open and somebody has to act. */
export const OPEN_STATUSES = ['Untriaged', 'Triaged', 'Routed', 'In Progress', 'Deadline Passed'];
/** The answer is in — nothing left open on the denial. */
export const RESOLVED_STATUSES = ['Recovered', 'Partially Recovered', 'Written Off', 'Lost', 'Manually Resolved'];
/** A29's vocabulary: a denial a reversed posting withdrew. Out of every list and every sum. */
export const WITHDRAWN = 'Reversed';

export const ROUTE_LABELS = {
  Recode: 'Recode',
  ChargeCorrection: 'Charge correction',
  AuthRework: 'Auth rework',
  Refresh: 'Refresh & resubmit',
  DefensioHandoff: 'Defensio hand-off',
  PayerReconsideration: 'Payer reconsideration',
  WriteOff: 'Write-off',
};
export const routeLabel = (kind) => ROUTE_LABELS[kind] || kind || '—';

export const ROUTE_ICONS = {
  Recode: 'medical_information', ChargeCorrection: 'receipt', AuthRework: 'verified_user', Refresh: 'sync',
  DefensioHandoff: 'gavel', PayerReconsideration: 'forum', WriteOff: 'money_off',
};

/** What each route hands the denial to, in a sentence the triage panel shows. */
export const ROUTE_HINTS = {
  Recode: 'Raises a recode request on the chart; the claim is reopened and refreshed once the coder answers.',
  ChargeCorrection: 'Puts the denied charge line on hold as disputed for the capture desk to correct.',
  AuthRework: 'Resubmits or renews the pre-authorisation, or drafts one, in Frontis.',
  Refresh: 'Reopens the claim as a draft to be corrected, scrubbed and finalized onto its next cycle.',
  DefensioHandoff: 'Hands the denied amount to Defensio to appeal on the contract terms.',
  PayerReconsideration: 'Marks the claim appealed and books a follow-up with the payer’s desk.',
  WriteOff: 'Raises a write-off request for the open amount, through the approval tiers.',
};

export const classTone = (cls) => (cls === 'Corrigible' ? 'info' : cls === 'Appealable' ? 'warning' : cls === 'Write-Off Candidate' ? 'critical' : '');

export function statusTone(status) {
  if (status === 'Recovered') return 'success';
  if (status === 'Partially Recovered' || status === 'Manually Resolved') return 'info';
  if (status === 'Written Off' || status === 'Lost' || status === 'Deadline Passed') return 'critical';
  if (status === 'Untriaged') return 'warning';
  if (status === 'Routed' || status === 'In Progress') return 'accent';
  return '';
}

export const isOpen = (denial) => OPEN_STATUSES.includes(denial?.status);
export const isResolved = (denial) => RESOLVED_STATUSES.includes(denial?.status);

// --- suggestion ---------------------------------------------------------------------

/**
 * defaultRootCause(denial) → the root cause id the payer's reason usually
 * comes down to, before anyone has looked: by the code itself when two codes
 * share a Performance reason, else by that reason.
 */
export function defaultRootCause(denial) {
  const code = denial?.payerReason?.code || denial?.code || null;
  return ROOT_CAUSE_BY_CODE[code] || DEFAULT_ROOT_CAUSE[denial?.reasonCode || reasonOf(code)] || 'RC-17';
}

/**
 * Where a route falls to when the denial cannot carry it — a claim with no
 * visit has no chart to recode, a legacy line no capture line to correct —
 * in the order the desk would try next.
 */
const FALLBACK = {
  Recode: ['Refresh', 'PayerReconsideration'],
  ChargeCorrection: ['Refresh', 'PayerReconsideration'],
  AuthRework: ['PayerReconsideration'],
  Refresh: ['PayerReconsideration'],
  DefensioHandoff: ['PayerReconsideration'],
  PayerReconsideration: ['DefensioHandoff'],
  WriteOff: ['PayerReconsideration'],
};

/**
 * availability(kind, facts) → { ok, why }. `facts` is what the repository
 * knows about the denial's claim: { hasEncounter, hasChargeLine, hasWriteoffs,
 * openAmount }. A route that cannot be taken says why, and the screen shows
 * the reason on the disabled option.
 */
export function availability(kind, facts = {}) {
  if (!ROUTES.includes(kind)) return { ok: false, why: 'Not a route' };
  if (!(Number(facts.openAmount) > 0)) return { ok: false, why: 'Nothing is open on this denial' };
  if (kind === 'Recode' && !facts.hasEncounter) return { ok: false, why: 'This claim has no visit behind it, so there is no chart to recode' };
  if (kind === 'ChargeCorrection' && !facts.hasChargeLine) return { ok: false, why: 'The denied line was not captured in the charge register, so there is no line to correct' };
  if (kind === 'WriteOff' && !facts.hasWriteoffs) return { ok: false, why: 'The write-off feature is not loaded yet' };
  return { ok: true, why: '' };
}

/**
 * suggest(denial, facts) → { rootCauseId, class, route, fallbackFrom, why }.
 * The root cause is the one triaged, else the default for the payer's
 * reason; class and route come off it, and the route steps down its fallback
 * list until it lands on one the denial can carry.
 */
export function suggest(denial, facts = {}) {
  const rootCauseId = denial?.rootCauseId || defaultRootCause(denial);
  const rc = rootCause(rootCauseId) || rootCause('RC-17');
  const first = rc.suggestedRoute;
  let route = first;
  const tried = [first, ...(FALLBACK[first] || [])];
  for (const kind of tried) {
    if (availability(kind, facts).ok) { route = kind; break; }
  }
  const stepped = route !== first;
  return {
    rootCauseId: rc.id,
    class: rc.suggestedClass,
    route,
    fallbackFrom: stepped ? first : null,
    why: stepped
      ? `${routeLabel(first)} is not available — ${availability(first, facts).why.toLowerCase()} — so ${routeLabel(route)} is next.`
      : `${rc.label} is usually ${rc.suggestedClass === 'Write-Off Candidate' ? 'a write-off candidate' : rc.suggestedClass.toLowerCase()} and goes to ${routeLabel(route)}.`,
  };
}

/** Every route with its availability for this denial — what the override select lists. */
export const routeOptions = (facts = {}) => ROUTES.map((kind) => ({ kind, label: routeLabel(kind), ...availability(kind, facts) }));

// --- deadline ---------------------------------------------------------------------------

/** The days a payer allows for an appeal — its own window, else the default. */
export function appealWindowDays(payerId) {
  const cfg = CONFIG.claima?.denials?.appealWindowDays || { default: 30, byPayer: {} };
  return Number(cfg.byPayer?.[payerId]) || Number(cfg.default) || 30;
}

/** The date the appeal has to be in by: the day the denial landed plus the payer's window. */
export function appealBy(createdAt, payerId) {
  const from = iso(createdAt) || todayIso();
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + appealWindowDays(payerId));
  return d.toISOString().slice(0, 10);
}

/**
 * deadlineOf(denial, on) → { appealBy, passed, daysLeft, warn }. Computed on
 * every read: a resolved denial has no deadline left to miss, and one with an
 * active route has met it — the appeal is under way.
 */
export function deadlineOf(denial, on = todayIso()) {
  const by = denial?.deadline?.appealBy || appealBy(denial?.createdAt, denial?.payerId);
  const daysLeft = Math.round((Date.parse(by) - Date.parse(on)) / 86400000);
  const binding = isOpen(denial) && !denial?.route?.active;
  const warnDays = Number(CONFIG.claima?.denials?.deadlineWarnDays) || 7;
  return {
    appealBy: by,
    daysLeft,
    passed: binding && compareDates(by, on) < 0,
    warn: binding && daysLeft >= 0 && daysLeft <= warnDays,
    binding,
  };
}

export const deadlineTone = (dl) => (dl.passed ? 'critical' : dl.warn ? 'warning' : '');

// --- amounts ---------------------------------------------------------------------------

export const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The figures, with open derived — the invariant is written here and checked
 * by selfCheck. `transferred` is what moved onto a successor denial after a
 * partial recovery; over a chain it cancels against the successor's denied.
 */
export function amountsOf({ denied = 0, recovered = 0, writtenOff = 0, lost = 0, transferred = 0 } = {}) {
  const open = cents(denied - recovered - writtenOff - lost - transferred);
  return {
    denied: cents(denied), recovered: cents(recovered), writtenOff: cents(writtenOff), lost: cents(lost),
    transferred: cents(transferred), open: Math.max(0, open),
  };
}

/** denied = recovered + lost + writtenOff + transferred + open, to the cent. */
export const invariantHolds = (a) =>
  Boolean(a) && Math.abs(cents(a.denied) - cents(a.recovered + a.lost + a.writtenOff + (a.transferred || 0) + a.open)) < 0.005;

/** The amount bands the worklist filters by — the assembly feature's, so a claim and its denial read the same band. */
export const AMOUNT_BANDS = (() => {
  const edges = CONFIG.claima?.assembly?.valueBands || [0, 500, 2000, 10000];
  return edges.map((lo, i) => {
    const hi = edges[i + 1];
    return { key: `b${i}`, lo, hi: hi ?? Infinity, label: hi == null ? `$${lo.toLocaleString()}+` : `$${lo.toLocaleString()}–${hi.toLocaleString()}` };
  });
})();
export const bandOf = (amount) => AMOUNT_BANDS.find((b) => amount >= b.lo && amount < b.hi)?.key || AMOUNT_BANDS[0].key;

/** "CO-197 · Pre-authorisation absent" for the worklist's reason column. */
export const payerReasonLabel = (denial) => {
  const code = denial?.payerReason?.code || denial?.code;
  const text = denial?.payerReason?.text || denialCode(code)?.label || denial?.reason || '';
  return code ? `${code}${text ? ` · ${text}` : ''}` : text || '—';
};

export const classOf = (rootCauseId) => rootCause(rootCauseId)?.suggestedClass || null;
export { ROOT_CAUSES };
