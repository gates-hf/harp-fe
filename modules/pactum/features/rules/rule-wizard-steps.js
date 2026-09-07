// The markup of the wizard's steps 1, 3 and 4. rule-wizard.js owns the draft
// and the events; step 2 is condition-builder.js and the simulation panel
// inside step 4 is rule-simulator.js. Same split as the bundle builder.

import * as contracts from '../../../../data/repositories/contracts.js';
import { esc } from '../../../../shared/format.js';
import { ACTION_TYPES } from '../../../../data/engines/rule-evaluator.js';
import { simulatorHtml } from './rule-simulator.js';

/** Co-pay takes one value, so only the two share types that need one appear. */
export const SHARE_TYPES = ['Co-pay %', 'Fixed Co-pay'];

export function stepDetails(draft) {
  return `
    <dl class="dl dl--narrow">
      <dt><label for="rw-name">Name *</label></dt>
      <dd><label class="field"><input id="rw-name" name="name" type="text" value="${esc(draft.name)}"
                 placeholder="What this rule is for"></label></dd>
      <dt><label for="rw-desc">Description</label></dt>
      <dd><label class="field field--area"><textarea id="rw-desc" name="description" rows="2"
                 placeholder="Why the payer asked for it">${esc(draft.description)}</textarea></label></dd>
      <dt><label for="rw-priority">Priority *</label></dt>
      <dd>
        <label class="field"><input id="rw-priority" name="priority" type="number" min="0" step="1"
               value="${esc(draft.priority)}"></label>
        <p class="t-body-sm">Lower runs first. Rules are spaced ${contracts.PRIORITY_STEP} apart, so there is
           room to slot one in between later.</p>
      </dd>
      <dt><label for="rw-status">Status *</label></dt>
      <dd>
        <label class="field">
          <select id="rw-status" name="status">
            ${contracts.RULE_STATUSES.map((s) => `<option value="${s}"${s === draft.status ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <p class="t-body-sm">An inactive rule is kept but never runs.</p>
      </dd>
    </dl>`;
}

export function stepAction(draft) {
  return `
    <p class="t-body-sm">One action per rule. It applies to the charge the conditions matched.</p>
    ${ACTION_TYPES.map((type) => `
      <div class="rule-child-row">
        <label class="toolbar">
          <input type="radio" name="actionType" value="${esc(type.key)}"${type.key === draft.action.type ? ' checked' : ''}>
          <span>${esc(type.key)}</span>
        </label>
        ${type.key === draft.action.type ? type.params.map((p) => paramHtml(p, draft)).join('') : ''}
      </div>`).join('')}`;
}

function paramHtml(param, draft) {
  const value = draft.action.params[param.name] ?? '';
  if (param.type === 'enum') {
    const options = param.optionsFrom === 'shareTypes' ? SHARE_TYPES : contracts.OVERAGE_ACTIONS;
    return `
      <label class="field">
        <select data-param="${esc(param.name)}" aria-label="${esc(param.label)}">
          <option value=""${value ? '' : ' selected'}>${esc(param.label)}…</option>
          ${options.map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
      </label>`;
  }
  const icon = param.type === 'percent' ? 'percent' : 'attach_money';
  return `
    <label class="field">
      <span class="icon icon--sm">${icon}</span>
      <input type="number" min="0" step="0.01" value="${esc(value)}" data-param="${esc(param.name)}"
             placeholder="${esc(param.label)}" aria-label="${esc(param.label)}">
    </label>`;
}

/** stepReview({ draft, contract, clashes, draftId, sim }) */
export function stepReview({ draft, contract, clashes, draftId, sim }) {
  const evaluation = contracts.RULE_EVALUATIONS.find((e) => e.key === contracts.ruleEvaluation(contract));
  const other = (clash) => (clash.a.id === draftId ? clash.b : clash.a);
  return `
    <div class="alert alert--info">
      <span class="icon">rule</span>
      <div>
        <div class="title">${esc(draft.name || 'This rule')}</div>
        ${esc(contracts.ruleSummary(contract, draft))}
      </div>
    </div>
    ${draft.description ? `<p class="t-body-sm">${esc(draft.description)}</p>` : ''}

    <dl class="dl dl--narrow">
      <dt>Priority</dt><dd class="t-mono-sm">${esc(draft.priority)}</dd>
      <dt>Status</dt>
      <dd><span class="badge${draft.status === 'Active' ? ' badge--success' : ''}"><span class="dot"></span>${esc(draft.status)}</span></dd>
      <dt>Evaluation</dt>
      <dd>${esc(evaluation?.label || '')} <span class="t-body-sm">— ${esc(evaluation?.hint || '')} Set on the Rules tab.</span></dd>
    </dl>

    ${clashes.length ? `
      <div class="alert alert--warning">
        <span class="icon">warning</span>
        <div>
          <div class="title">${clashes.length} possible conflict${clashes.length === 1 ? '' : 's'}</div>
          ${clashes.map((k) => `${esc(other(k).name)} — both match ${esc(k.value)} with ${esc(k.reason)}.`).join('<br>')}
          <br>You can still save: the evaluation setting decides which one wins.
        </div>
      </div>`
    : `
      <div class="alert alert--success">
        <span class="icon">check_circle</span>
        <div>No conflict with the other active rules on this contract.</div>
      </div>`}

    ${simulatorHtml({ rule: draft, contract, values: sim.values, more: sim.more, result: sim.result })}`;
}
