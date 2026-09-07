// Rule wizard — details, conditions, action, review and test. Reached at
// #/pactum/contracts/<id>/rules/new and /rules/<ruleId>; contracts-global.js
// hands the mount over. Nothing is written until Save on the last step.
//
// This file owns the draft, the steps and the save. The step markup is
// rule-wizard-steps.js, the condition tree condition-builder.js and the
// simulation panel rule-simulator.js.

import * as contracts from '../../../../data/repositories/contracts.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import * as builder from './condition-builder.js';
import * as simulator from './rule-simulator.js';
import * as steps from './rule-wizard-steps.js';
import { ACTION_TYPES, isGroup } from '../../../../data/engines/rule-evaluator.js';
import { byKey, fullLabel } from '../../../../data/engines/rule-attributes.js';

export const meta = { title: 'Rule' };

const STEPS = [
  { title: 'Details', hint: 'What the rule is called, and when it runs.' },
  { title: 'Conditions', hint: 'The claim this rule is looking for.' },
  { title: 'Action', hint: 'What happens when it fires.' },
  { title: 'Review & test', hint: 'Read it back, then try it on a claim.' },
];

const LAST = STEPS.length - 1;

export async function render(mount, ctx) {
  const contract = contracts.get(ctx.params[0]);
  if (!contract) throw new Error(`No contract ${ctx.params[0]}`);
  const param = ctx.params[2];
  const editing = param === 'new' ? null : contracts.getRule(contract, param);
  if (param !== 'new' && !editing) throw new Error(`No rule ${param} on ${contract.contractNo}`);

  const rulesPath = `/pactum/contracts/${contract.id}/rules`;
  if (contracts.rulesReadOnly(contract)) {
    toast(`This contract is ${contract.status.toLowerCase()}, so its rules are read-only`, 'warning');
    return void ctx.navigate(rulesPath);
  }

  const res = await fetch(new URL('./rule-wizard.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load rule-wizard.html (${res.status})`);
  mount.innerHTML = await res.text();

  const draft = {
    id: editing?.id || null,
    name: editing?.name || '',
    description: editing?.description || '',
    priority: String(editing?.priority ?? contracts.nextRulePriority(contract)),
    status: editing?.status || 'Active',
    conditions: structuredClone(editing?.conditions || { op: 'AND', items: [builder.blankCondition()] }),
    action: { type: editing?.action?.type || 'Not Billable', params: { ...(editing?.action?.params || {}) } },
  };
  const draftId = draft.id || 'draft';
  const state = { step: 0, sim: { values: {}, more: false, result: null } };
  const $ = (sel) => mount.querySelector(sel);

  ctx.setHeader(editing ? `Rule — ${editing.name}` : 'New rule');
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'Contracts', path: '/pactum/contracts' },
    { label: `${contract.contractNo} v${contract.version}`, path: rulesPath },
    { label: editing ? editing.name : 'New rule' },
  ]);
  $('#rw-back-link').href = `#${rulesPath}`;

  // --- steps ----------------------------------------------------------------

  function draw() {
    $('#rw-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#rw-title').textContent = STEPS[state.step].title;
    $('#rw-hint').textContent = STEPS[state.step].hint;
    $('#rw-body').innerHTML = bodyHtml();
    $('#rw-next').innerHTML = state.step === LAST
      ? `<span class="icon icon--sm">save</span>${editing ? 'Save rule' : 'Create rule'}`
      : 'Next<span class="icon icon--sm">chevron_right</span>';
    $('#rw-back').disabled = state.step === 0;
    $('#rw-back').title = state.step === 0 ? 'You are on the first step' : '';
    clearError();
    drawSummary();
  }

  function bodyHtml() {
    if (state.step === 0) return steps.stepDetails(draft);
    if (state.step === 1) return builder.builderHtml(draft.conditions, contract);
    if (state.step === 2) return steps.stepAction(draft);
    return steps.stepReview({ draft, contract, clashes: conflictsAgainstDraft(), draftId, sim: state.sim });
  }

  function stepHtml(step, i) {
    const cls = i === state.step ? ' stepper__step--current' : i < state.step ? ' stepper__step--done' : '';
    return `
      <button class="stepper__step${cls}" data-step="${i}" ${i > state.step ? 'aria-disabled="true"' : ''}
              title="${i > state.step ? 'Finish the current step first' : esc(step.title)}">
        <span class="stepper__n">${i < state.step ? '<span class="icon icon--sm">check</span>' : i + 1}</span>
        <span class="stepper__label">${esc(step.title)}</span>
      </button>`;
  }

  /** The sentence follows the draft while it is being built. */
  function drawSummary() {
    $('#rw-summary').innerHTML = state.step === 0 || state.step === LAST
      ? ''
      : `<span class="t-body-sm">${esc(contracts.ruleSummary(contract, draft))}</span>`;
  }

  function drawConditions() {
    $('#rw-body').innerHTML = builder.builderHtml(draft.conditions, contract);
    drawSummary();
  }

  /** The conflicts this draft brings, read off a copy that already holds it. */
  function conflictsAgainstDraft() {
    const others = contracts.rules(contract).filter((r) => r.id !== draft.id);
    const preview = { ...contract, rules: [...others, { ...draft, id: draftId }] };
    return contracts.ruleConflicts(preview).filter((c) => c.a.id === draftId || c.b.id === draftId);
  }

  // --- validation and save --------------------------------------------------

  function showError(message) {
    const box = $('#rw-error');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  function clearError() {
    const box = $('#rw-error');
    box.hidden = true;
    box.textContent = '';
  }

  function detailsError() {
    if (draft.name.trim().length < 3) return 'Give the rule a name of at least three characters.';
    const priority = Number(draft.priority);
    if (!Number.isInteger(priority) || priority < 0) return 'Priority is a whole number, zero or more.';
    return '';
  }

  function conditionsError() {
    const flat = [];
    let empty = false;
    const walk = (group) => {
      if (!group.items?.length) empty = true;
      for (const item of group.items || []) {
        if (isGroup(item)) walk(item);
        else flat.push(item);
      }
    };
    walk(draft.conditions);
    if (empty) return 'A group with no conditions never matches. Fill it in, or remove the group.';
    for (const cond of flat) {
      if (!cond.attr) return 'Every condition needs an attribute.';
      if (isBlank(cond.value)) return `The condition on ${fullLabel(byKey(cond.attr))} needs a value.`;
    }
    return '';
  }

  function actionError() {
    const { type, params } = draft.action;
    if (!type) return 'Choose what the rule does.';
    if (type === '% Discount' && !(Number(params.percent) > 0 && Number(params.percent) <= 100)) {
      return 'Enter a discount above zero and no more than 100.';
    }
    if ((type === 'Fixed Rate' || type === 'Ceiling') && !(Number(params.amount) > 0)) {
      return `Enter ${type === 'Ceiling' ? 'a ceiling' : 'a rate'} above zero.`;
    }
    if (type === 'Co-pay') {
      if (!params.shareType) return 'Choose the share type for the co-pay.';
      if (!(Number(params.value) > 0)) return 'Enter a co-pay value above zero.';
    }
    if (type === 'Override Overage Action' && !params.action) return 'Choose the overage action this rule forces.';
    return '';
  }

  const errorFor = (step) =>
    (step === 0 ? detailsError() : step === 1 ? conditionsError() : step === 2 ? actionError() : '');

  function save() {
    for (const step of [0, 1, 2]) {
      const problem = errorFor(step);
      if (!problem) continue;
      state.step = step;
      draw();
      return showError(problem);
    }
    const saved = contracts.saveRule(contract.id, {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      priority: Number(draft.priority),
      status: draft.status,
      conditions: draft.conditions,
      action: cleanAction(draft.action),
    });
    toast(`${saved.name} ${draft.id ? 'saved' : 'created'}`, 'success');
    ctx.navigate(rulesPath);
  }

  // --- events ---------------------------------------------------------------

  /** Fields the wizard itself owns; the tree and the simulator have their own. */
  function assign(e) {
    const field = e.target.closest('[name]');
    if (field && field.name in draft) {
      draft[field.name] = field.value;
      return true;
    }
    const param = e.target.closest('[data-param]');
    if (param) {
      draft.action.params[param.dataset.param] = param.value;
      return true;
    }
    const sim = e.target.closest('[data-sim-field]');
    if (sim) {
      state.sim.values[sim.dataset.simField] = sim.value;
      return true;
    }
    return false;
  }

  function editTree(e) {
    if (!e.target.closest('[data-path]')) return;
    if (builder.handleEvent(e, draft.conditions) === true) drawConditions();
    else drawSummary();
  }

  mount.addEventListener('input', (e) => {
    if (assign(e)) return;
    editTree(e);
  });

  mount.addEventListener('change', (e) => {
    const type = e.target.closest('[name="actionType"]');
    if (type) {
      draft.action = { type: type.value, params: {} };
      return draw();
    }
    if (assign(e)) return;
    editTree(e);
  });

  mount.addEventListener('click', (e) => {
    const sim = e.target.closest('[data-sim]')?.dataset.sim;
    if (sim === 'more') {
      state.sim.more = !state.sim.more;
      return draw();
    }
    if (sim === 'example') {
      state.sim.values = simulator.exampleValues(draft, contract);
      state.sim.result = simulator.run({ rule: { ...draft, id: draftId }, contract, values: state.sim.values });
      return draw();
    }
    if (sim === 'run') {
      state.sim.result = simulator.run({ rule: { ...draft, id: draftId }, contract, values: state.sim.values });
      $('#rw-sim-out').innerHTML = simulator.resultHtml(state.sim.result);
      return;
    }

    if (state.step === 1 && e.target.closest('[data-path]')) {
      if (builder.handleEvent(e, draft.conditions)) drawConditions();
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step) {
      state.step = Number(step.dataset.step);
      return draw();
    }
    if (e.target.closest('#rw-back') && state.step > 0) {
      state.step -= 1;
      return draw();
    }
    if (!e.target.closest('#rw-next')) return;
    if (state.step === LAST) return save();

    const problem = errorFor(state.step);
    if (problem) return showError(problem);
    state.step += 1;
    draw();
  });

  draw();
}

// --- helpers -------------------------------------------------------------------

function isBlank(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') {
    return [value.from, value.to].some((v) => v === '' || v == null);
  }
  return String(value ?? '') === '';
}

/** Only the parameters the chosen action uses, as numbers where they are. */
function cleanAction(action) {
  const spec = ACTION_TYPES.find((a) => a.key === action.type);
  const params = {};
  for (const param of spec?.params || []) {
    const value = action.params[param.name];
    params[param.name] = param.type === 'enum' ? (value || '') : Math.round((Number(value) || 0) * 100) / 100;
  }
  return { type: action.type, params };
}
