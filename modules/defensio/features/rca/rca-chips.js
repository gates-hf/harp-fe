// The chips the root-cause screens read a case by: status, trigger, nature,
// the target with its overdue tint, the denials it covers, the analyst, the
// cause, and the person named — masked outside the authorised roles, the
// register's own rule. One file so the worklist row, the case banner and
// the accountability register say the same thing the same way. The denial's
// own vocabulary is imported from the denials feature's chip file, which is
// this module's.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import * as payers from '../../../../data/repositories/payers.js';
import { staff, staffName } from '../../../../data/seed/staff.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';

export function statusHtml(row) {
  const tone = rcaCases.statusTone(row.status);
  const title = row.status === 'Closed' ? `Closed ${date(row.closedAt)} by ${row.closedBy}${row.closeNote ? ` — ${row.closeNote}` : ''}`
    : row.status === 'Concluded' ? `Concluded ${date(row.concludedAt)} by ${row.concludedBy} — awaiting the corrective actions`
      : row.status === 'InAnalysis' ? 'The analyst has started the whys' : 'Opened, nothing analysed yet';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(rcaCases.statusLabel(row.status))}</span>`;
}

const TRIGGER_ICONS = { amount: 'attach_money', repeat: 'repeat', appealLost: 'gavel', manual: 'person' };

export function triggerHtml(row) {
  const title = row.trigger === 'amount' ? 'Opened because the denial reached the amount threshold'
    : row.trigger === 'repeat' ? 'Opened because the same cause repeated inside the window'
      : row.trigger === 'appealLost' ? `Opened because an appeal was lost${row.triggerRef ? ` — ${row.triggerRef}` : ''}` : `Opened by ${row.openedBy}`;
  return `<span class="badge" title="${esc(title)}"><span class="icon icon--sm">${TRIGGER_ICONS[row.trigger] || 'flag'}</span>${esc(rcaCases.triggerLabel(row.trigger))}</span>`;
}

export function natureHtml(row) {
  const n = row.analysis?.causeNature;
  if (!n) return '<span class="t-body-sm" title="The analysis says whether the cause was the system, a person or the payer">—</span>';
  const tone = n === 'individual' ? 'warning' : n === 'payerSide' ? 'info' : 'accent';
  const title = n === 'individual' ? 'One person’s act let the denial happen — an accountability case follows the conclusion'
    : n === 'payerSide' ? 'The payer’s own reading — nothing on this side to fix but the escalation' : 'A process or a configuration let it happen — the corrective action is the fix';
  return `<span class="badge badge--${tone}" title="${esc(title)}">${esc(rcaCases.natureLabel(n))}</span>`;
}

/** Days to the target, amber inside three days, red once passed; quiet once the case has concluded. */
export function targetHtml(row) {
  const t = rcaCases.target(row);
  if (!rcaCases.isOpen(row)) return `<span class="t-body-sm" title="Target ${date(t.due)} — the case has concluded">${date(t.due)}</span>`;
  const tone = t.passed ? 'critical' : t.daysLeft <= 3 ? 'warning' : '';
  const text = t.passed ? `Overdue ${Math.abs(t.daysLeft)} d` : t.daysLeft === 0 ? 'Due today' : `${t.daysLeft} d left`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`Target ${date(t.due)} — ${row.targetDays} days from ${date(row.openedAt)}`)}">${esc(text)}</span>`;
}

/** The denials a case covers: count and total denied, the ids in the tooltip. */
export function denialsHtml(row) {
  const rows = rcaCases.denialsOf(row);
  return `<span title="${esc(rows.map((d) => `${d.id} · ${usd(d.amounts.denied)} · ${d.status}`).join('\n'))}">
    <span class="t-mono-sm">${rows.length}</span> <span class="t-body-sm">denial${rows.length === 1 ? '' : 's'} · ${esc(usd(rcaCases.deniedTotal(row)))}</span></span>`;
}

/** Each denial as a link chip. */
export const denialChipsHtml = (row) => rcaCases.denialsOf(row).map((d) => `
  <a class="badge" href="#/defensio/denials/${esc(d.id)}" title="${esc(`${d.status} · ${usd(d.amounts.denied)} denied · ${denials.rootCauseLabel(d.rootCauseId)}`)}"><span class="t-mono-sm">${esc(d.id)}</span></a>`).join(' ');

export const payersHtml = (row) => esc((row.payerIds || []).map((id) => payers.get(id)?.nameEn || id).join(', ') || '—');

export const analystHtml = (row) => (row.analystId
  ? `<span title="${esc(staff(row.analystId)?.title || '')}">${esc(staffName(row.analystId))}</span>` : '<span class="t-body-sm">Unassigned</span>');

