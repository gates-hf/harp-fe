// The five sections as collapsible tables — the markup both the live report
// and the frozen snapshot draw, from the same report shape. Each row is a
// control carrying its drill (repo + filter) so the click opens the
// transactions behind the cell; a row with prior-day money grows an "of which
// prior-day" sub-row that drills to that subset alone. Under the rows, the
// carried balances: opening + movement = closing per category.

import { esc, usd } from '../../../../shared/format.js';
import { moneyHtml, sectionTotalLine } from './dtr-chips.js';

/**
 * sectionsHtml(report, { drillable, open }) — every section. `drillable`
 * false draws the same tables without the row controls (a printed page).
 */
export function sectionsHtml(report, { drillable = true, open = [] } = {}) {
  return report.sections.map((s, i) => sectionHtml(s, { drillable, open: open.includes(s.key) || (!open.length && i === 0) })).join('');
}

export function sectionHtml(s, { drillable = true, open = false } = {}) {
  const groups = [...new Set(s.rows.map((r) => r.group))];
  const active = s.rows.filter((r) => r.count);
  return `
    <details class="panel" data-section="${esc(s.key)}"${open ? ' open' : ''}>
      <summary class="panel-header">
        <span>${esc(s.label)}</span>
        <span class="badge" title="Transactions counted into the section total">${s.count}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${esc(s.totalLabel)}</span>
        <span class="t-mono-sm">${esc(usd(s.total))}</span>
        ${s.priorDayAmount ? `<span class="badge badge--warning" title="Of which posted after an earlier day closed">${esc(usd(s.priorDayAmount))} prior-day</span>` : ''}
      </summary>
      <div class="panel-body">
        ${active.length ? `
          <table class="tbl">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col" class="num">Count</th>
                <th scope="col" class="num">Movement</th>
                <th scope="col" class="num" title="Posted after an earlier day closed, carried here flagged">Of which prior-day</th>
                <th scope="col" title="Whether the row counts into the section total">In total</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map((g) => groupRowsHtml(s, g, drillable)).join('')}
            </tbody>
          </table>` : `
          <p class="t-body-sm">Nothing moved in this section on the day.</p>`}
        ${carriedHtml(s)}
      </div>
    </details>`;
}

function groupRowsHtml(s, group, drillable) {
  const rows = s.rows.filter((r) => r.group === group && r.count);
  if (!rows.length) return '';
  return `
    <tr><th scope="rowgroup" colspan="5" class="t-caps">${esc(group)}</th></tr>
    ${rows.map((r) => rowHtml(s, r, drillable)).join('')}`;
}

function rowHtml(s, r, drillable) {
  const attrs = drillable ? ` data-drill="${esc(JSON.stringify(r.drill))}" data-drill-title="${esc(`${s.label} · ${r.label}`)}" tabindex="0" title="Open the ${r.count} transaction${r.count === 1 ? '' : 's'} behind this row"` : '';
  const sub = r.priorDayCount ? `
    <tr${drillable ? ` data-drill="${esc(JSON.stringify({ ...r.drill, filter: { ...r.drill.filter, priorDay: true } }))}" data-drill-title="${esc(`${s.label} · ${r.label} · prior-day`)}" tabindex="0" title="Open the ${r.priorDayCount} prior-day transaction${r.priorDayCount === 1 ? '' : 's'}"` : ''}>
      <td class="t-body-sm">&nbsp;&nbsp;&nbsp;of which prior-day</td>
      <td class="num t-mono-sm">${r.priorDayCount}</td>
      <td class="num">${moneyHtml(r.priorDayAmount)}</td>
      <td class="num">${moneyHtml(r.priorDayAmount)}</td>
      <td></td>
    </tr>` : '';
  return `
    <tr${attrs}>
      <td>${esc(r.label)}</td>
      <td class="num t-mono-sm">${r.count}</td>
      <td class="num">${moneyHtml(r.amount)}</td>
      <td class="num">${moneyHtml(r.priorDayAmount)}</td>
      <td>${r.inTotal ? '<span class="badge badge--success">yes</span>' : '<span class="badge" title="Shown for reading; the section total does not count it">no</span>'}</td>
    </tr>${sub}`;
}

function carriedHtml(s) {
  return `
    <div class="toolbar">
      <span class="t-label">Carried balances</span>
      <span class="t-body-sm">opening + movement = closing, per category</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col" class="num">Opening</th>
          <th scope="col" class="num">Movement</th>
          <th scope="col" class="num">Closing</th>
        </tr>
      </thead>
      <tbody>
        ${s.categories.map((c) => `
          <tr>
            <td>${esc(c.label)}</td>
            <td class="num">${moneyHtml(c.opening, { zero: usd(0) })}</td>
            <td class="num">${moneyHtml(c.movement)}</td>
            <td class="num">${moneyHtml(c.closing, { zero: usd(0) })}</td>
          </tr>`).join('')}
        <tr>
          <th scope="row">${esc(s.totalLabel)}</th>
          <td class="num">${moneyHtml(s.opening, { zero: usd(0) })}</td>
          <td class="num">${moneyHtml(s.total)}</td>
          <td class="num">${moneyHtml(s.closing, { zero: usd(0) })}</td>
        </tr>
      </tbody>
    </table>
    <p class="t-body-sm">${sectionTotalLine(s)}</p>`;
}

/** The drill a click landed on, or null. */
export function drillOf(e) {
  const tr = e.target.closest('tr[data-drill]');
  if (!tr) return null;
  try { return { drill: JSON.parse(tr.dataset.drill), title: tr.dataset.drillTitle || '' }; } catch { return null; }
}
