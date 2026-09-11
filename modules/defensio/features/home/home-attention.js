// The four attention tables on the Defensio dashboard: denials nobody has
// triaged, the deadlines closing on both clocks, the decisions waiting on
// somebody under root cause and accountability, and the prevention gaps.
// Each shows the worst five and hands the rest to the list its header links
// to; each empty state is the positive one.
//
// Nothing is computed here. Every row set is the owning repository's own
// helper — the one the screen behind "View all" reads — and the cells are the
// chips those features already draw, imported from their chip files inside
// this module: one module, one way of naming a denial, a case or a pattern.
// The panel frame is the Claima dashboard's, copied rather than imported: a
// module never reaches into another module's files.

import * as denials from '../../../../data/repositories/denials.js';
import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as payers from '../../../../data/repositories/payers.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { esc, relativeTime, usd } from '../../../../shared/format.js';
import { amountHtml, deadlineHtml, isWithheld, payerName, reasonHtml, statusHtml, withheldCell } from '../denials/denial-chips.js';
import { clockHtml } from '../appeal-tracking/tracking-chips.js';
import { stageHtml, statusHtml as rcaStatus } from '../rca/rca-chips.js';
import { patternStatusHtml, ruleFlagsHtml, trendHtml } from '../prevention/prevention-chips.js';
import { filingWarnDays } from './home-kpis.js';

const MAX_ROWS = 5;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The first row of panels: what nobody has looked at, and what is about to lapse. */
export const topHtml = () => untriagedPanel() + deadlinePanel();

/** The second: decisions waiting on somebody, and the gaps prevention has found. */
export const bottomHtml = () => decisionsPanel() + preventionPanel();

// --- untriaged denials ----------------------------------------------------------

/** The denials nobody has classed, largest open amount first — the worklist's own slice. */
export const untriagedRows = () => denials.search('', { status: 'Untriaged' })
  .sort((a, b) => (Number(b.amounts?.open) || 0) - (Number(a.amounts?.open) || 0));

function untriagedPanel() {
  const rows = untriagedRows();
  return panel({
    title: 'Untriaged denials',
    href: '#/defensio/denials?status=Untriaged',
    total: rows.length,
    headers: ['Denial', 'Payer', 'Reason', 'Amount', 'Appeal by'],
    body: rows.slice(0, MAX_ROWS).map(denialRow).join(''),
    empty: { icon: 'rule', title: 'Nothing to triage', body: 'Every denial has been separated, tiered and classed. A refusal a remittance posts lands here.' },
  });
}

function denialRow(denial) {
  const role = currentRole();
  const claim = denials.claimOf(denial);
  const withheld = claim ? isWithheld(claim, role) : false;
  return `
    ${rowStart(`/defensio/denials/${denial.id}`, `Open ${denial.id}`)}
      <td><span class="t-mono-sm">${esc(denial.id)}</span>
        <br><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(denial.claimNo)}">${esc(denial.claimNo)}</a></td>
      <td>${withheld ? withheldCell() : `${esc(payerName(denial))}<br>${statusHtml(denial)}`}</td>
      <td>${reasonHtml(denial)}</td>
      <td>${withheld ? withheldCell() : amountHtml(denial)}</td>
      <td>${deadlineHtml(denial)}</td>
    </tr>`;
}

// --- deadline critical (both clocks) --------------------------------------------

/**
 * One array over two clocks: the denial's filing deadline (amendment 36 —
 * inside the band, or passed with the money still open) and the payer's
 * response deadline on a submitted appeal (amendment 39 — overdue, or inside
 * its warning). Days remaining ascending, so what has lapsed comes first.
 */
