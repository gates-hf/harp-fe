// Capture the payer's answer. One dialog, because an answer arrives as one
// thing — a phone call or a letter — and is recorded in one act.
//
// Partially Approved is what earns the file. A payer that trims a request has
// answered per line, so the grid is the answer: a quantity and an amount for
// each service, with a reason on the ones it cut or refused. The dialog insists
// that at least one line actually differs, because a partial approval where
// nothing moved is an approval, and calling it something else makes the
// worklist lie.

import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc, todayIso, usd } from '../../../../shared/format.js';

const MAX_DOC = 10 * 1024 * 1024;

export async function askDecision(no) {
  const row = preauth.get(no);
  if (!row || !preauth.isPending(row)) return false;

  const state = {
    result: 'Approved',
    document: null,
    lines: row.services.map((service) => ({
      itemId: service.itemId,
      approvedQty: service.qty,
      approvedAmount: service.requestedAmount,
      lineDecision: 'Approved',
      lineReason: '',
    })),
  };

  const dialog = modal.open({
    title: `Record the payer's answer on ${esc(no)}`,
    sub: `${esc(preauth.patientName(row))} · ${esc(preauth.coverLabel(row))}`,
    icon: 'fact_check',
    size: 'lg',
    body: bodyHtml(row, state),
    note: 'The answer is recorded as the payer gave it. Nothing here recomputes a price.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Record the answer</button>`,
  });

  /**
   * The detail half is redrawn whenever the answer changes shape — a different
   * result asks different questions, and a reduced line grows a reason column.
   * What has already been typed is carried across: retyping an authorisation
   * number because a quantity moved would be the dialog's own fault.
   */
  const redraw = () => {
    const kept = {};
    for (const name of ['authNumber', 'validFrom', 'validTo', 'denialReasonCode', 'note']) {
      const el = dialog.el.querySelector(`[name="${name}"]`);
      if (el) kept[name] = el.value;
    }
    dialog.el.querySelector('#pd-detail').innerHTML = detailHtml(row, state);
    for (const [name, value] of Object.entries(kept)) {
      const el = dialog.el.querySelector(`[name="${name}"]`);
      if (el && value) el.value = value;
    }
  };

  dialog.el.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-result]');
    if (pick) {
      state.result = pick.dataset.result;
      for (const btn of dialog.el.querySelectorAll('[data-result]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.result === state.result));
      }
      // A refusal answers for the whole request; a partial answers per line.
      if (state.result === 'Approved') resetLines(row, state);
      return redraw();
    }
    if (!e.target.closest('[data-act="ok"]')) return;
    const answer = read(dialog.el, row, state);
    const message = validate(row, state, answer);
    const box = dialog.el.querySelector('[data-error]');
    box.hidden = !message;
    box.textContent = message;
    if (!message) dialog.close(answer);
  });

  dialog.el.addEventListener('input', (e) => {
    const line = lineOf(dialog.el, state, e.target);
    if (!line) return;
    if (e.target.dataset.field === 'approvedQty') line.approvedQty = Math.max(0, Number(e.target.value) || 0);
    if (e.target.dataset.field === 'approvedAmount') line.approvedAmount = Math.max(0, Number(e.target.value) || 0);
  });

  dialog.el.addEventListener('change', (e) => {
    if (e.target.id === 'pd-doc') return readDocument(dialog.el, state, e.target);
    const line = lineOf(dialog.el, state, e.target);
    if (!line) return;
    if (e.target.dataset.field === 'lineDecision') {
      line.lineDecision = e.target.value;
      // A refused line is refused outright: nothing is approved on it.
      if (line.lineDecision === 'Denied') {
        line.approvedQty = 0;
        line.approvedAmount = 0;
      }
      return redraw();
    }
    if (e.target.dataset.field === 'lineReason') line.lineReason = e.target.value;
    // A quantity that has just moved needs a reason beside it, and one that has
    // moved back does not.
    if (e.target.dataset.field === 'approvedQty' || e.target.dataset.field === 'approvedAmount') redraw();
  });

  const answer = await dialog.closed;
  if (!answer) return false;

  const saved = preauth.captureDecision(no, answer);
  if (!saved) return false;
  toast(saved.status === 'Denied'
    ? `${no} denied — ${preauth.denialLabel(saved.decision.denialReasonCode)}`
    : `${no} ${saved.status.toLowerCase()} · ${saved.decision.authNumber}`, saved.status === 'Denied' ? 'warning' : 'success');
  return true;
}

