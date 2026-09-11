// Reasons vs causes — the payer's codes ranked beside the desk's root
// causes over the true denials that landed in the period, and the
// divergence rows: pairs where the desk found a cause the payer's code does
// not usually come down to. Every row links to the worklist narrowed to it.
// Intake boundary throughout.

import * as engine from '../../../../data/engines/denial-analytics.js';
import { esc, usd } from '../../../../shared/format.js';
import { bar } from './analytics-charts.js';
import { badge, captionHtml, emptyHtml, pct } from './analytics-format.js';

export function render(host, { range, payerId }) {
  const r = engine.reasonsVsCauses(range, { payerId });
  const max = Math.max(...r.reasons.map((x) => x.amount), ...r.causes.map((x) => x.amount), 0.01);
  const panel = (title, hint, rows, extra) => `
    <div class="panel">
      <div class="panel-header">
        <span>${esc(title)}</span>
        <span class="icon icon--sm" tabindex="0" role="img" aria-label="About this panel" title="${esc(hint)}"></span>
        <span class="spacer"></span>
        <span class="badge">${rows.length}</span>
      </div>
      ${rows.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">${title === 'Payer reasons' ? 'Code' : 'Root cause'}</th><th scope="col" class="num">Denials</th><th scope="col">Denied</th><th scope="col" class="num">Share</th><th scope="col" class="num">Open</th></tr></thead>
        <tbody>${rows.map((g) => `
          <tr>
            <td><a class="crumb-link" href="${esc(g.href)}" title="Open the worklist on these denials">${esc(g.label)}</a>${extra ? extra(g) : ''}</td>
            <td class="num">${g.count}</td>
            <td>${bar({ value: g.amount, max, label: `${g.label} ${usd(g.amount)}` })} <span class="t-mono-sm">${esc(usd(g.amount))}</span></td>
            <td class="num t-mono-sm">${pct(g.share)}</td>
            <td class="num t-mono-sm">${esc(usd(g.open))}</td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="panel-body">${emptyHtml('Nothing landed', 'No true denial landed in this period for this payer.')}</div>`}
    </div>`;

  host.innerHTML = `
    <div class="worklists">
      ${panel('Payer reasons', 'What the payer said: its adjustment code on each refused line, ranked by the money behind it.', r.reasons)}
      ${panel('Root causes', 'What the desk found: the root cause each denial was triaged to, ranked the same way. A denial nobody has triaged yet sits under "Not yet triaged".', r.causes, (g) => (g.group && g.group !== 'Untriaged' ? ` <span class="t-body-sm">· ${esc(g.group)}</span>` : ''))}
    </div>
    <div class="panel">
      <div class="panel-header">
        <span>Divergence</span>
        <span class="icon icon--sm" tabindex="0" role="img" aria-label="About divergence" title="A pair where the desk's confirmed cause is not the one the payer's code usually comes down to — the payer said one thing and the register found another. The prevention that matters is the cause's, not the code's."></span>
        <span class="spacer"></span>
        <span class="t-body-sm">${r.total.triaged} of ${r.total.count} triaged</span>
      </div>
      ${r.divergence.length ? `
      <table class="tbl">
        <thead><tr><th scope="col">Payer said</th><th scope="col">Desk found</th><th scope="col">Code usually means</th><th scope="col" class="num">Denials</th><th scope="col" class="num">Denied</th><th scope="col"></th></tr></thead>
        <tbody>${r.divergence.map((d) => `
          <tr>
            <td>${badge(d.code, 'warning')} <span class="t-body-sm">${esc(d.codeLabel.replace(`${d.code} · `, ''))}</span></td>
            <td>${esc(d.cause)}</td>
            <td class="t-body-sm">${esc(d.expected)}</td>
            <td class="num">${d.count}</td>
            <td class="num t-mono-sm">${esc(usd(d.amount))}</td>
            <td><a class="btn btn--secondary btn--sm" href="${esc(d.href)}"><span class="icon icon--sm">open_in_new</span>Open</a></td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="panel-body">${emptyHtml('No divergence', 'Every triaged denial in the period sits under the cause its payer code usually comes down to.')}</div>`}
    </div>`;

  const csv = [
    ['Panel', 'Key', 'Label', 'Denials', 'Denied', 'Share', 'Open'],
    ...r.reasons.map((g) => ['Payer reason', g.key, g.label, g.count, g.amount, g.share, g.open]),
    ...r.causes.map((g) => ['Root cause', g.key, g.label, g.count, g.amount, g.share, g.open]),
    ...r.divergence.map((d) => ['Divergence', `${d.code} → ${d.rootCauseId}`, `${d.codeLabel} → ${d.cause} (usually ${d.expected})`, d.count, d.amount, '', '']),
  ];
  return { csv, name: `denial-analytics-reasons-${range.from}-${range.to}.csv`, caption: captionHtml(engine.boundariesFor(['denialRateValue']), `${r.total.count} true denial${r.total.count === 1 ? '' : 's'} worth ${esc(usd(r.total.amount))}`) };
}