/** The confirmed cause, or the tag the denials carry — the tooltip says which. */
export function causeHtml(row) {
  const confirmed = row.analysis?.confirmedRootCause;
  const id = rcaCases.causeOf(row);
  if (!id) return '<span class="t-body-sm">—</span>';
  return `<span title="${esc(`${id} · ${confirmed ? 'confirmed by the analysis' : 'the triage tag on the denials — not confirmed yet'}`)}">${esc(denials.rootCauseLabel(id))}${confirmed ? '' : ' <span class="badge">tagged</span>'}</span>`;
}

/** Who a case names — the name for an authorised role, "Individual — case N" for everyone else. */
export function causerHtml(row, role = currentRole()) {
  if (!row.causer?.personId) return '<span class="t-body-sm">—</span>';
  const acc = accountabilityCases.byCase(row.id)[0];
  if (!accountabilityCases.canRead(role)) {
    return `<span class="badge" title="Names on an accountability case are read by the authorised roles only">${esc(acc ? accountabilityCases.maskedLabel(acc) : 'Individual')}</span>`;
  }
  return `<span title="${esc(row.causer.roleInFailure)}">${esc(staffName(row.causer.personId))}</span>${acc ? ` <a class="badge badge--accent" href="#/defensio/accountability/${esc(acc.id)}" title="Open the accountability case">${esc(acc.id)}</a>` : ''}`;
}

/** A person by staff id, masked the same way when the role is not authorised. */
export const personHtml = (personId, row, role = currentRole()) => (accountabilityCases.canRead(role)
  ? `<span title="${esc(staff(personId)?.title || '')}">${esc(staffName(personId))}</span>`
  : `<span class="badge" title="Names on an accountability case are read by the authorised roles only">${esc(row ? accountabilityCases.maskedLabel(row) : 'Individual')}</span>`);

export function stageHtml(acc) {
  const stage = accountabilityCases.stageOf(acc);
  const tone = accountabilityCases.stageTone(stage);
  const w = accountabilityCases.windowOf(acc);
  const title = stage === 'Awaiting response' ? (w.passed ? `The window closed ${date(w.closes)} — record that nothing was received` : `Response window closes ${date(w.closes)}`) : '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(stage)}</span>`;
}

export function decisionHtml(acc) {
  const d = acc.decision;
  if (!d?.type) return '<span class="t-body-sm">—</span>';
  const tone = d.type === 'deductionRecommendation' ? 'critical' : d.type === 'warning' ? 'warning' : d.type === 'coaching' ? 'info' : 'success';
  return `<span class="badge badge--${tone}" title="${esc(`${d.decidedBy} · ${date(d.decidedAt)} — ${d.rationale}`)}">${esc(accountabilityCases.decisionLabel(d.type))}${d.deduction ? ` · ${esc(usd(d.deduction.amount))}` : ''}</span>`;
}

export function appealHtml(acc) {
  const a = acc.appeal;
  if (!a?.text) return '<span class="t-body-sm">—</span>';
  if (!a.outcome) return '<span class="badge badge--warning" title="Filed, not yet reviewed">Under review</span>';
  const tone = a.outcome === 'Upheld' ? 'info' : a.outcome === 'Overturned' ? 'success' : 'warning';
  return `<span class="badge badge--${tone}" title="${esc(`${a.reviewedBy} · ${date(a.reviewedAt)} — ${a.rationale}`)}">${esc(a.outcome)}</span>`;
}

export function deductionHtml(acc) {
  const t = acc.deductionTracking;
  if (!t) return '<span class="t-body-sm">—</span>';
  const tone = t.status === 'OutcomeCaptured' ? 'success' : t.status === 'SentToHR' ? 'info' : 'warning';
  const title = t.status === 'SentToHR' ? `Sent ${date(t.sentAt)} · ${t.sentRef}` : t.status === 'OutcomeCaptured' ? `${t.hrOutcome}${t.hrRef ? ` · ${t.hrRef}` : ''}` : 'Recommended — not yet with HR';
  return `<span class="badge badge--${tone}" title="${esc(title)}">${esc(accountabilityCases.DEDUCTION_LABELS[t.status] || t.status)}</span>`;
}

/** The chip a denial page wears when a case covers it. */
export function caseChipHtml(denialId) {
  const c = rcaCases.caseFor(denialId);
  if (!c) return '';
  return `<a class="badge badge--accent" href="#/defensio/rca/${esc(c.id)}" title="${esc(`Root-cause case · ${rcaCases.statusLabel(c.status)} · ${rcaCases.triggerLabel(c.trigger)} — ${c.detail}`)}"><span class="icon icon--sm">troubleshoot</span>${esc(c.id)} · ${esc(rcaCases.statusLabel(c.status))}</a>`;
}
