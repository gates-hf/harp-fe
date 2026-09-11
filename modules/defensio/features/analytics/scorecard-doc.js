// The payer scorecard document — one renderer for the preview the generate
// screen shows and the frozen snapshot the archive prints. It draws a
// figures object (the engine's scorecard() shape, or a stored row's
// `figures`) and never computes: a saved scorecard is rendered from what
// was frozen on it, so this file imports no engine and no repository.

import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { deltaArrow, legend, monthColumns } from './analytics-charts.js';
import { badge, pct } from './analytics-format.js';

const GOOD_WHEN_UP = new Set(['recoveryRate', 'overturnRate', 'firstPassPrevention']);

/** docHtml(figures, { scorecardNo, version, generatedBy, generatedAt, notes, draft }) → the document. */
export function docHtml(f, meta = {}) {
  const fin = f.financial;
  const ap = f.appeals;
  const mis = f.misclassification;
  return `
    <article class="panel" id="sc-doc">
      <div class="panel-body">
        <div class="toolbar">
          <div>
            <div class="t-title-sm">Payer scorecard — ${esc(f.payer)}</div>
            <div class="t-body-sm">${esc(f.range.label)} · ${esc(f.range.from)} → ${esc(f.range.to)}${f.prior ? ` · compared with ${esc(f.prior.label)}` : ''}</div>
          </div>
          <span class="spacer"></span>
          <div class="t-body-sm">
            ${meta.scorecardNo ? `<div class="t-mono-sm">${esc(meta.scorecardNo)} · v${meta.version || 1}</div>` : `<div>${badge('Preview — not saved', 'warning')}</div>`}
            <div>${meta.generatedAt ? `Generated ${esc(dateTime(meta.generatedAt))} by ${esc(meta.generatedBy || '—')}` : `Read ${esc(date(f.generated))}`}</div>
          </div>
        </div>
      </div>
      <div class="panel-header"><span>Headline</span><span class="spacer"></span><span class="t-body-sm">this period · the period before · every payer over the same period</span></div>
      <table class="tbl">
        <thead><tr><th scope="col">Metric</th><th scope="col">Boundary</th><th scope="col" class="num">This period</th><th scope="col" class="num">Prior</th><th scope="col">Change</th><th scope="col" class="num">All payers</th></tr></thead>
        <tbody>${f.headline.map((h) => `
          <tr>
            <td title="${esc(h.label)}">${esc(h.label)}${h.pending ? ` ${badge(`pending A${h.pending.replace(/\D/g, '')}`, 'warning')}` : ''}</td>
            <td class="t-body-sm">${esc(h.dateBoundary)}</td>
            <td class="num t-mono-sm">${esc(h.text)}<span class="t-body-sm"> · ${h.count}</span></td>
            <td class="num t-mono-sm">${esc(h.prior?.text || '—')}</td>
            <td>${h.delta == null ? '<span class="t-body-sm">—</span>' : `${deltaArrow(h.delta, { goodWhenUp: GOOD_WHEN_UP.has(h.key) })} <span class="t-mono-sm">${esc(h.deltaText)}</span>`}</td>
            <td class="num t-mono-sm">${esc(h.allPayers?.text || '—')}</td>
          </tr>`).join('')}</tbody>
      </table>
      <div class="panel-body t-body-sm">Denial rates are by intake date — the day the denial landed on the register. Pactum Performance reports by date of service, so its figure for the same payer is a different clock, not a different register.</div>
      <div class="panel-header"><span>Profile</span><span class="spacer"></span><span class="t-body-sm">${f.profile.triaged} of ${f.profile.count} denials triaged</span></div>
      <div class="panel-body">
        <div class="worklists">
          ${rankTable('Payer reasons', f.profile.reasons)}
          ${rankTable('Root causes', f.profile.causes)}
        </div>
        ${f.profile.divergence.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">Payer said</th><th scope="col">Desk found</th><th scope="col">Code usually means</th><th scope="col" class="num">Denials</th><th scope="col" class="num">Denied</th></tr></thead>
          <tbody>${f.profile.divergence.map((d) => `<tr><td>${badge(d.code, 'warning')}</td><td>${esc(d.cause)}</td><td class="t-body-sm">${esc(d.expected)}</td><td class="num">${d.count}</td><td class="num t-mono-sm">${esc(usd(d.amount))}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="t-body-sm">No divergence: every triaged denial sits under the cause its payer code usually comes down to.</p>'}
      </div>
      <div class="panel-header"><span>Appeal record</span><span class="spacer"></span><span class="t-body-sm">response window ${ap.responseWindow} d</span></div>
      <div class="panel-body">
        <dl class="dl">
          <dt>Opened · submitted · decided</dt><dd>${ap.opened} · ${ap.submitted} · ${ap.decided}</dd>
          <dt>Overturned</dt><dd>${ap.overturned} of ${ap.decided} — ${pct(ap.overturnRate)} · ${ap.byOutcome.filter((o) => o.count).map((o) => `${o.count} ${o.label.toLowerCase()}`).join(', ') || 'none decided'}</dd>
          <dt>Turnaround</dt><dd>${ap.turnaroundDays == null ? '—' : `${ap.turnaroundDays} d`}${ap.turnaroundDays != null && ap.turnaroundDays > ap.responseWindow ? ` ${badge('over the window', 'warning')}` : ''}</dd>
          <dt>Conceded · recovered in cash</dt><dd>${esc(usd(ap.conceded))} · ${esc(usd(ap.recovered))}</dd>
          <dt>Appealable, never appealed</dt><dd>${ap.neverAppealed}</dd>
          <dt>Awaiting remittance · shortfalls</dt><dd>${ap.awaiting} · ${ap.shortfalls}</dd>
        </dl>
      </div>
      <div class="panel-header"><span>Misclassification</span><span class="spacer"></span><span class="t-body-sm">${pct(mis.rate)} of what landed</span></div>
      <div class="panel-body">
        <dl class="dl">
          <dt>Separated out</dt><dd>${mis.count} · ${esc(usd(mis.amount))}</dd>
          <dt>Contractual adjustments</dt><dd>${mis.contractual.count} · ${esc(usd(mis.contractual.amount))}</dd>
          <dt>TPA fees</dt><dd>${mis.tpa.count} · ${esc(usd(mis.tpa.amount))}</dd>
        </dl>
      </div>
      <div class="panel-header"><span>Financial summary</span></div>
      <table class="tbl">
        <thead><tr><th scope="col">Answered</th><th scope="col" class="num">Denied</th><th scope="col" class="num">Recovered (cash)</th><th scope="col" class="num">Lost</th><th scope="col" class="num">Written off</th><th scope="col" class="num">Reclassified</th><th scope="col" class="num">Open</th></tr></thead>
        <tbody><tr>
          <td>${fin.adjudicatedCount} claims · <span class="t-mono-sm">${esc(usd(fin.adjudicatedValue))}</span></td>
          <td class="num t-mono-sm">${esc(usd(fin.denied))}<span class="t-body-sm"> · ${fin.deniedCount}</span></td>
          <td class="num t-mono-sm">${esc(usd(fin.recovered))}</td>
          <td class="num t-mono-sm">${esc(usd(fin.lost))}</td>
          <td class="num t-mono-sm">${esc(usd(fin.writtenOff))}</td>
          <td class="num t-mono-sm">${esc(usd(fin.reclassified))}</td>
          <td class="num t-mono-sm">${esc(usd(fin.open))}</td>
        </tr></tbody>
      </table>
      <div class="panel-header"><span>Six-month trend</span><span class="t-body-sm">${legend('Denied (intake)', 'Recovered (cash)')}</span></div>
      <div class="panel-body">
        ${monthColumns(f.trend.map((m) => ({ label: m.label, a: m.deniedValue, b: m.recovered })), { height: 150 })}
        <table class="tbl">
          <thead><tr><th scope="col">Month</th><th scope="col" class="num">Denials</th><th scope="col" class="num">Denied</th><th scope="col" class="num">Rate $</th><th scope="col" class="num">Recovered</th><th scope="col" class="num">Lost + written off</th><th scope="col" class="num">Separated</th></tr></thead>
          <tbody>${f.trend.map((m) => `<tr><td>${esc(m.label)} ${esc(String(m.key).slice(0, 4))}</td><td class="num">${m.deniedCount}</td><td class="num t-mono-sm">${esc(usd(m.deniedValue))}</td><td class="num t-mono-sm">${pct(m.denialRateValue)}</td><td class="num t-mono-sm">${esc(usd(m.recovered))}</td><td class="num t-mono-sm">${esc(usd(m.lost))}</td><td class="num">${m.reclassifiedCount}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="panel-header"><span>Notes</span></div>
      <div class="panel-body">${String(meta.notes || 'No notes were written at generation.').split(/\r?\n/).map((p) => `<p class="t-body-sm">${esc(p)}</p>`).join('')}</div>
      <div class="panel-body t-body-sm">${(f.boundaries || []).map((b) => `<strong>${esc(b.label)}</strong> — ${esc(b.caption.toLowerCase())}`).join(' · ')}. A reclassified row is in no denial rate; recovered is cash-confirmed only.</div>
    </article>`;
}

function rankTable(title, rows) {
  return `
    <div>
      <div class="t-title-sm">${esc(title)}</div>
      ${rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">${title === 'Payer reasons' ? 'Code' : 'Cause'}</th><th scope="col" class="num">Denials</th><th scope="col" class="num">Denied</th><th scope="col" class="num">Share</th></tr></thead>
        <tbody>${rows.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.count}</td><td class="num t-mono-sm">${esc(usd(g.amount))}</td><td class="num t-mono-sm">${pct(g.share)}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="t-body-sm">Nothing landed in the period.</p>'}
    </div>`;
}

/** The document as rows for a CSV — the same figures, every section. */
export function docCsv(f, meta = {}) {
  const fin = f.financial;
  const ap = f.appeals;
  const mis = f.misclassification;
  return [
    ['Payer scorecard', f.payer, meta.scorecardNo || 'preview', `v${meta.version || 1}`, f.range.label, f.range.from, f.range.to, meta.generatedAt || f.generated, meta.generatedBy || ''],
    [],
    ['Metric', 'Boundary', 'This period', 'Records', 'Prior', 'Change', 'All payers'],
    ...f.headline.map((h) => [h.label, h.dateBoundary, h.value ?? '', h.count, h.prior?.value ?? '', h.delta ?? '', h.allPayers?.value ?? '']),
    [],
    ['Payer reason', 'Denials', 'Denied', 'Share'],
    ...f.profile.reasons.map((g) => [g.label, g.count, g.amount, g.share]),
    ['Root cause', 'Denials', 'Denied', 'Share'],
    ...f.profile.causes.map((g) => [g.label, g.count, g.amount, g.share]),
    ['Divergence (payer said → desk found)', 'Usually means', 'Denials', 'Denied'],
    ...f.profile.divergence.map((d) => [`${d.code} → ${d.cause}`, d.expected, d.count, d.amount]),
    [],
    ['Appeals opened', ap.opened, 'submitted', ap.submitted, 'decided', ap.decided, 'overturned', ap.overturned, 'overturn rate', ap.overturnRate ?? '', 'turnaround days', ap.turnaroundDays ?? '', 'window', ap.responseWindow],
    ['Conceded', ap.conceded, 'recovered', ap.recovered, 'never appealed', ap.neverAppealed, 'awaiting', ap.awaiting, 'shortfalls', ap.shortfalls],
    [],
    ['Misclassified', mis.count, mis.amount, 'rate', mis.rate ?? '', 'contractual', mis.contractual.count, mis.contractual.amount, 'TPA', mis.tpa.count, mis.tpa.amount],
    [],
    ['Answered claims', fin.adjudicatedCount, fin.adjudicatedValue, 'denied', fin.deniedCount, fin.denied, 'recovered', fin.recovered, 'lost', fin.lost, 'written off', fin.writtenOff, 'reclassified', fin.reclassified, 'open', fin.open],
    [],
    ['Month', 'Denials', 'Denied', 'Rate $', 'Recovered', 'Lost + written off', 'Separated', 'Separated value'],
    ...f.trend.map((m) => [m.key, m.deniedCount, m.deniedValue, m.denialRateValue ?? '', m.recovered, m.lost, m.reclassifiedCount, m.reclassifiedValue]),
    [],
    ['Notes', meta.notes || ''],
  ];
}
