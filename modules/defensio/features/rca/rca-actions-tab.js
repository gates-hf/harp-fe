// The Corrective actions tab on the root-cause case page: every action on
// the case as a row — what, type (a Configuration action's target opens the
// screen it is made on), owner, due date with its overdue tint, status, the
// verification note — with Raise, Edit, Mark done, Verify, Reopen and
// Attach. A case closes only when every row here reads Verified, which the
// header line says. It owns its node and its listener.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as correctiveActions from '../../../../data/repositories/corrective-actions.js';
import { staffName } from '../../../../data/seed/staff.js';
import { date, esc } from '../../../../shared/format.js';
import { openActionDialog, openActionNoteDialog } from './rca-dialogs.js';

/** render(host, { id, redraw }) — draws the tab for the case and binds its listener on the host. */
export function render(host, { id, redraw }) {
  const row = rcaCases.get(id);
  if (!row) return;
  const rows = correctiveActions.byCase(id);
  const verified = rows.filter((a) => a.status === 'Verified').length;
  const closed = row.status === 'Closed';

  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Corrective actions</span>
      <span class="badge">${rows.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${rows.length ? `${verified} of ${rows.length} verified${verified === rows.length ? ' — the case can close' : ''}` : 'Conclusion needs at least one; closing needs every one verified.'}</span>
      ${closed ? '' : '<button class="btn btn--primary btn--sm" data-act="raise"><span class="icon icon--sm">add</span>Raise action</button>'}
    </div>
    ${rows.length ? `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col">Type</th>
          <th scope="col">Owner</th>
          <th scope="col">Due</th>
          <th scope="col">Status</th>
          <th scope="col">Verification</th>
          <th scope="col">Attachments</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map((a) => rowHtml(a, closed)).join('')}</tbody>
    </table>` : `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">build</span></div>
      <div class="state-view__title">No corrective action yet</div>
      <p class="state-view__body">What changes so this does not happen again — a configuration, a training, a process, a staffing change, an escalation to the payer.</p>
      ${closed ? '' : '<div class="state-view__actions"><button class="btn btn--primary" data-act="raise">Raise action</button></div>'}
    </div>`}`;

  host.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const actionId = btn.closest('tr[data-id]')?.dataset.id;
    if (act === 'raise') { await openActionDialog(id); return; }
    if (act === 'edit') { await openActionDialog(id, actionId); return; }
    if (['done', 'verify', 'reopen', 'attach'].includes(act)) { await openActionNoteDialog(actionId, act); }
  });
}

function rowHtml(a, closed) {
  const overdue = correctiveActions.isOverdue(a);
  const href = correctiveActions.targetHref(a);
  return `
    <tr data-id="${esc(a.id)}">
      <td><span class="t-mono-sm">${esc(a.id)}</span><br>${esc(a.action)}</td>
      <td><span class="badge">${esc(correctiveActions.typeLabel(a.type))}</span>${a.targetRef ? `<br>${href ? `<a class="crumb-link t-mono-sm" href="${esc(href)}" title="Open where the change is made">${esc(a.targetRef)}</a>` : `<span class="t-body-sm">${esc(a.targetRef)}</span>`}` : ''}</td>
      <td>${esc(staffName(a.ownerId))}</td>
      <td><span class="badge${overdue ? ' badge--critical' : ''}" title="${esc(overdue ? 'Past due and still open' : `Due ${date(a.dueDate)}`)}">${date(a.dueDate)}</span></td>
      <td><span class="badge badge--${correctiveActions.statusTone(a.status)}" title="${esc(a.status === 'Done' ? `Done ${date(a.doneAt)} by ${a.doneBy}${a.doneNote ? ` — ${a.doneNote}` : ''}` : a.status === 'Verified' ? `Verified ${date(a.verifiedAt)} by ${a.verifiedBy}` : 'Open')}"><span class="dot"></span>${esc(a.status)}</span></td>
      <td><span class="t-body-sm">${a.status === 'Verified' ? `${esc(a.verificationNote)}<br>— ${esc(a.verifiedBy)}, ${date(a.verifiedAt)}` : a.status === 'Done' ? `Done ${date(a.doneAt)}${a.doneNote ? ` — ${esc(a.doneNote)}` : ''}` : '—'}</span></td>
      <td>${a.attachments.length ? a.attachments.map((d) => `<span class="t-body-sm" title="${esc(`${d.by} · ${date(d.at)}`)}">${esc(d.fileName)}</span>`).join('<br>') : '<span class="t-body-sm">—</span>'}</td>
      <td>${closed ? '<span class="t-body-sm">Closed</span>' : `
        ${a.status === 'Open' ? `
          <button class="btn btn--secondary btn--sm" data-act="edit" title="Edit the action"><span class="icon icon--sm">edit</span>Edit</button>
          <button class="btn btn--primary btn--sm" data-act="done" title="Mark the action done"><span class="icon icon--sm">check</span>Done</button>` : ''}
        ${a.status === 'Done' ? `
          <button class="btn btn--primary btn--sm" data-act="verify" title="Verify what was done, with a note"><span class="icon icon--sm">verified</span>Verify</button>
          <button class="btn btn--secondary btn--sm" data-act="reopen" title="Send the action back"><span class="icon icon--sm">undo</span>Reopen</button>` : ''}
        ${a.status === 'Verified' ? '<button class="btn btn--secondary btn--sm" data-act="reopen" title="Reopen a verified action with a reason"><span class="icon icon--sm">undo</span>Reopen</button>' : ''}
        <button class="btn btn--ghost btn--sm" data-act="attach" title="Attach a document"><span class="icon icon--sm">attach_file</span></button>`}</td>
    </tr>`;
}
