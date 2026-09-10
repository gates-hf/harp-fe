// Generate a statement of account at #/frontis/accounts/<mrn>/soa/new: the
// scope (whole account, chosen visits, or a period), the detail and the
// language, previewed live from the same builder Generate freezes with. The
// reconciliation check runs on every change and Generate is disabled while it
// fails, so a statement whose blocks do not add up to the account cannot be
// handed to a patient.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as soa from '../../../../data/repositories/soa.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';
import { statementHtml } from './soa-doc.js';

export const meta = { title: 'Generate statement' };

const SCOPE_LABELS = { Account: 'Whole account', Encounters: 'Chosen visits', Period: 'A period' };

export async function render(mount, ctx) {
  const mrn = ctx.params[0];
  if (!patients.get(mrn)) throw new Error(`No patient ${mrn}`);

  const res = await fetch(new URL('./soa-generate.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load soa-generate.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader(`Statement of account — ${mrn}`);
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Accounts', path: '/frontis/accounts' },
    { label: mrn, path: `/frontis/accounts/${mrn}` },
    { label: 'Generate SOA' },
  ]);

  const visits = encounters.byPatient(mrn).filter((enc) => accounts.transactions(mrn).some((tx) => tx.encounterNo === enc.no));
  const state = {
    scope: 'Account', encounterNos: visits.slice(0, 1).map((enc) => enc.no), from: firstOfYear(), to: todayIso(),
    detail: 'Summary', language: 'EN',
  };
  const $ = (sel) => mount.querySelector(sel);
  $('#sg-back').href = `#/frontis/accounts/${mrn}`;

  const params = () => ({ scope: state.scope, encounterNos: state.encounterNos, from: state.from, to: state.to, detail: state.detail, language: state.language });

  function draw() {
    const role = currentRole();
    const masked = Boolean(patients.view(patients.get(mrn), role)?.masked);
    segmented($('#sg-scope'), soa.SCOPES.map((s) => [s, SCOPE_LABELS[s]]), state.scope, 'scope');
    segmented($('#sg-detail'), soa.DETAILS.map((d) => [d, d]), state.detail, 'detail');
    segmented($('#sg-language'), soa.LANGUAGES.map((l) => [l, l === 'EN' ? 'English' : 'Arabic']), state.language, 'language');
    $('#sg-scope-body').innerHTML = scopeBodyHtml();

    if (masked) {
      $('#sg-error').innerHTML = `<div class="perm-banner"><span class="icon">lock</span><div><div class="title">Withheld</div>${esc(role.name)}’s role reads this record masked, so a statement cannot be generated from here.</div></div>`;
      $('#sg-check').innerHTML = '';
      $('#sg-preview').innerHTML = '';
      $('#sg-generate').disabled = true;
      return;
    }
    const built = soa.preview(mrn, params());
    $('#sg-error').innerHTML = built.error ? `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(built.error)}</div></div>` : '';
    $('#sg-check').innerHTML = built.error ? '' : checkHtml(built);
    $('#sg-preview').innerHTML = built.error ? emptyHtml() : statementHtml(built);
    const btn = $('#sg-generate');
    btn.disabled = Boolean(built.error);
    btn.title = built.error || `Freeze this statement as ${soa.nextNo()}`;
  }

  function scopeBodyHtml() {
    if (state.scope === 'Encounters') {
      if (!visits.length) return '<p class="t-body-sm">No visit on this account has been charged.</p>';
      return visits.map((enc) => `
        <label class="rule-child-row">
          <input type="checkbox" data-enc="${esc(enc.no)}"${state.encounterNos.includes(enc.no) ? ' checked' : ''} aria-label="Include ${esc(enc.no)}">
          <span><span class="t-mono-sm">${esc(enc.no)}</span> ${esc(encounters.typeLabel(enc.type))} · ${esc(enc.department)}
            <br><span class="t-body-sm">${esc(date(enc.startAt))} · ${esc(enc.status)} · ${esc(usd(accounts.encounterBalance(mrn, enc.no).unpaid))} unpaid</span></span>
        </label>`).join('');
    }
    if (state.scope === 'Period') {
      return `
        <div class="toolbar">
          <label class="field"><span class="icon icon--sm">event</span><input type="date" data-field="from" value="${esc(state.from)}" aria-label="From"></label>
          <label class="field"><span class="icon icon--sm">event</span><input type="date" data-field="to" value="${esc(state.to)}" aria-label="To"></label>
        </div>`;
    }
    return '<p class="t-body-sm">Every transaction on the account, from the first to today.</p>';
  }

  function checkHtml(built) {
    const c = built.snapshot.reconciled;
    return `
      <div class="alert alert--${c.ok ? 'success' : 'critical'}">
        <span class="icon">${c.ok ? 'verified' : 'error'}</span>
        <div>${c.ok
          ? `The ${built.snapshot.encounters.length} visit block${built.snapshot.encounters.length === 1 ? '' : 's'}${built.snapshot.account ? ' and the account block' : ''} add up to the account’s balances for this scope — balance due ${esc(usd(built.snapshot.balanceDue))}.`
          : `The blocks do not add up: ${esc(c.problems.join('; '))}.`}</div>
      </div>`;
  }

  function segmented(host, options, value, key) {
    host.innerHTML = options.map(([v, label]) => `<button data-${key}="${esc(v)}" aria-pressed="${v === value}">${esc(label)}</button>`).join('');
  }

  // --- events -----------------------------------------------------------------

  mount.addEventListener('click', (e) => {
    for (const key of ['scope', 'detail', 'language']) {
      const btn = e.target.closest(`[data-${key}]`);
      if (btn) { state[key] = btn.dataset[key]; return draw(); }
    }
    if (e.target.closest('[data-act]')?.dataset.act === 'generate') {
      const result = soa.create(mrn, params());
      if (result.error) return void toast(result.error, 'warning');
      toast(`${result.row.no} generated — balance due ${usd(result.row.snapshot.balanceDue)}`);
      ctx.navigate(`/frontis/accounts/soa/${result.row.no}`);
    }
  });
  mount.addEventListener('change', (e) => {
    const box = e.target.closest('[data-enc]');
    if (box) {
      state.encounterNos = [...mount.querySelectorAll('[data-enc]')].filter((b) => b.checked).map((b) => b.dataset.enc);
      return draw();
    }
    const field = e.target.closest('[data-field]');
    if (field) { state[field.dataset.field] = field.value; draw(); }
  });

  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}

const firstOfYear = () => `${todayIso().slice(0, 4)}-01-01`;

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">description</span></div>
      <div class="state-view__title">Nothing to print</div>
      <p class="state-view__body">The scope selects no transaction. Widen it to see the statement.</p>
    </div>`;
}
