// The Rules tab of the contract page: every rule in priority order, the
// evaluation setting that decides whether the first match wins or all of them
// apply, and the conflict banner. The wizard is a page of its own, so the tab's
// Edit and New rule are links rather than modals.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as drawer from '../../../../shared/drawer.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { dateTime, esc } from '../../../../shared/format.js';

const SUMMARY_MAX = 90;

/** render(host, { contractId, readOnly, refresh }) */
export async function render(host, { contractId, readOnly }) {
  const res = await fetch(new URL('./tab-rules.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tab-rules.html (${res.status})`);
  host.innerHTML = await res.text();

  const $ = (sel) => host.querySelector(sel);
  const contract = () => contracts.get(contractId);
  const state = { conflictsOpen: false };
  const rulesPath = `#/pactum/contracts/${contractId}/rules`;

  const rows = () => contracts
    .rules(contract())
    .slice()
    .sort((a, b) => (a.priority - b.priority) || String(a.id).localeCompare(String(b.id)));

  function draw() {
    const c = contract();
    const list = rows();
    const active = contracts.activeRuleCount(c);

    $('#tr-evaluation').innerHTML = contracts.RULE_EVALUATIONS.map((e) => `
      <button type="button" data-evaluation="${esc(e.key)}" ${readOnly ? 'disabled' : ''}
              aria-pressed="${e.key === contracts.ruleEvaluation(c)}" title="${esc(e.hint)}">${esc(e.label)}</button>`).join('');
    $('#tr-evaluation-hint').textContent =
      contracts.RULE_EVALUATIONS.find((e) => e.key === contracts.ruleEvaluation(c))?.hint || '';
    $('#tr-count').textContent = `${list.length} rule${list.length === 1 ? '' : 's'} · ${active} active`;
    $('#tr-actions').innerHTML = readOnly
      ? ''
      : `<a class="btn btn--primary btn--sm" href="${rulesPath}/new">
           <span class="icon icon--sm">add</span>New rule
         </a>`;
    $('#tr-conflicts').innerHTML = conflictsHtml(c);
    $('#tr-rows').innerHTML = list.map((rule) => rowHtml(c, rule)).join('');
    $('#tr-table').hidden = list.length === 0;
    $('#tr-empty').hidden = list.length > 0;
    if (!list.length) $('#tr-empty').innerHTML = emptyHtml();
    $('#tr-hint').textContent = readOnly
      ? `This contract is ${c.status.toLowerCase()}, so its rules are read-only.`
      : 'A rule runs on the charge its conditions match. Lower priority runs first.';
  }

  function conflictsHtml(c) {
    const clashes = contracts.ruleConflicts(c);
    if (!clashes.length) return '';
    return `
      <div class="alert alert--warning">
        <span class="icon">warning</span>
        <div>
          <div class="title">${clashes.length} conflict${clashes.length === 1 ? '' : 's'} between active rules</div>
          ${state.conflictsOpen
            ? clashes.map((k) => `${esc(k.a.name)} vs ${esc(k.b.name)} — both match ${esc(k.value)} with ${esc(k.reason)}.`).join('<br>')
            : 'Two rules can fire on the same charge and disagree about what happens.'}
          <br>
          <button class="btn btn--ghost btn--sm" data-act="toggle-conflicts">
            ${state.conflictsOpen ? 'Hide the list' : 'Show the list'}
          </button>
        </div>
      </div>`;
  }

  function rowHtml(c, rule) {
    const conditions = contracts.ruleConditionsText(c, rule);
    const short = conditions.length > SUMMARY_MAX ? `${conditions.slice(0, SUMMARY_MAX - 1)}…` : conditions;
    return `
      <tr data-id="${esc(rule.id)}">
        <td class="num t-mono-sm">${esc(rule.priority)}</td>
        <td>${esc(rule.name)}${rule.description ? `<br><span class="t-body-sm">${esc(rule.description)}</span>` : ''}</td>
        <td class="t-body-sm" title="${esc(conditions)}">${esc(short)}</td>
        <td class="t-mono-sm">${esc(contracts.ruleActionSummary(rule.action))}</td>
        <td><span class="badge${rule.status === 'Active' ? ' badge--success' : ''}"><span class="dot"></span>${esc(rule.status)}</span></td>
        <td>
          ${readOnly ? '' : `
          <a class="btn btn--ghost btn--icon btn--sm" href="${rulesPath}/${esc(rule.id)}" title="Edit this rule">
            <span class="icon icon--sm">edit</span>
          </a>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="toggle-status"
                  title="${rule.status === 'Active' ? 'Deactivate this rule' : 'Activate this rule'}">
            <span class="icon icon--sm">${rule.status === 'Active' ? 'pause_circle' : 'play_circle'}</span>
          </button>
          <button class="btn btn--ghost btn--icon btn--sm" data-act="duplicate" title="Duplicate this rule">
            <span class="icon icon--sm">content_copy</span>
          </button>`}
          <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
            <span class="icon icon--sm">history</span>
          </button>
        </td>
      </tr>`;
  }

  function emptyHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">rule</span></div>
        <div class="state-view__title">No rules yet</div>
        <p class="state-view__body">${readOnly
          ? 'This contract closed without any rules on file.'
          : 'A rule is the exception the rate card cannot express — a plan that pays differently, a stay that needs approval, a charge the payer will not take. Build one and test it against a claim before you save.'}</p>
        ${readOnly ? '' : `
        <div class="state-view__actions">
          <a class="btn btn--primary" href="${rulesPath}/new">New rule</a>
        </div>`}
      </div>`;
  }

  // --- actions --------------------------------------------------------------

  function toggleStatus(ruleId) {
    const rule = contracts.getRule(contract(), ruleId);
    if (!rule) return;
    const next = rule.status === 'Active' ? 'Inactive' : 'Active';
    contracts.setRuleStatus(contractId, ruleId, next);
    toast(`${rule.name} ${next === 'Active' ? 'activated' : 'deactivated'}`, 'success');
    draw();
  }

  async function duplicate(ruleId) {
    const rule = contracts.getRule(contract(), ruleId);
    if (!rule) return;
    const ok = await modal.confirm({
      title: 'Duplicate rule',
      body: `${rule.name} is copied as "${rule.name} (copy)" at priority ${(Number(rule.priority) || 0) + 1}, inactive, `
        + 'and opens in the wizard for you to change.',
      confirmLabel: 'Duplicate and edit',
      icon: 'content_copy',
    });
    if (!ok) return;
    const copy = contracts.duplicateRule(contractId, ruleId);
    toast(`${copy.name} created`, 'success');
    location.hash = `${rulesPath}/${copy.id}`;
  }

  function history(ruleId) {
    const c = contract();
    const rule = contracts.getRule(c, ruleId);
    if (!rule) return;
    const entries = contracts.ruleHistory(c, ruleId);
    drawer.open({
      title: `History — ${esc(rule.name)}`,
      sub: `${esc(c.contractNo)} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · append-only`,
      icon: 'history',
      body: entries.length
        ? `<ol class="journey">${entries.map((entry) => `
             <li class="journey__row">
               <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
               <span class="journey__action">${esc(entry.action)}</span>
               <span class="journey__actor">${esc(entry.user)}</span>
               <span class="journey__detail">${esc(String(entry.details).replace(/^v\d+ · /, ''))}</span>
             </li>`).join('')}</ol>`
        : `<div class="state-view">
             <div class="state-view__glyph"><span class="icon">history</span></div>
             <div class="state-view__title">Nothing recorded yet</div>
             <p class="state-view__body">This rule came with the contract. Every later edit is recorded here.</p>
           </div>`,
    });
  }

  // --- events ---------------------------------------------------------------

  host.addEventListener('click', (e) => {
    const evaluation = e.target.closest('[data-evaluation]');
    if (evaluation && !readOnly) {
      contracts.setRuleEvaluation(contractId, evaluation.dataset.evaluation);
      toast('Evaluation setting saved', 'success');
      return draw();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle-conflicts') {
      state.conflictsOpen = !state.conflictsOpen;
      return void ($('#tr-conflicts').innerHTML = conflictsHtml(contract()));
    }
    const id = e.target.closest('tr[data-id]')?.dataset.id;
    if (!act || !id) return;
    if (act === 'history') return history(id);
    if (readOnly) return;
    if (act === 'toggle-status') return toggleStatus(id);
    if (act === 'duplicate') return void duplicate(id);
  });

  draw();
}