export function deadlineRows() {
  const filing = [...denials.nearDeadline(), ...denials.search('', { deadline: 'passed' })].map((d) => {
    const dl = denials.deadline(d);
    return { kind: 'Filing', record: d, id: d.id, payerId: d.payerId, amount: d.amounts?.open, daysLeft: dl.daysLeft, overdue: dl.passed,
      path: `/defensio/denials/${d.id}`, chip: deadlineHtml(d) };
  });
  const response = tracking.inFlight().map((c) => ({ c, clock: tracking.clockOf(c) }))
    .filter(({ clock }) => clock.overdue || clock.warn)
    .map(({ c, clock }) => ({ kind: 'Payer response', record: c, id: c.id, payerId: c.payerId, amount: tracking.disputedOf(c), daysLeft: clock.daysLeft, overdue: clock.overdue,
      path: `/defensio/appeal-tracking/${c.id}`, chip: clockHtml(c) }));
  return [...filing, ...response].sort((a, b) => a.daysLeft - b.daysLeft || (Number(b.amount) || 0) - (Number(a.amount) || 0));
}

function deadlinePanel() {
  const rows = deadlineRows();
  const overdue = rows.filter((r) => r.overdue).length;
  return panel({
    title: 'Deadline critical',
    href: '#/defensio/denials?deadline=week',
    hrefTitle: 'Open the denial worklist on the filing band',
    extra: `<a class="btn btn--ghost btn--sm" href="#/defensio/appeal-tracking?slice=overdue" title="Open the tracking worklist on the appeals past the payer's window">Payer responses<span class="icon icon--sm">arrow_forward</span></a>`,
    total: rows.length,
    badgeTone: overdue ? 'critical' : '',
    headers: ['Clock', 'Record', 'Payer', 'Amount', 'Days left'],
    body: rows.slice(0, MAX_ROWS).map(deadlineRow).join(''),
    empty: { icon: 'event_available', title: 'No deadline inside the window', body: `No appeal window closes inside ${filingWarnDays()} days and every payer is still inside its response window.` },
  });
}

/** The owner's own chip carries the day count and the tint — critical once the clock has passed. */
function deadlineRow(r) {
  return `
    ${rowStart(r.path, `Open ${r.id}`)}
      <td><span class="badge${r.kind === 'Filing' ? '' : ' badge--info'}" title="${r.kind === 'Filing' ? 'The denial’s own appeal window' : 'How long the payer has to answer the submitted appeal'}">${esc(r.kind)}</span></td>
      <td><span class="t-mono-sm">${esc(r.id)}</span><br><span class="t-body-sm">${esc(r.record.claimNo || '')}</span></td>
      <td>${esc(payers.get(r.payerId)?.nameEn || r.payerId || '—')}</td>
      <td><span class="t-mono-sm">${esc(usd(r.amount))}</span></td>
      <td>${r.chip}</td>
    </tr>`;
}

// --- pending decisions (root cause & accountability) ----------------------------

/**
 * Everything under amendment 37 waiting on somebody's decision: an
 * accountability case awaiting the person's response, the decider, the
 * appeal reviewer or HR, and a root-cause case past its target or concluded
 * and waiting to be closed. Names are read through the register's own
 * `personLabel`, which masks outside the authorised roles — no person id
 * reaches the markup, and the assert below says so on every draw.
 */
export function decisionRows() {
  const role = currentRole();
  const acc = accountabilityCases.search('', {}).filter(accountabilityCases.isOpen).map((a) => {
    const stage = accountabilityCases.stageOf(a);
    const w = accountabilityCases.windowOf(a);
    const waitingOn = stage === 'Awaiting response' ? (w.passed ? 'the person — window passed' : `the person · ${w.daysLeft} d left`)
      : stage === 'Response recorded' || stage === 'No response' ? 'the decider'
        : stage === 'Under appeal' ? 'the appeal reviewer'
          : a.deductionTracking && a.deductionTracking.status !== 'OutcomeCaptured' ? `HR · ${a.deductionTracking.status === 'SentToHR' ? 'outcome' : 'to send'}` : 'closure';
    return { kind: 'Accountability', id: a.id, who: accountabilityCases.personLabel(a, role), since: a.updatedAt || a.openedAt, urgent: w.passed && stage === 'Awaiting response',
      stage: stageHtml(a), waitingOn, path: accountabilityCases.canRead(role) ? `/defensio/accountability/${a.id}` : `/defensio/rca/${a.rcaCaseId}` };
  });
  const rca = rcaCases.all().filter((c) => rcaCases.isOverdue(c) || c.status === 'Concluded').map((c) => ({
    kind: 'Root cause', id: c.id, who: rcaCases.analystName(c) || 'Unassigned', since: c.status === 'Concluded' ? c.concludedAt || c.updatedAt : c.openedAt, urgent: rcaCases.isOverdue(c),
    stage: rcaStatus(c), waitingOn: rcaCases.isOverdue(c) ? `the analyst · ${Math.abs(rcaCases.target(c).daysLeft)} d past target` : 'closure — actions to verify',
    path: `/defensio/rca/${c.id}`,
  }));
  return [...acc, ...rca].sort((a, b) => Number(b.urgent) - Number(a.urgent) || String(a.since).localeCompare(String(b.since)));
}

