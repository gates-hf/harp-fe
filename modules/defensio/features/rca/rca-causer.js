// The Causer tab on the root-cause case page: enabled only once the analysis
// says the cause was one person's act. The person off the staff list, what
// they did (their role in the failure), the analyst's note, and the evidence
// — the origin trail drawn with a checkbox per entry, at least one ticked
// before a person can be named. The person's earlier cases are shown under
// the form. Outside the authorised roles the tab reads "Individual — case N"
// and offers no form; once the case has concluded it is read-only. It owns
// its node and its listener.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as accountabilityCases from '../../../../data/repositories/accountability-cases.js';
import { staff, staffName } from '../../../../data/seed/staff.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { entriesByKey, evidenceHtml, originTrail, refKey } from './rca-evidence.js';
import { staffOptions } from './rca-dialogs.js';
import { decisionHtml, stageHtml } from './rca-chips.js';

/** render(host, { id, redraw }) — draws the tab for the case and binds its listener on the host. */
export function render(host, { id, redraw }) {
  const row = rcaCases.get(id);
  if (!row) return;
  const role = currentRole();
  const individual = row.analysis?.causeNature === 'individual';
  const locked = rcaCases.isConcluded(row);

  if (!individual) {
    host.innerHTML = `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">lock</span></div>
        <div class="state-view__title">Not an individual finding</div>
        <p class="state-view__body">${row.analysis?.causeNature ? `The analysis reads the cause as ${esc(rcaCases.natureLabel(row.analysis.causeNature).toLowerCase())}, so nobody is named.` : 'A person is named only once the analysis says the cause was one person’s act. Set the nature on the Analysis tab.'}</p>
      </div>`;
    return;
  }

  if (!accountabilityCases.canRead(role)) {
    const acc = accountabilityCases.byCase(row.id)[0];
    host.innerHTML = `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>
          <div class="title">${esc(row.causer ? (acc ? accountabilityCases.maskedLabel(acc) : 'Individual — named') : 'Individual — not yet named')}</div>
          Who is named on an individual finding is read by the authorised roles only; ${esc(role.name)}’s role sees the case without the name.
        </div>
      </div>`;
    return;
  }

  const stages = originTrail(row);
  const byKey = entriesByKey(stages);
  const selected = new Set((row.causer?.evidenceRefs || []).map(refKey));
  const dis = locked ? ' disabled' : '';
  const c = row.causer || {};

  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Person</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(locked ? `Named ${date(c.namedAt)} by ${c.namedBy}` : 'Named with evidence, never without — tick at least one trail entry below.')}</span>
    </div>
    <div class="toolbar">
      <label class="field field--grow"><span class="icon icon--sm">person</span><select id="cs-person" aria-label="Person"${dis}>${staffOptions(c.personId || '', { none: 'Pick the person…' })}</select></label>
    </div>
    <label class="field"><span class="icon icon--sm">work</span>
      <input type="text" id="cs-role" placeholder="Their role in the failure — what they did or left undone" aria-label="Role in failure" maxlength="200" value="${esc(c.roleInFailure || '')}"${dis}>
    </label>
    <label class="field field--area"><span class="icon icon--sm">notes</span>
      <textarea id="cs-note" rows="2" placeholder="Analyst’s note — what the evidence shows" aria-label="Analyst note" maxlength="400"${dis}>${esc(c.analystNote || '')}</textarea>
    </label>
    <div class="toolbar">
      <span class="t-title-sm">Evidence</span>
      <span class="badge" id="cs-count">${selected.size} linked</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Trail entries the other registers wrote — attributed, never edited here.</span>
    </div>
    <div id="cs-evidence">${evidenceHtml(stages, { selectable: !locked, selected })}</div>
    ${locked ? linkedHtml(row, byKey) : `
    <div class="toolbar">
      <span class="spacer"></span>
      ${row.causer ? '<button class="btn btn--secondary btn--sm" data-act="clear"><span class="icon icon--sm">person_remove</span>Clear</button>' : ''}
      <button class="btn btn--primary btn--sm" data-act="save"><span class="icon icon--sm">save</span>${row.causer ? 'Update causer' : 'Name causer'}</button>
    </div>`}
    <div id="cs-error"></div>
    <div id="cs-prior">${priorHtml(c.personId, row)}</div>`;

  const $ = (sel) => host.querySelector(sel);

  host.addEventListener('change', (e) => {
    const box = e.target.closest('[data-evidence]');
    if (box) {
      if (box.checked) selected.add(box.dataset.evidence); else selected.delete(box.dataset.evidence);
      $('#cs-count').textContent = `${selected.size} linked`;
      return;
    }
    if (e.target.id === 'cs-person') $('#cs-prior').innerHTML = priorHtml(e.target.value, row);
  });

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const errors = (list) => { $('#cs-error').innerHTML = list.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${list.map(esc).join('<br>')}</div></div>` : ''; };
    if (act === 'clear') {
      const r = rcaCases.clearCauser(id);
      if (r?.error) return errors([r.error]);
      toast(`${id} — causer cleared`);
      return redraw();
    }
    if (act !== 'save') return;
    const evidenceRefs = [...selected].map((k) => byKey.get(k)?.ref).filter(Boolean);
    const r = rcaCases.saveCauser(id, { personId: $('#cs-person').value, roleInFailure: $('#cs-role').value, evidenceRefs, analystNote: $('#cs-note').value });
    if (r?.error) return errors([r.error]);
    toast(`${staffName(r.causer.personId)} named on ${id} with ${r.causer.evidenceRefs.length} evidence ref${r.causer.evidenceRefs.length === 1 ? '' : 's'}`);
    return redraw();
  });
}

