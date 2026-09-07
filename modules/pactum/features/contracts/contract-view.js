// The contract page, at #/pactum/contracts/<id>. One version at a time, with a
// switcher for the rest of the lineage.
//
// General and History are built here and Methodologies, Overage, Coverage and
// Pre-Auth render themselves into a node of their own; Rules is the
// configuration a later amendment fills in, so it renders a placeholder that
// already counts what the contract holds.

import * as contracts from '../../../../data/repositories/contracts.js';
import { date, dateTime, esc, fileSize } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { openContractForm } from './contract-form.js';
import { askActivate, chooseEditType, askTerminate, askDeleteDraft } from './contract-actions.js';
import { historyHtml } from './contract-history.js';
import * as tabMethodologies from './tab-methodologies.js';
import * as tabOverage from './tab-overage.js';
import * as tabCoverage from './tab-coverage.js';
import * as tabPreauth from './tab-preauth.js';

const TAB_FEATURES = {
  methodologies: tabMethodologies, overage: tabOverage, coverage: tabCoverage, preauth: tabPreauth,
};

export const meta = { title: 'Contract' };

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'methodologies', label: 'Methodologies', field: 'methodologies' },
  { id: 'overage', label: 'Overage', field: 'overagePolicies' },
  { id: 'coverage', label: 'Coverage', field: 'coverage' },
  { id: 'preauth', label: 'Pre-Auth', field: 'preAuth' },
  { id: 'rules', label: 'Rules', field: 'rules' },
  { id: 'history', label: 'History' },
];

export async function render(mount, ctx) {
  const id = ctx.params[0];
  if (!contracts.get(id)) throw new Error(`No contract ${id}`);

  const res = await fetch(new URL('./contract-view.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load contract-view.html (${res.status})`);
  mount.innerHTML = await res.text();

  const state = { tab: 'general', filter: 'all' };
  const $ = (sel) => mount.querySelector(sel);
  const contract = () => contracts.get(id);

  function draw() {
    const c = contract();
    if (!c) return;
    const readOnly = c.status === 'Expired' || c.status === 'Terminated';

    ctx.setHeader(`${c.contractNo} — ${c.name}`);
    ctx.setCrumb([
      { label: 'Pactum', path: '/pactum/payers' },
      { label: 'Contracts', path: '/pactum/contracts' },
      { label: `${c.contractNo} v${c.version}` },
    ]);

    $('#cv-name').textContent = c.name;
    $('#cv-meta').innerHTML = metaHtml(c);
    $('#cv-actions').innerHTML = actionsHtml(c, readOnly);
    $('#cv-lock').innerHTML = readOnly ? lockHtml(c) : '';
    $('#cv-tabs').innerHTML = TABS.map(
      (t) => `<button class="sections__tab${t.id === state.tab ? ' is-active' : ''}" role="tab"
                      aria-selected="${t.id === state.tab}" data-tab="${t.id}">${t.label}</button>`).join('');
    $('#cv-panel').innerHTML = panelHtml(c);
    drawTabFeature(c, readOnly);
  }

  /**
   * A tab that owns its own screen gets a fresh node to render into, so the
   * listeners it binds retire when the panel is drawn again — the shell's rule
   * for the page body, one level down.
   */
  function drawTabFeature(c, readOnly) {
    const feature = TAB_FEATURES[state.tab];
    if (!feature) return;
    const box = document.createElement('div');
    $('#cv-panel').replaceChildren(box);
    void feature.render(box, { contractId: c.id, readOnly, refresh: draw });
  }

  function metaHtml(c) {
    const tone = contracts.statusTone(c.status);
    const versions = contracts.versionsOf(c.lineageId);
    const days = contracts.daysLeft(c);
    return `
      <span class="badge badge--accent">v${c.version}</span>
      <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${c.status}</span>
      <span class="t-mono-sm">${esc(c.contractNo)}</span>
      <span>·</span>
      <a class="crumb-link" href="#/pactum/payers/${esc(c.payerId)}/contracts">${esc(contracts.payerName(c))}</a>
      <span>·</span>
      <span class="t-mono-sm">${date(c.startDate)} – ${date(c.endDate)}</span>
      ${c.status === 'Active' && days != null && days >= 0 && days <= 90
        ? `<span class="badge badge--warning"><span class="dot"></span>expires in ${days} day${days === 1 ? '' : 's'}</span>`
        : ''}
      ${versions.length > 1
        ? `<label class="field">
             <span class="icon icon--sm">history_toggle_off</span>
             <select id="cv-version" aria-label="Version">
               ${versions.map((v) => `<option value="${v.id}"${v.id === c.id ? ' selected' : ''}>Version ${v.version} — ${v.status}</option>`).join('')}
             </select>
           </label>`
        : ''}`;
  }

  function actionsHtml(c, readOnly) {
    // The report reads whichever version is on screen, closed ones included.
    const report = `<a class="btn btn--secondary btn--sm" href="#/pactum/contracts/${esc(c.id)}/fee-report">
                      <span class="icon icon--sm">table_view</span>Fee schedule report
                    </a>`;
    if (readOnly) {
      return `${report}
              <a class="btn btn--secondary btn--sm" href="#/pactum/payers/${esc(c.payerId)}/contracts">
                <span class="icon icon--sm">arrow_back</span>Back to payer contracts
              </a>`;
    }
    if (c.status === 'Draft') {
      return `
        ${report}
        <button class="btn btn--secondary btn--sm" data-act="edit"><span class="icon icon--sm">edit</span>Edit</button>
        <button class="btn btn--primary btn--sm" data-act="activate"><span class="icon icon--sm">play_circle</span>Activate</button>
        <button class="btn btn--danger btn--sm" data-act="delete"><span class="icon icon--sm">delete</span>Delete draft</button>`;
    }
    return `
      ${report}
      <button class="btn btn--secondary btn--sm" data-act="edit"><span class="icon icon--sm">edit</span>Edit</button>
      <button class="btn btn--danger btn--sm" data-act="terminate"><span class="icon icon--sm">block</span>Terminate</button>`;
  }

  function lockHtml(c) {
    const why = c.status === 'Terminated'
      ? `Terminated ${date(c.terminationDate)} — ${esc(c.terminationReason)}`
      : `Closed ${date(c.closedAt || c.endDate)}. A later version may have replaced it.`;
    return `
      <div class="perm-banner">
        <span class="icon">lock</span>
        <div>This contract is ${c.status.toLowerCase()} and read-only. ${why}</div>
      </div>`;
  }

  function panelHtml(c) {
    if (state.tab === 'history') return historyHtml(c, state.filter);
    if (state.tab === 'general') return generalHtml(c);
    if (TAB_FEATURES[state.tab]) return ''; // drawTabFeature takes it from here
    const tab = TABS.find((t) => t.id === state.tab);
    const held = c[tab.field];
    const count = Array.isArray(held) ? held.length : Object.keys(held || {}).length;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">construction</span></div>
        <div class="state-view__title">${tab.label} — configured in a later amendment</div>
        <p class="state-view__body">This contract holds ${count} ${tab.label.toLowerCase()} ${count === 1 ? 'entry' : 'entries'} today.
           The screen that edits them lands with part B of contract management.</p>
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  async function edit() {
    const c = contract();
    if (c.status === 'Draft') {
      const saved = await openContractForm({ payerId: c.payerId, contractId: c.id });
      draw();
      if (saved) toast(`${saved.contractNo} saved`, 'success');
      return;
    }
    const outcome = await chooseEditType(c, { navigate: ctx.navigate });
    if (outcome && outcome !== 'corrective') return; // a change edit navigates away
    draw();
  }

  async function activate() {
    if (await askActivate(contract())) draw();
  }

  async function terminate() {
    if (await askTerminate(contract())) draw();
  }

  async function remove() {
    const c = contract();
    if (await askDeleteDraft(c)) ctx.navigate(`/pactum/payers/${c.payerId}/contracts`);
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('change', (e) => {
    if (e.target.id === 'cv-version') ctx.navigate(`/pactum/contracts/${e.target.value}`);
  });

  mount.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      state.filter = 'all';
      draw();
      return;
    }

    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.filter = chip.dataset.filter;
      $('#cv-panel').innerHTML = panelHtml(contract());
      return;
    }

    const version = e.target.closest('[data-version]');
    if (version) return ctx.navigate(`/pactum/contracts/${version.dataset.version}`);

    // Scoped to the banner: a tab renders its own [data-act] buttons inside
    // the panel, and those belong to the tab, not to the contract.
    const act = e.target.closest('#cv-actions [data-act]')?.dataset.act;
    if (act === 'edit') return void edit();
    if (act === 'activate') return void activate();
    if (act === 'terminate') return void terminate();
    if (act === 'delete') return void remove();
  });

  mount.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-version]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(`/pactum/contracts/${row.dataset.version}`);
    }
  });

  draw();
}

