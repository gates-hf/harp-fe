// Refresh — re-assemble a draft against the visit as it stands, and show what
// moved. The diff is data from data/engines/claim-assembler.js; this file
// renders it, once for the dialog a refresh ends in and once for the History
// tab, which lists every refresh with the same markup.

import * as claims from '../../../../data/repositories/claims.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, usd } from '../../../../shared/format.js';

/** askRefresh(id) → Promise<{ claim, diff } | null>. Runs, then shows the diff. */
export async function askRefresh(id) {
  const claim = claims.get(id);
  if (!claim) return null;
  const out = claims.refresh(id);
  if (out.error) {
    toast(out.error, 'warning');
    return null;
  }
  const summary = claims.diffSummary(out.diff);
  toast(`${claim.claimNo} refreshed — ${summary.toLowerCase()}`, 'success');
  const dialog = modal.open({
    title: `Refreshed ${claim.claimNo}`,
    sub: summary,
    icon: 'sync',
    size: 'lg',
    body: diffHtml(out.diff),
  });
  await dialog.closed;
  return out;
}

const money = (v) => (v == null || v === '' ? '—' : typeof v === 'number' ? usd(v) : String(v));

/** The diff as markup: what moved, old → new, one line each. Empty when nothing did. */
export function diffHtml(diff) {
  if (!diff || claims.diffSummary(diff) === 'Nothing changed') {
    return '<p class="t-body-sm">Nothing changed — the claim already matched the visit.</p>';
  }
  const parts = [];
  if (diff.header.length) {
    parts.push(section('Header', diff.header.map((h) => row(h.label, h.from, h.to))));
  }
  const { added, removed, changed } = diff.lines;
  if (added.length || removed.length || changed.length) {
    parts.push(section('Lines', [
      ...added.map((l) => row(`${l.chargeCode || l.itemId} added`, '—', `${usd(l.payerShare)} payer`)),
      ...removed.map((l) => row(`${l.chargeCode || l.itemId} removed`, `${usd(l.payerShare)} payer`, '—')),
      ...changed.map((c) => row(`${c.lineId} ${fieldLabel(c.field)}`, money(c.from), money(c.to))),
    ]));
  }
  if (diff.coding) {
    parts.push(section('Coding', [
      row('Version', diff.coding.from == null ? '—' : `v${diff.coding.from}`, diff.coding.to == null ? '—' : `v${diff.coding.to}`),
      ...(diff.coding.principalFrom !== diff.coding.principalTo
        ? [row('Principal diagnosis', diff.coding.principalFrom || '—', diff.coding.principalTo || '—')] : []),
    ]));
  }
  if (diff.attachments.added.length || diff.attachments.removed.length) {
    parts.push(section('Attachments', [
      ...diff.attachments.added.map((a) => row(`${a.type} added`, '—', a.fileName)),
      ...diff.attachments.removed.map((a) => row(`${a.type} removed`, a.fileName, '—')),
    ]));
  }
  if (diff.totals) parts.push(section('Totals', [row('Payer share', usd(diff.totals.from), usd(diff.totals.to))]));
  return parts.join('');
}

const fieldLabel = (field) => ({
  qty: 'quantity', allowedExpected: 'allowed', payerShare: 'payer share', patientShare: 'patient share', authNumber: 'authorisation',
}[field] || field);

const section = (title, rows) => `
  <div class="toolbar"><span class="t-title-sm">${esc(title)}</span></div>
  <table class="tbl">
    <thead><tr><th>What</th><th>Was</th><th>Now</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;

const row = (what, from, to) => `
  <tr>
    <td>${esc(what)}</td>
    <td class="t-mono-sm">${esc(from ?? '—')}</td>
    <td class="t-mono-sm">${esc(to ?? '—')}</td>
  </tr>`;