function decisionsPanel() {
  const rows = decisionRows();
  const canRead = accountabilityCases.canRead(currentRole());
  const html = panel({
    title: 'Pending decisions',
    href: canRead ? '#/defensio/accountability?slice=open' : '#/defensio/rca?slice=open',
    hrefTitle: canRead ? 'Open the accountability register on the open cases' : 'Open the root-cause worklist on the open cases',
    extra: canRead ? `<a class="btn btn--ghost btn--sm" href="#/defensio/rca?slice=open" title="Open the root-cause worklist on the open cases">Root cause<span class="icon icon--sm">arrow_forward</span></a>` : '',
    total: rows.length,
    badgeTone: rows.some((r) => r.urgent) ? 'critical' : '',
    headers: ['Case', 'Who', 'Stage', 'Waiting on', 'Since'],
    body: rows.slice(0, MAX_ROWS).map(decisionRow).join(''),
    empty: { icon: 'task_alt', title: 'No decision waiting', body: 'Every root-cause case is inside its target and every accountability case has been answered.' },
  });
  // Identity masking preserved verbatim: outside the authorised roles no
  // person id and no staff name may reach the page — the label is A37's own.
  if (!canRead) {
    const ids = accountabilityCases.all().map((a) => a.personId).filter(Boolean);
    console.assert(!ids.some((id) => html.includes(id)), '[defensio home] a person id reached the pending-decisions table');
  }
  return html;
}

function decisionRow(r) {
  return `
    ${rowStart(r.path, `Open ${r.id}`)}
      <td><span class="badge${r.kind === 'Root cause' ? ' badge--info' : ''}">${esc(r.kind)}</span><br><span class="t-mono-sm">${esc(r.id)}</span></td>
      <td>${esc(r.who)}</td>
      <td>${r.stage}</td>
      <td>${r.urgent
        ? `<span class="badge badge--critical">${esc(r.waitingOn)}</span>`
        : `<span class="t-body-sm">${esc(r.waitingOn)}</span>`}</td>
      <td><span class="t-body-sm">${esc(relativeTime(r.since))}</span></td>
    </tr>`;
}

// --- prevention gaps --------------------------------------------------------------

/**
 * What amendment 40 has found and nobody has answered: a pattern to
 * acknowledge, a cause worth the flag value with no plan in force, a plan
 * with an overdue action, a rule waiting on a retirement or suspension
 * decision. Each carries its type and the one action that answers it.
 */