// --- general tab ---------------------------------------------------------------

function generalHtml(c) {
  const plans = contracts.plansOf(c);
  return `
    <dl class="dl">
      <dt>Payer</dt>
      <dd><a class="crumb-link" href="#/pactum/payers/${esc(c.payerId)}/contracts">${esc(contracts.payerName(c))}</a>
          — ${esc(contracts.payerOf(c)?.type || '')}</dd>
      <dt>Contract no.</dt><dd class="t-mono-sm">${esc(c.contractNo)}</dd>
      <dt>Version</dt><dd>${c.version} of ${contracts.versionsOf(c.lineageId).length}</dd>
      <dt>Term</dt><dd class="t-mono-sm">${date(c.startDate)} – ${date(c.endDate)}</dd>
      <dt>Active from</dt><dd class="t-mono-sm">${date(c.effectiveDate)}</dd>
      ${c.closedAt ? `<dt>Closed</dt><dd class="t-mono-sm">${date(c.closedAt)}</dd>` : ''}
      ${c.terminationDate
        ? `<dt>Terminated</dt><dd class="t-mono-sm">${date(c.terminationDate)}</dd>
           <dt>Reason</dt><dd>${esc(c.terminationReason)}</dd>`
        : ''}
      <dt>Created</dt><dd>${esc(c.createdBy)} · <span class="t-mono-sm">${dateTime(c.createdAt)}</span></dd>
      <dt>Last updated</dt><dd class="t-mono-sm">${dateTime(c.updatedAt)}</dd>
    </dl>

    <div class="toolbar">
      <span class="t-title-sm">Linked plans</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${plans.length} plan${plans.length === 1 ? '' : 's'} billed under this contract</span>
    </div>
    <table class="tbl">
      <thead><tr><th>Plan</th><th>Code</th><th>Status</th></tr></thead>
      <tbody>
        ${plans.map((p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td class="t-mono-sm">${esc(p.code)}</td>
            <td><span class="badge${p.status === 'Active' ? ' badge--success' : ''}"><span class="dot"></span>${esc(p.status)}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>

    <div class="toolbar">
      <span class="t-title-sm">Signed document</span>
    </div>
    ${c.document
      ? `<div class="rule-child-row">
           <span class="icon">description</span>
           <span>${esc(c.document.fileName)}</span>
           <span class="t-mono-sm">${fileSize(c.document.size)}</span>
           <span class="t-body-sm">attached ${esc(date(c.document.uploadedAt))}</span>
         </div>`
      : '<p class="t-body-sm">No document attached. Edit the contract to attach the signed copy.</p>'}`;
}
