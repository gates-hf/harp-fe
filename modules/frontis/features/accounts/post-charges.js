// Posting a visit's charges at #/frontis/encounters/<no>/post-charges. The
// lines go in on the left and the price comes back on the right, and the price
// is the engine's — there is no field anywhere on this screen for a payer or a
// patient share, because that split is what the contract answers.
//
// The preview and the posting are the same call: accounts.postCharges() asks
// the engine for the rows and the preview asks the engine for the same rows
// without appending them, so what is on screen is what lands in the ledger.

import * as accounts from '../../../../data/repositories/accounts.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as estimates from '../../../../data/repositories/estimates.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { postCharges as priceCharges, paymentModeOf } from '../../../../data/engines/account-engine.js';
import { prefilledConsumption } from '../../../../shared/consumption-table.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { date, esc, usd } from '../../../../shared/format.js';
import { inputsHtml, emptyPreviewHtml, previewHtml } from './post-charges-panels.js';

export const meta = { title: 'Post charges' };

export async function render(mount, ctx) {
  const no = ctx.params[0];
  const encounter = encounters.get(no);
  if (!encounter) throw new Error(`No encounter ${no}`);

  const res = await fetch(new URL('./post-charges.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load post-charges.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = {
    lines: [blankLine()],
    at: new Date().toISOString().slice(0, 16),
    posting: false,
  };
  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    const enc = encounters.get(no);
    const patient = patients.view(patients.get(enc.patientMrn), currentRole());

    ctx.setHeader(`Post charges — ${enc.no}`);
    ctx.setCrumb([
      { label: 'Frontis', path: '/frontis/patients' },
      { label: 'Encounters', path: '/frontis/encounters' },
      { label: enc.no, path: `/frontis/encounters/${enc.no}` },
      { label: 'Post charges' },
    ]);

    $('#pc-title').textContent = `Post charges — ${enc.no}`;
    $('#pc-meta').innerHTML = metaHtml(enc, patient);
    $('#pc-actions').innerHTML = actionsHtml(enc);
    $('#pc-banners').innerHTML = bannersHtml(enc);
    $('#pc-load').disabled = !quotedLines(enc).length;
    $('#pc-load').title = quotedLines(enc).length
      ? 'Fill the lines from the estimate this visit was quoted on'
      : 'No issued estimate is linked to this visit';
    drawInputs();
    drawResult();
  }

  function metaHtml(enc, patient) {
    const cover = enc.financial?.payerId ? encounters.financialTitle(enc) : 'Self-Pay';
    return `
      <span>${esc(patient?.nameEn || enc.patientMrn)}</span>
      <span class="t-mono-sm">${esc(enc.patientMrn)}</span>
      <span>·</span>
      <span class="badge${enc.type === 'ER' ? ' badge--critical' : enc.type === 'IP' ? ' badge--accent' : ''}">
        ${esc(encounters.typeLabel(enc.type))}</span>
      <span>·</span>
      <span>${esc(enc.department)}</span>
      <span>·</span>
      <span title="The cover this visit was classified under">${esc(cover)}</span>`;
  }

  function actionsHtml(enc) {
    const blocked = postingBlocked(enc);
    return `
      <a class="btn btn--ghost btn--sm" href="#/frontis/encounters/${esc(enc.no)}">
        <span class="icon icon--sm">arrow_back</span>Back to the encounter
      </a>
      <a class="btn btn--secondary btn--sm" href="#/frontis/accounts/${esc(enc.patientMrn)}">
        <span class="icon icon--sm">account_balance_wallet</span>Account
      </a>
      <button class="btn btn--primary btn--sm" data-act="post"${blocked ? ' disabled' : ''}
              title="${esc(blocked || 'Append these charges to the patient’s ledger')}">
        <span class="icon icon--sm">post_add</span>Post charges
      </button>`;
  }

  /** Why the button is off, or '' — the tooltip says which. */
  function postingBlocked(enc) {
    if (patients.view(patients.get(enc.patientMrn), currentRole())?.masked) {
      return 'A restricted record is charged by roles with VIP access only';
    }
    if (enc.status === 'Cancelled') return 'A cancelled visit takes no charges';
    if (!state.lines.some((line) => line.itemId)) return 'Add at least one charge';
    return '';
  }

  function bannersHtml(enc) {
    const parts = [];
    const contract = contractLabel(enc);
    parts.push(`
      <div class="alert alert--info">
        <span class="icon">gavel</span>
        <div>${esc(contract)} The split below is what that agreement answers — it cannot be typed in.</div>
      </div>`);
    if (enc.chargesPosted) {
      parts.push(`
        <div class="alert alert--warning">
          <span class="icon">history</span>
          <div>Charges have already been posted on this visit. Anything posted here is added to them, never
            instead of them — the ledger is append-only.</div>
        </div>`);
    }
    if (paymentModeOf(enc) === 'Upfront Settlement') {
      parts.push(`
        <div class="alert alert--info">
          <span class="icon">bolt</span>
          <div>This visit settles upfront, so money already taken as a settlement is applied to these
            charges the moment they are posted.</div>
        </div>`);
    }
    return parts.join('');
  }

  /** Which agreement will price this posting — the version live on the date. */
  function contractLabel(enc) {
    if (!enc.financial?.payerId) {
      return 'Self-Pay — the charge master’s price is the price and the patient carries all of it.';
    }
    const on = atIso().slice(0, 10);
    const contract = contracts.contractForService(enc.financial.payerId, enc.financial.planId, on);
    return contract
      ? `Priced under ${contract.contractNo} v${contract.version} on ${date(on)}.`
      : `No agreement covers ${encounters.financialTitle(enc)} on ${date(on)}, so every line prices at the standard price.`;
  }

  const atIso = () => `${state.at.slice(0, 10)}T${state.at.slice(11) || '00:00'}:00.000Z`;

  function drawInputs() {
    $('#pc-inputs').innerHTML = inputsHtml(state);
  }

  function drawResult() {
    const enc = encounters.get(no);
    const lines = state.lines.filter((line) => line.itemId);
    const result = $('#pc-result');
    if (!lines.length) {
      $('#pc-priced').textContent = '';
      result.innerHTML = emptyPreviewHtml();
      return;
    }
    const priced = priceCharges(enc, lines, atIso());
    $('#pc-priced').textContent = `${priced.rows.length} row${priced.rows.length === 1 ? '' : 's'} to append`;
    result.innerHTML = previewHtml(priced);
  }

  /** The lines of the estimate this visit was quoted on, if it was quoted. */
  function quotedLines(enc) {
    const quoted = estimates.byEncounter(enc.no)
      .filter((row) => (row.lines || []).length)
      .sort((a, b) => String(b.issuedAt || b.createdAt).localeCompare(String(a.issuedAt || a.createdAt)))[0];
    return quoted?.lines || [];
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('change', (e) => {
    const field = e.target.closest('[data-field]');
    if (field?.dataset.field === 'at') {
      state.at = field.value;
      draw();
      return;
    }
    const wrap = e.target.closest('[data-index]');
    if (field && wrap) {
      const line = state.lines[Number(wrap.dataset.index)];
      if (field.dataset.field === 'itemId') {
        line.itemId = field.value;
        line.consumption = prefilledConsumption(line.itemId, line.qty);
      } else {
        line.qty = Math.max(1, Number(field.value) || 1);
        if (cdm.isBundle(cdm.get(line.itemId))) line.consumption = prefilledConsumption(line.itemId, line.qty);
      }
      drawInputs();
      drawResult();
      $('#pc-actions').innerHTML = actionsHtml(encounters.get(no));
      return;
    }
    if (e.target.closest('[data-consumption]')) readConsumption(e.target, wrap);
  });

  // A consumption figure re-prices as it is typed: the overage it produces is
  // the reason the reader is looking at this panel at all.
  mount.addEventListener('input', (e) => {
    const input = e.target.closest('[data-consumption]');
    if (input) readConsumption(input, e.target.closest('[data-index]'));
  });

  function readConsumption(input, wrap) {
    if (!wrap) return;
    const line = state.lines[Number(wrap.dataset.index)];
    const componentId = input.dataset.consumption;
    const unit = input.dataset.unit;
    const value = Number(input.value) || 0;
    const entry = (line.consumption || []).find((c) => c.componentId === componentId);
    if (entry) entry[unit] = value;
    else line.consumption = [...(line.consumption || []), { componentId, [unit]: value }];
    drawResult();
  }

  mount.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-line') {
      state.lines = [...state.lines, blankLine()];
      drawInputs();
      return;
    }
    if (act === 'remove-line') {
      const i = Number(e.target.closest('[data-index]').dataset.index);
      state.lines = state.lines.filter((_, n) => n !== i);
      if (!state.lines.length) state.lines = [blankLine()];
      drawInputs();
      drawResult();
      $('#pc-actions').innerHTML = actionsHtml(encounters.get(no));
      return;
    }
    if (act === 'load-estimate') {
      const enc = encounters.get(no);
      state.lines = quotedLines(enc).map((line) => ({
        itemId: line.itemId,
        qty: Math.max(1, Number(line.qty) || 1),
        consumption: (line.consumption || []).map((c) => ({ ...c })),
      }));
      if (!state.lines.length) state.lines = [blankLine()];
      draw();
      toast('Lines filled from the estimate this visit was quoted on');
      return;
    }
    if (act === 'post') await post();
  });

  async function post() {
    const enc = encounters.get(no);
    const lines = state.lines.filter((line) => line.itemId);
    const priced = priceCharges(enc, lines, atIso());
    const ok = await modal.confirm({
      title: 'Post these charges?',
      body: `<p class="t-body">${priced.rows.length} row${priced.rows.length === 1 ? '' : 's'} will be appended
        to ${esc(enc.patientMrn)}'s ledger: ${esc(usd(priced.totals.allowed))} allowed,
        ${esc(usd(priced.totals.payer))} to the payer and ${esc(usd(priced.totals.patient))} to the patient.</p>
        <p class="t-body-sm">The ledger is append-only. A charge posted in error is corrected by reversing it,
        which leaves both rows in the trail.</p>`,
      confirmLabel: 'Post charges',
      tone: 'warning',
      icon: 'post_add',
    });
    if (!ok) return;

    const result = accounts.postCharges(no, lines, atIso());
    if (result.error) {
      toast(result.error, 'critical');
      return;
    }
    const applied = (result.applied || []).reduce((n, row) => n + row.amount, 0);
    toast(`${result.rows.length} charge${result.rows.length === 1 ? '' : 's'} posted${
      applied ? ` — ${usd(applied)} of the upfront settlement applied` : ''}`);
    ctx.navigate(`/frontis/accounts/${enc.patientMrn}/encounters`);
  }

  ctx.onData(() => {
    $('#pc-actions').innerHTML = actionsHtml(encounters.get(no));
    $('#pc-banners').innerHTML = bannersHtml(encounters.get(no));
  });
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));
  draw();
}

const blankLine = () => ({ itemId: '', qty: 1, consumption: [] });
