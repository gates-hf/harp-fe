// The schedule dialogs: register an administrator, link a payer to it (one
// administrator per payer per day), end a link, and add a version to a fee
// schedule — basis, rate, service-group rates that win over it, caps and
// the term, starting today or later. Each validates, writes through
// data/repositories/tpas.js or tpa-fee-schedules.js and says what it did;
// a past version is never edited here — the block on the tab links to the
// amendments.

import * as tpas from '../../../../data/repositories/tpas.js';
import * as schedules from '../../../../data/repositories/tpa-fee-schedules.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, todayIso } from '../../../../shared/format.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

const payerOptions = (selected = '') => `<option value="">Pick a payer…</option>${
  payers.findActive().filter((p) => p.type !== 'Self Pay').map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.nameEn)}</option>`).join('')}`;

export async function openAddTpaDialog() {
  const dialog = modal.open({
    title: 'Register an administrator',
    sub: 'The third party that stands between a payer and the hospital and withholds its fee from the remittances',
    icon: 'add_business',
    size: 'md',
    body: `
      <label class="field"><span class="icon icon--sm">apartment</span><input id="tp-name" placeholder="Administrator" aria-label="Name" autofocus></label>
      <div class="toolbar">
        <label class="field field--grow"><span class="icon icon--sm">person</span><input id="tp-contact" placeholder="Contact name" aria-label="Contact name"></label>
        <label class="field"><span class="icon icon--sm">badge</span><input id="tp-role" placeholder="Role" aria-label="Contact role"></label>
      </div>
      <div class="toolbar">
        <label class="field field--grow"><span class="icon icon--sm">mail</span><input id="tp-email" type="email" placeholder="Email" aria-label="Email"></label>
        <label class="field"><span class="icon icon--sm">call</span><input id="tp-phone" placeholder="+961 …" aria-label="Phone"></label>
      </div>
      <label class="field"><span class="icon icon--sm">account_balance</span><select id="tp-record" aria-label="Payer master record"><option value="">Not on the payer master</option>${
        payers.all().filter((p) => /^TPA-/.test(p.licenseNo || '')).map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)} · ${esc(p.licenseNo)}</option>`).join('')}</select></label>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="tp-note" rows="2" placeholder="Note" aria-label="Note"></textarea></label>
      <div id="tp-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="tp-save">Register</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#tp-save').addEventListener('click', () => {
    const r = tpas.create({ name: $('#tp-name').value, contact: { name: $('#tp-contact').value, role: $('#tp-role').value, email: $('#tp-email').value, phone: $('#tp-phone').value }, payerRecordId: $('#tp-record').value || null, note: $('#tp-note').value });
    if (r?.error) return errorBox($('#tp-errors'), [r.error]);
    toast(`${r.name} registered as ${r.id} — link the payers it administers`);
    return dialog.close(true);
  });
  return dialog.closed;
}

export async function openAddLinkDialog(tpaId) {
  const t = tpas.get(tpaId);
  if (!t) return false;
  const dialog = modal.open({
    title: `Link a payer to ${t.name}`,
    sub: 'A payer has one administrator on any day; the fee is read against the one linked on the remittance date',
    icon: 'link',
    size: 'sm',
    body: `
      <label class="field"><span class="icon icon--sm">account_balance</span><select id="tl-payer" aria-label="Payer">${payerOptions()}</select></label>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">event</span><input id="tl-from" type="date" value="${todayIso()}" aria-label="From"></label>
        <label class="field"><span class="icon icon--sm">event</span><input id="tl-to" type="date" aria-label="To (optional)"></label>
      </div>
      <div id="tl-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="tl-save">Link payer</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  $('#tl-save').addEventListener('click', () => {
    const r = tpas.addLink(t.id, { payerId: $('#tl-payer').value, from: $('#tl-from').value, to: $('#tl-to').value || null });
    if (r?.error) return errorBox($('#tl-errors'), [r.error]);
    schedules.ensureSchedule(t.id, $('#tl-payer').value);
    toast(`${payers.get($('#tl-payer').value)?.nameEn} linked to ${t.name} — add the fee schedule's first version`);
    return dialog.close(true);
  });
  return dialog.closed;
}

