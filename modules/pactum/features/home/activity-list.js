// Activity — the whole shared audit trail on one screen, filtered by entity
// type and paged. Reached from the home screen's Recent activity panel; the
// entry-to-record resolver is home-activity.js's, so both agree on where a row
// leads.

import { dateTime, esc, relativeTime } from '../../../../shared/format.js';
import { ENTITY_TYPES, describe, recent } from './home-activity.js';

export const meta = { title: 'Activity' };

const PAGE_SIZE = 15;

export async function render(mount, ctx) {
  const res = await fetch(new URL('./activity-list.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load activity-list.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/home' },
    { label: 'Activity' },
  ]);

  const state = { q: '', entity: '', page: 0 };
  const $ = (sel) => mount.querySelector(sel);

  const search = $('#ac-search');
  const entitySel = $('#ac-entity');

  entitySel.innerHTML =
    '<option value="">All records</option>' +
    ENTITY_TYPES.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('');

  function rows() {
    const needle = state.q.trim().toLowerCase();
    return recent().filter((entry) => {
      if (state.entity && entry.entity !== state.entity) return false;
      if (!needle) return true;
      const about = describe(entry);
      return `${entry.action} ${entry.user} ${entry.details} ${about.type} ${about.name}`
        .toLowerCase()
        .includes(needle);
    });
  }

  function draw() {
    const all = rows();
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE_SIZE;
    const page = all.slice(start, start + PAGE_SIZE);

    $('#ac-rows').innerHTML = page.map(rowHtml).join('');

    const empty = $('#ac-empty');
    empty.hidden = all.length > 0;
    mount.querySelector('.tbl').hidden = all.length === 0;
    if (!all.length) empty.innerHTML = emptyHtml();

    $('#ac-range').textContent = all.length
      ? `${start + 1}–${start + page.length} of ${all.length}`
      : '0 of 0';

    setPager('prev', state.page === 0, 'You are on the first page');
    setPager('next', state.page >= pages - 1, 'You are on the last page');
  }

  function setPager(which, disabled, why) {
    const btn = mount.querySelector(`[data-page="${which}"]`);
    btn.disabled = disabled;
    btn.title = disabled ? why : '';
  }

  function rowHtml(entry) {
    const about = describe(entry);
    return `
      <tr>
        <td class="t-mono-sm" title="${esc(dateTime(entry.at))}">${esc(relativeTime(entry.at))}</td>
        <td>${esc(entry.user)}</td>
        <td>${esc(entry.action)}</td>
        <td>
          ${about.path
            ? `<a class="crumb-link" href="#${esc(about.path)}" title="Open ${esc(about.name)}">${esc(about.name)}</a>`
            : esc(about.name)}
          <br><span class="t-body-sm">${esc(about.type)}</span>
        </td>
        <td class="t-body-sm">${esc(entry.details || '—')}</td>
      </tr>`;
  }

  function emptyHtml() {
    const filtered = state.q || state.entity;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'history'}</span></div>
        <div class="state-view__title">No activity found</div>
        <p class="state-view__body">${filtered
          ? 'No entries match. Change the search text or clear the filter to see the whole trail.'
          : 'The trail is append-only: every change made in the session lands here.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/pactum/home">Back to home</a>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  search.addEventListener('input', () => {
    state.q = search.value;
    state.page = 0;
    draw();
  });

  entitySel.addEventListener('change', () => {
    state.entity = entitySel.value;
    state.page = 0;
    draw();
  });

  mount.addEventListener('click', (e) => {
    const pager = e.target.closest('[data-page]');
    if (pager && !pager.disabled) {
      state.page += pager.dataset.page === 'next' ? 1 : -1;
      draw();
      return;
    }
    if (e.target.closest('[data-action="clear"]')) {
      Object.assign(state, { q: '', entity: '', page: 0 });
      search.value = '';
      entitySel.value = '';
      draw();
    }
  });

  // The trail is live: anything audited anywhere in the session appends here.
  ctx.onData(draw);

  // Deep link: #/pactum/activity?entity=contract opens one entity's trail.
  if (ENTITY_TYPES.some((t) => t.key === ctx.query?.entity)) {
    entitySel.value = state.entity = ctx.query.entity;
  }

  draw();
}
