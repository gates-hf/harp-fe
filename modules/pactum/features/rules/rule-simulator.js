// Step 4's simulation panel: a made-up claim run through the rule being edited
// and then through the whole contract. It reads and computes, and never writes
// — the contract it evaluates is a throwaway copy carrying the draft rule in
// place of its saved version.

import * as contracts from '../../../../data/repositories/contracts.js';
import { esc } from '../../../../shared/format.js';
import * as attrs from '../../../../data/engines/rule-attributes.js';
import { optionsFor } from './condition-builder.js';
import { evalGroup, evaluate, isGroup, actionSummary } from '../../../../data/engines/rule-evaluator.js';

/** Every attribute the rule mentions, in catalog order. */
export function referencedAttrs(rule) {
  const keys = new Set();
  const walk = (group) => {
    for (const item of group?.items || []) {
      if (isGroup(item)) walk(item);
      else if (item?.attr) keys.add(item.attr);
    }
  };
  walk(rule?.conditions);
  return attrs.ATTRIBUTES.filter((a) => keys.has(a.key));
}

/** Only the values actually filled in — a blank attribute stays unknown. */
export function contextOf(values) {
  const ctx = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (value === '' || value == null) continue;
    const attr = attrs.byKey(key);
    if (attr?.type === 'number') ctx[key] = Number(value);
    else if (attr?.type === 'bool') ctx[key] = value === true || value === 'true';
    else ctx[key] = value;
  }
  return ctx;
}

/** A claim that makes this rule fire, as far as its conditions can be met. */
export function exampleValues(rule, contract) {
  const values = {};
  const walk = (group) => {
    for (const item of group?.items || []) {
      if (isGroup(item)) walk(item);
      else fill(values, item, contract);
    }
  };
  walk(rule?.conditions);
  return values;
}

function fill(values, cond, contract) {
  const attr = attrs.byKey(cond.attr);
  if (!attr) return;
  const options = () => optionsFor(attr, contract).map((o) => String(o.value));
  const bump = (v, by) => {
    if (attr.type === 'date') return shiftDate(v, by);
    return String((Number(v) || 0) + by);
  };
  const first = (list) => (Array.isArray(list) && list.length ? String(list[0]) : '');

  if (cond.operator === 'eq' || cond.operator === 'contains') values[attr.key] = String(cond.value ?? '');
  else if (cond.operator === 'gt') values[attr.key] = bump(cond.value, 1);
  else if (cond.operator === 'gte') values[attr.key] = String(cond.value ?? '');
  else if (cond.operator === 'lt') values[attr.key] = bump(cond.value, -1);
  else if (cond.operator === 'lte') values[attr.key] = String(cond.value ?? '');
  else if (cond.operator === 'between') values[attr.key] = String(cond.value?.from ?? '');
  else if (cond.operator === 'in') values[attr.key] = first(cond.value);
  else if (cond.operator === 'ne' || cond.operator === 'not_in') {
    const barred = new Set((cond.operator === 'ne' ? [cond.value] : cond.value || []).map(String));
    const free = options().find((v) => !barred.has(v));
    values[attr.key] = free ?? (attr.type === 'number' ? String((Number(cond.value) || 0) + 1) : 'Anything else');
  }
  if (attr.type === 'bool') values[attr.key] = cond.value === true || cond.value === 'true' ? 'true' : 'false';
}

function shiftDate(iso, days) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return String(iso ?? '');
  return new Date(at + days * 86400000).toISOString().slice(0, 10);
}

// --- markup ------------------------------------------------------------------

/** simulatorHtml({ rule, contract, values, more, result }) */
export function simulatorHtml({ rule, contract, values, more, result }) {
  const referenced = referencedAttrs(rule);
  const keys = new Set(referenced.map((a) => a.key));
  const rest = attrs.ATTRIBUTES.filter((a) => !keys.has(a.key));
  return `
    <div class="panel panel--sunken">
      <div class="panel-header">
        <span class="t-title-sm">Simulation</span>
        <span class="spacer"></span>
        <span class="t-body-sm">Nothing here is saved.</span>
        <button class="btn btn--secondary btn--sm" data-sim="example">
          <span class="icon icon--sm">bolt</span>Load example
        </button>
        <button class="btn btn--primary btn--sm" data-sim="run">
          <span class="icon icon--sm">play_arrow</span>Run
        </button>
      </div>
      <div class="panel-body">
        <p class="t-body-sm">${referenced.length
          ? 'The attributes this rule tests. Leave one empty and the claim does not carry it, so the condition on it cannot match.'
          : 'This rule has no conditions yet, so there is nothing to fill in.'}</p>
        <dl class="dl dl--narrow">${referenced.map((a) => fieldHtml(a, values, contract)).join('')}</dl>

        <div class="toolbar">
          <button class="btn btn--ghost btn--sm" data-sim="more">
            <span class="icon icon--sm">${more ? 'expand_less' : 'expand_more'}</span>
            ${more ? 'Hide the other attributes' : `More attributes… (${rest.length})`}
          </button>
        </div>
        ${more ? `<dl class="dl dl--narrow">${rest.map((a) => fieldHtml(a, values, contract)).join('')}</dl>` : ''}

        <div id="rw-sim-out">${result ? resultHtml(result) : '<p class="t-body-sm">Run the claim to see which rules fire.</p>'}</div>
      </div>
    </div>`;
}