export function preventionRows() {
  const patterns = denialPatterns.search('', { attention: true }).map((p) => ({
    kind: 'Pattern', id: p.id, label: denialPatterns.labelOf(p), value: p.counters?.deniedValue || 0,
    state: `${patternStatusHtml(p)} ${trendHtml(p)}`, action: 'Acknowledge', href: `#/defensio/prevention?pattern=${encodeURIComponent(p.id)}`,
  }));
  const causes = denialPatterns.rankedCauses().filter((c) => c.noPlanFlag).map((c) => ({
    kind: 'No plan', id: c.causeId, label: `${c.label} · ${plural(c.count, 'denial')} in the window`, value: c.deniedValue,
    state: `<span class="badge badge--critical" title="${esc(`${usd(c.deniedValue)} denied in the window and no plan in force — the flag trips at ${usd(denialPatterns.noPlanFlagValue())}`)}">No plan</span>`,
    action: 'Plan', href: `#/defensio/prevention/plans/new?cause=${encodeURIComponent(c.causeId)}`,
  }));
  const plans = preventionPlans.all().filter((p) => preventionPlans.overdueActions(p).length).map((p) => ({
    kind: 'Plan', id: p.id, label: p.title, value: p.baseline?.value || 0,
    state: `<span class="badge badge--warning">${esc(plural(preventionPlans.overdueActions(p).length, 'overdue action'))}</span>`,
    action: 'Open plan', href: `#/defensio/prevention/plans/${encodeURIComponent(p.id)}`,
  }));
  const rules = riskRules.attention().map((r) => ({
    kind: 'Rule', id: r.id, label: r.message || riskRules.conditionsLabel(r.conditions), value: 0,
    state: ruleFlagsHtml(r), action: 'Review', href: `#/defensio/prevention/rules?slice=${riskRules.retirementFlag(r) ? 'flagged' : 'proposed'}`,
  }));
  return [...patterns, ...causes, ...plans, ...rules].sort((a, b) => b.value - a.value || a.kind.localeCompare(b.kind));
}

function preventionPanel() {
  const rows = preventionRows();
  return panel({
    title: 'Prevention gaps',
    href: '#/defensio/prevention',
    total: rows.length,
    headers: ['Type', 'Item', 'State', 'Value', 'Action'],
    body: rows.slice(0, MAX_ROWS).map(preventionRow).join(''),
    empty: { icon: 'shield', title: 'No prevention gap', body: 'Every pattern is acknowledged, every flagged cause has a plan in force and no rule is waiting on a decision.' },
  });
}

function preventionRow(r) {
  return `
    ${rowStart(r.href.replace(/^#/, ''), `${r.action} ${r.id}`)}
      <td><span class="badge">${esc(r.kind)}</span></td>
      <td><span class="t-mono-sm">${esc(r.id)}</span><br><span class="t-body-sm">${esc(r.label)}</span></td>
      <td>${r.state}</td>
      <td>${r.value ? `<span class="t-mono-sm">${esc(usd(r.value))}</span>` : '<span class="t-body-sm">—</span>'}</td>
      <td><a class="btn btn--secondary btn--sm" href="${esc(r.href)}">${esc(r.action)}</a></td>
    </tr>`;
}

// --- shared markup ----------------------------------------------------------------

/**
 * One attention panel: a header that says how many there are and links to the
 * whole list (and a second list, when the table merges two), and a five-row
 * table or a positive empty state.
 */
function panel({ title, href, hrefTitle = 'Open the full list', extra = '', total, badgeTone = '', headers, body, empty }) {
  return `
    <div class="panel">
      <div class="panel-header">
        <span>${esc(title)}</span>
        ${total ? `<span class="badge${badgeTone ? ` badge--${badgeTone}` : ''}">${total}</span>` : ''}
        <span class="spacer"></span>
        ${extra}
        <a class="btn btn--ghost btn--sm" href="${esc(href)}" title="${esc(hrefTitle)}">
          View all<span class="icon icon--sm">arrow_forward</span>
        </a>
      </div>
      <div class="panel-body">
        ${total ? `
          <table class="tbl">
            <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${body}</tbody>
          </table>
          ${total > MAX_ROWS ? `<p class="t-body-sm">${total - MAX_ROWS} more in the full list.</p>` : ''}
        ` : `
          <div class="state-view">
            <div class="state-view__glyph"><span class="icon">${empty.icon}</span></div>
            <div class="state-view__title">${esc(empty.title)}</div>
            <p class="state-view__body">${esc(empty.body)}</p>
          </div>`}
      </div>
    </div>`;
}

const rowStart = (path, title) =>
  `<tr data-go="${esc(path)}" tabindex="0" title="${esc(title)}">`;
