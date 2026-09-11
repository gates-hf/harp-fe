// The Codes tab of the code system page: one version at a time — the current
// one unless the page was opened on another (`?version=`) — searched, paged,
// added to, and corrected in place. The display is the one field edited
// inline (a code never changes: a wrong code is deactivated and the right one
// added), and every write is the repository's, audited on the code.
//
// The tab's state lives on the page's state object, so a commit that redraws
// the page brings the same version, search and page back.

import * as versions from '../../../../data/repositories/code-system-versions.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import { date, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openCodeForm } from './code-form.js';

const PAGE_SIZE = 20;

/** render(host, { systemId, state, refresh }) */
export function render(host, { systemId, state, refresh }) {
  state.codes ||= { q: '', status: '', page: 0, editingId: null };
  const s = state.codes;
  const list = versions.bySystem(systemId);
  // The version shown: the query's, else the current, else the newest.
  if (!list.some((v) => v.id === state.versionId)) {
    state.versionId = (versions.currentOf(systemId) || list[0])?.id || '';
  }
  const $ = (sel) => host.querySelector(sel);
  const version = () => versions.get(state.versionId);

  function draw() {
    const v = version();
    host.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">Codes</span>
        ${list.length ? `
          <label class="field">
            <span class="icon icon--sm">layers</span>
            <select data-version aria-label="Version">
              ${list.map((x) => `<option value="${esc(x.id)}"${x.id === state.versionId ? ' selected' : ''}>${esc(x.versionLabel)}${x.isCurrent ? ' — current' : ''}${x.status !== 'Active' ? ' — inactive' : ''} · ${codes.counts(x.id).total} codes</option>`).join('')}
            </select>
          </label>
          ${v ? `<span class="t-body-sm">valid ${date(v.validFrom)}${v.validTo ? ` – ${date(v.validTo)}` : ' onward'}</span>` : ''}` : ''}
        <span class="spacer"></span>
        ${v
          ? `<a class="btn btn--secondary btn--sm" href="#/pactum/standard-codes/${esc(systemId)}/import?version=${esc(state.versionId)}">
               <span class="icon icon--sm">upload_file</span>Bulk import
             </a>`
          : `<button class="btn btn--secondary btn--sm" disabled title="Add a version first">
               <span class="icon icon--sm">upload_file</span>Bulk import
             </button>`}
        <button class="btn btn--primary btn--sm" data-act="add" ${v ? '' : 'disabled title="Add a version first"'}>
          <span class="icon icon--sm">add</span>Add code
        </button>
      </div>
      ${v ? `
      <div class="toolbar">
        <label class="field field--grow">
          <span class="icon icon--sm">search</span>
          <input type="search" data-search value="${esc(s.q)}" placeholder="Search code or display" aria-label="Search codes">
        </label>
        <label class="field">
          <span class="icon icon--sm">filter_list</span>
          <select data-status aria-label="Status">
            <option value=""${s.status ? '' : ' selected'}>All statuses</option>
            ${codes.STATUSES.map((x) => `<option value="${x}"${s.status === x ? ' selected' : ''}>${x}</option>`).join('')}
          </select>
        </label>
      </div>
      <table class="tbl">
        <thead><tr><th>Code</th><th>Display</th><th>Status</th><th>Valid from</th><th>Attributes</th><th>Actions</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
      <div data-empty hidden></div>
      <div class="tbl-foot">
        <span class="range" data-range></span>
        <span class="pager">
          <button class="btn btn--secondary btn--sm" data-page="prev"><span class="icon icon--sm">chevron_left</span>Previous</button>
          <button class="btn btn--secondary btn--sm" data-page="next">Next<span class="icon icon--sm">chevron_right</span></button>
        </span>
      </div>` : emptyVersionsHtml()}`;
    if (v) drawRows();
  }

  function drawRows() {
    const all = codes.search(state.versionId, s.q, { status: s.status });
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    s.page = Math.min(s.page, pages - 1);
    const start = s.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('[data-rows]').innerHTML = page.map(rowHtml).join('');
    const empty = $('[data-empty]');
    empty.hidden = all.length > 0;
    $('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();
    $('[data-range]').textContent = all.length ? `${start + 1}–${start + page.length} of ${all.length}` : '0 of 0';
    for (const [which, disabled, why] of [['prev', s.page === 0, 'You are on the first page'], ['next', s.page >= pages - 1, 'You are on the last page']]) {
      const btn = $(`[data-page="${which}"]`);
      btn.disabled = disabled;
      btn.title = disabled ? why : '';
    }
    $('[data-display]')?.focus();
  }

  function attributesHtml(a = {}) {
    const parts = [];
    if (a.sex) parts.push(a.sex === 'F' ? 'female' : 'male');
    if (a.ageMin !== null && a.ageMin !== undefined) parts.push(`age ≥ ${a.ageMin}`);
    if (a.ageMax !== null && a.ageMax !== undefined) parts.push(a.ageMax === 0 ? 'newborn' : `age ≤ ${a.ageMax}`);
    if (a.category) parts.push(a.category);
    if (a.chapter) parts.push(`chapter ${a.chapter}`);
    return parts.length ? esc(parts.join(' · ')) : '<span class="t-body-sm">—</span>';
  }

  function rowHtml(row) {
    const active = row.status === 'Active';
    const editing = s.editingId === row.id;
    return `
      <tr data-id="${row.id}">
        <td class="t-mono-sm">${esc(row.code)}</td>
        <td>${editing
          ? `<label class="field field--grow"><input data-display value="${esc(row.display)}" aria-label="Display for ${esc(row.code)}"></label>`
          : esc(row.display)}</td>
        <td><span class="badge${active ? ' badge--success' : ''}"><span class="dot"></span>${row.status}</span></td>
        <td class="t-mono-sm">${date(row.validFrom)}</td>
        <td class="t-body-sm">${attributesHtml(row.attributes)}</td>
        <td>${editing
          ? `<button class="btn btn--primary btn--sm" data-act="save">Save</button>
             <button class="btn btn--ghost btn--sm" data-act="cancel">Cancel</button>`
          : `<button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit the display of ${esc(row.code)}"><span class="icon icon--sm">edit</span></button>
             <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle" title="${active ? 'Deactivate' : 'Activate'} ${esc(row.code)}"><span class="icon icon--sm">${active ? 'toggle_on' : 'toggle_off'}</span></button>`}</td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = s.q || s.status;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'data_object'}</span></div>
        <div class="state-view__title">${filtered ? 'No codes match' : 'No codes in this version'}</div>
        <p class="state-view__body">${filtered ? 'Change the search text or the status filter.' : 'Add codes by hand, or import a file with the template.'}</p>
        ${filtered ? '' : '<div class="state-view__actions"><button class="btn btn--primary" data-act="add">Add code</button></div>'}
      </div>`;
  }

  function emptyVersionsHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">layers</span></div>
        <div class="state-view__title">No versions yet</div>
        <p class="state-view__body">Codes belong to a version. Add the first release on the Versions tab.</p>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function add() {
    const row = await openCodeForm(state.versionId);
    if (!row) return;
    s.q = '';
    refresh();
    toast(`${row.code} added to version ${version().versionLabel}`, 'success');
  }

  function saveDisplay(id) {
    const input = $('[data-display]');
    const result = codes.updateDisplay(id, input?.value);
    if (result.error) return toast(result.error, 'warning');
    s.editingId = null;
    refresh();
    toast(`${result.row.code} display saved`, 'success');
  }

  async function toggle(id) {
    const row = codes.get(id);
    const next = row.status === 'Active' ? 'Inactive' : 'Active';
    if (next === 'Inactive') {
      const ok = await confirm({
        title: 'Deactivate code',
        body: `${row.code} — ${row.display} stays in version ${version().versionLabel} and drops out of every lookup. A wrong code is replaced by adding the right one.`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }
    codes.setStatus(id, next);
    refresh();
    toast(`${row.code} ${next === 'Active' ? 'activated' : 'deactivated'}`, 'success');
  }

  // --- events ---------------------------------------------------------------

  host.addEventListener('input', (e) => {
    if (!e.target.matches('[data-search]')) return;
    s.q = e.target.value;
    s.page = 0;
    drawRows();
  });

  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-version]')) {
      state.versionId = e.target.value;
      s.page = 0;
      s.editingId = null;
      draw();
    } else if (e.target.matches('[data-status]')) {
      s.status = e.target.value;
      s.page = 0;
      drawRows();
    }
  });

  host.addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-display]')) return;
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (e.key === 'Enter') { e.preventDefault(); saveDisplay(id); }
    if (e.key === 'Escape') { s.editingId = null; drawRows(); }
  });

  host.addEventListener('click', (e) => {
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      s.page += pager.dataset.page === 'next' ? 1 : -1;
      return drawRows();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add') return void add();
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (!id) return;
    if (act === 'edit') { s.editingId = id; return drawRows(); }
    if (act === 'cancel') { s.editingId = null; return drawRows(); }
    if (act === 'save') return saveDisplay(id);
    if (act === 'toggle') return void toggle(id);
  });

  draw();
}
