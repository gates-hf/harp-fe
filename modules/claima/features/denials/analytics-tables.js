// The analytics screen's tables: the side-by-side reason and root-cause
// tables (count, amount, recovery rate, days to resolve, monthly trend), the
// breakdown by payer / department / service line / doctor, the repeat
// patterns and the prevention feed. Markup only over the repository's
// analytics() result; the screen owns the period and the listeners.

import { esc, usd } from '../../../../shared/format.js';
import { recoveryBar, sparkline, valueBar } from './denial-charts.js';

/** count · amount · recovery · avg days · trend — one table for reasons, root causes and every breakdown. */
export function groupTableHtml(groups, { first = 'Reason', trend = true, link = null } = {}) {
  if (!groups.length) return emptyHtml('Nothing in this period');
  const max = Math.max(1, ...groups.map((g) => g.amount));
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">${esc(first)}</th>
          <th scope="col">Denials</th>
          <th scope="col">Denied</th>
          <th scope="col" title="Recovered ÷ denied, on these denials">Recovery</th>
          <th scope="col" title="Average days from the denial landing to its resolution — resolved denials only">Days</th>
          ${trend ? '<th scope="col">Trend</th>' : ''}
        </tr>
      </thead>
      <tbody>${groups.map((g) => `
        <tr>
          <td>${link ? `<a class="crumb-link" href="${esc(link(g))}">${esc(g.label)}</a>` : esc(g.label)}${g.repeats ? ` <span class="badge badge--warning" title="${g.repeats} repeat denial${g.repeats === 1 ? '' : 's'}">×${g.repeats}</span>` : ''}</td>
          <td>${g.count}</td>
          <td>${valueBar(g.amount, max)}${g.open ? `<br><span class="t-body-sm">${esc(usd(g.open))} open</span>` : ''}</td>
          <td>${recoveryBar(g.recoveryRate)}</td>
          <td>${g.avgDays == null ? '<span class="t-body-sm">—</span>' : `${g.avgDays} d`}</td>
          ${trend ? `<td>${sparkline(g.trend)}</td>` : ''}
        </tr>`).join('')}</tbody>
    </table>`;
}

export function repeatsHtml(repeats) {
  if (!repeats.length) return emptyHtml('No repeat pattern', 'No root cause has been refused twice by the same payer in this period.');
  return `
    <table class="tbl">
      <thead>
        <tr><th scope="col">Root cause</th><th scope="col">Payer</th><th scope="col">Denials</th><th scope="col">Denied</th><th scope="col">Deepest</th></tr>
      </thead>
      <tbody>${repeats.map((r) => `
        <tr>
          <td>${esc(r.rootCause)}</td>
          <td>${esc(r.payer)}</td>
          <td><a class="crumb-link" href="#/claima/denials?payerId=${esc(r.payerId)}${r.rootCauseId ? `&rootCauseId=${esc(r.rootCauseId)}` : ''}">${r.count}</a></td>
          <td><span class="t-mono-sm">${esc(usd(r.amount))}</span></td>
          <td><span class="badge badge--warning">×${r.maxRepeat}</span></td>
        </tr>`).join('')}</tbody>
    </table>`;
}

export function preventionHtml(feed) {
  if (!feed.length) return emptyHtml('Nothing to prevent', 'No denial landed in this period.');
  const max = Math.max(1, ...feed.map((g) => g.amount));
  return `
    <ol class="row-list">${feed.map((g, i) => `
      <li class="row-list__row">
        <span class="badge">${i + 1}</span>
        <div>
          <div><strong>${esc(g.key)}</strong> · ${g.count} denial${g.count === 1 ? '' : 's'} · ${valueBar(g.amount, max)}</div>
          <div class="t-body-sm">${g.causes.map((c) => `${esc(c.label)} (${c.count}, ${esc(usd(c.amount))})`).join(' · ')}</div>
          <div class="t-body-sm">Prevented in <a class="crumb-link" href="${esc(g.owner.href)}">${esc(g.owner.feature)}</a>${g.recoveryRate ? ` · ${Math.round(g.recoveryRate * 100)}% recovered so far` : ''}</div>
        </div>
      </li>`).join('')}</ol>`;
}

export function emptyHtml(title, body = 'Widen the period, or wait for a remittance to be posted with a refused line.') {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">insights</span></div>
      <div class="state-view__title">${esc(title)}</div>
      <p class="state-view__body">${esc(body)}</p>
    </div>`;
}

/** The CSV: every table in one file, a blank line between them. */
export function csvOf(a, periodLabel) {
  const line = (cells) => cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
  const table = (title, first, groups) => [
    line([title]),
    line([first, 'Denials', 'Denied', 'Recovered', 'Written off', 'Lost', 'Open', 'Recovery rate', 'Avg days']),
    ...groups.map((g) => line([g.label, g.count, g.amount.toFixed(2), g.recovered.toFixed(2), g.writtenOff.toFixed(2), g.lost.toFixed(2), g.open.toFixed(2), (g.recoveryRate * 100).toFixed(1), g.avgDays ?? ''])),
    '',
  ];
  return [
    line([`Denial analytics — ${periodLabel}`, `${a.range.from || ''} to ${a.range.to || ''}`]),
    line(['Denials', a.totals.count, 'Denied', a.totals.amount.toFixed(2), 'Recovered', a.totals.recovered.toFixed(2), 'Open', a.totals.open.toFixed(2)]),
    '',
    ...table('Payer reasons', 'Reason', a.reasons),
    ...table('Root causes', 'Root cause', a.rootCauses),
    ...table('By payer', 'Payer', a.byPayer),
    ...table('By department', 'Department', a.byDepartment),
    ...table('By service line', 'Service line', a.byServiceLine),
    ...table('By doctor', 'Doctor', a.byDoctor),
    line(['Repeat patterns']),
    line(['Root cause', 'Payer', 'Denials', 'Denied', 'Deepest repeat']),
    ...a.repeats.map((r) => line([r.rootCause, r.payer, r.count, r.amount.toFixed(2), r.maxRepeat])),
    '',
    line(['Prevention feed']),
    line(['Group', 'Owning feature', 'Denials', 'Denied', 'Recovery rate']),
    ...a.prevention.map((g) => line([g.key, g.owner.feature, g.count, g.amount.toFixed(2), (g.recoveryRate * 100).toFixed(1)])),
  ].join('\r\n');
}

export function download(fileName, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
