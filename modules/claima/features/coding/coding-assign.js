// The assignment dialog: a supervisor hands a chart to a coder, with the
// reason the trail keeps. Asked from the worklist row and from the workspace
// banner alike. Self-assign and Release to pool need no dialog — one click,
// one trail line — so they are not here.
//
// `askReason` is the one-field dialog the Frontis actions use, copied rather
// than imported: a module never reaches into another module's files.

import * as coding from '../../../../data/repositories/coding.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';

export async function askAssign(no) {
  const rec = coding.get(no);
  const why = coding.assignBlocked(rec);
  if (why) {
    toast(why, 'warning');
    return false;
  }
  const options = coding.coders();
  const dialog = modal.open({
    title: `Assign ${esc(no)}`,
    sub: rec?.assignedTo ? `Now with ${esc(coding.coderName(rec.assignedTo))}` : 'In the pool',
    icon: 'person_add',
    size: 'md',
    body: `
      <p class="modal__lede">The chart moves to the coder's own list. A draft already saved on it goes with it.</p>
      <dl class="dl">
        <dt><label for="ca-coder">Coder *</label></dt>
        <dd><label class="field"><select id="ca-coder" name="coder">${
          options.map((c) => `<option value="${esc(c.id)}"${c.id === rec?.assignedTo ? ' selected' : ''}>${esc(c.name)}</option>`).join('')
        }</select></label></dd>
        <dt><label for="ca-reason">Reason</label></dt>
        <dd><label class="field field--area">
          <textarea id="ca-reason" name="reason" rows="2" placeholder="Backlog, specialty, a query to follow up…"></textarea>
        </label></dd>
      </dl>`,
    note: 'Recorded in the trail with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Assign</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    dialog.close({
      coder: dialog.el.querySelector('[name="coder"]').value,
      reason: dialog.el.querySelector('[name="reason"]').value.trim(),
    });
  });

  const answer = await dialog.closed;
  if (!answer || typeof answer !== 'object') return false;
  const after = coding.assign(no, answer.coder, answer.reason);
  if (after) toast(`${no} assigned to ${coding.coderName(answer.coder)}`, 'success');
  return Boolean(after);
}

/** One question, one field — the reason a change is made. */
export async function askReason({
  title, sub: subLine = '', icon = 'edit_note', tone = 'warning', lede, placeholder = '', confirmLabel = 'Confirm', minLength = 5,
}) {
  const dialog = modal.open({
    title,
    sub: esc(subLine),
    icon,
    tone,
    size: 'md',
    body: `
      <p class="modal__lede">${esc(lede)}</p>
      <dl class="dl">
        <dt>Reason *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="value" rows="3" placeholder="${esc(placeholder)}"></textarea>
          </label>
          <div class="field-error" data-error="value" hidden></div>
        </dd>
      </dl>`,
    note: 'The change is recorded in the trail with your name and the time.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn ${tone === 'critical' ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const input = dialog.el.querySelector('[name="value"]');
    const box = dialog.el.querySelector('[data-error="value"]');
    const value = input.value.trim();
    const message = value.length < minLength ? 'Enter the reason. It is what the next reader of this chart sees.' : '';
    box.hidden = !message;
    box.textContent = message;
    input.closest('.field').classList.toggle('field--invalid', Boolean(message));
    if (message) return input.focus();
    dialog.close(value);
  });

  return dialog.closed;
}
