// The matcher: an ambiguous row's candidates side by side — amounts, dates,
// patient, status — with Choose on each; and, for an unmatched row, the same
// table over every claim of the payer still in flight, narrowed by a lookup.
// Choosing calls remittances.resolveMatch, which re-pairs the lines.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';

/** chooseClaim(no, key) → true when the row was matched. */
export async function chooseClaim(no, key) {
  const rem = remittances.get(no);
  const row = rem?.claims.find((r) => remittances.keyOf(r) === key);
  if (!row) return false;
  const ambiguous = row.matchStatus === 'Ambiguous';
  let pool = ambiguous
    ? row.candidates.map((cn) => claims.get(cn)).filter(Boolean)
    : remittances.inFlightClaims(rem.payerId);
  const taken = new Set(rem.claims.filter((r) => r !== row && r.claimNo).map((r) => r.claimNo));
  pool = pool.filter((c) => !taken.has(c.claimNo));
  const cash = row.lines.reduce((n, l) => n + (Number(l.paid) || 0), 0);

  const dialog = modal.open({
    title: ambiguous ? `Choose the claim for ${row.payerClaimRef}` : `Match ${row.payerClaimRef} to a claim`,
    sub: `${ambiguous ? `${pool.length} candidates` : `${pool.length} claims with the payer`} · the row says ${usd(cash)} paid${
      row.dateOfService ? ` · service ${date(row.dateOfService)}` : ''}${row.billed ? ` · billed ${usd(row.billed)}` : ''}`,
    icon: ambiguous ? 'compare_arrows' : 'link',
    size: 'xxl',
    body: `
      ${ambiguous ? '' : `
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">search</span>
            <input type="text" id="mx-q" placeholder="Narrow by claim no., patient or MRN" aria-label="Narrow the claims">
          </label>
        </div>`}
      <div id="mx-body">${tableHtml(pool, row)}</div>`,
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });

  const body = dialog.el.querySelector('#mx-body');
  dialog.el.addEventListener('input', (e) => {
    if (e.target.id !== 'mx-q') return;
    const q = e.target.value.trim().toLowerCase();
    body.innerHTML = tableHtml(pool.filter((c) => {
      const p = patients.get(c.patientMrn);
      return !q || [c.claimNo, c.patientMrn, p?.nameEn, p?.nameAr].some((v) => String(v || '').toLowerCase().includes(q));
    }), row);
  });
  dialog.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-choose]');
    if (!btn) return;
    const { error } = remittances.resolveMatch(no, key, btn.dataset.choose);
    if (error) return void toast(error, 'critical');
    toast(`${row.payerClaimRef} matched to ${btn.dataset.choose}`, 'success');
    dialog.close('matched');
  });
  return (await dialog.closed) === 'matched';
}

function tableHtml(pool, row) {
  if (!pool.length) {
    return `<div class="state-view"><div class="state-view__glyph"><span class="icon">search_off</span></div>
      <div class="state-view__title">No claim to choose</div>
      <p class="state-view__body">Nothing of this payer's is in flight and unclaimed on this remittance. Remove the row, and its cash becomes residue.</p></div>`;
  }
  const role = currentRole();
  const cash = row.lines.reduce((n, l) => n + (Number(l.paid) || 0), 0);
  return `
    <table class="tbl">
      <thead>
        <tr><th>Claim</th><th>Patient</th><th>Service</th><th>Billed</th><th>Expected</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>${pool.map((c) => {
        const p = patients.view(patients.get(c.patientMrn), role);
        const near = Math.abs(c.totals.payerShare - cash) < 0.005;
        return `
          <tr>
            <td class="t-mono-sm">${esc(c.claimNo)}</td>
            <td title="${esc(c.patientMrn)}">${esc(p?.nameEn || c.patientMrn)}</td>
            <td>${esc(date(c.dateOfService))}${row.dateOfService === c.dateOfService ? ' <span class="badge badge--success" title="Same date as the row">date</span>' : ''}</td>
            <td class="t-mono-sm">${esc(usd(c.totals.gross))}${row.billed && Math.abs(row.billed - c.totals.gross) < 0.005 ? ' <span class="badge badge--success" title="Same billed amount as the row">billed</span>' : ''}</td>
            <td class="t-mono-sm">${esc(usd(c.totals.payerShare))}${near ? ' <span class="badge badge--success" title="Equals what the row says was paid">paid</span>' : ''}</td>
            <td><span class="badge badge--${claims.statusTone(c.status)}" title="${c.lines.length} line${c.lines.length === 1 ? '' : 's'} · submitted ${esc(date(c.submittedAt))}"><span class="dot"></span>${esc(c.status)}</span></td>
            <td><button class="btn btn--primary btn--sm" data-choose="${esc(c.claimNo)}">Choose</button></td>
          </tr>`;
      }).join('')}</tbody>
    </table>`;
}