// --- markup -------------------------------------------------------------------

function bodyHtml(row, state) {
  return `
    <p class="modal__lede">What did the payer say? The three answers are the payer's own — a request the payer
      trimmed is partially approved, however small the trim.</p>
    <div class="segmented" role="group" aria-label="Result">
      ${preauth.RESULTS.map((r) => `
        <button type="button" data-result="${esc(r)}" aria-pressed="${r === state.result}">${esc(r)}</button>`).join('')}
    </div>
    <div id="pd-detail">${detailHtml(row, state)}</div>
    <div class="toolbar">
      <span class="t-title-sm">Payer response document</span>
      <span class="spacer"></span>
      <label class="btn btn--secondary btn--sm" title="The letter or the portal printout, up to 10 MB">
        <span class="icon icon--sm">upload_file</span>Attach
        <input type="file" id="pd-doc" accept=".pdf,.jpg,.jpeg,.png" hidden>
      </label>
    </div>
    <p class="t-body-sm" id="pd-doc-name">Nothing attached yet.</p>
    <div class="field-error" data-error hidden></div>`;
}

/** The fields that answer depends on: a validity, a refusal, or both. */
function detailHtml(row, state) {
  const denied = state.result === 'Denied';
  const partial = state.result === 'Partially Approved';
  return `
    ${denied ? '' : `
      <dl class="dl">
        <dt>Authorisation number *</dt>
        <dd><label class="field">
          <span class="icon icon--sm">confirmation_number</span>
          <input name="authNumber" type="text" placeholder="NSSF/PA/2026/40118">
        </label></dd>
        <dt>Valid from *</dt>
        <dd><label class="field"><input name="validFrom" type="date" value="${esc(todayIso())}"></label></dd>
        <dt>Valid to *</dt>
        <dd><label class="field"><input name="validTo" type="date" value=""></label></dd>
      </dl>`}
    ${partial ? gridHtml(row, state) : ''}
    ${denied || partial ? `
      <dl class="dl">
        <dt>${denied ? 'Denial reason *' : 'Reason for the reduction *'}</dt>
        <dd><label class="field">
          <span class="icon icon--sm">rule</span>
          <select name="denialReasonCode">
            <option value="">Choose the reason the payer gave</option>
            ${preauth.DENIAL_REASONS.map((r) => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}
          </select>
        </label></dd>
        <dt>Note</dt>
        <dd><label class="field field--area">
          <textarea name="note" rows="3" placeholder="What the payer said, in its own words."></textarea>
        </label></dd>
      </dl>` : ''}`;
}

/** The per-service grid. Every line is editable; at least one has to move. */
function gridHtml(row, state) {
  return `
    <div class="toolbar">
      <span class="t-title-sm">What the payer allowed</span>
      <span class="spacer"></span>
      <span class="t-body-sm">at least one line has to differ from what was asked</span>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Service</th>
          <th scope="col" class="num">Asked</th>
          <th scope="col" class="num">Approved qty *</th>
          <th scope="col" class="num">Approved amount *</th>
          <th scope="col">Line decision</th>
          <th scope="col">Reason</th>
        </tr>
      </thead>
      <tbody>
        ${row.services.map((service, i) => {
          const line = state.lines[i];
          return `
            <tr data-line="${i}">
              <td>${esc(preauth.serviceLabel(service))}</td>
              <td class="num t-mono-sm">${service.qty} · ${usd(service.requestedAmount)}</td>
              <td class="num"><label class="field">
                <input type="number" min="0" step="1" data-field="approvedQty" value="${esc(line.approvedQty)}"
                       aria-label="Approved quantity on ${esc(preauth.serviceLabel(service))}">
              </label></td>
              <td class="num"><label class="field">
                <input type="number" min="0" step="0.01" data-field="approvedAmount" value="${esc(line.approvedAmount)}"
                       aria-label="Approved amount on ${esc(preauth.serviceLabel(service))}">
              </label></td>
              <td><label class="field">
                <select data-field="lineDecision" aria-label="Decision on ${esc(preauth.serviceLabel(service))}">
                  <option value="Approved"${line.lineDecision === 'Approved' ? ' selected' : ''}>Approved</option>
                  <option value="Denied"${line.lineDecision === 'Denied' ? ' selected' : ''}>Denied</option>
                </select>
              </label></td>
              <td>${line.lineDecision === 'Denied' || line.approvedQty !== service.qty
                ? `<label class="field">
                     <select data-field="lineReason" aria-label="Reason on ${esc(preauth.serviceLabel(service))}">
                       <option value="">Choose a reason</option>
                       ${preauth.DENIAL_REASONS.map((r) => `
                         <option value="${esc(r.code)}"${r.code === line.lineReason ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
                     </select>
                   </label>`
                : '<span class="t-body-sm">allowed in full</span>'}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// --- reading and checking -----------------------------------------------------

function read(el, row, state) {
  const value = (name) => el.querySelector(`[name="${name}"]`)?.value?.trim() || '';
  const partial = state.result === 'Partially Approved';
  return {
    result: state.result,
    authNumber: value('authNumber'),
    validFrom: value('validFrom'),
    validTo: value('validTo'),
    denialReasonCode: value('denialReasonCode') || null,
    note: value('note'),
    document: state.document,
    services: partial
      ? state.lines.map((line) => ({
        ...line,
        // A reason is the payer's code, and the request stores it as the
        // reason it gave for that line — the label is looked up on read.
        lineReason: line.lineReason ? preauth.denialLabel(line.lineReason) : null,
      }))
      : null,
  };
}

function validate(row, state, answer) {
  if (answer.result !== 'Denied') {
    if (!answer.authNumber) return 'Enter the authorisation number the payer gave. It is what a claim is billed under.';
    if (!answer.validFrom) return 'Enter the date the authorisation starts.';
    if (!answer.validTo) return 'Enter the date the authorisation runs to.';
    if (answer.validTo <= answer.validFrom) return 'The authorisation has to run to a date after it starts.';
  }
  if (answer.result !== 'Approved' && !answer.denialReasonCode) {
    return 'Choose the reason the payer gave. It is what a resubmission has to answer.';
  }
  if (answer.result === 'Partially Approved') {
    const moved = row.services.some((service, i) => {
      const line = state.lines[i];
      return line.lineDecision === 'Denied'
        || Number(line.approvedQty) !== Number(service.qty)
        || Number(line.approvedAmount) !== Number(service.requestedAmount);
    });
    if (!moved) return 'Nothing was reduced. If the payer allowed everything as asked, record it as Approved.';
    if (state.lines.every((line) => line.lineDecision === 'Denied')) {
      return 'Every line was refused. If the payer allowed nothing, record it as Denied.';
    }
  }
  return '';
}

function resetLines(row, state) {
  state.lines = row.services.map((service) => ({
    itemId: service.itemId,
    approvedQty: service.qty,
    approvedAmount: service.requestedAmount,
    lineDecision: 'Approved',
    lineReason: '',
  }));
}

const lineOf = (el, state, target) => {
  const tr = target.closest?.('[data-line]');
  return tr ? state.lines[Number(tr.dataset.line)] : null;
};

function readDocument(el, state, input) {
  const file = input.files?.[0];
  const name = el.querySelector('#pd-doc-name');
  if (!file) return;
  if (file.size > MAX_DOC) {
    input.value = '';
    name.textContent = 'That document is over 10 MB. Scan it again at a lower resolution.';
    return;
  }
  state.document = { fileName: file.name, size: file.size };
  name.textContent = `${file.name} will be filed with the answer.`;
}
