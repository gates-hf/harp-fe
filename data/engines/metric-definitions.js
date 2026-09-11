// Metric definitions — the one table every Defensio analytics figure is
// read from (amendment 41, F6). A leaf: it imports nothing from data/, so
// data/engines/denial-analytics.js can build the world and hand it in, and
// a screen that wants to name a metric reads its label, its date boundary
// and its format here rather than restating them.
//
// Each definition is { key, label, short, formula(world), dateBoundary,
// format, hint }. `formula` runs over a world the engine has already sliced
// to a period (and, for a breakdown, to one payer or department) and returns
// { value, count, ids, detail } — the figure, how many records stand behind
// it and which, so every figure on a screen can carry its drill-through.
//
// Rules baked in, not switchable: a Reclassified denial (a contractual
// adjustment or a TPA fee the desk separated out) is never in a denial rate
// and is counted only by misclassificationRate; recovered money is
// cash-confirmed only — the union of an expected recovery in state
// Recovered (an appeal's conceded share the remittance paid) and a denial a
// remittance posting resolved outright (`resolution.kind` Remittance — a
// resubmission paid back, cash by definition). What stays out is an
// appealed denial's own `amounts.recovered` while its expected recovery is
// still awaiting: the payer conceded, the cash has not come.
//
// Three date boundaries, one per metric family, named on every view:
//   intake   — the day the denial landed (denial.createdAt)
//   decision — the day the answer came (appeal decidedAt, denial resolvedAt)
//   cash     — the day the remittance that paid it was dated

export const BOUNDARIES = {
  intake: { key: 'intake', label: 'Intake', caption: 'Denials by the day they landed on the register' },
  decision: { key: 'decision', label: 'Decision', caption: 'Appeals by the day the payer decided; denials by the day they were resolved' },
  cash: { key: 'cash', label: 'Cash', caption: 'Recoveries by the payment date of the remittance that carried them' },
};

export const FORMATS = ['pct', 'usd', 'days', 'int'];

