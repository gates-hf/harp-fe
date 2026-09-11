// Appeal funnel — the stages a true denial passes on its way back to cash,
// the leakage between them (appealable denials nobody appealed first), wins
// by ground and by level, the payer's turnaround against its response
// window, and the shortfall aging: conceded money the remittance has not
// carried in full. Decision and cash boundaries, with the landed set on
// intake.

import * as engine from '../../../../data/engines/denial-analytics.js';
import { esc, usd } from '../../../../shared/format.js';
import { funnelBars } from './analytics-charts.js';
import { badge, captionHtml, emptyHtml, pct } from './analytics-format.js';

export function render(host, { range, payerId }) {
  const f = engine.funnel(range, { payerId });
  const leak = f.leakage.appealableNeverAppealed;
  host.innerHTML = `
    <div class="worklists">
      <div class="panel">
        <div class="panel-header">
          <span>Stages</span>
          <span class="icon icon--sm" tabindex="0" role="img" aria-label="How the stages are read" title="Each stage counts what happened inside the period on its own boundary: denials by the day they landed, cases by the day they were opened or submitted, decisions by the payer's decision date, cash by the remittance date. A stage can outnumber the one before it when a case opened last period was decided in this one."></span>
          <span class="spacer"></span>
          <span class="t-body-sm">${f.stages[0].count} landed</span>
        </div>
        <div class="panel-body">${funnelBars(f.stages)}</div>
      </div>
      <div class="panel">
        <div class="panel-header"><span>Leakage</span><span class="spacer"></span>${leak.count ? badge(`${leak.count} never appealed`, 'critical') : badge('none', 'success')}</div>
        <div class="panel-body">
          <dl class="dl dl--narrow">
            <dt>Appealable, never appealed</dt>
            <dd><a class="crumb-link" href="${esc(leak.href)}" title="Open the worklist on appealable denials with no appeal case">${leak.count} · ${esc(usd(leak.amount))}</a>
              <span class="t-body-sm">— ${leak.open} still open, ${leak.resolved} closed without one, ${leak.deadlinePassed} past the window, ${leak.otherRoute} on another route</span></dd>
            <dt>Opened, not submitted</dt>
            <dd><a class="crumb-link" href="${esc(f.leakage.openedNotSubmitted.href)}">${f.leakage.openedNotSubmitted.count}</a> <span class="t-body-sm">— ${f.leakage.openedNotSubmitted.withdrawn} withdrawn before filing</span></dd>
            <dt>Conceded, not yet in cash</dt>
            <dd><a class="crumb-link" href="${esc(f.leakage.decidedNotRecovered.href)}">${f.leakage.decidedNotRecovered.count} case${f.leakage.decidedNotRecovered.count === 1 ? '' : 's'} · ${esc(usd(f.leakage.decidedNotRecovered.amount))}</a> <span class="t-body-sm">— awaiting the remittance or short of it</span></dd>
          </dl>
        </div>
      </div>
    </div>
    <div class="worklists">
      ${winPanel('Win rate by ground', f.winByGround, 'The primary ground each decided case was argued on.')}
      ${winPanel('Win rate by level', f.winByLevel, 'Level 1 is the first appeal; level 2 the escalation after a loss.')}
    </div>
    <div class="worklists">
      <div class="panel">
        <div class="panel-header"><span>Turnaround by payer</span><span class="spacer"></span><span class="t-body-sm">submission → decision</span></div>
        ${f.turnaroundByPayer.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">Payer</th><th scope="col" class="num">Decided</th><th scope="col" class="num">Avg days</th><th scope="col" class="num">Window</th><th scope="col" class="num">In flight</th><th scope="col" class="num">Overdue</th></tr></thead>
          <tbody>${f.turnaroundByPayer.map((p) => `
            <tr>
              <td><a class="crumb-link" href="${esc(p.href)}">${esc(p.label)}</a></td>
              <td class="num">${p.decided}</td>
              <td class="num t-mono-sm">${p.avgDays == null ? '—' : `${p.avgDays} d`}${p.avgDays != null && p.avgDays > p.window ? ` ${badge('over window', 'warning')}` : ''}</td>
              <td class="num t-mono-sm">${p.window} d</td>
              <td class="num">${p.inFlight}</td>
              <td class="num">${p.overdue ? badge(String(p.overdue), 'critical') : '0'}</td>
            </tr>`).join('')}</tbody>
        </table>` : `<div class="panel-body">${emptyHtml('No appeal decided', 'No appeal was submitted or decided in this period.')}</div>`}
      </div>
      <div class="panel">
        <div class="panel-header"><span>Shortfall aging</span><span class="icon icon--sm" tabindex="0" role="img" aria-label="About shortfalls" title="Conceded money the remittance has not carried in full: still awaiting it (days since the decision) or short of it (the gap, and whether the case answered it)."></span><span class="spacer"></span><span class="badge">${f.shortfallAging.length}</span></div>
        ${f.shortfallAging.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">Case</th><th scope="col">Claim</th><th scope="col" class="num">Conceded</th><th scope="col" class="num">Came</th><th scope="col" class="num">Gap</th><th scope="col">State</th><th scope="col" class="num">Days</th></tr></thead>
          <tbody>${f.shortfallAging.map((r) => `
            <tr>
              <td><a class="crumb-link t-mono-sm" href="${esc(r.href)}">${esc(r.caseId)}</a></td>
              <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(r.claimNo)}">${esc(r.claimNo)}</a></td>
              <td class="num t-mono-sm">${esc(usd(r.conceded))}</td>
              <td class="num t-mono-sm">${esc(usd(r.recovered))}</td>
              <td class="num t-mono-sm">${esc(usd(r.gap))}</td>
              <td>${r.state === 'Shortfall' ? badge(r.answered ? `Shortfall · ${r.answered}` : 'Shortfall · unanswered', r.answered ? 'info' : 'critical') : badge('Awaiting remittance', r.aging ? 'critical' : 'warning')}</td>
              <td class="num t-mono-sm">${r.days}</td>
            </tr>`).join('')}</tbody>
        </table>` : `<div class="panel-body">${emptyHtml('Nothing outstanding', 'Every conceded amount has been paid in full.')}</div>`}
      </div>
    </div>`;

  const csv = [
    ['Stage', 'Count', 'Amount'],
    ...f.stages.map((s) => [s.label, s.count, s.amount]),
    [],
    ['Leakage', 'Count', 'Amount', 'Detail'],
    ['Appealable, never appealed', leak.count, leak.amount, `${leak.open} open, ${leak.resolved} closed, ${leak.deadlinePassed} past window, ${leak.otherRoute} other route`],
    ['Opened, not submitted', f.leakage.openedNotSubmitted.count, '', `${f.leakage.openedNotSubmitted.withdrawn} withdrawn`],
    ['Conceded, not in cash', f.leakage.decidedNotRecovered.count, f.leakage.decidedNotRecovered.amount, ''],
    [],
    ['Win by ground', 'Decided', 'Won', 'Rate', 'Conceded'],
    ...f.winByGround.map((g) => [g.label, g.decided, g.won, g.rate == null ? '' : g.rate, g.conceded]),
    ['Win by level', 'Decided', 'Won', 'Rate', 'Conceded'],
    ...f.winByLevel.map((g) => [g.label, g.decided, g.won, g.rate == null ? '' : g.rate, g.conceded]),
    [],
    ['Turnaround by payer', 'Decided', 'Avg days', 'Window', 'In flight', 'Overdue'],
    ...f.turnaroundByPayer.map((p) => [p.label, p.decided, p.avgDays ?? '', p.window, p.inFlight, p.overdue]),
    [],
    ['Shortfall aging', 'Claim', 'Conceded', 'Came', 'Gap', 'State', 'Days'],
    ...f.shortfallAging.map((r) => [r.caseId, r.claimNo, r.conceded, r.recovered, r.gap, r.state, r.days]),
  ];
  return { csv, name: `denial-analytics-funnel-${range.from}-${range.to}.csv`, caption: captionHtml(engine.boundariesFor(['denialRateValue', 'overturnRate', 'recoveryRate'])) };
}

function winPanel(title, rows, hint) {
  return `
    <div class="panel">
      <div class="panel-header"><span>${esc(title)}</span><span class="icon icon--sm" tabindex="0" role="img" aria-label="About this panel" title="${esc(hint)}"></span><span class="spacer"></span><span class="badge">${rows.length}</span></div>
      ${rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">${title.includes('ground') ? 'Ground' : 'Level'}</th><th scope="col" class="num">Decided</th><th scope="col" class="num">Won</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Disputed</th><th scope="col" class="num">Conceded</th></tr></thead>
        <tbody>${rows.map((g) => `
          <tr>
            <td>${esc(g.label)}</td>
            <td class="num">${g.decided}</td>
            <td class="num">${g.won}</td>
            <td class="num t-mono-sm">${pct(g.rate)}</td>
            <td class="num t-mono-sm">${esc(usd(g.disputed))}</td>
            <td class="num t-mono-sm">${esc(usd(g.conceded))}</td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="panel-body">${emptyHtml('No decision yet', 'No appeal was decided in this period.')}</div>`}
    </div>`;
}
