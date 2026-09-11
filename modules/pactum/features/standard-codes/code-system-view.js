// The code system page, at #/pactum/standard-codes/<id>: the banner, and three
// tabs — Versions, Codes and History — each rendering into a fresh node of its
// own so the listeners it binds retire when the panel is drawn again (the
// shell's freshBody rule one level down). A tab id in the path opens on that
// tab and `?version=` picks the version the Codes tab shows.
//
// #/pactum/standard-codes/<id>/import is the bulk importer; the page hands the
// mount over to it the way the CDM list hands over to its own.

import * as systems from '../../../../data/repositories/code-systems.js';
import * as versions from '../../../../data/repositories/code-system-versions.js';
import { date, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openSystemForm } from './system-form.js';
import * as tabVersions from './tab-versions.js';
import * as tabCodes from './tab-codes.js';
import * as tabHistory from './tab-history.js';

export const meta = { title: 'Code system' };

const TABS = [
  { id: 'versions', label: 'Versions', feature: tabVersions },
  { id: 'codes', label: 'Codes', feature: tabCodes },
  { id: 'history', label: 'History', feature: tabHistory },
];

export async function render(mount, ctx) {
  const id = ctx.params[0];
  if (ctx.params[1] === 'import') {
    const importer = await import('./code-import.js');
    return importer.render(mount, ctx);
  }
  if (!systems.get(id)) throw new Error(`No code system ${id}`);

  const res = await fetch(new URL('./code-system-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load code-system-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const deepTab = TABS.some((t) => t.id === ctx.params[1]) ? ctx.params[1] : 'versions';
  // The Codes tab keeps the version it shows across redraws; the query seeds it.
  const state = { tab: deepTab, versionId: ctx.query?.version || '' };
  const $ = (sel) => mount.querySelector(sel);
  const system = () => systems.get(id);

  function draw() {
    const s = system();
    if (!s) return;
    ctx.setHeader(s.name);
    ctx.setCrumb([
      { label: 'Pactum', path: '/pactum/payers' },
      { label: 'Standard Codes', path: '/pactum/standard-codes' },
      { label: s.name },
    ]);

    $('#cs-name').textContent = s.name;
    $('#cs-meta').innerHTML = metaHtml(s);
    $('#cs-actions').innerHTML = actionsHtml(s);
    $('#cs-notice').innerHTML = noticeHtml(s);
    $('#cs-tabs').innerHTML = TABS.map(
      (t) => `<button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
                      aria-selected="${t.id === state.tab}" data-tab="${t.id}">${t.label}</button>`).join('');
    drawTab(s);
  }

  function drawTab(s) {
    const tab = TABS.find((t) => t.id === state.tab);
    const box = document.createElement('div');
    $('#cs-panel').replaceChildren(box);
    void tab.feature.render(box, { systemId: s.id, state, refresh: draw, navigate: ctx.navigate });
  }

  function metaHtml(s) {
    const current = versions.currentOf(s.id);
    const list = versions.bySystem(s.id);
    return `
      <span class="badge badge--info">${esc(systems.typeLabel(s.systemType))}</span>
      <span class="badge${s.status === 'Active' ? ' badge--success' : ''}"><span class="dot"></span>${s.status}</span>
      <span class="t-mono-sm">${esc(s.id)}</span>
      <span>·</span>
      ${current
        ? `<span class="badge badge--accent" title="The version a lookup with no date reads">current ${esc(current.versionLabel)}</span>`
        : s.status === 'Active'
          ? '<span class="badge badge--critical" title="Lookups fall back to the newest active version and warn, or find nothing"><span class="dot"></span>no current version</span>'
          : ''}
      <span>·</span>
      <span class="t-body-sm">${list.length} version${list.length === 1 ? '' : 's'}</span>
      <span>·</span>
      <span class="t-mono-sm">${date(s.validFrom)}${s.validTo ? ` – ${date(s.validTo)}` : ' onward'}</span>`;
  }

  function actionsHtml(s) {
    const active = s.status === 'Active';
    return `
      <button class="btn btn--secondary btn--sm" data-act="edit"><span class="icon icon--sm">edit</span>Edit system</button>
      <button class="btn btn--secondary btn--sm" data-act="toggle">
        <span class="icon icon--sm">${active ? 'toggle_on' : 'toggle_off'}</span>${active ? 'Deactivate' : 'Activate'}
      </button>
      <a class="btn btn--ghost btn--sm" href="#/pactum/standard-codes"><span class="icon icon--sm">arrow_back</span>All systems</a>`;
  }

  /** The broken-source banner: an active system nobody can resolve on cleanly. */
  function noticeHtml(s) {
    if (s.status !== 'Active' || versions.currentOf(s.id)) return '';
    const latest = versions.latestActiveOf(s.id);
    return `
      <div class="alert alert--critical">
        <span class="icon">warning</span>
        <div>
          <div class="title">No current version</div>
          ${latest
            ? `A lookup on ${esc(s.name)} falls back to the newest active version, ${esc(latest.versionLabel)}, and warns in the console. Set a version as current on the Versions tab.`
            : `${esc(s.name)} has no active version, so a lookup finds nothing and warns in the console. Add or activate a version and set it as current.`}
        </div>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function edit() {
    const row = await openSystemForm(id);
    draw();
    if (row) toast(`${row.name} saved`, 'success');
  }

  async function toggle() {
    const s = system();
    const next = s.status === 'Active' ? 'Inactive' : 'Active';
    if (next === 'Inactive') {
      const ok = await confirm({
        title: 'Deactivate code system',
        body: `${s.name} stays on file with its versions and codes, and drops out of every lookup in the platform.`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }
    systems.setStatus(id, next);
    draw();
    toast(`${s.name} ${next === 'Active' ? 'activated' : 'deactivated'}`, 'success');
  }

  // --- events ---------------------------------------------------------------

  // Scoped to the banner and the tab strip: each tab owns the clicks inside
  // the panel.
  mount.addEventListener('click', (e) => {
    const tab = e.target.closest('#cs-tabs [data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      draw();
      return;
    }
    const act = e.target.closest('#cs-actions [data-act]')?.dataset.act;
    if (act === 'edit') return void edit();
    if (act === 'toggle') return void toggle();
  });

  ctx.onData(draw);
  draw();
}
