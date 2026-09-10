// A statement of account at #/frontis/accounts/soa/<no>: the frozen document,
// printed as it was generated. Reprint prints the snapshot and records that a
// copy went out; Generate new opens the generator for a fresh number. Nothing
// on this page reads the ledger — a statement is what the account said on the
// day, and a reprint a month later is the same page.

import * as soa from '../../../../data/repositories/soa.js';
import * as patients from '../../../../data/repositories/patients.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc, usd } from '../../../../shared/format.js';
import { statementHtml } from './soa-doc.js';

export const meta = { title: 'Statement of account' };

export async function render(mount, ctx) {
  const no = ctx.params[1];
  const row0 = soa.get(no);
  if (!row0) throw new Error(`No statement ${no}`);

  const res = await fetch(new URL('./soa-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load soa-view.html (${res.status})`);
  mount.innerHTML = await res.text();
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const row = soa.get(no);
    const role = currentRole();
    const patient = patients.view(patients.get(row.mrn), role);
    ctx.setHeader(`${row.no} — ${patient?.nameEn || row.mrn}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Accounts', path: '/frontis/accounts' },
      { label: row.mrn, path: `/frontis/accounts/${row.mrn}` },
      { label: row.no },
    ]);
    $('#sv-no').textContent = row.no;
    $('#sv-meta').innerHTML = `
      <span class="badge badge--info">${esc(row.params.language)}</span>
      <span class="badge">${esc(row.params.detail)}</span>
      <span>·</span>
      <span>${esc(soa.scopeLabel(row.params))}</span>
      <span>·</span>
      <span class="t-body-sm">generated ${esc(dateTime(row.generatedAt))} by ${esc(row.by)}</span>
      <span>·</span>
      <span class="t-body-sm">balance due ${esc(usd(row.snapshot.balanceDue))}</span>`;
    // A statement names what the patient owes and who pays, so a restricted
    // record's is withheld the way its account is.
    if (patient?.masked) {
      $('#sv-actions').innerHTML = `<button class="btn btn--secondary btn--sm" disabled title="A restricted record is read by roles with VIP access only"><span class="icon icon--sm">lock</span>Restricted</button>`;
      $('#sv-banner').innerHTML = '';
      $('#sv-doc').innerHTML = `<div class="perm-banner"><span class="icon">lock</span><div><div class="title">Withheld</div>${esc(role.name)}’s role reads this record masked. Switch to a role with VIP access to read the statement.</div></div>`;
      return;
    }
    $('#sv-actions').innerHTML = `
      <a class="btn btn--ghost btn--sm" href="#/frontis/accounts/${esc(row.mrn)}/receipts">
        <span class="icon icon--sm">arrow_back</span>Account
      </a>
      <a class="btn btn--secondary btn--sm" href="#/frontis/accounts/${esc(row.mrn)}/soa/new" title="Generate a fresh statement under a new number — this one never changes">
        <span class="icon icon--sm">add</span>Generate new
      </a>
      <button class="btn btn--primary btn--sm" data-act="print" title="Print the statement exactly as it was generated">
        <span class="icon icon--sm">print</span>Reprint
      </button>`;
    $('#sv-banner').innerHTML = (row.reprints || []).length
      ? `<div class="alert alert--info"><span class="icon">print</span><div>Reprinted ${row.reprints.length} time${row.reprints.length === 1 ? '' : 's'}, last ${esc(date(row.reprints.at(-1)))}. Every copy is the document as generated on ${esc(date(row.generatedAt))}.</div></div>`
      : '';
    $('#sv-doc').innerHTML = statementHtml(row);
  }

  mount.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'print') return;
    soa.markPrinted(no);
    toast(`${no} sent to print`);
    window.print();
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}
