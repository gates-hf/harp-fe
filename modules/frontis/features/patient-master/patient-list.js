// Patient Master — the list. Reads and writes go through
// data/repositories/patients.js and nowhere else.
//
// This feature also owns the patient screen's deeper links, and hands the mount
// over on each: /new and /<mrn>/edit are the register form, /<mrn> the record
// page, /duplicates the worklist, /merge the merge screen and /import the
// importer.

import * as patients from '../../../../data/repositories/patients.js';
import * as duplicates from '../../../../data/repositories/duplicates.js';
import { age, date, esc } from '../../../../shared/format.js';
import { metricKey } from '../../../../shared/metric-card.js';
import { current as currentRole, subscribe as onRole } from '../../../../shared/roles.js';
import { openPatientHistory } from './patient-history.js';
import { KPI, railHtml, selectKpi } from './patient-kpis.js';

export const meta = { title: 'Patient Master' };

const PAGE_SIZE = 12;

const HANDOFFS = {
  new: () => import('./patient-form.js'),
  duplicates: () => import('./duplicates-worklist.js'),
  merge: () => import('./patient-merge.js'),
  import: () => import('./patient-import.js'),
};

export async function render(mount, ctx) {
  const [first, second] = ctx.params;
  if (HANDOFFS[first]) return (await HANDOFFS[first]()).render(mount, ctx);
  if (first && second === 'edit') return (await import('./patient-form.js')).render(mount, ctx);
  if (first) return (await import('./patient-view.js')).render(mount, ctx);

  const res = await fetch(new URL('./patient-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load patient-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { ...KPI.all, sort: 'nameEn', dir: 'asc', page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#pl-search');
  const statusSel = $('#pl-status');
  const genderSel = $('#pl-gender');
  const nationalitySel = $('#pl-nationality');
  const mergedSel = $('#pl-merged');

  statusSel.innerHTML = optionsHtml('All statuses', patients.STATUSES);
  genderSel.innerHTML = optionsHtml('All genders', patients.GENDERS);
  nationalitySel.innerHTML = optionsHtml('All nationalities', patients.nationalitiesInUse());

  function syncFilters() {
    search.value = state.q;
    statusSel.value = state.status;
    genderSel.value = state.gender;
    nationalitySel.value = state.nationality;
    mergedSel.value = state.includeMerged ? '1' : '';
  }

  function rows() {
    return patients.search(state.q, state, { includeMerged: state.includeMerged });
  }

  function draw() {
    const role = currentRole();
    $('#pl-metrics').innerHTML = railHtml(state, role);
    drawDuplicates();
    drawRows(role);
  }

  function drawDuplicates() {
    const open = duplicates.openCount();
    const link = $('#pl-duplicates');
    link.innerHTML = `<span class="icon icon--sm">join_inner</span>Duplicates${
      open ? ` <span class="badge badge--warning">${open}</span>` : ''}`;
    link.title = open
      ? `${open} potential duplicate ${open === 1 ? 'pair is' : 'pairs are'} waiting for a decision`
      : 'No potential duplicates are waiting';
  }

  function drawRows(role) {
    const all = rows();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('#pl-rows').innerHTML = page.map((p) => rowHtml(patients.view(p, role))).join('');

    const empty = $('#pl-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();

    $('#pl-range').textContent = all.length
      ? `${start + 1}–${start + page.length} of ${all.length}`
      : '0 of 0';

    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function rowHtml(p) {
    const tone = patients.statusTone(p.status);
    const years = age(p.dob);
    return `
      <tr data-mrn="${p.mrn}" tabindex="0" title="Open ${esc(p.nameEn)}">
        <td class="t-mono-sm">${esc(p.mrn)}</td>
        <td>${esc(p.nameEn)}<br><span class="t-body-sm" dir="rtl">${esc(p.nameAr)}</span></td>
        <td class="t-mono-sm">${p.civilId ? esc(p.civilId) : p.passportNo ? `${esc(p.passportNo)} <span class="badge">passport</span>` : '—'}</td>
        <td class="t-mono-sm">${date(p.dob)}${years === '—' ? '' : ` (${years})`}</td>
        <td>${esc(p.gender)}</td>
        <td class="t-mono-sm">${p.phone ? esc(p.phone) : '—'}</td>
        <td>
          <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${p.status}</span>
          ${p.vip && !p.masked ? '<span class="badge badge--accent">VIP</span>' : ''}
          ${p.masked ? '<span class="badge" title="Your role reads this record masked">Restricted</span>' : ''}
        </td>
        <td class="t-mono-sm">${date(p.lastVisitAt)}</td>
        <td>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit ${esc(p.nameEn)}">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.status || state.gender || state.nationality || state.vip;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'groups'}</span></div>
        <div class="state-view__title">No patients found</div>
        <p class="state-view__body">${
          filtered
            ? 'No patients match. Change the search text or clear the filters to see the whole register.'
            : 'The register is empty. Register the first patient to give the rest of the platform something to hang off.'
        }</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/patients/new">Register patient</a>
        </div>
      </div>`;
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function markSort() {
    for (const btn of mount.querySelectorAll('.sort-btn')) {
      const on = btn.dataset.sort === state.sort;
      btn.querySelector('.icon').textContent = on
        ? (state.dir === 'asc' ? 'arrow_upward' : 'arrow_downward')
        : 'unfold_more';
      btn.closest('th').setAttribute('aria-sort', on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  }

  /** A card or a link opens this list already filtered: patients?status=Blocked. */
  function applyQuery(q = {}) {
    if (patients.STATUSES.includes(q.status)) state.status = q.status;
    if (patients.GENDERS.includes(q.gender)) state.gender = q.gender;
    if (q.merged === '1' || q.status === 'Merged') state.includeMerged = true;
    if (q.vip === '1') state.vip = true;
    syncFilters();
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  for (const [el, key] of [[statusSel, 'status'], [genderSel, 'gender'], [nationalitySel, 'nationality']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      // Merged records are only listed when they are asked for, and choosing
      // the status is asking for them.
      if (key === 'status' && el.value === 'Merged') state.includeMerged = true;
      state.page = 0;
      syncFilters();
      draw();
    });
  }

  mergedSel.addEventListener('change', () => {
    state.includeMerged = mergedSel.value === '1';
    if (!state.includeMerged && state.status === 'Merged') state.status = '';
    state.page = 0;
    syncFilters();
    draw();
  });

  mount.addEventListener('click', (e) => {
    const sort = e.target.closest('.sort-btn');
    if (sort) {
      const key = sort.dataset.sort;
      state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
      state.sort = key;
      markSort();
      drawRows(currentRole());
      return;
    }

    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      drawRows(currentRole());
      return;
    }

    const kpi = metricKey(e);
    if (kpi) {
      selectKpi(state, kpi);
      state.page = 0;
      syncFilters();
      draw();
      return;
    }

    if (e.target.closest('[data-action="clear"]')) {
      Object.assign(state, { ...KPI.all, page: 0 });
      syncFilters();
      draw();
      return;
    }

    const row = e.target.closest('tr[data-mrn]');
    if (!row) return;
    const mrn = row.dataset.mrn;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'history') return void openPatientHistory(mrn);
    if (act === 'edit') return ctx.navigate(`/frontis/patients/${mrn}/edit`);
    ctx.navigate(`/frontis/patients/${mrn}`);
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-mrn]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/frontis/patients/${row.dataset.mrn}`);
    }
  });

  // The list is live on both axes: a patient registered, merged or blocked
  // anywhere in the session lands here, and switching demo role re-masks the
  // restricted rows. The role subscription retires itself once this screen has
  // left the document.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  applyQuery(ctx.query);
  markSort();
  draw();
}

function optionsHtml(allLabel, values) {
  return `<option value="">${allLabel}</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
}
