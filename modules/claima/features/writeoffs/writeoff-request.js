// The request screen at #/claima/writeoffs/new — the source, the amount, the
// reason and the case for it, with the context card reading the source live
// beside them. ?denial=, ?claim=, ?mrn= prefill the source (a denial at its
// open amount), ?rerequest=<id> re-raises a refused request with its case
// carried across. Nothing is written until Submit; the tier the amount needs
// is shown as it is typed, and the repository's own validation is what the
// error box and the disabled Submit read.

import * as writeoffs from '../../../../data/repositories/writeoffs.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as tiers from '../../../../data/engines/writeoff-tiers.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { esc, fileSize, usd } from '../../../../shared/format.js';
import { classificationHtml, sideHtml } from './writeoff-chips.js';
import { contextHtml } from './writeoff-context.js';

export const meta = { title: 'New write-off' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./writeoff-request.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load writeoff-request.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('New write-off request');
  ctx.setCrumb([
    { label: 'Claima', path: '/claima/writeoffs' },
    { label: 'Write-offs', path: '/claima/writeoffs' },
    { label: 'New request' },
  ]);

  const $ = (sel) => mount.querySelector(sel);
  const state = {
    kind: 'Denial', ref: '', amount: '', reasonCode: '', justification: '', mode: tiers.defaultMode(),
    file: null, rerequestOf: null, touched: false,
  };
  let options = [];

  const fill = (el, list, any = '') => {
    el.innerHTML = `${any ? `<option value="">${esc(any)}</option>` : ''}${list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}`;
  };
  fill($('#wr-kind'), writeoffs.SOURCE_KINDS.map((k) => [k, writeoffs.SOURCE_LABELS[k]]));
  fill($('#wr-reason'), writeoffs.WRITEOFF_REASONS.map((r) => [r.code, `${r.code} — ${r.label}`]), 'Pick a reason');
  fill($('#wr-mode'), writeoffs.MODES.map((m) => [m, m === 'Single' ? 'Single — one signature at the tier' : 'Sequential — every tier up to it signs']));

  /** The picker's rows for the chosen kind, and the one the state names. */
  function loadOptions() {
    options = writeoffs.sourceOptions(state.kind);
    const sel = $('#wr-ref');
    fill(sel, options.map((o) => [o.ref, o.label]), options.length ? 'Pick a record' : `No ${writeoffs.SOURCE_LABELS[state.kind].toLowerCase()} has anything outstanding`);
    sel.disabled = !options.length;
    if (state.ref && !options.some((o) => o.ref === state.ref)) state.ref = '';
    sel.value = state.ref;
  }

  const chosen = () => options.find((o) => o.ref === state.ref) || null;

  const sourceOf = () => {
    const o = chosen();
    return o ? { kind: o.kind, ref: o.ref, claimNo: o.claimNo, mrn: o.mrn, encounterNo: o.encounterNo } : { kind: state.kind, ref: '' };
  };

  const draft = () => ({
    source: sourceOf(),
    side: writeoffs.sideOf(state.kind),
    amount: Number(state.amount),
    reasonCode: state.reasonCode,
    justification: state.justification,
    hardshipEvidence: state.file,
    mode: state.mode,
    rerequestOf: state.rerequestOf,
  });

  function draw() {
    const role = currentRole();
    const o = chosen();
    const side = writeoffs.sideOf(state.kind);
    const outstanding = o ? writeoffs.outstandingFor(sourceOf(), side) : 0;
    const amount = Number(state.amount) || 0;

    $('#wr-kind').value = state.kind;
    $('#wr-side').innerHTML = sideHtml(side);
    $('#wr-ref-note').textContent = o ? `${usd(outstanding)} outstanding` : '';
    $('#wr-amount').value = state.amount;
    $('#wr-amount-note').textContent = o
      ? (amount > outstanding ? `More than the ${usd(outstanding)} outstanding` : amount > 0 ? `${Math.round((amount / (outstanding || 1)) * 100)}% of what is outstanding` : `Up to ${usd(outstanding)}`)
      : '';
    $('#wr-reason').value = state.reasonCode;
    $('#wr-class').innerHTML = state.reasonCode
      ? `${classificationHtml(writeoffs.classificationOf(state.reasonCode))} <span class="t-body-sm">${esc(writeoffs.reason(state.reasonCode)?.hint || '')}</span>`
      : '<span class="t-body-sm">The reason decides whether this is contractual or discretionary.</span>';
    $('#wr-mode').value = state.mode;
    $('#wr-tier').textContent = amount > 0
      ? `${tiers.tierLabel(tiers.tierFor(amount))}${state.mode === 'Sequential' && tiers.tierFor(amount) > 1 ? ` — ${tiers.stepsFor(amount, 'Sequential').length} signatures, tier 1 first` : ' — one signature'}`
      : 'The amount decides the tier.';
    $('#wr-why').value = state.justification;
    const needs = writeoffs.EVIDENCE_REASONS.includes(state.reasonCode);
    $('#wr-file-note').textContent = state.file ? `${state.file.fileName} · ${fileSize(state.file.size)}` : needs ? 'Required for a hardship write-off' : 'Optional';

    // A restricted record: the request names money and a payer, so it is
    // withheld the way the claim page withholds it.
    const patient = patients.view(patients.get(sourceOf().mrn), role);
    const masked = Boolean(patient?.masked);
    $('#wr-banner').innerHTML = masked ? `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div><div class="title">Withheld</div>
          ${esc(role.name)}’s role reads this record masked, so a write-off cannot be raised on it from here. Switch to a role with VIP access.</div>
      </div>` : state.rerequestOf ? `
      <div class="alert alert--info"><span class="icon">replay</span>
        <div><div class="title">Re-request of ${esc(state.rerequestOf)}</div>The refusal and its note stay on the earlier request; this one carries the case made since.</div>
      </div>` : '';

    const problems = state.touched ? writeoffs.validate(draft()) : [];
    $('#wr-error').innerHTML = problems.length
      ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
    const submit = $('#wr-submit');
    const blocker = masked ? 'Your role reads this record masked' : writeoffs.validate(draft()).join(' ');
    submit.disabled = Boolean(blocker);
    submit.title = blocker || `Submit for ${tiers.tierLabel(tiers.tierFor(amount))}`;

    $('#wr-context-sub').textContent = o ? o.label : '';
    $('#wr-context').innerHTML = masked ? '' : contextHtml(sourceOf(), side, { amount: amount || null });
  }

  // --- events ---------------------------------------------------------------

  $('#wr-kind').addEventListener('change', (e) => { state.kind = e.target.value; state.ref = ''; state.reasonCode = ''; loadOptions(); draw(); });
  $('#wr-ref').addEventListener('change', (e) => {
    state.ref = e.target.value;
    const o = chosen();
    if (o) {
      state.amount = String(o.outstanding);
      if (!state.reasonCode) state.reasonCode = o.reasonCode || '';
    }
    draw();
  });
  $('#wr-amount').addEventListener('input', (e) => { state.amount = e.target.value; state.touched = true; draw(); });
  $('#wr-reason').addEventListener('change', (e) => { state.reasonCode = e.target.value; draw(); });
  $('#wr-mode').addEventListener('change', (e) => { state.mode = e.target.value; draw(); });
  $('#wr-why').addEventListener('input', (e) => { state.justification = e.target.value; });
  $('#wr-why').addEventListener('change', () => { state.touched = true; draw(); });
  $('#wr-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    state.file = f ? { fileName: f.name, size: f.size } : null;
    draw();
  });

  mount.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'submit') return;
    state.touched = true;
    const row = writeoffs.request(draft());
    if (row.error) {
      draw();
      toast(row.error, 'warning');
      return;
    }
    toast(`${row.id} submitted for ${tiers.tierLabel(row.tier.required)}`);
    ctx.navigate(`/claima/writeoffs/${row.id}`);
  });

  ctx.onData(() => { loadOptions(); draw(); });
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  writeoffs.peersReady.then(() => { if (mount.isConnected) { prefill(); loadOptions(); draw(); } });

  /** ?denial=, ?claim=, ?mrn=, ?rerequest= — the query names the source. */
  function prefill() {
    const q = ctx.query || {};
    if (q.rerequest) {
      const earlier = writeoffs.get(q.rerequest);
      if (earlier && earlier.status === 'Rejected') {
        state.kind = earlier.source.kind;
        state.ref = earlier.source.ref;
        state.amount = String(earlier.amountRequested);
        state.reasonCode = earlier.reasonCode;
        state.justification = earlier.justification;
        state.mode = earlier.tier?.mode || state.mode;
        state.file = earlier.hardshipEvidence;
        state.rerequestOf = earlier.id;
      }
    } else if (q.denial) {
      state.kind = 'Denial';
      state.ref = q.denial;
    } else if (q.claim) {
      const claim = claims.get(q.claim);
      state.kind = claim && claims.isPending(claim) ? 'AgedItem' : 'ClaimResidual';
      state.ref = claim?.claimNo || q.claim;
    } else if (q.mrn) {
      state.kind = 'PatientBalance';
      state.ref = q.mrn;
    }
    loadOptions();
    const o = chosen();
    if (o && !state.amount) state.amount = String(o.outstanding);
    if (o && !state.reasonCode) state.reasonCode = o.reasonCode || '';
    if (q.item && !state.justification) state.justification = `Line ${q.item}: `;
  }

  prefill();
  draw();
}