export async function openEndLinkDialog(tpaId, payerId) {
  const t = tpas.get(tpaId);
  if (!t) return false;
  const dialog = modal.open({
    title: `End ${payers.get(payerId)?.nameEn || payerId}’s link`,
    sub: `${t.name} stops administering the payer from the day after`,
    icon: 'link_off',
    tone: 'warning',
    size: 'sm',
    body: `<label class="field"><span class="icon icon--sm">event</span><input id="te-to" type="date" value="${todayIso()}" aria-label="Last day"></label><div id="te-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="te-save">End link</button>`,
  });
  dialog.el.querySelector('#te-save').addEventListener('click', () => {
    const r = tpas.endLink(t.id, payerId, dialog.el.querySelector('#te-to').value);
    if (r?.error) return errorBox(dialog.el.querySelector('#te-errors'), [r.error]);
    toast(`Link ended ${dialog.el.querySelector('#te-to').value}`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Add a version: basis, rate, service-group rates, caps and the term (today or later). */
export async function openAddVersionDialog(scheduleId) {
  const s = schedules.get(scheduleId);
  if (!s) return false;
  const last = s.versions.filter((v) => !v.retrospective).sort((a, b) => b.n - a.n)[0] || null;
  const groups = schedules.SERVICE_GROUPS;
  const dialog = modal.open({
    title: `New version — ${tpas.nameOf(s.tpaId)} × ${payers.get(s.payerId)?.nameEn || s.payerId}`,
    sub: last ? `v${last.n} runs ${last.effectiveFrom}${last.effectiveTo ? ` to ${last.effectiveTo}` : ' onwards — it closes the day before the new one starts'}` : 'The schedule’s first version',
    icon: 'post_add',
    size: 'md',
    body: `
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">functions</span><select id="tv-basis" aria-label="Basis">${schedules.BASES.map((b) => `<option value="${b}"${b === (last?.basis || 'pctPaid') ? ' selected' : ''}>${esc(schedules.basisLabel(b))}</option>`).join('')}</select></label>
        <label class="field"><span class="icon icon--sm">percent</span><input id="tv-rate" type="number" min="0" step="0.01" value="${last?.rate ?? 3}" aria-label="Rate"></label>
        <span class="t-body-sm" id="tv-rate-hint"></span>
      </div>
      <div class="toolbar">
        <span class="t-title-sm">Service-group rates</span>
        <span class="t-body-sm">a group named here wins over the base rate</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn--ghost btn--sm" id="tv-add-scope"><span class="icon icon--sm">add</span>Add group</button>
      </div>
      <div id="tv-scopes"></div>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">vertical_align_top</span><input id="tv-cap-claim" type="number" min="0" step="0.01" placeholder="Cap per claim" value="${last?.capPerClaim ?? ''}" aria-label="Cap per claim"></label>
        <label class="field"><span class="icon icon--sm">date_range</span><input id="tv-cap-period" type="number" min="0" step="0.01" placeholder="Cap per month" value="${last?.capPerPeriod ?? ''}" aria-label="Cap per month"></label>
      </div>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">event</span><input id="tv-from" type="date" value="${todayIso()}" aria-label="Effective from"></label>
        <label class="field"><span class="icon icon--sm">event</span><input id="tv-to" type="date" aria-label="Effective to (optional)"></label>
      </div>
      <label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="tv-note" rows="2" placeholder="Where the version comes from — the addendum, the notice" aria-label="Note"></textarea></label>
      <div id="tv-errors"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="tv-save">Add version</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const scopes = (last?.scopes || []).filter((x) => x.level === 'serviceGroup').map((x) => ({ ref: x.ref, rate: x.rate }));
  const scopeRow = (sc, i) => `
    <div class="toolbar" data-scope="${i}">
      <label class="field"><span class="icon icon--sm">category</span><select data-scope-ref aria-label="Service group">${groups.map((g) => `<option value="${esc(g)}"${g === sc.ref ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
      <label class="field"><span class="icon icon--sm">percent</span><input data-scope-rate type="number" min="0" step="0.01" value="${sc.rate ?? ''}" aria-label="Rate"></label>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-scope-remove title="Remove"><span class="icon">close</span></button>
    </div>`;
  const drawScopes = () => { $('#tv-scopes').innerHTML = scopes.map(scopeRow).join('') || '<p class="t-body-sm">No group rate — the base rate applies to every claim.</p>'; };
  const readScopes = () => [...dialog.el.querySelectorAll('[data-scope]')].map((row) => ({ level: 'serviceGroup', ref: row.querySelector('[data-scope-ref]').value, rate: row.querySelector('[data-scope-rate]').value }));
  const hint = () => { $('#tv-rate-hint').textContent = schedules.isPct($('#tv-basis').value) ? 'per cent of the basis' : 'dollars'; };
  $('#tv-basis').addEventListener('change', hint);
  $('#tv-add-scope').addEventListener('click', () => { scopes.splice(0, scopes.length, ...readScopes().map((x) => ({ ref: x.ref, rate: x.rate })), { ref: groups[0], rate: '' }); drawScopes(); });
  dialog.el.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-scope-remove]');
    if (!rm) return;
    const i = Number(rm.closest('[data-scope]').dataset.scope);
    scopes.splice(0, scopes.length, ...readScopes().map((x) => ({ ref: x.ref, rate: x.rate })));
    scopes.splice(i, 1);
    drawScopes();
  });
  $('#tv-save').addEventListener('click', () => {
    const r = schedules.addVersion(s.id, {
      basis: $('#tv-basis').value, rate: $('#tv-rate').value, scopes: readScopes(), capPerClaim: $('#tv-cap-claim').value, capPerPeriod: $('#tv-cap-period').value,
      effectiveFrom: $('#tv-from').value, effectiveTo: $('#tv-to').value || null, note: $('#tv-note').value,
    });
    if (r?.error) return errorBox($('#tv-errors'), [r.error]);
    toast(`${r.ref} added — ${schedules.describe(r)} from ${r.effectiveFrom}`);
    return dialog.close(true);
  });
  hint();
  drawScopes();
  return dialog.closed;
}
