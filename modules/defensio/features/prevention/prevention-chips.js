// The chips the prevention screens read a pattern, a plan and a risk rule
// by: the pattern's three dimensions with the codes it counts from, its
// status and trend, the plan and the rule on it; a plan's status, verdict
// and overdue mark; a rule's status, its follow-through and the flags a
// person has to answer. One file so the dashboard's rows, the plan page's
// banner and the rules table say the same thing the same way.

import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import { staff, staffName } from '../../../../data/seed/staff.js';
import { date, esc, usd } from '../../../../shared/format.js';

// --- patterns ---------------------------------------------------------------------------

/** Payer · cause · service on three lines, the codes and the level in the tooltip. */
export function patternHtml(p) {
  const codes = denialPatterns.codesLabel(p);
  const level = denialPatterns.LEVEL_LABELS[p.dims.service?.level] || 'Any service';
  return `
    <span title="${esc(`${p.id} · ${level}${codes ? ` · payer codes ${codes}` : ''}${p.origin ? ` · origin ${p.origin}` : ''}`)}">
      <span class="t-body-sm">${esc(denialPatterns.payerLabel(p.dims))}</span><br>
      ${esc(denialPatterns.causeLabel(p.dims))}<br>
      <span class="badge">${esc(denialPatterns.serviceLabel(p.dims))}</span>
    </span>`;
}

export function patternStatusHtml(p) {
  const tone = denialPatterns.statusTone(p.status);
  const title = p.status === 'New' ? `Detected ${date(p.firstDetectedAt)} — nobody has acknowledged it`
    : p.status === 'Reactivated' ? `Faded ${date(p.fadedAt)}, back over the threshold ${date(p.reactivatedAt)} — needs a fresh acknowledgment`
      : p.status === 'Acknowledged' ? `Acknowledged ${date(p.acknowledged?.at)} by ${p.acknowledged?.by || '—'}${p.acknowledged?.note ? ` — ${p.acknowledged.note}` : ''}`
        : p.status === 'UnderPlan' ? 'A plan in force targets it — the plan’s measurement is what reads the count'
          : `Faded ${date(p.fadedAt)} — the window no longer holds the threshold`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(denialPatterns.statusLabel(p.status))}</span>`;
}

/** The two half-windows compared — quiet on a faded pattern, where a trend says nothing. */
export function trendHtml(p) {
  const c = p.counters || {};
  if (!denialPatterns.isActive(p)) return '<span class="t-body-sm" title="Below the threshold — no trend to read">—</span>';
  const tone = denialPatterns.trendTone(c.trend);
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(`${c.firstHalf} in the first half of the window, ${c.secondHalf} in the second`)}">${esc(denialPatterns.trendLabel(c.trend))}</span>`;
}

/** "3 in 90 days", the lifetime count under it. */
export function occurrencesHtml(p) {
  const c = p.counters || {};
  return `<span title="${esc(`${c.occurrences} inside the ${p.window?.days || denialPatterns.windowDays()}-day window (threshold ${p.window?.threshold || denialPatterns.threshold()}); ${c.lifetime} since the register began`)}">
    <span class="t-mono-sm">${c.occurrences ?? 0}</span> <span class="t-body-sm">of ${c.lifetime ?? 0}</span>${c.lostAppeals ? `<br><span class="badge badge--warning" title="${esc(`${c.lostAppeals} of them upheld by the payer on appeal — a reason for a plan rather than another appeal`)}">${c.lostAppeals} upheld on appeal</span>` : ''}</span>`;
}

export const moneyHtml = (n, title = '') => `<span class="t-mono-sm"${title ? ` title="${esc(title)}"` : ''}>${esc(usd(n))}</span>`;

/** The plans in force on the pattern, each a chip that opens the plan. */
export function planChipsHtml(p) {
  const plans = preventionPlans.inForceFor(p);
  if (!plans.length) {
    const closed = preventionPlans.byPattern(p.id).filter((x) => !preventionPlans.isOpen(x));
    return closed.length ? closed.map((x) => `<a class="badge" href="#/defensio/prevention/plans/${esc(x.id)}" title="${esc(`${preventionPlans.statusLabel(x.status)} — ${x.title}`)}">${esc(x.id)}</a>`).join(' ') : '<span class="t-body-sm">—</span>';
  }
  return plans.map((x) => `<a class="badge badge--${preventionPlans.statusTone(x.status)}" href="#/defensio/prevention/plans/${esc(x.id)}" title="${esc(`${preventionPlans.statusLabel(x.status)} — ${x.title}`)}">${esc(x.id)}</a>`).join(' ');
}

/** The rules on the pattern, each a chip that opens the rules screen on it. */
export function ruleChipsHtml(p) {
  const rules = riskRules.byPattern(p.id);
  if (!rules.length) return '<span class="t-body-sm">—</span>';
  return rules.map((r) => `<a class="badge badge--${riskRules.statusTone(r.status)}" href="#/defensio/prevention/rules?patternId=${esc(p.id)}" title="${esc(`${r.status} — ${r.message}`)}">${esc(r.id)}</a>`).join(' ');
}