const sum = (rows, f) => Math.round(rows.reduce((n, r) => n + (Number(f(r)) || 0), 0) * 100) / 100;
const ratio = (num, den) => (den > 0 ? num / den : null);
const avg = (values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
const ids = (rows) => rows.map((r) => r.id);
const distinct = (rows, f) => new Set(rows.map(f).filter(Boolean)).size;

/**
 * The world a formula reads (built by the engine for one period and one
 * slice): { range { from, to }, denials (true denials landed in range),
 * reclassified (separated-out denials landed in range), adjudicated (claims
 * the payer answered in range, each { id, claimNo, payerShare }), recoveries
 * (cash-confirmed recoveries with a cash date in range — expected recoveries
 * Recovered, plus denials a remittance resolved outright — each { id, source
 * ('appeal' | 'remittance'), denialId, recoveredAmount, cashOn }), decided (appeal
 * cases decided in range, each with submittedAt / decidedAt), resolved (true
 * denials resolved in range), openNow (true denials open, landed on or
 * before range.to), prevention (A40's summary or null) }.
 */
export const METRICS = [
  {
    key: 'denialRateValue', label: 'Denial rate (value)', short: 'Denial rate $', format: 'pct', dateBoundary: 'intake',
    hint: 'Value of true denials landed in the period over the payer share of every claim the payer answered in it. Reclassified rows are out.',
    formula: (w) => {
      const denied = sum(w.denials, (d) => d.amounts.denied);
      const base = sum(w.adjudicated, (c) => c.payerShare);
      return { value: ratio(denied, base), count: w.denials.length, ids: ids(w.denials), detail: { denied, adjudicatedValue: base } };
    },
  },
  {
    key: 'denialRateCount', label: 'Denial rate (count)', short: 'Denial rate #', format: 'pct', dateBoundary: 'intake',
    hint: 'Claims carrying a true denial landed in the period over the claims the payer answered in it.',
    formula: (w) => {
      const deniedClaims = distinct(w.denials, (d) => d.claimNo);
      return { value: ratio(deniedClaims, w.adjudicated.length), count: w.denials.length, ids: ids(w.denials), detail: { deniedClaims, adjudicatedClaims: w.adjudicated.length } };
    },
  },
  {
    key: 'recoveryRate', label: 'Recovery rate', short: 'Recovered', format: 'pct', dateBoundary: 'cash',
    hint: 'Cash-confirmed recoveries dated in the period — an appeal’s conceded share the remittance paid, or a denial a remittance posting resolved outright — over the value of true denials landed in it. A conceded amount nobody has paid is not recovered.',
    formula: (w) => {
      const recovered = sum(w.recoveries, (r) => r.recoveredAmount);
      const denied = sum(w.denials, (d) => d.amounts.denied);
      const appeal = sum(w.recoveries.filter((r) => r.source === 'appeal'), (r) => r.recoveredAmount);
      return { value: ratio(recovered, denied), count: w.recoveries.length, ids: ids(w.recoveries), detail: { recovered, denied, onAppeal: appeal, onResubmission: Math.round((recovered - appeal) * 100) / 100 } };
    },
  },
  {
    key: 'overturnRate', label: 'Overturn rate', short: 'Overturned', format: 'pct', dateBoundary: 'decision',
    hint: 'Appeals the payer decided in the period that were won, partially won or settled, over every appeal decided in it.',
    formula: (w) => {
      const won = w.decided.filter((c) => c.outcome && c.outcome.type !== 'Lost');
      return { value: ratio(won.length, w.decided.length), count: w.decided.length, ids: ids(w.decided), detail: { overturned: won.length, decided: w.decided.length, conceded: sum(won, (c) => c.outcome.concededTotal) } };
    },
  },
  {
    key: 'appealTurnaround', label: 'Appeal turnaround', short: 'Turnaround', format: 'days', dateBoundary: 'decision',
    hint: 'Average days from the appeal’s submission to the payer’s decision, over appeals decided in the period.',
    formula: (w) => {
      const days = w.decided.map((c) => c.turnaroundDays).filter((n) => Number.isFinite(n));
      return { value: avg(days), count: days.length, ids: ids(w.decided), detail: { decided: w.decided.length } };
    },
  },
  {
    key: 'avgResolutionDays', label: 'Average resolution', short: 'Resolution', format: 'days', dateBoundary: 'decision',
    hint: 'Average days from a true denial landing to its resolution, over denials resolved in the period. Reclassified rows are out — they were never pursued.',
    formula: (w) => {
      const days = w.resolved.map((d) => d.resolutionDays).filter((n) => Number.isFinite(n));
      return { value: avg(days), count: days.length, ids: ids(w.resolved), detail: { resolved: w.resolved.length } };
    },
  },
  {
    key: 'misclassificationRate', label: 'Misclassification rate', short: 'Misclassified', format: 'pct', dateBoundary: 'intake',
    hint: 'Rows the payer sent as denials that the desk separated out as contractual adjustments or TPA fees, over everything that landed in the period. The only place a Reclassified row is counted.',
    formula: (w) => {
      const all = w.denials.length + w.reclassified.length;
      const value = sum(w.reclassified, (d) => d.amounts.reclassified || d.amounts.denied);
      const contractual = w.reclassified.filter((d) => d.separation === 'Contractual');
      const tpa = w.reclassified.filter((d) => d.separation === 'TPA');
      return {
        value: ratio(w.reclassified.length, all), count: w.reclassified.length, ids: ids(w.reclassified),
        detail: { reclassified: w.reclassified.length, landed: all, value, contractual: { count: contractual.length, value: sum(contractual, (d) => d.amounts.reclassified || d.amounts.denied) }, tpa: { count: tpa.length, value: sum(tpa, (d) => d.amounts.reclassified || d.amounts.denied) } },
      };
    },
  },
  {
    key: 'firstPassPrevention', label: 'First-pass prevention', short: 'Prevented', format: 'pct', dateBoundary: 'intake',
    hint: 'Value the prevention rules stopped before submission over what they stopped plus what was denied — read from amendment 40’s prevention summary and pending until it lands.',
    formula: (w) => {
      const p = w.prevention;
      if (!p) return { value: null, count: 0, ids: [], detail: { pending: 'A40' } };
      const rate = Number.isFinite(Number(p.firstPassPreventionRate)) ? Number(p.firstPassPreventionRate)
        : Number.isFinite(Number(p.firstPassRate)) ? Number(p.firstPassRate) : null;
      const prevented = Number(p.preventedValue) || 0;
      const denied = sum(w.denials, (d) => d.amounts.denied);
      return { value: rate ?? ratio(prevented, prevented + denied), count: Number(p.preventedCount) || 0, ids: [], detail: { preventedValue: prevented, denied, estimate: true } };
    },
  },
  {
    key: 'netDenialLoss', label: 'Net denial loss', short: 'Net loss', format: 'usd', dateBoundary: 'decision',
    hint: 'What true denials resolved in the period cost for good: lost on appeal or by hand, plus written off. Written off is summed from both doors — denial-sourced requests and the appeal loop’s.',
    formula: (w) => {
      const lost = sum(w.resolved, (d) => d.amounts.lost);
      const writtenOff = sum(w.resolved, (d) => d.amounts.writtenOff);
      return { value: Math.round((lost + writtenOff) * 100) / 100, count: w.resolved.length, ids: ids(w.resolved), detail: { lost, writtenOff, writtenOffDenialSourced: w.writtenOff.denialSourced, writtenOffAppealLoop: w.writtenOff.appealLoop } };
    },
  },
  {
    key: 'openExposure', label: 'Open exposure', short: 'Open', format: 'usd', dateBoundary: 'intake',
    hint: 'Money still open on true denials that landed on or before the period’s last day — a point in time, read as of that day.',
    formula: (w) => ({ value: sum(w.openNow, (d) => d.amounts.open), count: w.openNow.length, ids: ids(w.openNow), detail: { open: w.openNow.length } }),
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const metric = (key) => METRICS.find((m) => m.key === key) || null;
export const boundaryOf = (key) => BOUNDARIES[metric(key)?.dateBoundary] || null;

/** The families a view captions: the boundaries the metrics it shows are read on. */
export const boundariesFor = (keys = METRIC_KEYS) => [...new Set(keys.map((k) => metric(k)?.dateBoundary).filter(Boolean))].map((k) => BOUNDARIES[k]);
