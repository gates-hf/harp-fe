// The five items, drawn. One row each: a glyph carrying the shape of the
// answer, a badge carrying its colour, the label, the detail — which is always
// present, including the reason an item does not apply — how long it has been
// waiting, and the button that goes and does something about it.
//
// The N/A reason is never blank on purpose. "Not required" without a because is
// how a desk stops trusting a checklist.
//
// The buttons come off the stamp: the engine decides where a failed item is
// answered, at the same moment it decides that it failed, so a screen never has
// to work out which route a reason implies.

import * as clearance from '../../../../data/repositories/clearance.js';
import { stateIcon, stateTone } from '../../../../data/engines/clearance-engine.js';
import { dateTime, esc, relativeTime } from '../../../../shared/format.js';

/**
 * `readOnly` drops the action buttons: a discharged or cancelled visit is a
 * record of what happened, and nothing on it is worked any more.
 */
export function checklistHtml(enc, { readOnly = false } = {}) {
  const items = clearance.stampOf(enc).items || [];
  if (!items.length) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">rule</span></div>
        <div class="state-view__title">Nothing computed</div>
        <p class="state-view__body">Clearance is computed for open visits only, and this one is closed. There is
          no checklist because there is nothing left to answer.</p>
      </div>`;
  }
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Detail</th>
          <th scope="col">Waiting</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>${items.map((item) => rowHtml(item, readOnly)).join('')}</tbody>
    </table>`;
}

function rowHtml(item, readOnly) {
  const tone = stateTone(item.state);
  return `
    <tr>
      <td>
        <span class="icon icon--sm" title="${esc(item.state)}">${stateIcon(item.state)}</span>
        ${esc(item.label)}<br>
        <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${esc(item.state)}</span>
      </td>
      <td class="t-body-sm" title="${esc(item.detail || '')}">${esc(item.detail || '—')}</td>
      <td class="t-body-sm">${item.since
        ? `<span title="Outstanding since ${esc(dateTime(item.since))}">${esc(relativeTime(item.since))}</span>`
        : '—'}</td>
      <td>${readOnly ? '' : actionHtml(item)}</td>
    </tr>`;
}

/**
 * A Failed or Pending item carries the button that answers it; a settled one
 * carries the link to what settled it, so the evidence is one click away either
 * way. An action with `act` stays on this page — the two dialogs — and one with
 * `route` goes to the screen that owns the answer.
 */
function actionHtml(item) {
  const action = item.action;
  if (!action) return '';
  const outstanding = item.state === 'Failed' || item.state === 'Pending';
  const icon = outstanding ? 'arrow_forward' : 'open_in_new';
  const kind = outstanding ? 'btn--primary' : 'btn--ghost';
  return action.act
    ? `<button class="btn ${kind} btn--sm" data-act="${esc(action.act)}">
         <span class="icon icon--sm">${icon}</span>${esc(action.label)}</button>`
    : `<a class="btn ${kind} btn--sm" href="${esc(action.route)}">
         <span class="icon icon--sm">${icon}</span>${esc(action.label)}</a>`;
}
