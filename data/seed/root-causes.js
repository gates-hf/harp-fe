// Seed — denial root causes (amendment 31). Static, like reference.js: the
// list a triage picks from, grouped by the part of the revenue cycle that let
// the denial happen, each carrying the class and the route the router
// suggests for it. The group is also what the prevention feed reads — a
// root cause under Authorization is Frontis's pre-auth workflow to prevent,
// one under Coding is Claima's coding feature — so `OWNERS` names the feature
// behind each group and where it is read.
//
// Imports nothing, so data/engines/denial-router.js stays a leaf when it
// reads this file.
//
// Amendment 36 (Defensio takes the entity over) adds the one-pass triage's
// vocabulary: a category (clinical, technical, administrative), a tier (hard,
// soft, underpayment) and a separation (a true denial, a contractual
// adjustment the payer was right to take, a TPA fee withheld from the
// remittance). Each root cause carries the category and the tier it usually
// reads as, so picking a cause fills the rest of the form and the desk
// overrides what it disagrees with. `Appeal` joins the routes: an appealable
// denial opens an appeal case (a stub until amendment 38 builds the feature).

export const GROUPS = ['Registration', 'Eligibility', 'Authorization', 'Coding', 'Charge', 'Documentation', 'Contract', 'Payer'];

export const CLASSES = ['Corrigible', 'Appealable', 'Write-Off Candidate'];

export const ROUTES = ['Recode', 'ChargeCorrection', 'AuthRework', 'Refresh', 'Appeal', 'DefensioHandoff', 'PayerReconsideration', 'WriteOff'];

// --- A36: the one-pass triage's vocabulary -------------------------------------------

/** What kind of failure let the denial happen — the first question the triage asks. */
export const CATEGORIES = ['Clinical', 'Technical', 'Administrative'];

/**
 * Hard: the payer refuses the service itself and only an appeal moves it.
 * Soft: the claim was wrong and a corrected one is paid. Underpayment: the
 * line was paid, below what the contract says.
 */
export const TIERS = ['Hard', 'Soft', 'Underpayment'];

/** The class a tier usually reads as — the root cause's own class is narrower and wins when one is picked. */
export const TIER_CLASS = { Hard: 'Appealable', Soft: 'Corrigible', Underpayment: 'Appealable' };

/** The route a tier leans to before a root cause is known. */
export const TIER_ROUTE = { Hard: 'Appeal', Soft: 'Refresh', Underpayment: 'Appeal' };

/**
 * A denial is worked only when it is one. A contractual adjustment is the
 * payer applying the contract as written — reconciled against the claim, not
 * pursued. A TPA fee is the administrator's cut withheld from the remittance —
 * accrued as a fee, not pursued either. Both leave the worklist as
 * Reclassified with the money in `amounts.reclassified`.
 */
export const SEPARATIONS = ['True', 'Contractual', 'TPA'];
export const SEPARATION_LABELS = { True: 'True denial', Contractual: 'Contractual adjustment', TPA: 'TPA fee' };

/** The feature a group's denials are prevented in, and the screen that owns it. */
export const OWNERS = {
  Registration: { feature: 'Frontis · Patient Master', href: '#/frontis/patients' },
  Eligibility: { feature: 'Frontis · Eligibility', href: '#/frontis/eligibility' },
  Authorization: { feature: 'Frontis · Pre-authorisation', href: '#/frontis/preauth' },
  Coding: { feature: 'Claima · Coding', href: '#/claima/coding' },
  Charge: { feature: 'Claima · Charge capture', href: '#/claima/charges' },
  Documentation: { feature: 'Claima · Claim assembly', href: '#/claima/claims' },
  Contract: { feature: 'Pactum · Contracts', href: '#/pactum/contracts' },
  Payer: { feature: 'Claima · Follow-ups', href: '#/claima/followups' },
};

