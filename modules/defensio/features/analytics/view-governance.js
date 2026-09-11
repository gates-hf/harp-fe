// Governance — how the root-cause work is going: throughput and overdue
// cases, the nature split, individual findings by the role in failure only
// (a person is never named here — asserted on every draw), corrective
// actions by status and type, and what amendment 40 publishes when it is
// on disk: plan verdicts, the prevented value (an estimate, badged as one)
// and rule quality. Decision boundary for the cases; the actions are read
// as they stand today.

import * as engine from '../../../../data/engines/denial-analytics.js';
import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import { STAFF } from '../../../../data/seed/staff.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { esc, usd } from '../../../../shared/format.js';
import { badge, captionHtml, emptyHtml, estimateBadge, pendingHtml } from './analytics-format.js';

export function render(host, { range }) {
  const g = engine.governance(range);
  const rca = g.rca;
  host.innerHTML = `
    <div class="metric-rail">${metricRailHtml([
      { value: rca.opened, label: 'RCA opened', href: '#/defensio/rca?slice=open', title: `Cases opened inside the period (${range.from} → ${range.to})` },
      { value: rca.concluded, label: 'Concluded', href: '#/defensio/rca?slice=concluded', tone: rca.avgDaysToConclude != null && rca.avgDaysToConclude > rca.target ? 'warning' : '',
        sub: rca.avgDaysToConclude == null ? 'no average yet' : `${rca.avgDaysToConclude} d avg · target ${rca.target}`, title: 'Cases concluded inside the period and the average days from opening to conclusion' },
      { value: rca.overdue, label: 'Overdue now', href: '#/defensio/rca?slice=overdue', tone: rca.overdue ? 'critical' : '', title: `Open cases past their ${rca.target}-day target today` },
      { value: g.actions.byStatus.find((s) => s.key === 'Open')?.count || 0, label: 'Actions open', href: '#/defensio/rca', tone: g.actions.overdue ? 'warning' : '',
        sub: g.actions.overdue ? `${g.actions.overdue} past due` : 'none past due', title: 'Corrective actions not yet done' },
      { value: g.actions.byStatus.find((s) => s.key === 'Verified')?.count || 0, label: 'Actions verified', href: '#/defensio/rca', title: 'Corrective actions done and verified with a note' },
    ])}</div>
    <div class="worklists">
      <div class="panel">
        <div class="panel-header"><span>Nature of the cause</span><span class="spacer"></span><span class="t-body-sm">all cases · concluded in period</span></div>
        <table class="tbl">
          <thead><tr><th scope="col">Nature</th><th scope="col" class="num">Cases</th><th scope="col" class="num">Concluded in period</th></tr></thead>
          <tbody>${g.natureSplit.map((n) => `<tr><td><a class="crumb-link" href="${esc(n.href)}">${esc(n.label)}</a></td><td class="num">${n.count}</td><td class="num">${n.concluded}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-header">
          <span>Individual findings by role</span>
          <span class="icon icon--sm" tabindex="0" role="img" aria-label="Why roles and not names" title="An individual finding is counted by the job role of the person named — never by the person. What they did is in the row's tooltip; names live on the accountability register, behind its own roles."></span>
          <span class="spacer"></span>${badge('roles only', 'info')}
        </div>
        ${g.causerByRole.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">Role in failure</th><th scope="col" class="num">Findings</th><th scope="col" class="num">Concluded</th><th scope="col" class="num">Denied behind them</th></tr></thead>
          <tbody>${g.causerByRole.map((r) => `<tr><td title="${esc(r.failures.join(' · '))}">${esc(r.role)}</td><td class="num">${r.count}</td><td class="num">${r.concluded}</td><td class="num t-mono-sm">${esc(usd(r.denied))}</td></tr>`).join('')}</tbody>
        </table>` : `<div class="panel-body">${emptyHtml('No individual finding', 'No root-cause case has named a role in failure.')}</div>`}
      </div>
    </div>
    <div class="worklists">
      <div class="panel">
        <div class="panel-header"><span>Corrective actions</span><span class="spacer"></span><span class="badge">${g.actions.total}</span></div>
        <table class="tbl">
          <thead><tr><th scope="col">Status</th><th scope="col" class="num">Actions</th><th scope="col" class="num">Overdue</th></tr></thead>
          <tbody>${g.actions.byStatus.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.count}</td><td class="num">${s.overdue ? badge(String(s.overdue), 'critical') : '—'}</td></tr>`).join('')}</tbody>
        </table>
        ${g.actions.byType.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">Type</th><th scope="col" class="num">Raised</th><th scope="col" class="num">Verified</th></tr></thead>
          <tbody>${g.actions.byType.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${t.count}</td><td class="num">${t.verified}</td></tr>`).join('')}</tbody>
        </table>` : ''}
      </div>
      <div class="panel">
        <div class="panel-header"><span>Prevention plans</span><span class="spacer"></span>${g.prevention ? badge('A40 live', 'success') : badge('pending A40', 'warning')}</div>
        <div class="panel-body">${preventionHtml(g)}</div>
      </div>
      <div class="panel">
        <div class="panel-header"><span>Rule quality</span><span class="spacer"></span>${g.rules ? badge('A40 live', 'success') : badge('pending A40', 'warning')}</div>
        <div class="panel-body">${g.rules ? kv(g.rules) : pendingHtml('amendment 40', 'Risk-rule quality — how often each rule fires and how often it is right')}</div>
      </div>
    </div>`;

  assertNoIdentity(host.innerHTML);

  const csv = [
    ['Root cause', 'Opened', 'Concluded', 'Closed', 'Open now', 'Overdue', 'Avg days to conclude', 'Target'],
    ['', rca.opened, rca.concluded, rca.closed, rca.open, rca.overdue, rca.avgDaysToConclude ?? '', rca.target],
    [],
    ['Nature', 'Cases', 'Concluded in period'],
    ...g.natureSplit.map((n) => [n.label, n.count, n.concluded]),
    [],
    ['Role in failure', 'Findings', 'Concluded', 'Denied behind them'],
    ...g.causerByRole.map((r) => [r.role, r.count, r.concluded, r.denied]),
    [],
    ['Action status', 'Actions', 'Overdue'],
    ...g.actions.byStatus.map((s) => [s.label, s.count, s.overdue]),
    ['Action type', 'Raised', 'Verified'],
    ...g.actions.byType.map((t) => [t.label, t.count, t.verified]),
    [],
    ['Prevented value (estimate)', g.prevention ? g.prevention.preventedValue : 'pending A40'],
  ];
  return { csv, name: `denial-analytics-governance-${range.from}-${range.to}.csv`, caption: captionHtml([engine.BOUNDARIES.decision], 'root-cause cases by the day they were opened, concluded or closed; corrective actions as they stand today') };
}

function preventionHtml(g) {
  if (!g.prevention) return pendingHtml('amendment 40', 'Plan verdicts and the value the prevention rules stopped');
  const p = g.prevention;
  const plans = Array.isArray(p.plans) ? p.plans : [];
  return `
    <dl class="dl dl--narrow">
      <dt>Prevented value</dt><dd><span class="t-mono-sm">${esc(usd(p.preventedValue))}</span> ${estimateBadge()} <span class="t-body-sm">over ${p.preventedCount} claim${p.preventedCount === 1 ? '' : 's'}</span></dd>
      <dt>Plans</dt><dd>${plans.length ? `${plans.length} with a verdict` : 'none with a verdict yet'}</dd>
    </dl>
    ${plans.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">Plan</th><th scope="col">Verdict</th></tr></thead>
      <tbody>${plans.slice(0, 10).map((pl) => `<tr><td>${esc(String(pl.title || pl.name || pl.id || '—'))}</td><td>${badge(String(pl.verdict || pl.status || '—'))}</td></tr>`).join('')}</tbody>
    </table>` : ''}`;
}

/** The scalar fields of whatever amendment 40 publishes, as a definition list — nothing here is restated. */
function kv(obj) {
  const rows = Object.entries(obj).filter(([, v]) => v == null || ['number', 'string', 'boolean'].includes(typeof v)).slice(0, 12);
  if (!rows.length) return pendingHtml('amendment 40', 'Rule quality in a shape this view can read');
  return `<dl class="dl dl--narrow">${rows.map(([k, v]) => `<dt>${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt><dd>${esc(typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v ?? '—'))}</dd>`).join('')}</dl>`;
}

/** No person named on a root-cause case may appear on this view — by id or by name. */
function assertNoIdentity(html) {
  const persons = rcaCases.all().map((c) => c.causer?.personId).filter(Boolean);
  const names = persons.map((id) => STAFF.find((s) => s.id === id)?.name).filter(Boolean);
  const leaked = [...persons, ...names].filter((v) => html.includes(v));
  console.assert(!leaked.length, '[analytics] governance rendered an identity', leaked);
}