function fieldHtml(attr, values, contract) {
  const value = values?.[attr.key] ?? '';
  const control = attr.type === 'enum' || attr.type === 'bool'
    ? `<select data-sim-field="${esc(attr.key)}" aria-label="${esc(attrs.fullLabel(attr))}">
         <option value=""${value === '' ? ' selected' : ''}>Not on this claim</option>
         ${(attr.type === 'bool'
           ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
           : optionsFor(attr, contract))
           .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
       </select>`
    : `<input type="${attr.type === 'number' ? 'number' : attr.type === 'date' ? 'date' : 'text'}"
              ${attr.type === 'number' ? 'step="0.01"' : ''} value="${esc(value)}"
              data-sim-field="${esc(attr.key)}" placeholder="${esc(attr.placeholder || attr.unit || 'Not on this claim')}"
              aria-label="${esc(attrs.fullLabel(attr))}">`;
  return `
    <dt><label>${esc(attrs.fullLabel(attr))}</label></dt>
    <dd><label class="field">${attr.money ? '<span class="icon icon--sm">attach_money</span>' : ''}${control}</label></dd>`;
}

// --- running -----------------------------------------------------------------

/** run({ rule, contract, values }) -> the result the panel renders. */
export function run({ rule, contract, values }) {
  const ctx = contextOf(values);
  const fires = evalGroup(rule.conditions, ctx);

  // The contract as it would be with this draft in place: never stored.
  const others = contracts.rules(contract).filter((r) => r.id !== rule.id);
  const preview = { ...contract, rules: [...others, { ...rule, id: rule.id || 'draft' }] };
  const evaluation = evaluate(preview, ctx);

  return {
    fires,
    ruleName: rule.name || 'This rule',
    ruleId: rule.id || 'draft',
    mode: evaluation.mode,
    fired: evaluation.fired.map((r) => ({ id: r.id, name: r.name, priority: r.priority, action: r.action })),
    outcome: evaluation.outcome,
    filled: Object.keys(ctx).length,
  };
}

export function resultHtml(result) {
  const modeLabel = result.mode === 'all-match' ? 'All match' : 'First match';
  return `
    <div class="alert alert--${result.fires ? 'success' : 'warning'}">
      <span class="icon">${result.fires ? 'check_circle' : 'do_not_disturb_on'}</span>
      <div>
        <div class="title">${esc(result.ruleName)} ${result.fires ? 'fires on this claim' : 'does not fire on this claim'}</div>
        ${result.fires
          ? 'Every condition matched the values above.'
          : `At least one condition did not match, or the claim does not carry the attribute it tests. ${
            result.filled} attribute${result.filled === 1 ? '' : 's'} filled in.`}
      </div>
    </div>

    <div class="toolbar">
      <span class="t-title-sm">Contract evaluation</span>
      <span class="spacer"></span>
      <span class="badge badge--accent">${esc(modeLabel)}</span>
    </div>
    ${result.fired.length
      ? `<ol class="journey">
           ${result.fired.map((r) => `
             <li class="journey__row">
               <span class="journey__at t-mono-sm">priority ${esc(r.priority)}</span>
               <span class="journey__action">${esc(r.name)}</span>
               <span class="journey__actor">${esc(r.id)}</span>
               <span class="journey__detail">${esc(actionSummary(r.action))}</span>
             </li>`).join('')}
         </ol>`
      : '<p class="t-body-sm">No rule on this contract fires on this claim, so it is priced by the methodology and coverage alone.</p>'}

    <dl class="dl dl--narrow">
      <dt>Final outcome</dt>
      <dd>${result.outcome.length
        ? result.outcome.map((o) => `${esc(actionSummary(o.action))} <span class="t-body-sm">(${esc(o.ruleName)})</span>`).join('<br>')
        : 'No rule outcome — nothing overrides the contract.'}</dd>
    </dl>`;
}
