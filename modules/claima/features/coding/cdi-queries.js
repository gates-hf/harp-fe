// CDI queries — the questions a coder puts to the physician while working a
// chart, and the thread each becomes. Raise is a dialog (type, physician,
// template, references); the thread opens in the shared drawer, where the
// physician answers and the coder resolves, reopens or withdraws.
//
// Two screens read these: the workspace's Queries strip and the physician's
// queue at #/claima/coding/queries. Both open the same drawer.

import * as coding from '../../../../data/repositories/coding.js';
import * as docs from '../../../../data/repositories/clinical-docs.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as modal from '../../../../shared/modal.js';
import * as drawer from '../../../../shared/drawer.js';
import { toast } from '../../../../shared/toast.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { DOCTORS, doctorName } from '../../../../data/seed/reference.js';
import { askReason } from './coding-assign.js';
import { daysLabel } from './coding-chips.js';

/** A starting sentence per type — editable, never sent as it stands. */
export const TEMPLATES = {
  'Missing Documentation': 'The chart refers to [document] but it is not on file. Please file it — [what it decides for the coding].',
  Clarification: 'The record documents [finding]. Please clarify [the question], so the chart can be coded as written.',
  Specificity: 'The documentation states [diagnosis]. Please document the type, acuity or laterality if known — it cannot be coded from [the finding] alone.',
  Conflicting: 'The [document A] states [X] while the [document B] states [Y]. Please confirm which applies to this visit.',
};

export function queryTone(status) {
  if (status === 'Open') return 'warning';
  if (status === 'Answered') return 'accent';
  if (status === 'Resolved') return 'success';
  return '';
}

export const queryStatusHtml = (q) =>
  `<span class="badge${queryTone(q.status) ? ` badge--${queryTone(q.status)}` : ''}"><span class="dot"></span>${esc(q.status)}</span>`;

/** Days with the physician, or the turnaround once answered. */
export function tatHtml(q) {
  const days = coding.queryTat(q);
  const label = q.answeredAt ? `answered in ${daysLabel(days)}` : `${daysLabel(days)} with the physician`;
  const late = !q.answeredAt && days >= 3 && q.status === 'Open';
  return late
    ? `<span class="badge badge--critical" title="Raised ${esc(dateTime(q.raisedAt))}"><span class="dot"></span>${esc(label)}</span>`
    : `<span class="t-body-sm" title="Raised ${esc(dateTime(q.raisedAt))}">${esc(label)}</span>`;
}

// --- raise ------------------------------------------------------------------

