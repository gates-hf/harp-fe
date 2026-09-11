// The coding workspace at #/claima/coding/<encounter no>: the evidence on the
// left, the coding on the right. The draft lives here until Save draft writes
// it, and the validation panel runs over the draft on screen rather than the
// stored copy, so a coder sees what still blocks before saving.
//
// The whole page redraws from state on every change — a store commit, a role
// switch, an edit — and the two search fields redraw only their hits, so a
// half-typed code survives the redraw that adding the last one caused.

import * as coding from '../../../../data/repositories/coding.js';
import * as docs from '../../../../data/repositories/clinical-docs.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as patients from '../../../../data/repositories/patients.js';
import { icd, proc } from '../../../../data/repositories/code-sets.js';
import { doctorName } from '../../../../data/seed/reference.js';
import { dateTime, esc } from '../../../../shared/format.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { toast } from '../../../../shared/toast.js';
import { askAssign, askReason } from './coding-assign.js';
import { askRaiseQuery, openQueryThread } from './cdi-queries.js';
import { evidenceHtml } from './coding-evidence.js';
import { dosOf, hitsHtml, panelHtml } from './coding-panel.js';
import { requestHtml, statusHtml, typeHtml } from './coding-chips.js';
import { historyHtml } from './coding-history.js';
import { askDismissRequest, askRecode, askRequestRecode, requestsHtml, versionsHtml } from './recode.js';

export const meta = { title: 'Coding workspace' };

const blankDraft = () => ({ diagnoses: [], procedures: [], warningsAcknowledged: [] });
const clone = (v) => JSON.parse(JSON.stringify({ diagnoses: v.diagnoses, procedures: v.procedures, warningsAcknowledged: v.warningsAcknowledged }));