// --- plans ------------------------------------------------------------------------------

export function planStatusHtml(plan) {
  const tone = preventionPlans.statusTone(plan.status);
  const m = plan.measurement || {};
  const title = plan.status === 'InMeasurement' ? `Measuring to ${date(m.endsAt)}${preventionPlans.pastWindow(plan) ? ' — the window has passed, close it on the verdict' : ` — ${preventionPlans.daysLeft(plan)} days left`}`
    : plan.status.startsWith('Closed') ? `Closed ${date(m.closedAt)} by ${m.closedBy || '—'} — ${m.verdict || ''}`
      : plan.status === 'Cancelled' ? `Cancelled ${date(plan.cancelled?.at)} — ${plan.cancelled?.reason || ''}`
        : plan.status === 'Active' ? `Active since ${date(plan.activatedAt)} — measurement starts once every action is done` : 'A draft — activate it to freeze the baseline';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(preventionPlans.statusLabel(plan.status))}</span>`;
}

export function verdictHtml(result) {
  if (!result) return '<span class="t-body-sm">—</span>';
  return `<span class="badge badge--${preventionPlans.verdictTone(result.verdict)}" title="${esc(`${result.count} denial${result.count === 1 ? '' : 's'}, ${usd(result.value)} measured (${result.deltaPct > 0 ? '+' : ''}${result.deltaPct}% on value)`)}">${esc(result.verdict)}</span>`;
}

/** The plan's actions as "2 of 3 done", overdue in red. */
export function actionsSummaryHtml(plan) {
  const rows = plan.actions || [];
  const done = rows.filter(preventionPlans.actionDone).length;
  const overdue = preventionPlans.overdueActions(plan).length;
  if (!rows.length) return '<span class="t-body-sm">No actions</span>';
  return `<span class="t-mono-sm">${done}</span> <span class="t-body-sm">of ${rows.length} done</span>${overdue ? ` <span class="badge badge--critical" title="${esc(`${overdue} action${overdue === 1 ? '' : 's'} past due`)}">${overdue} overdue</span>` : ''}`;
}

export const ownerHtml = (id) => (id ? `<span title="${esc(staff(id)?.title || '')}">${esc(staffName(id))}</span>` : '<span class="t-body-sm">Nobody</span>');

export function targetsHtml(plan) {
  const targets = plan.targets || [];
  if (!targets.length) return '<span class="t-body-sm">No target yet</span>';
  return targets.map((t) => {
    const href = preventionPlans.targetHref(t);
    const label = preventionPlans.targetLabel(t);
    return `${href ? `<a class="badge" href="${esc(href)}" title="${esc(`${preventionPlans.TARGET_LABELS[t.type]} — ${label}`)}">` : `<span class="badge" title="${esc(label)}">`}${esc(t.type === 'pattern' ? t.ref : t.type === 'cause' ? label : t.ref)}${href ? '</a>' : '</span>'}`;
  }).join(' ');
}

// --- rules ------------------------------------------------------------------------------

export function ruleStatusHtml(r) {
  const tone = riskRules.statusTone(r.status);
  const title = r.status === 'Active' ? `Warns at the scrub since ${date(r.createdAt)}` : `${r.status}${r.statusReason ? ` — ${r.statusReason}` : ''}`;
  return `<span class="badge${tone ? ` badge--${tone}` : ''}" title="${esc(title)}"><span class="dot"></span>${esc(r.status)}</span>`;
}

/** Denied anyway over sent out as warned — the share the rule predicted right. */
export function followThroughHtml(r) {
  const ft = riskRules.followThrough(r);
  const s = riskRules.stats(r);
  if (ft == null) return `<span class="t-body-sm" title="Nothing has been sent out over this warning yet">—</span>`;
  const pct = Math.round(ft * 100);
  const flagged = riskRules.retirementFlag(r);
  return `<span class="badge${flagged ? ' badge--critical' : pct >= 50 ? ' badge--success' : ''}" title="${esc(`${s.deniedAnyway} of the ${s.ackSubmitted} claims sent out over the warning were denied`)}">${pct}%</span>`;
}

/** The decision a rule waits on: a retirement flag, a suspension proposed by its faded pattern. */
export function ruleFlagsHtml(r) {
  const out = [];
  if (riskRules.retirementFlag(r)) out.push(`<span class="badge badge--critical" title="${esc(`Fired ${riskRules.stats(r).fired} times, follow-through under ${Math.round(riskRules.retireFollowThroughBelow() * 100)}% — a poor predictor; retire it, or keep it with a reason`)}">Retire?</span>`);
  const p = riskRules.suspendProposal(r);
  if (p) out.push(`<span class="badge badge--warning" title="${esc(`${p.reason} — suspend it, or keep it`)}">Suspend?</span>`);
  return out.join(' ') || '<span class="t-body-sm">—</span>';
}

export const severityHtml = () => '<span class="badge badge--warning" title="Locked — a risk rule warns and never blocks"><span class="icon icon--sm">lock</span>Warning</span>';
