// The Versions tab of the code system page: every release with its term, its
// code count and whether it is the one a dated lookup resolves on. Set as
// current is the atomic swap the repository owns; the button carries the
// repository's own refusal in its tooltip, so a disabled control and a refused
// call say the same sentence.

import * as versions from '../../../../data/repositories/code-system-versions.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { confirm } from '../../../../shared/modal.js';
import { openVersionForm } from './version-form.js';

/** render(host, { systemId, state, refresh, navigate }) */
export function render(host, { systemId, state, refresh, navigate }) {
  function draw() {
    const rows = versions.bySystem(systemId);
    host.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">Versions</span>
        <span class="t-body-sm">Terms never overlap; at most one version is current.</span>
        <span class="spacer"></span>
        <button class="btn btn--primary btn--sm" data-act="add"><span class="icon icon--sm">add</span>Add version</button>
      </div>
      ${rows.length ? tableHtml(rows) : emptyHtml()}`;
  }

  function tableHtml(rows) {
    return `
      <table class="tbl">
        <thead>
          <tr><th>Version</th><th>Release date</th><th>Valid from</th><th>Valid to</th><th>Codes</th><th>Status</th><th>Current</th><th>Last updated</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>
      </table>`;
  }

  function rowHtml(v) {
    const c = codes.counts(v.id);
    const active = v.status === 'Active';
    const why = versions.setCurrentBlocked(v);
    return `
      <tr data-id="${v.id}">
        <td class="t-mono-sm">${esc(v.versionLabel)}</td>
        <td class="t-mono-sm">${date(v.releaseDate)}</td>
        <td class="t-mono-sm">${date(v.validFrom)}</td>
        <td class="t-mono-sm">${v.validTo ? date(v.validTo) : 'open'}</td>
        <td><a class="crumb-link" href="#/pactum/standard-codes/${esc(v.codeSystemId)}/codes?version=${esc(v.id)}" title="Open the codes of ${esc(v.versionLabel)}">${c.active}${c.inactive ? ` <span class="t-body-sm">(+${c.inactive} inactive)</span>` : ''}</a></td>
        <td><span class="badge${active ? ' badge--success' : ''}"><span class="dot"></span>${v.status}</span></td>
        <td>${v.isCurrent ? '<span class="badge badge--accent"><span class="icon icon--sm">check</span>current</span>' : '<span class="t-body-sm">—</span>'}</td>
        <td class="t-mono-sm">${dateTime(v.updatedAt)}</td>
        <td>
          <button class="btn btn--secondary btn--sm" data-act="current" ${why ? `disabled title="${esc(why)}"` : `title="Make ${esc(v.versionLabel)} the version lookups with no date read"`}>
            <span class="icon icon--sm">flag</span>Set as current
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="edit" title="Edit version ${esc(v.versionLabel)}">
            <span class="icon icon--sm">edit</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle" title="${active ? 'Deactivate' : 'Activate'} version ${esc(v.versionLabel)}">
            <span class="icon icon--sm">${active ? 'toggle_on' : 'toggle_off'}</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">layers</span></div>
        <div class="state-view__title">No versions yet</div>
        <p class="state-view__body">Add the first release; its codes are entered by hand or imported on the Codes tab.</p>
        <div class="state-view__actions"><button class="btn btn--primary" data-act="add">Add version</button></div>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function add() {
    const result = await openVersionForm(systemId, null);
    if (!result) return;
    // Open the new release's codes straight away: the next thing to do is fill it.
    state.versionId = result.row.id;
    state.tab = 'codes';
    refresh();
    toast(result.copied ? `Version ${result.row.versionLabel} added with ${result.copied} codes copied` : `Version ${result.row.versionLabel} added`, 'success');
  }

  async function edit(id) {
    const result = await openVersionForm(systemId, id);
    if (!result) return;
    refresh();
    toast(`Version ${result.row.versionLabel} saved`, 'success');
  }

  async function makeCurrent(id) {
    const v = versions.get(id);
    const previous = versions.currentOf(systemId);
    const ok = await confirm({
      title: 'Set as current',
      body: previous
        ? `Version ${v.versionLabel} becomes the one lookups with no date read, and ${previous.versionLabel} stops being current. Both moves are recorded.`
        : `Version ${v.versionLabel} becomes the one lookups with no date read.`,
      confirmLabel: 'Set as current',
      tone: '',
      icon: 'flag',
    });
    if (!ok) return;
    const result = versions.setCurrent(id);
    if (result.error) return toast(result.error, 'warning');
    refresh();
    toast(`Version ${v.versionLabel} is current`, 'success');
  }

  async function toggle(id) {
    const v = versions.get(id);
    const next = v.status === 'Active' ? 'Inactive' : 'Active';
    if (next === 'Inactive') {
      const ok = await confirm({
        title: 'Deactivate version',
        body: v.isCurrent
          ? `Version ${v.versionLabel} is current. Deactivating it leaves the system with no current version: lookups fall back to the newest active version and warn, or find nothing.`
          : `Version ${v.versionLabel} stays on file with its codes and is no longer resolved on.`,
        confirmLabel: 'Deactivate',
        icon: 'toggle_off',
      });
      if (!ok) return;
    }
    versions.setStatus(id, next);
    refresh();
    toast(`Version ${v.versionLabel} ${next === 'Active' ? 'activated' : 'deactivated'}`, 'success');
  }

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add') return void add();
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (!id) return;
    if (act === 'current') return void makeCurrent(id);
    if (act === 'edit') return void edit(id);
    if (act === 'toggle') return void toggle(id);
  });

  draw();
}