/** Each carries the class and the route the router suggests, and (A36) the category and the tier it usually reads as. */
export const ROOT_CAUSES = [
  { id: 'RC-01', group: 'Registration', label: 'Wrong member ID or demographics', suggestedClass: 'Corrigible', suggestedRoute: 'Refresh', category: 'Administrative', tier: 'Soft' },
  { id: 'RC-02', group: 'Registration', label: 'Wrong payer or plan on file', suggestedClass: 'Corrigible', suggestedRoute: 'Refresh', category: 'Administrative', tier: 'Soft' },
  { id: 'RC-03', group: 'Eligibility', label: 'Cover lapsed on the date of service', suggestedClass: 'Write-Off Candidate', suggestedRoute: 'WriteOff', category: 'Administrative', tier: 'Hard' },
  { id: 'RC-04', group: 'Eligibility', label: 'Eligibility never verified', suggestedClass: 'Appealable', suggestedRoute: 'PayerReconsideration', category: 'Administrative', tier: 'Hard' },
  { id: 'RC-05', group: 'Authorization', label: 'Pre-authorisation not obtained', suggestedClass: 'Appealable', suggestedRoute: 'AuthRework', category: 'Administrative', tier: 'Hard' },
  { id: 'RC-06', group: 'Authorization', label: 'Pre-authorisation expired or exceeded', suggestedClass: 'Appealable', suggestedRoute: 'AuthRework', category: 'Administrative', tier: 'Hard' },
  { id: 'RC-07', group: 'Authorization', label: 'Authorisation on file, not quoted on the claim', suggestedClass: 'Corrigible', suggestedRoute: 'Refresh', category: 'Technical', tier: 'Soft' },
  { id: 'RC-08', group: 'Coding', label: 'Diagnosis and procedure do not agree', suggestedClass: 'Corrigible', suggestedRoute: 'Recode', category: 'Clinical', tier: 'Soft' },
  { id: 'RC-09', group: 'Coding', label: 'Unspecified or missing code', suggestedClass: 'Corrigible', suggestedRoute: 'Recode', category: 'Clinical', tier: 'Soft' },
  { id: 'RC-10', group: 'Charge', label: 'Duplicate charge line', suggestedClass: 'Corrigible', suggestedRoute: 'ChargeCorrection', category: 'Technical', tier: 'Soft' },
  { id: 'RC-11', group: 'Charge', label: 'Charge outside the package or unbundled', suggestedClass: 'Corrigible', suggestedRoute: 'ChargeCorrection', category: 'Technical', tier: 'Soft' },
  { id: 'RC-12', group: 'Documentation', label: 'Required document not attached', suggestedClass: 'Corrigible', suggestedRoute: 'Refresh', category: 'Technical', tier: 'Soft' },
  { id: 'RC-13', group: 'Documentation', label: 'Report illegible or incomplete', suggestedClass: 'Corrigible', suggestedRoute: 'Refresh', category: 'Technical', tier: 'Soft' },
  { id: 'RC-14', group: 'Contract', label: 'Service excluded by the contract', suggestedClass: 'Write-Off Candidate', suggestedRoute: 'WriteOff', category: 'Administrative', tier: 'Hard' },
  { id: 'RC-15', group: 'Contract', label: 'Payer adjudicated outside the contract terms', suggestedClass: 'Appealable', suggestedRoute: 'Appeal', category: 'Administrative', tier: 'Underpayment' },
  { id: 'RC-16', group: 'Payer', label: 'Filing deadline missed', suggestedClass: 'Write-Off Candidate', suggestedRoute: 'WriteOff', category: 'Administrative', tier: 'Hard' },
  { id: 'RC-17', group: 'Payer', label: 'Medical necessity disputed by the payer', suggestedClass: 'Appealable', suggestedRoute: 'PayerReconsideration', category: 'Clinical', tier: 'Hard' },
];

export const rootCause = (id) => ROOT_CAUSES.find((r) => r.id === id) || null;

export const rootCauseLabel = (id) => rootCause(id)?.label || (id ? String(id) : '—');

/** The list grouped for a select: [{ group, causes[] }] in GROUPS order. */
export const groupedRootCauses = () => GROUPS
  .map((group) => ({ group, causes: ROOT_CAUSES.filter((r) => r.group === group) }))
  .filter((g) => g.causes.length);

/**
 * The root cause a payer's reason code usually comes down to, by the
 * Performance reason it reads as — the router's starting point when nobody
 * has triaged the denial yet.
 */
export const DEFAULT_ROOT_CAUSE = {
  PA_MISSING: 'RC-05',
  COV_RULE: 'RC-17',
  DOC_MISSING: 'RC-12',
  LATE_FILING: 'RC-16',
  CODE_MISMATCH: 'RC-08',
  MEMBER_INELIG: 'RC-03',
  DUPLICATE: 'RC-10',
};

/** Two payer codes read as coverage-rule trips but come down to different causes. */
export const ROOT_CAUSE_BY_CODE = {
  'CO-96': 'RC-14',
  'CO-50': 'RC-17',
};
