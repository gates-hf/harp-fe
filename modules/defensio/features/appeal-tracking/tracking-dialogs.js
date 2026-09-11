// The appeal tracking dialogs: a follow-up (one case, or a same-payer
// selection), the Under Review mark, the payer's decision with its
// allocation editor, a lost share's disposition, a shortfall's answer and
// the close. Each validates, writes through data/repositories/appeal-tracking.js
// and says what it did; the screens redraw on the commit.

import * as tracking from '../../../../data/repositories/appeal-tracking.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc, todayIso, usd } from '../../../../shared/format.js';
import { payerName } from './tracking-chips.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length
    ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};
const fieldHtml = (icon, inner) => `<label class="field"><span class="icon icon--sm">${icon}</span>${inner}</label>`;
const areaHtml = (id, placeholder) => `<label class="field field--area"><textarea id="${id}" rows="3" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></textarea></label>`;

/** Log a follow-up on one case or on several of one payer — the same fields, one commit. */
export async function openFollowUpDialog(ids = []) {
  const rows = ids.map((id) => tracking.get(id)).filter((c) => c && tracking.isTracked(c));
  if (!rows.length) { toast('Pick a submitted appeal to follow up', 'warning'); return undefined; }
  const payerIds = new Set(rows.map((c) => c.payerId));
  if (payerIds.size > 1) { toast(`Pick cases with one payer — the selection spans ${payerIds.size}`, 'warning'); return undefined; }
  const dialog = modal.open({
    title: rows.length === 1 ? `Follow up ${rows[0].id}` : `Follow up ${rows.length} cases — ${payerName(rows[0])}`,
    icon: 'call', size: 'md',
    sub: rows.length === 1 ? `${payerName(rows[0])} · response due ${date(tracking.clockOf(rows[0]).deadline)}` : rows.map((c) => c.id).join(', '),
    body: `
      <div class="toolbar">
        ${fieldHtml('call', `<select id="fu-method" aria-label="Method">${tracking.FOLLOW_UP_METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>`)}
        ${fieldHtml('person', '<input id="fu-contact" placeholder="Who was reached" aria-label="Contact">')}
        ${fieldHtml('event', `<input type="date" id="fu-next" aria-label="Next follow-up due" title="When to chase again">`)}
      </div>
      ${areaHtml('fu-note', 'What was said')}
      <div id="fu-errors"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="fu-save">Log follow-up</button>`,
  });
  dialog.el.querySelector('#fu-save').addEventListener('click', () => {
    const fields = {
      method: dialog.el.querySelector('#fu-method').value, contact: dialog.el.querySelector('#fu-contact').value,
      note: dialog.el.querySelector('#fu-note').value, nextDue: dialog.el.querySelector('#fu-next').value || null,
    };
    const r = rows.length === 1 ? tracking.logFollowUp(rows[0].id, fields) : tracking.logFollowUpMany(rows.map((c) => c.id), fields);
    if (r?.error) return errorBox(dialog.el.querySelector('#fu-errors'), [r.error]);
    if (r?.problems?.length) return errorBox(dialog.el.querySelector('#fu-errors'), r.problems);
    toast(`Follow-up logged on ${rows.length === 1 ? rows[0].id : `${rows.length} cases`}`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** The payer has acknowledged the appeal and is reading it. */
export async function openUnderReviewDialog(id) {
  const c = tracking.get(id);
  if (!c) return undefined;
  const dialog = modal.open({
    title: `${c.id} under review`, icon: 'visibility', size: 'sm',
    body: `
      <p class="modal__lede">The payer has acknowledged the appeal and is reviewing it. The response clock keeps running — the answer is due ${esc(date(tracking.clockOf(c).deadline))}.</p>
      ${fieldHtml('tag', '<input id="ur-ref" placeholder="Payer’s review reference (optional)" aria-label="Review reference">')}
      <div id="ur-errors"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="ur-save">Mark under review</button>`,
  });
  dialog.el.querySelector('#ur-save').addEventListener('click', () => {
    const r = tracking.setUnderReview(c.id, { ref: dialog.el.querySelector('#ur-ref').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#ur-errors'), [r.error]);
    toast(`${c.id} is under review`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/**
 * The payer's decision: outcome, date, reference, rationale from the shared
 * payer-code list, the document, and the allocation editor — one row per
 * denial on the case with conceded and lost shares that have to add up to
 * its disputed share, and the conceded shares to the conceded total, checked
 * live. A lost share may be disposed of here or later from the tab.
 */
export async function openOutcomeDialog(id) {
  const c = tracking.get(id);
  if (!c) return undefined;
  const shares = tracking.sharesOf(c);
  const disputed = tracking.disputedOf(c);
  const ids = Object.keys(shares);
  const codes = denials.DENIAL_CODES;
  const rowHtml = (dId) => `
    <tr data-denial="${esc(dId)}">
      <td><a class="crumb-link t-mono-sm" href="#/defensio/denials/${esc(dId)}">${esc(dId)}</a><br><span class="t-body-sm">${esc(denials.denialCodeLabel(denials.get(dId)?.code))}</span></td>
      <td class="t-mono-sm">${esc(usd(shares[dId]))}</td>
      <td><label class="field"><input type="number" step="0.01" min="0" data-conceded value="${shares[dId]}" aria-label="Conceded share"></label></td>
      <td><label class="field"><input type="number" step="0.01" min="0" data-lost value="0" aria-label="Lost share"></label></td>
      <td>
        <label class="field"><select data-disposition aria-label="Lost disposition" disabled>
          <option value="">Decide later</option>
          ${tracking.DISPOSITIONS.map((d) => `<option value="${d}">${esc(tracking.dispositionLabel(d))}</option>`).join('')}
        </select></label>
        <label class="field"><input data-reason placeholder="Reason" aria-label="Disposition reason" disabled></label>
      </td>
    </tr>`;
  const dialog = modal.open({
    title: `Decision on ${c.id}`, icon: 'gavel', size: 'xl',
    sub: `${payerName(c)} · ${esc(usd(disputed))} disputed · submitted ${date(tracking.submissionOf(c).submittedAt)}`,
    body: `
      <div class="toolbar">
        ${fieldHtml('gavel', `<select id="oc-type" aria-label="Outcome">${tracking.OUTCOMES.map((o) => `<option value="${o}">${esc(tracking.outcomeLabel(o))}</option>`).join('')}</select>`)}
        ${fieldHtml('event', `<input type="date" id="oc-date" value="${todayIso()}" max="${todayIso()}" aria-label="Decision date">`)}
        ${fieldHtml('tag', '<input id="oc-ref" placeholder="Payer’s decision reference" aria-label="Payer reference">')}
        ${fieldHtml('attach_money', `<input type="number" step="0.01" min="0" id="oc-conceded" value="${disputed}" aria-label="Conceded total">`)}
      </div>
      <div class="toolbar">
        ${fieldHtml('report', `<select id="oc-code" aria-label="Payer rationale code"><option value="">Rationale code…</option>${codes.map((x) => `<option value="${esc(x.code)}">${esc(x.code)} · ${esc(x.label)}</option>`).join('')}</select>`)}
        ${fieldHtml('upload_file', '<input type="file" id="oc-doc" aria-label="Decision document">')}
      </div>
      ${areaHtml('oc-text', 'What the payer said — the rationale in its own words')}
      <div class="toolbar"><span class="t-title-sm">Allocation</span><span class="spacer"></span><span class="t-body-sm" id="oc-sum"></span></div>
      <table class="tbl">
        <thead><tr><th scope="col">Denial</th><th scope="col">Disputed</th><th scope="col">Conceded</th><th scope="col">Lost</th><th scope="col">Lost share disposition</th></tr></thead>
        <tbody>${ids.map(rowHtml).join('')}</tbody>
      </table>
      <div id="oc-errors"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="oc-save">Capture decision</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);
  const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const readForm = () => ({
    type: $('#oc-type').value, decisionDate: $('#oc-date').value, payerRef: $('#oc-ref').value, concededTotal: $('#oc-conceded').value,
    payerRationale: { code: $('#oc-code').value, text: $('#oc-text').value },
    documentRef: $('#oc-doc').files?.[0] ? { fileName: $('#oc-doc').files[0].name, size: $('#oc-doc').files[0].size } : null,
    allocations: [...dialog.el.querySelectorAll('tr[data-denial]')].map((tr) => ({
      denialId: tr.dataset.denial, concededShare: tr.querySelector('[data-conceded]').value, lostShare: tr.querySelector('[data-lost]').value,
      lostDisposition: tr.querySelector('[data-disposition]').value || null, reason: tr.querySelector('[data-reason]').value,
    })),
  });
  /** The live sum check: each row against its share, the conceded shares against the total, the lost cells enabled by their share. */
  function check() {
    const form = readForm();
    const conceded = cents(form.allocations.reduce((n, a) => n + cents(a.concededShare), 0));
    const lost = cents(form.allocations.reduce((n, a) => n + cents(a.lostShare), 0));
    for (const tr of dialog.el.querySelectorAll('tr[data-denial]')) {
      const has = cents(tr.querySelector('[data-lost]').value) > 0;
      tr.querySelector('[data-disposition]').disabled = !has;
      tr.querySelector('[data-reason]').disabled = !has;
    }
    const ok = Math.abs(conceded + lost - disputed) < 0.005 && Math.abs(conceded - cents(form.concededTotal)) < 0.005;
    $('#oc-sum').innerHTML = `<span class="badge${ok ? ' badge--success' : ' badge--critical'}">${esc(`${usd(conceded)} conceded + ${usd(lost)} lost = ${usd(conceded + lost)} of ${usd(disputed)}`)}</span>`;
  }
  /** Picking the outcome fills the shares the way that outcome reads: won concedes all, lost none, the two partial kinds keep what is typed. */
  function presetShares() {
    const type = $('#oc-type').value;
    if (type !== 'Won' && type !== 'Lost') return check();
    const all = type === 'Won';
    $('#oc-conceded').value = all ? disputed : 0;
    for (const tr of dialog.el.querySelectorAll('tr[data-denial]')) {
      tr.querySelector('[data-conceded]').value = all ? shares[tr.dataset.denial] : 0;
      tr.querySelector('[data-lost]').value = all ? 0 : shares[tr.dataset.denial];
    }
    return check();
  }
  $('#oc-type').addEventListener('change', presetShares);
  dialog.el.addEventListener('input', (e) => { if (e.target.matches('[data-conceded], [data-lost], #oc-conceded')) check(); });
  dialog.el.addEventListener('change', (e) => {
    // A conceded share typed fills the lost share as the remainder, so the row adds up unless it is overridden.
    const tr = e.target.closest('tr[data-denial]');
    if (tr && e.target.matches('[data-conceded]')) tr.querySelector('[data-lost]').value = cents(shares[tr.dataset.denial] - cents(e.target.value));
    check();
  });
  $('#oc-save').addEventListener('click', () => {
    const r = tracking.captureOutcome(c.id, readForm());
    if (r?.error) return errorBox($('#oc-errors'), r.error.split(/(?<=\.) /));
    toast(`${c.id} ${tracking.outcomeLabel(r.outcome.type).toLowerCase()} — ${usd(r.outcome.concededTotal)} conceded`);
    return dialog.close(true);
  });
  check();
  return dialog.closed;
}

/** What becomes of a lost share: escalate, the write-off loop, or accept with a reason (the role the config names). */
export async function openDispositionDialog(id, denialId) {
  const c = tracking.get(id);
  const a = c?.outcome?.allocations.find((x) => x.denialId === denialId);
  if (!a) return undefined;
  const role = currentRole();
  const canAccept = Boolean(role.canResolveDenial);
  const dialog = modal.open({
    title: `Lost share on ${denialId}`, icon: 'call_split', size: 'sm',
    sub: `${esc(usd(a.lostShare))} lost on ${c.id}`,
    body: `
      <p class="modal__lede">Escalate raises a level-2 appeal on the share; the write-off loop raises a write-off request on the claim's residual; accepting records the loss with a reason.</p>
      ${fieldHtml('call_split', `<select id="dp-kind" aria-label="Disposition">${tracking.DISPOSITIONS.map((d) => `<option value="${d}"${d === 'acceptWithReason' && !canAccept ? ' disabled' : ''}>${esc(tracking.dispositionLabel(d))}${d === 'acceptWithReason' && !canAccept ? ' — coder or CMO' : ''}</option>`).join('')}</select>`)}
      ${areaHtml('dp-reason', 'Why')}
      <div id="dp-errors"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="dp-save">Apply</button>`,
  });
  dialog.el.querySelector('#dp-save').addEventListener('click', () => {
    const r = tracking.setDisposition(c.id, denialId, dialog.el.querySelector('#dp-kind').value, { reason: dialog.el.querySelector('#dp-reason').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#dp-errors'), [r.error]);
    toast(`${denialId}: ${tracking.dispositionLabel(dialog.el.querySelector('#dp-kind').value).toLowerCase()}`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** A shortfall's answer: accept the gap with a reason, or send it to the write-off loop. */
export async function openShortfallDialog(id, recoveryId) {
  const c = tracking.get(id);
  const r = tracking.recoveriesOf(c).find((x) => x.id === recoveryId);
  if (!r) return undefined;
  const gap = Math.round((r.concededAmount - r.recoveredAmount) * 100) / 100;
  const dialog = modal.open({
    title: `Shortfall on ${r.denialId}`, icon: 'trending_down', size: 'sm', tone: 'warning',
    sub: `${esc(usd(r.recoveredAmount))} of ${esc(usd(r.concededAmount))} came on ${esc(r.remittanceRef || '—')} — ${esc(usd(gap))} short`,
    body: `
      ${fieldHtml('call_split', '<select id="sf-how" aria-label="Answer"><option value="accept">Accept the shortfall</option><option value="writeOff">Write-off loop</option></select>')}
      ${areaHtml('sf-reason', 'Why')}
      <div id="sf-errors"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="sf-save">Apply</button>`,
  });
  dialog.el.querySelector('#sf-save').addEventListener('click', () => {
    const out = tracking.answerShortfall(c.id, r.id, { how: dialog.el.querySelector('#sf-how').value, reason: dialog.el.querySelector('#sf-reason').value });
    if (out?.error) return errorBox(dialog.el.querySelector('#sf-errors'), [out.error]);
    toast(`Shortfall on ${r.denialId} answered`);
    return dialog.close(true);
  });
  return dialog.closed;
}

/** Close the case — the gate is the ledger's, shown before the button. */
export async function openCloseDialog(id) {
  const c = tracking.get(id);
  if (!c) return undefined;
  const l = tracking.ledgerOf(c);
  const dialog = modal.open({
    title: `Close ${c.id}`, icon: 'task_alt', size: 'sm',
    body: `
      <p class="modal__lede">${esc(tracking.ledgerLine(l))}</p>
      ${areaHtml('cl-reason', 'Closing note (optional)')}
      <div id="cl-errors"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" id="cl-save">Close case</button>`,
  });
  dialog.el.querySelector('#cl-save').addEventListener('click', () => {
    const r = tracking.closeCase(c.id, { reason: dialog.el.querySelector('#cl-reason').value });
    if (r?.error) return errorBox(dialog.el.querySelector('#cl-errors'), [r.error]);
    toast(`${c.id} closed`);
    return dialog.close(true);
  });
  return dialog.closed;
}
