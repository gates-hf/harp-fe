// The match & reconcile grid: one collapsible per claim row on the remittance
// — billed, expected (as stamped on the claim), paid, adjustment and its code,
// denied and its code, variance, outcome and match status per line, with the
// row's totals in the summary. A posted row shows what the posting decided; an
// unposted one shows what it would decide, read off the same engine.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as denials from '../../../../data/repositories/denials.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { matchHtml, money, outcomeHtml } from './remittance-chips.js';
import { controlStripHtml } from './entry-lines.js';

export function gridHtml(rem) {
  if (!rem.claims.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">playlist_add</span></div>
        <div class="state-view__title">No claims on this remittance</div>
        <p class="state-view__body">Enter the claims the payer's advice names and their lines, then post.</p>
        <div class="state-view__actions"><a class="btn btn--primary" href="#/claima/remittances/new?no=${esc(rem.remittanceNo)}">Enter lines</a></div>
      </div>`;
  }
  const plan = rem.status === 'Closed' ? null : remittances.planFor(rem);
  return `${rem.claims.map((row) => rowHtml(rem, row, plan)).join('')}${controlStripHtml(rem)}`;
}

function rowHtml(rem, row, plan) {
  const entry = plan?.entries.find((e) => e.row === row) || null;
  const lines = entry ? entry.lines : row.lines.map((l) => ({ ...l, ...(l.outcome ? {} : previewOf(l, row)) }));
  const sum = (key) => lines.reduce((n, l) => n + (Number(l[key]) || 0), 0);
  const expected = sum('expected');
  const paid = sum('paid');
  const variance = expected - paid - sum('patientShift');
  const claim = row.claimNo ? claims.get(row.claimNo) : null;
  const posting = row.postingId ? rem.postings.find((p) => p.id === row.postingId) : null;
  return `
    <details open data-row="${esc(remittances.keyOf(row))}">
      <summary class="panel-header">
        <span class="t-mono-sm">${row.claimNo ? `<a class="crumb-link" href="#/claima/claims/${esc(row.claimNo)}">${esc(row.claimNo)}</a>` : esc(row.payerClaimRef)}</span>
        ${matchHtml(row.matchStatus, row.matchStatus === 'Ambiguous' ? `${row.candidates.length} candidates` : row.matchStatus === 'Unmatched' ? 'No claim of this payer answers the row' : '')}
        ${row.posted ? `<span class="badge badge--success" title="Posted in ${esc(row.postingId)}"><span class="dot"></span>Posted</span>` : '<span class="badge">Not posted</span>'}
        ${claim ? `<span class="t-body-sm">${esc(claim.status)} · ${esc(date(claim.dateOfService))}</span>` : ''}
        <span class="spacer"></span>
        <span class="t-body-sm">${claim ? `expected ${esc(usd(expected))} · ` : ''}paid ${esc(usd(paid))} · adjusted ${esc(usd(sum('adjustment')))} · denied ${esc(usd(sum('denied')))}${
          claim && Math.abs(variance) > 0.005 ? ` · <strong>variance ${esc(usd(variance))}</strong>` : ''}</span>
        ${actionsHtml(rem, row)}
      </summary>
      <table class="tbl">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Charge</th>
            <th scope="col">Billed</th>
            <th scope="col">Expected</th>
            <th scope="col">Paid</th>
            <th scope="col">Adjustment</th>
            <th scope="col">Denied</th>
            <th scope="col">Variance</th>
            <th scope="col">Outcome</th>
            <th scope="col">Match</th>
          </tr>
        </thead>
        <tbody>${lines.map((l) => lineHtml(l, row)).join('')}</tbody>
      </table>
      ${posting ? `<p class="t-body-sm">Posted ${esc(date(posting.at))} by ${esc(posting.by)} in ${esc(posting.id)}${posting.reversedBy ? ` — reversed by ${esc(posting.reversedBy)}` : ''}.</p>` : ''}
    </details>`;
}

/** What the engine would say about a line before posting — the same evaluation, no writes. */
function previewOf(l, row) {
  if (!l.claimLineId || row.matchStatus !== 'Matched') return { outcome: null, variance: null, patientShift: 0 };
  const r = remittances.evaluateLine(l, l.expected, remittances.toleranceOf(claims.get(row.claimNo)?.payerId));
  return { outcome: r.outcome, variance: r.variance, patientShift: r.patientShift, preview: true };
}

function lineHtml(l, row) {
  const matched = Boolean(l.claimLineId);
  return `
    <tr data-line="${esc(l.claimLineId || l.lineRef || '')}">
      <td class="t-mono-sm">${esc(l.lineRef || l.claimLineId || '—')}</td>
      <td class="t-mono-sm">${esc(l.chargeCode || '—')}</td>
      <td>${money(l.billed)}</td>
      <td>${matched ? money(l.expected) : '<span class="t-body-sm">—</span>'}</td>
      <td>${money(l.paid)}</td>
      <td>${l.adjustment ? `${money(l.adjustment)}<br><span class="badge" title="${esc(remittances.adjLabel(l.adjCode))}">${esc(l.adjCode || '—')}</span>` : '<span class="t-body-sm">—</span>'}</td>
      <td>${l.denied ? `${money(l.denied)}<br><span class="badge badge--critical" title="${esc(denials.denialCodeLabel(l.denialCode))}">${esc(l.denialCode || '—')}</span>` : '<span class="t-body-sm">—</span>'}</td>
      <td>${l.variance == null ? '<span class="t-body-sm">—</span>' : `<span class="t-mono-sm${Math.abs(l.variance) > 0.005 ? '' : ''}">${esc(usd(l.variance))}</span>`}</td>
      <td>${row.posted || !l.outcome ? outcomeHtml(l.outcome, l) : `${outcomeHtml(l.outcome, l)} <span class="t-body-sm" title="What posting would decide">preview</span>`}</td>
      <td>${matchHtml(matched ? 'Matched' : 'Unmatched', matched ? `Claim line ${l.claimLineId}` : 'No line on the claim answers this one')}</td>
    </tr>`;
}

/** The row's own buttons: choose or match a claim, enter its lines, take it off. */
function actionsHtml(rem, row) {
  if (row.posted || rem.status === 'Closed') return '';
  const key = esc(remittances.keyOf(row));
  const out = [];
  if (row.matchStatus === 'Ambiguous') {
    out.push(`<button class="btn btn--primary btn--sm" data-act="choose" data-key="${key}" title="Compare the candidates and choose"><span class="icon icon--sm">compare_arrows</span>Choose claim</button>`);
  } else if (row.matchStatus === 'Unmatched') {
    out.push(`<button class="btn btn--primary btn--sm" data-act="match" data-key="${key}" title="Name the claim this row is about"><span class="icon icon--sm">link</span>Match to claim</button>`);
  } else {
    out.push(`<a class="btn btn--secondary btn--sm" href="#/claima/remittances/new?no=${esc(rem.remittanceNo)}" title="Enter or correct the payer's answer on each line"><span class="icon icon--sm">edit_note</span>Enter lines</a>`);
  }
  out.push(`<button class="btn btn--ghost btn--icon btn--sm" data-act="remove" data-key="${key}" title="Take this row off — its cash becomes residue"><span class="icon icon--sm">delete</span></button>`);
  return out.join('');
}