/** The linked entries, read-only, once the case has concluded. */
function linkedHtml(row, byKey) {
  const refs = row.causer?.evidenceRefs || [];
  return `
    <div class="toolbar"><span class="t-title-sm">Linked as evidence</span><span class="badge">${refs.length}</span></div>
    <ol class="journey">${refs.map((ref) => {
    const e = byKey.get(refKey(ref));
    const live = rcaCases.resolveEvidence(ref);
    return `
      <li class="journey__row">
        <span class="journey__at t-mono-sm">${dateTime(ref.at)}</span>
        <span class="journey__action"><span class="badge${live ? '' : ' badge--critical'}">${esc(ref.action)}</span></span>
        <span class="journey__actor">${esc(ref.user || live?.user || '')}</span>
        <span class="journey__detail">${e?.tag ? `<a class="crumb-link t-mono-sm" href="${esc(e.href || '#')}">${esc(e.tag)}</a> · ` : `<span class="t-mono-sm">${esc(ref.entityId)}</span> · `}${esc(live?.details || ref.label || '')}${live ? '' : ' — no longer on the trail'}</span>
      </li>`;
  }).join('')}</ol>`;
}

/** Earlier findings against the same person, and their accountability cases. */
function priorHtml(personId, row) {
  if (!personId) return '';
  const cases = rcaCases.all().filter((c) => c.id !== row.id && c.causer?.personId === personId);
  const accs = accountabilityCases.byPerson(personId).filter((a) => a.rcaCaseId !== row.id);
  const who = staff(personId);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Prior cases — ${esc(who?.name || personId)}</span>
      <span class="badge">${cases.length}</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(who ? `${who.title} · ${who.department}` : '')}</span>
    </div>
    ${cases.length ? `
    <table class="tbl">
      <thead><tr><th scope="col">Case</th><th scope="col">Role in failure</th><th scope="col">Status</th><th scope="col">Concluded</th><th scope="col">Accountability</th><th scope="col">Decision</th></tr></thead>
      <tbody>${cases.map((c) => {
    const acc = accs.find((a) => a.rcaCaseId === c.id);
    return `
        <tr>
          <td><a class="crumb-link t-mono-sm" href="#/defensio/rca/${esc(c.id)}">${esc(c.id)}</a></td>
          <td>${esc(c.causer.roleInFailure)}</td>
          <td><span class="badge">${esc(rcaCases.statusLabel(c.status))}</span></td>
          <td><span class="t-body-sm">${c.concludedAt ? date(c.concludedAt) : '—'}</span></td>
          <td>${acc ? `<a class="crumb-link t-mono-sm" href="#/defensio/accountability/${esc(acc.id)}">${esc(acc.id)}</a> ${stageHtml(acc)}` : '<span class="t-body-sm">—</span>'}</td>
          <td>${acc ? decisionHtml(acc) : '<span class="t-body-sm">—</span>'}</td>
        </tr>`;
  }).join('')}</tbody>
    </table>` : '<p class="t-body-sm">No earlier case names this person.</p>'}`;
}
