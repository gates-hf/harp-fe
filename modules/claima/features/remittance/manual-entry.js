// Manual entry at #/claima/remittances/new — the payer's paper advice typed
// in: the payment header first, then the claims it names looked up one by
// one, each auto-loading its lines for the paid / adjustment / denied answer,
// with the strip under them saying what is still to account for. `?no=` opens
// an existing unposted remittance for more entry — which is where the rows a
// file could not read are typed in on the same remittance.

import * as remittances from '../../../../data/repositories/remittances.js';
import * as payers from '../../../../data/repositories/payers.js';
import { esc, todayIso, usd } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { controlStripHtml, entryError, entryTableHtml, readLines } from './entry-lines.js';
import { payerName, statusHtml } from './remittance-chips.js';
import { askPost } from './post-dialog.js';

export const meta = { title: 'Manual entry' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./manual-entry.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load manual-entry.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { no: ctx.query?.no || null, editing: false, saving: false };
  const $ = (sel) => mount.querySelector(sel);
  const current = () => (state.no ? remittances.get(state.no) : null);

  function draw() {
    const rem = current();
    if (rem && rem.status !== 'Unposted') return ctx.navigate(`/claima/remittances/${rem.remittanceNo}`);
    ctx.setHeader(rem ? `${rem.remittanceNo} — entry` : 'Manual entry');
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/remittances' },
      { label: 'Remittances', path: '/claima/remittances' },
      { label: rem ? rem.remittanceNo : 'Manual entry' },
    ]);
    $('#me-title').textContent = rem ? `${rem.remittanceNo} · ${payerName(rem.payerId)}` : 'New remittance';
    $('#me-header').innerHTML = rem && !state.editing ? summaryHtml(rem) : formHtml(rem);
    const entry = $('#me-entry');
    entry.hidden = !rem;
    if (!rem) return undefined;
    $('#me-open').href = `#/claima/remittances/${rem.remittanceNo}`;
    $('#me-rows').innerHTML = rem.claims.length
      ? rem.claims.filter((r) => !r.posted).map((r) => entryTableHtml(r)).join('')
      : `<div class="state-view">
           <div class="state-view__glyph"><span class="icon">playlist_add</span></div>
           <div class="state-view__title">No claims yet</div>
           <p class="state-view__body">Look up each claim the advice names — it has to be this payer’s and still with it — and its lines load for entry.</p>
         </div>`;
    $('#me-strip').innerHTML = rem.claims.length ? controlStripHtml(rem) : '';
    const post = $('#me-post');
    const plan = remittances.planFor(rem);
    post.disabled = Boolean(plan.blocked) || !rem.claims.length;
    post.title = plan.blocked || (!rem.claims.length ? 'Add a claim first' : 'Post — save the lines first if you have changed them');
    return undefined;
  }

  function formHtml(rem) {
    const p = rem?.payment || {};
    return `
      <form id="me-form" novalidate>
        <div class="toolbar">
          <label class="field field--grow">
            <span class="icon icon--sm">apartment</span>
            <select name="payerId" aria-label="Payer"${rem ? ' disabled' : ''}>
              <option value="">Payer *</option>
              ${payers.findActive().map((py) => `<option value="${esc(py.id)}"${py.id === rem?.payerId ? ' selected' : ''}>${esc(py.nameEn)}</option>`).join('')}
            </select>
          </label>
          <label class="field field--grow">
            <span class="icon icon--sm">tag</span>
            <input name="reference" placeholder="Payment reference *" value="${esc(p.reference || '')}" aria-label="Payment reference">
          </label>
        </div>
        <div class="toolbar">
          <label class="field">
            <span class="icon icon--sm">event</span>
            <input type="date" name="date" value="${esc(p.date || todayIso())}" aria-label="Payment date">
          </label>
          <label class="field">
            <span class="icon icon--sm">account_balance</span>
            <select name="method" aria-label="Method">
              ${remittances.METHODS.map((m) => `<option value="${m}"${m === (p.method || 'EFT') ? ' selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="icon icon--sm">attach_money</span>
            <input type="number" step="0.01" min="0" name="total" placeholder="Total (USD) *" value="${p.total ? p.total : ''}" aria-label="Payment total">
          </label>
          <span class="spacer"></span>
          ${rem ? '<button type="button" class="btn btn--ghost btn--sm" data-act="cancel-edit">Cancel</button>' : ''}
          <button type="submit" class="btn btn--primary btn--sm">
            <span class="icon icon--sm">${rem ? 'save' : 'add'}</span>${rem ? 'Save header' : 'Start remittance'}
          </button>
        </div>
        <div class="field-error" id="me-form-error" hidden></div>
        <p class="t-body-sm">The total is the control figure: the lines you enter have to account for it, and what they do not becomes unapplied cash when the remittance is posted.</p>
      </form>`;
  }

  function summaryHtml(rem) {
    return `
      <div class="toolbar">
        <dl class="dl dl--narrow">
          <dt>Payer</dt><dd>${esc(payerName(rem.payerId))}</dd>
          <dt>Payment</dt><dd><span class="t-mono-sm">${esc(rem.payment.reference)}</span> · ${esc(rem.payment.date)} · ${esc(rem.payment.method)}</dd>
          <dt>Total</dt><dd><span class="t-mono-sm">${esc(usd(rem.payment.total))}</span></dd>
          <dt>Status</dt><dd>${statusHtml(rem)}</dd>
        </dl>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="edit-header"><span class="icon icon--sm">edit</span>Edit header</button>
      </div>`;
  }

  // --- actions ---------------------------------------------------------------

  function saveHeader(form) {
    const f = new FormData(form);
    const payment = { reference: f.get('reference'), date: f.get('date'), method: f.get('method'), total: Number(f.get('total')) };
    const box = $('#me-form-error');
    const rem = current();
    if (rem) {
      remittances.updateHeader(rem.remittanceNo, payment);
      state.editing = false;
      toast('Header saved', 'success');
      return draw();
    }
    const { error, remittance } = remittances.createManual({ payerId: f.get('payerId'), payment });
    if (error) { box.textContent = error; box.hidden = false; return undefined; }
    state.no = remittance.remittanceNo;
    toast(`${remittance.remittanceNo} started`, 'success');
    ctx.navigate(`/claima/remittances/new?no=${remittance.remittanceNo}`);
    return undefined;
  }

  /** Adding a row redraws every grid, so what is typed in them is saved first. */
  function addClaim() {
    const input = $('#me-lookup');
    const box = $('#me-lookup-error');
    if (mount.querySelector('[data-entry]') && !saveLines({ quiet: true })) return;
    const { error } = remittances.addClaim(state.no, input.value);
    box.textContent = error;
    box.hidden = !error;
    if (error) return;
    input.value = '';
    toast('Claim added — enter its lines', 'success');
  }

  /**
   * Every grid on screen, read first and written after — a write commits and
   * a commit redraws, which would take the unsaved grids with it — and the
   * first thing wrong stops the whole save before anything is written.
   */
  function saveLines({ quiet = false } = {}) {
    const batch = [...mount.querySelectorAll('[data-entry]')].map((table) => ({ key: table.dataset.entry, lines: readLines(table) }));
    for (const b of batch) {
      const error = entryError(b.lines);
      if (error) { toast(error, 'critical'); return false; }
    }
    state.saving = true;
    try {
      for (const b of batch) remittances.updateLines(state.no, b.key, b.lines);
    } finally {
      state.saving = false;
    }
    draw();
    if (!quiet) toast('Lines saved', 'success');
    return true;
  }

  // --- events ------------------------------------------------------------------

  mount.addEventListener('submit', (e) => {
    if (e.target.id !== 'me-form') return;
    e.preventDefault();
    saveHeader(e.target);
  });

  mount.addEventListener('keydown', (e) => {
    if (e.target.id === 'me-lookup' && e.key === 'Enter') { e.preventDefault(); addClaim(); }
  });

  mount.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'edit-header') { state.editing = true; return draw(); }
    if (act === 'cancel-edit') { state.editing = false; return draw(); }
    if (act === 'add-claim') return addClaim();
    if (act === 'remove-row') {
      if (!saveLines({ quiet: true })) return undefined;
      remittances.removeClaim(state.no, e.target.closest('[data-act]').dataset.key);
      return toast('Claim removed', 'info');
    }
    if (act === 'save-lines') return void saveLines();
    if (act === 'post') {
      if (!saveLines({ quiet: true })) return undefined;
      const result = await askPost(state.no);
      if (result) ctx.navigate(`/claima/remittances/${state.no}`);
    }
    return undefined;
  });

  // The strip follows what is typed, before it is saved.
  mount.addEventListener('input', (e) => {
    if (!e.target.closest('[data-entry]')) return;
    const rem = current();
    if (!rem) return;
    const probe = structuredClone(rem);
    for (const table of mount.querySelectorAll('[data-entry]')) {
      const row = probe.claims.find((r) => remittances.keyOf(r) === table.dataset.entry);
      if (!row) continue;
      for (const patch of readLines(table)) {
        const line = row.lines.find((l) => (l.claimLineId || l.lineRef) === patch.claimLineId);
        if (line) Object.assign(line, patch);
      }
    }
    $('#me-strip').innerHTML = controlStripHtml(probe);
  });

  ctx.onData(() => { if (!state.saving && !mount.querySelector('[data-entry] input:focus')) draw(); });
  draw();
}
