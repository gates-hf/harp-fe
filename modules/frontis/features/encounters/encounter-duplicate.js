// The duplicate warning. A second open encounter of the same type on the same
// patient is nearly always the same visit entered twice, so registration raises
// it before the flow goes on rather than after the number is spent.
//
// It answers 'open' (go to the one already open), 'go' (proceed, which the new
// encounter's trail records) or undefined (the clerk backed out).

import * as modal from '../../../../shared/modal.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import { dateTime, esc } from '../../../../shared/format.js';

export async function askDuplicate(open) {
  const dialog = modal.open({
    title: 'This patient already has an open encounter',
    sub: `${esc(encounters.typeLabel(open.type))} · ${esc(open.no)}`,
    icon: 'content_copy',
    tone: 'warning',
    size: 'md',
    body: `
      <p class="modal__lede">${esc(open.no)} is still ${esc(open.status.toLowerCase())} — ${esc(open.department)},
        opened ${esc(dateTime(open.startAt))}. Opening a second one splits the visit across two records.</p>`,
    note: 'Proceeding is recorded on the new encounter.',
    foot: `
      <button class="btn btn--secondary" data-act="open">Open ${esc(open.no)}</button>
      <button class="btn btn--primary" data-act="go">Proceed anyway</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) dialog.close(act);
  });

  return dialog.closed;
}
