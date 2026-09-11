// Misclassification — the rows the payer sent as denials that the desk
// separated out as contractual adjustments or TPA fees: the trend by
// month, the contractual / TPA split, by payer, and the rows themselves.
// The one place a Reclassified row is counted; the TPA link points at
// amendment 42's screen and is tolerated by the shell until it lands.
// Intake boundary.

import * as engine from '../../../../data/engines/denial-analytics.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { legend, monthColumns } from './analytics-charts.js';
import { badge, captionHtml, emptyHtml, pct } from './analytics-format.js';

export function render(host, { range, payerId }) {
  const m = engine.misclassification(range, { payerId });
  const [contractual, tpa] = m.split;
  const q = payerId ? `&payerId=${payerId}` : '';
  host.innerHTML = `
    <div class="metric-rail">${metricRailHtml([
      { value: m.total.count, label: 'Separated out', href: `#/defensio/denials?status=Reclassified${q}`, tone: m.total.count ? 'info' : '', sub: `${usd(m.total.amount)} that was never a denial`, title: 'Rows separated out as contractual adjustments or TPA fees inside the period. Opens the worklist on them' },
      { value: pct(m.total.rate), label: 'Misclassification rate', href: `#/defensio/denials?status=Reclassified${q}`, sub: `${m.total.count} of ${m.total.landed} rows that landed`, title: engine.metric('misclassificationRate').hint },
      { value: contractual.count, label: 'Contractual', href: contractual.href, sub: `${usd(contractual.amount)} reconciled on the claims`, title: 'Fee-schedule cuts the payer was right to take — reconciled against the claim, a note on its trail' },
      { value: tpa.count, label: 'TPA fees', href: tpa.href, sub: `${usd(tpa.amount)} accrued`, title: 'The administrator’s fee withheld from the remittance — accrued against the payer on the TPA register' },
    ])}</div>
    <div class="worklists">
      <div class="panel">
        <div class="panel-header"><span>Trend</span><span class="t-body-sm">${legend('True denials', 'Separated out')}</span><span class="spacer"></span><span class="t-body-sm">by month landed</span></div>
        <div class="panel-body">
          ${monthColumns(m.trend.map((t) => ({ label: t.label, a: t.deniedCount, b: t.reclassifiedCount, title: `${t.label} — ${t.deniedCount} true denial${t.deniedCount === 1 ? '' : 's'}, ${t.reclassifiedCount} separated out worth ${usd(t.reclassifiedValue)}` })), { aLabel: 'True denials', bLabel: 'Separated out', money: false, height: 160 })}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><span>By payer</span><span class="spacer"></span><span class="badge">${m.byPayer.length}</span></div>
        ${m.byPayer.length ? `
        <table class="tbl">
          <thead><tr><th scope="col">Payer</th><th scope="col" class="num">Landed</th><th scope="col" class="num">Separated</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Contractual</th><th scope="col" class="num">TPA</th><th scope="col" class="num">Value</th></tr></thead>
          <tbody>${m.byPayer.map((p) => `
            <tr>
              <td><a class="crumb-link" href="${esc(p.href)}">${esc(p.label)}</a></td>
              <td class="num">${p.landed}</td>
              <td class="num">${p.count}</td>
              <td class="num t-mono-sm">${pct(p.rate)}</td>
              <td class="num">${p.contractual}</td>
              <td class="num">${p.tpa}</td>
              <td class="num t-mono-sm">${esc(usd(p.amount))}</td>
            </tr>`).join('')}</tbody>
        </table>` : `<div class="panel-body">${emptyHtml('Nothing separated out', 'No row landed in this period was reclassified.')}</div>`}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span>Separated-out rows</span>
        <span class="spacer"></span>
        <a class="btn btn--secondary btn--sm" href="#/defensio/tpa-fees" title="The TPA fee register — amendment 42's screen; the shell sends the link to the Defensio home until it lands">
          <span class="icon icon--sm">receipt_long</span>TPA fee register
        </a>
      </div>
      ${m.rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Denial</th><th scope="col">Payer</th><th scope="col">Claim</th><th scope="col">Code</th><th scope="col">Separation</th><th scope="col" class="num">Amount</th><th scope="col">Landed</th><th scope="col">Record</th></tr></thead>
        <tbody>${m.rows.map((r) => `
          <tr>
            <td><a class="crumb-link t-mono-sm" href="${esc(r.href)}">${esc(r.id)}</a></td>
            <td>${esc(r.payer)}</td>
            <td><a class="crumb-link t-mono-sm" href="#/claima/claims/${esc(r.claimNo)}">${esc(r.claimNo)}</a></td>
            <td>${badge(r.code || '—')}</td>
            <td>${badge(r.separation === 'TPA' ? 'TPA fee' : 'Contractual adjustment', r.separation === 'TPA' ? 'accent' : 'info')}</td>
            <td class="num t-mono-sm">${esc(usd(r.amount))}</td>
            <td>${date(r.landedOn)}</td>
            <td class="t-body-sm" title="${esc(r.note)}">${esc(r.ref || '—')}</td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="panel-body">${emptyHtml('Nothing separated out', 'No row landed in this period was reclassified.')}</div>`}
    </div>`;

  const csv = [
    ['Separated out', m.total.count, 'Value', m.total.amount, 'Landed', m.total.landed, 'Rate', m.total.rate ?? ''],
    ['Contractual', contractual.count, contractual.amount],
    ['TPA', tpa.count, tpa.amount],
    [],
    ['Payer', 'Landed', 'Separated', 'Rate', 'Contractual', 'TPA', 'Value'],
    ...m.byPayer.map((p) => [p.label, p.landed, p.count, p.rate, p.contractual, p.tpa, p.amount]),
    [],
    ['Denial', 'Payer', 'Claim', 'Code', 'Separation', 'Amount', 'Landed', 'Record', 'Note'],
    ...m.rows.map((r) => [r.id, r.payer, r.claimNo, r.code, r.separation, r.amount, r.landedOn, r.ref || '', r.note]),
    [],
    ['Month', 'True denials', 'Separated out', 'Separated value'],
    ...m.trend.map((t) => [t.key, t.deniedCount, t.reclassifiedCount, t.reclassifiedValue]),
  ];
  return { csv, name: `denial-analytics-misclassification-${range.from}-${range.to}.csv`, caption: captionHtml([engine.BOUNDARIES.intake], 'the only view where a reclassified row is counted') };
}