/** Raise a query on a chart. `lines` and `documents` are what it may refer to. */
export async function askRaiseQuery(no, { lines = [], documents = [] } = {}) {
  const enc = encounters.get(no);
  const rec = coding.get(no);
  const why = coding.editBlocked(rec);
  if (why) {
    toast(why, 'warning');
    return null;
  }
  const dialog = modal.open({
    title: `Raise a query — ${esc(no)}`,
    sub: `${esc(enc.department)} · ${esc(doctorName(enc.doctorId))}`,
    icon: 'contact_support',
    size: 'lg',
    body: `
      <p class="modal__lede">The physician sees the question in their queue and answers in the thread. The chart
        waits as Query Pending until every open query is resolved or withdrawn.</p>
      <dl class="dl">
        <dt><label for="cq-type">Type *</label></dt>
        <dd><label class="field"><select id="cq-type" name="type">${
          coding.QUERY_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label></dd>
        <dt><label for="cq-physician">Physician *</label></dt>
        <dd><label class="field"><select id="cq-physician" name="physicianId">${
          DOCTORS.map((d) => `<option value="${esc(d.id)}"${d.id === enc.doctorId ? ' selected' : ''}>${esc(d.name)} — ${esc(d.department)}</option>`).join('')}</select></label></dd>
        <dt><label for="cq-question">Question *</label></dt>
        <dd>
          <div class="toolbar">
            <span class="t-body-sm">Start from the template and replace the brackets.</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--ghost btn--sm" data-act="template">Load template</button>
          </div>
          <label class="field field--area"><textarea id="cq-question" name="question" rows="5">${esc(TEMPLATES['Missing Documentation'])}</textarea></label>
          <div class="field-error" data-error="question" hidden></div>
        </dd>
        <dt>Refers to</dt>
        <dd>
          ${lines.length ? lines.map((l) => `
            <label class="rule-child-row"><input type="checkbox" name="line" value="${esc(l.id)}">
              <div><span class="t-mono-sm">${esc(l.chargeCode)}</span> ${esc(l.description)}</div></label>`).join('') : ''}
          ${documents.length ? documents.map((d) => `
            <label class="rule-child-row"><input type="checkbox" name="doc" value="${esc(d.id)}">
              <div>${esc(d.type)} — ${esc(d.title)}</div></label>`).join('') : ''}
          ${!lines.length && !documents.length ? '<span class="t-body-sm">Nothing on the chart to refer to.</span>' : ''}
        </dd>
      </dl>`,
    note: 'Recorded on the chart with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Send to physician</button>`,
  });

  const el = dialog.el;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="template"]')) {
      el.querySelector('[name="question"]').value = TEMPLATES[el.querySelector('[name="type"]').value] || '';
      return;
    }
    if (!e.target.closest('[data-act="ok"]')) return;
    const question = el.querySelector('[name="question"]').value.trim();
    const box = el.querySelector('[data-error="question"]');
    const bad = question.length < 20 ? 'Write the question out. The physician answers what is asked.'
      : /\[[^\]]*\]/.test(question) ? 'Replace every bracketed placeholder before sending.' : '';
    box.hidden = !bad;
    box.textContent = bad;
    el.querySelector('[name="question"]').closest('.field').classList.toggle('field--invalid', Boolean(bad));
    if (bad) return;
    dialog.close({
      type: el.querySelector('[name="type"]').value,
      physicianId: el.querySelector('[name="physicianId"]').value,
      question,
      refs: {
        chargeLineIds: [...el.querySelectorAll('[name="line"]:checked')].map((i) => i.value),
        docIds: [...el.querySelectorAll('[name="doc"]:checked')].map((i) => i.value),
      },
    });
  });

  const answer = await dialog.closed;
  if (!answer || typeof answer !== 'object') return null;
  const q = coding.raiseQuery(no, answer);
  if (q) toast(`${q.id} sent to ${doctorName(q.physicianId)}`, 'success');
  return q;
}

// --- the thread ---------------------------------------------------------------

/** One query's thread in the drawer, with the actions the signed-in role has. */
export async function openQueryThread(id) {
  const sheet = drawer.open({ title: `Query ${esc(id)}`, icon: 'forum', body: '', foot: ' ' });

  function draw() {
    const q = coding.getQuery(id);
    if (!q) return sheet.close();
    const role = currentRole();
    sheet.el.querySelector('.drawer__title').textContent = `${q.id} · ${q.type}`;
    sheet.el.querySelector('.drawer__body').innerHTML = threadHtml(q, role);
    sheet.el.querySelector('.drawer__foot').innerHTML = footHtml(q, role);
  }

  sheet.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const q = coding.getQuery(id);
    const text = sheet.el.querySelector('[name="reply"]')?.value.trim() || '';
    if (act === 'answer') {
      if (text.length < 5) return void toast('Write the answer before sending', 'warning');
      if (coding.answerQuery(id, text)) toast(`${id} answered`, 'success');
      return draw();
    }
    if (act === 'resolve') {
      if (coding.resolveQuery(id, text)) toast(`${id} resolved`, 'success');
      return draw();
    }
    if (act === 'reopen') {
      if (text.length < 5) return void toast('Say what is still missing before reopening', 'warning');
      if (coding.reopenQuery(id, text)) toast(`${id} reopened`, 'success');
      return draw();
    }
    if (act === 'withdraw') {
      const reason = await askReason({
        title: `Withdraw ${q.id}`, sub: q.type, icon: 'undo', tone: 'warning',
        lede: 'The physician no longer needs to answer. The question stays on the chart with the reason it was withdrawn.',
        placeholder: 'Found in the operative note; asked the wrong physician…', confirmLabel: 'Withdraw',
      });
      if (typeof reason !== 'string') return;
      if (coding.withdrawQuery(id, reason)) toast(`${id} withdrawn`, 'success');
      return draw();
    }
  });

  draw();
  return sheet.closed;
}

