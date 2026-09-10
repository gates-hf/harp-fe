// The day's three dialogs: close it (freezing the report as the next
// version), reopen it with a reason, and document an exception over a RED
// check. Each asks the repository for its blocker first and shows the
// sentence the repository would refuse with, so a disabled button and a
// refused dialog say the same thing.

import * as businessDays from '../../../../data/repositories/business-days.js';
import { open as openModal, confirm } from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { esc } from '../../../../shared/format.js';

const errorHtml = (why) => `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(why)}</div></div>`;

/** closeDayDialog(date) → Promise<boolean>. */
export async function closeDayDialog(date) {
  const why = businessDays.closeBlocker(date);
  if (why) { toast(why, 'critical'); return false; }
  const report = businessDays.compute(date);
  const n = (businessDays.get(date)?.versions.length || 0) + 1;
  const reds = report.checks.filter((c) => c.status === 'RED');
  const ok = await confirm({
    title: `Close business day ${date}`,
    icon: 'lock',
    tone: reds.length ? 'warning' : 'info',
    confirmLabel: n === 1 ? 'Close day' : `Close as v${n}`,
    body: `The report is frozen as <strong>${esc(businessDays.dtrNoFor(date, n))}</strong> and the day locks: no session opens on it and anything posted to it afterwards is carried by the next open day, flagged prior-day.${
      reds.length ? ` ${reds.length} RED check${reds.length === 1 ? ' is' : 's are'} closed over on the documented exception${reds.length === 1 ? '' : 's'}.` : ' Every check is OK.'}`,
    note: `${report.sections.map((s) => `${s.label} ${s.count}`).join(' · ')}`,
  });
  if (!ok) return false;
  const { error, version } = businessDays.closeDay(date);
  if (error) { toast(error, 'critical'); return false; }
  toast(`${version.dtrNo} frozen — the day is closed`);
  return true;
}

/** reopenDayDialog(date) → Promise<boolean>. */
export async function reopenDayDialog(date) {
  const why = businessDays.reopenBlocker(date);
  if (why) { toast(why, 'critical'); return false; }
  const day = businessDays.get(date);
  const latest = businessDays.latestVersion(day);
  const dialog = openModal({
    title: `Reopen business day ${date}`,
    sub: `${latest?.dtrNo} stays on record; the next close writes v${day.versions.length + 1}`,
    icon: 'lock_open',
    tone: 'warning',
    size: 'sm',
    body: `
      <p class="modal__lede">Say why. The reason is written on the reopen event and on the version the re-close produces.</p>
      <div class="toolbar">
        <label class="field field--area field--grow">
          <span class="icon icon--sm">notes</span>
          <textarea id="rd-reason" rows="3" placeholder="Why the day is being reopened" aria-label="Reason" autofocus></textarea>
        </label>
      </div>
      <div id="rd-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="reopen">Reopen day</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'reopen') return;
    const { error } = businessDays.reopenDay(date, dialog.el.querySelector('#rd-reason').value);
    if (error) { dialog.el.querySelector('#rd-error').innerHTML = errorHtml(error); return; }
    toast(`${date} reopened — close it again to write v${day.versions.length + 1}`);
    dialog.close('reopened');
  });
  return (await dialog.closed) === 'reopened';
}

/** documentExceptionDialog(date, checkKey, current) → Promise<boolean>. */
export async function documentExceptionDialog(date, checkKey, current = null) {
  const check = businessDays.CHECKS.find((c) => c.key === checkKey);
  const role = currentRole();
  if (!role[businessDays.exceptionFlag()]) { toast(`${role.name} cannot document an exception — a role with that right can`, 'critical'); return false; }
  const dialog = openModal({
    title: `Document exception — ${check?.label || checkKey}`,
    sub: `${date} · ${check?.hint || ''}`,
    icon: 'edit_note',
    tone: 'warning',
    size: 'md',
    body: `
      <p class="modal__lede">A RED check the day is closed over rather than fixed. The note persists into the frozen report and reads beside the check on every version that carries it.</p>
      <div class="toolbar">
        <label class="field field--area field--grow">
          <span class="icon icon--sm">notes</span>
          <textarea id="de-note" rows="4" placeholder="What was found, what was done, who agreed it" aria-label="Exception note" autofocus>${esc(current?.note || '')}</textarea>
        </label>
      </div>
      <div id="de-error"></div>`,
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="save">Save note</button>`,
  });
  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'save') return;
    const { error } = businessDays.documentException(date, checkKey, dialog.el.querySelector('#de-note').value);
    if (error) { dialog.el.querySelector('#de-error').innerHTML = errorHtml(error); return; }
    toast(`Exception documented on ${check?.label || checkKey}`);
    dialog.close('saved');
  });
  return (await dialog.closed) === 'saved';
}