export async function render(mount, ctx) {
  const no = ctx.params[0];
  if (!encounters.get(no)) throw new Error(`No encounter ${no}`);

  const res = await fetch(new URL('./coding-workspace.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load coding-workspace.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { draft: blankDraft(), loadedKey: '', dirty: false, dxQuery: '', pxQuery: '', docId: null, historyFilter: 'all' };
  const $ = (sel) => mount.querySelector(sel);

  /**
   * The draft follows the stored version unless the coder has unsaved edits
   * on the same version. A version that changed underneath — a recode, a save
   * from another tab — replaces what is on screen either way.
   */
  function loadDraft(force = false) {
    const v = coding.currentVersion(coding.get(no));
    const key = v ? `${v.version}:${v.codedAt || 'draft'}` : 'none';
    if (!force && state.dirty && state.loadedKey === key) return;
    state.draft = v ? clone(v) : blankDraft();
    state.loadedKey = key;
    state.dirty = false;
  }

  function view() {
    const role = currentRole();
    const enc = encounters.get(no);
    const rec = coding.get(no);
    const why = coding.editBlocked(rec, role);
    return {
      role, enc, rec, why,
      editable: !why,
      patient: patients.view(patients.get(enc.patientMrn), role),
      lines: coding.releasedLines(no),
      documents: docs.byEncounter(no),
      queries: coding.queriesFor(no),
      draft: state.draft,
      dirty: state.dirty,
      dxQuery: state.dxQuery,
      pxQuery: state.pxQuery,
      docId: state.docId,
      validation: coding.validate(no, state.draft),
      requestsHtml: requestsHtml(rec, role),
      versionsHtml: versionsHtml(rec),
    };
  }

  function draw() {
    loadDraft();
    const v = view();
    const { enc, rec, role } = v;
    ctx.setHeader(`${enc.no} — coding`);
    ctx.setCrumb([
      { label: 'Claima', path: '/claima/home' },
      { label: 'Coding', path: '/claima/coding' },
      { label: enc.no },
    ]);
    $('#cx-no').textContent = enc.no;
    $('#cx-meta').innerHTML = metaHtml(v);
    $('#cx-actions').innerHTML = actionsHtml(rec, role);
    $('#cx-banners').innerHTML = bannersHtml(rec);
    $('#cx-encounter').href = `#/frontis/encounters/${enc.no}`;
    $('#cx-evidence').innerHTML = evidenceHtml(v);
    const current = coding.currentVersion(rec);
    $('#cx-version').textContent = current
      ? `v${current.version}${current.codedAt ? ` · coded ${dateTime(current.codedAt)} by ${coding.coderName(current.codedBy)}` : ' · draft'}`
      : 'no draft yet';
    $('#cx-panel').innerHTML = panelHtml(v);
    $('#cx-history').innerHTML = historyHtml(no, state.historyFilter);
  }

  function metaHtml({ enc, rec, patient }) {
    const status = rec?.status || 'Unassigned';
    return `
      ${statusHtml(status)} ${requestHtml(rec)}
      ${typeHtml(enc.type)}
      <span>·</span><span>${esc(enc.department)}</span>
      <span>·</span><span>${esc(doctorName(enc.doctorId))}</span>
      <span>·</span><span>${esc(patient?.nameEn || enc.patientMrn)}</span>
      <span>·</span><span>${rec?.assignedTo ? `Assigned to ${esc(coding.coderName(rec.assignedTo))}` : 'In the pool'}</span>`;
  }

  function actionsHtml(rec, role) {
    const gate = (why, label, act, icon, cls = 'btn--secondary') => (why
      ? `<button class="btn ${cls} btn--sm" disabled title="${esc(why)}"><span class="icon icon--sm">${icon}</span>${label}</button>`
      : `<button class="btn ${cls} btn--sm" data-act="${act}"><span class="icon icon--sm">${icon}</span>${label}</button>`);
    const coded = rec && coding.lastCoded(rec);
    return `
      ${gate(coding.selfAssignBlocked(rec, role), 'Take chart', 'self', 'front_hand')}
      ${gate(coding.assignBlocked(rec, role), 'Assign', 'assign', 'person_add')}
      ${gate(coding.recodeBlocked(rec, role), 'Recode', 'recode', 'history_edu')}
      ${role.canRecode ? '' : gate(coded ? '' : 'Nothing has been coded yet', 'Request recode', 'request', 'flag')}`;
  }

  function bannersHtml(rec) {
    const open = coding.openRecodeRequests(rec);
    if (!open.length) return '';
    const req = open[open.length - 1];
    return `
      <div class="alert alert--${req.status === 'Open' ? 'critical' : 'warning'}">
        <span class="icon">history_edu</span>
        <div>
          <div class="title">${req.status === 'Open' ? 'Recode requested' : 'Recode in progress'} — ${esc(req.id)} · ${esc(req.source === 'LateCharge' ? 'Late charge' : req.source)}${req.ref ? ` · ${esc(req.ref)}` : ''}</div>
          ${esc(req.reason)}${req.status === 'Open' ? ' — Recode opens a new version to correct it in; the coded version stands until then.' : ''}
        </div>
      </div>`;
  }

  // --- the draft ------------------------------------------------------------

  const edit = (fn) => {
    fn(state.draft);
    state.dirty = true;
    draw();
  };

  // A code is resolved on the version in force on the visit's date of service
  // (amendment 44), so the display written onto the chart is the one that
  // release carried.
  function addDiagnosis(code) {
    const row = icd.get(code, dosOf(encounters.get(no)));
    if (!row || state.draft.diagnoses.some((d) => d.code === row.code)) return toast(`${code} is already on the chart`, 'warning');
    state.dxQuery = '';
    edit((d) => d.diagnoses.push({ code: row.code, desc: row.desc, principal: d.diagnoses.length === 0, poa: null }));
  }

  /**
   * A procedure arrives dated on the day the visit closed, under the
   * attending, and linked to the first unlinked released line in its own
   * category — the guess that is right for a chest film on a chest-film line,
   * and one checkbox away from right when it is not.
   */
  function addProcedure(code) {
    const enc = encounters.get(no);
    const row = proc.get(code, dosOf(enc));
    if (!row) return;
    const linked = new Set(state.draft.procedures.flatMap((p) => p.chargeLineIds));
    const line = coding.releasedLines(no).find((l) => coding.isLinkable(l) && !linked.has(l.id) && l.category === row.category);
    state.pxQuery = '';
    edit((d) => d.procedures.push({
      code: row.code, desc: row.desc, date: String(enc.endAt || enc.startAt).slice(0, 10), doctorId: enc.doctorId,
      chargeLineIds: line ? [line.id] : [],
    }));
  }

  function jump(section) {
    const id = { lines: 'sec-procedures', warnings: 'sec-validation', 'doc-preview': 'doc-preview' }[section] || `sec-${section}`;
    const target = $(`#cx-${id}`);
    if (!target) return;
    // Focus first, then scroll: moving focus after cancels a smooth scroll under way.
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('input', (e) => {
    const kind = e.target.dataset.search;
    if (!kind) return;
    state[kind === 'dx' ? 'dxQuery' : 'pxQuery'] = e.target.value;
    $(`#cx-${kind}-hits`).innerHTML = hitsHtml(kind, e.target.value, dosOf(encounters.get(no)));
  });

  mount.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'principal') return edit((d) => d.diagnoses.forEach((x, i) => { x.principal = i === Number(t.value); }));
    if (t.dataset.poa !== undefined) return edit((d) => { d.diagnoses[Number(t.dataset.poa)].poa = t.value || null; });
    if (t.dataset.px) return edit((d) => { d.procedures[Number(t.dataset.index)][t.dataset.px] = t.value; });
    if (t.dataset.pxLine) {
      return edit((d) => {
        const p = d.procedures[Number(t.dataset.index)];
        p.chargeLineIds = t.checked ? [...new Set([...p.chargeLineIds, t.dataset.pxLine])] : p.chargeLineIds.filter((id) => id !== t.dataset.pxLine);
      });
    }
  });

  mount.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.search) {
      e.preventDefault();
      const first = $(`#cx-${e.target.dataset.search}-hits [data-add]`);
      if (first) first.click();
    }
    const tr = e.target.closest('tr[data-doc], tr[data-query]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      tr.querySelector('[data-act]')?.click();
    }
  });

  mount.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return add.dataset.add === 'dx' ? addDiagnosis(add.dataset.code) : addProcedure(add.dataset.code);

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      return edit((d) => {
        const list = remove.dataset.remove === 'dx' ? d.diagnoses : d.procedures;
        list.splice(Number(remove.dataset.index), 1);
        if (remove.dataset.remove === 'dx' && d.diagnoses.length && !d.diagnoses.some((x) => x.principal)) d.diagnoses[0].principal = true;
      });
    }

    const jumpTo = e.target.closest('[data-jump]');
    if (jumpTo) return jump(jumpTo.dataset.jump);

    const ack = e.target.closest('[data-ack]');
    if (ack) {
      const label = coding.validate(no, state.draft).warnings.find((w) => w.key === ack.dataset.ack)?.label || ack.dataset.ack;
      const reason = await askReason({
        title: 'Acknowledge the warning', sub: label, icon: 'warning', tone: 'warning',
        lede: 'The warning stays on the chart with your reason beside it, and no longer blocks Mark coded.',
        placeholder: 'Why the code stands as written', confirmLabel: 'Acknowledge',
      });
      if (typeof reason !== 'string') return;
      return edit((d) => d.warningsAcknowledged.push({ code: ack.dataset.ack, reason }));
    }
    const unack = e.target.closest('[data-unack]');
    if (unack) return edit((d) => { d.warningsAcknowledged = d.warningsAcknowledged.filter((w) => w.code !== unack.dataset.unack); });

    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.historyFilter = chip.dataset.filter;
      $('#cx-history').innerHTML = historyHtml(no, state.historyFilter);
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'read-doc' || (!act && e.target.closest('tr[data-doc]'))) {
      const id = e.target.closest('tr[data-doc]').dataset.doc;
      state.docId = state.docId === id ? null : id;
      draw();
      if (state.docId) jump('doc-preview');
      return;
    }
    if (act === 'thread' || (!act && e.target.closest('tr[data-query]'))) {
      return void (await openQueryThread(e.target.closest('tr[data-query]').dataset.query));
    }
    if (act === 'save') {
      const rec = coding.saveDraft(no, state.draft);
      if (!rec) return toast(coding.editBlocked(coding.get(no)) || 'The draft could not be saved', 'warning');
      state.dirty = false;
      loadDraft(true);
      toast('Draft saved', 'success');
      return draw();
    }
    if (act === 'coded') {
      const result = coding.markCoded(no);
      if (!result.ok) {
        toast(result.blocking[0]?.label || 'Something still blocks it', 'critical');
        return draw();
      }
      toast(`${no} coded — v${result.version.version}`, 'success');
      return;
    }
    if (act === 'release') {
      if (coding.releaseToPool(no)) toast(`${no} back in the pool`, 'success');
      return;
    }
    if (act === 'self') {
      if (coding.selfAssign(no)) toast(`${no} is yours`, 'success');
      return;
    }
    if (act === 'assign') return void (await askAssign(no));
    if (act === 'recode') return void (await askRecode(no));
    if (act === 'request') return void (await askRequestRecode(no));
    if (act === 'dismiss-request') return void (await askDismissRequest(no, e.target.closest('[data-request]').dataset.request));
    if (act === 'raise') {
      const v = view();
      return void (await askRaiseQuery(no, { lines: v.lines, documents: v.documents }));
    }
  });

  // Live on both axes: a physician's answer lands here, and a role switch
  // re-reads the edit gate and the masking.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();
}