function threadHtml(q, role) {
  const refs = [
    ...(q.refs?.chargeLineIds || []).map((lineId) => `<span class="badge" title="Charge line">${esc(lineId)}</span>`),
    ...(q.refs?.docIds || []).map((docId) => {
      const d = docs.get(docId);
      return `<span class="badge" title="${esc(d ? d.title : 'Document')}">${esc(d ? d.type : docId)}</span>`;
    }),
  ];
  return `
    <dl class="dl dl--narrow">
      <dt>Encounter</dt><dd><a class="crumb-link t-mono-sm" href="#/claima/coding/${esc(q.encounterNo)}">${esc(q.encounterNo)}</a></dd>
      <dt>Physician</dt><dd>${esc(doctorName(q.physicianId))}</dd>
      <dt>Status</dt><dd>${queryStatusHtml(q)} ${tatHtml(q)}</dd>
      <dt>Refers to</dt><dd>${refs.length ? refs.join(' ') : '<span class="t-body-sm">—</span>'}</dd>
    </dl>
    <div class="toolbar"><span class="t-title-sm">Thread</span></div>
    <ol class="journey">
      ${q.thread.map((m) => `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${dateTime(m.at)}</span>
          <span class="journey__action">${esc(m.role)}</span>
          <span class="journey__actor">${esc(m.by)}</span>
          <span class="journey__detail">${esc(m.text)}</span>
        </li>`).join('')}
    </ol>
    ${replyHtml(q, role)}`;
}

/** The reply box under the thread — the physician's answer or the coder's note. */
function replyHtml(q, role) {
  if (q.status === 'Withdrawn' || (!role.isPhysician && !role.canCode)) return '';
  if (role.isPhysician && q.status !== 'Open') return '';
  const placeholder = role.isPhysician ? 'Your answer, as it should be documented' : 'A note for the thread — optional on Resolve, required to reopen';
  return `
    <div class="toolbar"><span class="t-title-sm">${role.isPhysician ? 'Answer' : 'Reply'}</span></div>
    <label class="field field--area"><textarea name="reply" rows="3" placeholder="${esc(placeholder)}"></textarea></label>`;
}

/** The reply box and the buttons the role has; a missing right is a disabled button saying why. */
function footHtml(q, role) {
  const closed = !coding.isQueryOpen(q);
  const physician = role.isPhysician;
  const coder = role.canCode;
  const gate = (allowed, why, label, act, cls = 'btn--secondary') => (allowed
    ? `<button class="btn ${cls}" data-act="${act}">${label}</button>`
    : `<button class="btn ${cls}" disabled title="${esc(why)}">${label}</button>`);
  return `
    <span class="spacer"></span>
    <button class="btn btn--secondary" data-close>Close</button>
    ${physician
      ? gate(q.status === 'Open', q.status === 'Answered' ? 'Already answered — the coder resolves or reopens it' : 'This query is closed', 'Answer', 'answer', 'btn--primary')
      : ''}
    ${coder && !physician ? `
      ${gate(!closed, 'Already closed', 'Resolve', 'resolve', 'btn--primary')}
      ${gate(q.status === 'Answered' || q.status === 'Resolved', q.status === 'Open' ? 'Still open with the physician' : 'A withdrawn query is not reopened — raise a new one', 'Reopen', 'reopen')}
      ${gate(!closed, 'Already closed', 'Withdraw', 'withdraw')}` : ''}
    ${!physician && !coder ? `<button class="btn btn--primary" disabled title="${esc(role.title)} neither answers nor resolves a query">Answer</button>` : ''}`;
}

/** The compact row both lists draw a query as. */
export function queryRowHtml(q, { showEncounter = false } = {}) {
  return `
    <tr data-query="${esc(q.id)}" tabindex="0" title="Open the thread">
      <td><span class="t-mono-sm">${esc(q.id)}</span>${showEncounter ? `<br><span class="t-mono-sm">${esc(q.encounterNo)}</span>` : ''}</td>
      <td>${esc(q.type)}</td>
      <td>${esc(doctorName(q.physicianId))}</td>
      <td>${esc(q.question.length > 90 ? `${q.question.slice(0, 90)}…` : q.question)}</td>
      <td>${queryStatusHtml(q)}</td>
      <td>${tatHtml(q)}</td>
      <td><button class="btn btn--ghost btn--icon btn--sm" data-act="thread" title="Open the thread">
        <span class="icon icon--sm">forum</span></button></td>
    </tr>`;
}
