// The three zones of the prevention dashboard as markup: the prevention
// feed (ranked causes with the No-plan flag), the pattern alerts table and
// the plans summary. Markup only — prevention-dashboard.js owns the state
// and the listener.

import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as preventionPlans from '../../../../data/repositories/prevention-plans.js';
import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as payers from '../../../../data/repositories/payers.js';
import { date, esc, usd } from '../../../../shared/format.js';
import {
  actionsSummaryHtml, moneyHtml, occurrencesHtml, ownerHtml, patternHtml, patternStatusHtml, planChipsHtml, planStatusHtml,
  ruleChipsHtml, targetsHtml, trendHtml, verdictHtml,
} from './prevention-chips.js';

// --- Zone A: the prevention feed -----------------------------------------------------------

export function feedHtml(rows) {
  if (!rows.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">verified</span></div>
        <div class="state-view__title">Nothing denied in the window</div>
        <p class="state-view__body">No denial landed inside the last ${denialPatterns.windowDays()} days — there is nothing to prevent yet.</p>
      </div>`;
  }
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Root cause</th>
          <th scope="col" title="The stage of the revenue cycle the cause belongs to, and the feature that prevents it">Origin</th>
          <th scope="col" title="Denials counted under the cause inside the window">Denials</th>
          <th scope="col">Denied</th>
          <th scope="col">Recovered</th>
          <th scope="col">Payers</th>
          <th scope="col" title="Patterns over the threshold on this cause">Patterns</th>
          <th scope="col" title="A plan in force targets the cause, or a pattern on it">Plan</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((c, i) => `
        <tr data-cause="${esc(c.causeId)}"${c.noPlanFlag ? ' aria-current="true"' : ''}>
          <td><span class="t-mono-sm">${i + 1}</span></td>
          <td>${esc(c.label)}<br><span class="t-mono-sm">${esc(c.causeId)}</span></td>
          <td>${c.owner ? `<a class="crumb-link t-body-sm" href="${esc(c.owner.href)}" title="Where this cause is prevented">${esc(c.group)} · ${esc(c.owner.feature)}</a>` : esc(c.group || '—')}</td>
          <td><span class="t-mono-sm">${c.count}</span></td>
          <td>${moneyHtml(c.deniedValue)}</td>
          <td>${moneyHtml(c.recoveredValue)}</td>
          <td><span class="t-body-sm" title="${esc(c.payerIds.map((id) => payers.get(id)?.nameEn || id).join(', '))}">${c.payerIds.length}</span></td>
          <td>${c.patternIds.length ? c.patternIds.map((id) => `<a class="badge" href="#/defensio/prevention?pattern=${esc(id)}" title="Open the pattern">${esc(id)}</a>`).join(' ') : '<span class="t-body-sm">—</span>'}</td>
          <td>${c.hasPlan ? '<span class="badge badge--success" title="A plan in force covers it">Planned</span>'
    : c.noPlanFlag ? `<span class="badge badge--critical" title="${esc(`${usd(c.deniedValue)} denied in the window and no plan in force — the flag trips at ${usd(denialPatterns.noPlanFlagValue())}`)}">No plan</span>`
      : '<span class="t-body-sm" title="Below the flag value">—</span>'}</td>
          <td>${c.hasPlan ? '<span class="t-body-sm">Covered</span>' : `
            <button class="btn btn--${c.noPlanFlag ? 'primary' : 'secondary'} btn--sm" data-act="plan-cause" data-id="${esc(c.causeId)}" title="Open a plan prefilled with this cause">
              <span class="icon icon--sm">add_task</span>Create plan
            </button>`}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

// --- Zone B: the pattern alerts ------------------------------------------------------------

export function patternsHtml(rows, filtered) {
  if (!rows.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'insights'}</span></div>
        <div class="state-view__title">${filtered ? 'Nothing matches' : 'No pattern yet'}</div>
        <p class="state-view__body">${filtered ? 'No pattern matches these filters. Clear them to see the whole list.'
    : `A pattern appears once the same payer, cause and service have been refused ${denialPatterns.threshold()} times inside ${denialPatterns.windowDays()} days.`}</p>
        ${filtered ? '<div class="state-view__actions"><button class="btn btn--secondary" data-act="clear">Clear filters</button></div>' : ''}
      </div>`;
  }
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Pattern</th>
          <th scope="col">Status</th>
          <th scope="col" title="The second half of the window against the first">Trend</th>
          <th scope="col" title="In the window, of the lifetime count">Occurrences</th>
          <th scope="col" title="Denied inside the window">Denied</th>
          <th scope="col" title="Recovered on the window's denials">Recovered</th>
          <th scope="col">First · last seen</th>
          <th scope="col">Plan</th>
          <th scope="col">Rule</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((p) => `
        <tr data-id="${esc(p.id)}" tabindex="0" title="Open ${esc(p.id)}"${denialPatterns.needsAcknowledgment(p) ? ' aria-current="true"' : ''}>
          <td>${patternHtml(p)}</td>
          <td>${patternStatusHtml(p)}</td>
          <td>${trendHtml(p)}</td>
          <td>${occurrencesHtml(p)}</td>
          <td>${moneyHtml(p.counters?.deniedValue, `${usd(p.counters?.openValue || 0)} still open`)}</td>
          <td>${moneyHtml(p.counters?.recoveredValue)}</td>
          <td><span class="t-body-sm">${date(p.firstSeenAt)}<br>${date(p.lastSeenAt)}</span></td>
          <td>${planChipsHtml(p)}</td>
          <td>${ruleChipsHtml(p)}</td>
          <td>${actionsHtml(p)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function actionsHtml(p) {
  const needsAck = denialPatterns.needsAcknowledgment(p);
  const planned = preventionPlans.inForceFor(p).length > 0;
  const ruled = riskRules.activeFor(p.id).length > 0;
  return `
    ${needsAck ? '<button class="btn btn--primary btn--sm" data-act="acknowledge" title="Say you have read it"><span class="icon icon--sm">visibility</span>Acknowledge</button>' : ''}
    <button class="btn btn--secondary btn--sm" data-act="plan-pattern"${planned ? ' disabled title="A plan in force already targets this pattern"' : ' title="Open a plan prefilled with this pattern"'}>
      <span class="icon icon--sm">add_task</span>Plan</button>
    <button class="btn btn--secondary btn--sm" data-act="rule-pattern"${ruled ? ' disabled title="An active rule already warns on this pattern"' : ' title="Warn at the claim scrub when a claim matches this pattern"'}>
      <span class="icon icon--sm">rule</span>Rule</button>
    <a class="btn btn--ghost btn--sm" href="${esc(denialPatterns.denialsHref(p))}" title="The worklist narrowed to this payer and cause">
      <span class="icon icon--sm">list</span>Denials</a>`;
}

// --- Zone C: the plans summary --------------------------------------------------------------

export function plansHtml(rows) {
  if (!rows.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">add_task</span></div>
        <div class="state-view__title">No prevention plan yet</div>
        <p class="state-view__body">Open one from a pattern, from a cause on the feed, or from scratch.</p>
        <div class="state-view__actions"><button class="btn btn--primary" data-act="new-plan">New plan</button></div>
      </div>`;
  }
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Plan</th>
          <th scope="col">Targets</th>
          <th scope="col">Status</th>
          <th scope="col">Owner</th>
          <th scope="col" title="Done of raised — overdue ones in red">Actions</th>
          <th scope="col" title="Frozen at activation">Baseline</th>
          <th scope="col" title="What the targets drew since measurement started">Measured</th>
          <th scope="col">Verdict</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>${rows.map((plan) => {
    const overdue = preventionPlans.overdueActions(plan).length;
    const r = plan.measurement?.result;
    return `
        <tr data-plan="${esc(plan.id)}" tabindex="0" title="Open ${esc(plan.id)}"${overdue ? ' aria-current="true"' : ''}>
          <td><a class="crumb-link t-mono-sm" href="#/defensio/prevention/plans/${esc(plan.id)}">${esc(plan.id)}</a><br>${esc(plan.title)}</td>
          <td>${targetsHtml(plan)}</td>
          <td>${planStatusHtml(plan)}</td>
          <td>${ownerHtml(plan.ownerId)}</td>
          <td>${actionsSummaryHtml(plan)}</td>
          <td>${plan.baseline ? `<span class="t-mono-sm">${plan.baseline.count}</span> <span class="t-body-sm">· ${esc(usd(plan.baseline.value))}</span>` : '<span class="t-body-sm">Not frozen</span>'}</td>
          <td>${r ? `<span class="t-mono-sm">${r.count}</span> <span class="t-body-sm">· ${esc(usd(r.value))} (${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%)</span>` : '<span class="t-body-sm">—</span>'}</td>
          <td>${verdictHtml(r)}${r && preventionPlans.pastWindow(plan) && plan.status === 'InMeasurement' ? ' <span class="badge badge--info" title="The window has passed">Close it</span>' : ''}</td>
          <td><a class="btn btn--secondary btn--sm" href="#/defensio/prevention/plans/${esc(plan.id)}" title="Open the plan"><span class="icon icon--sm">open_in_new</span>Open</a></td>
        </tr>`;
  }).join('')}</tbody>
    </table>`;
}
