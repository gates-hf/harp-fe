// Step 2 of the rule wizard: the condition tree. A group is AND or OR over
// conditions and nested groups, and every node is addressed by its path from
// the root ("" is the root, "0.1" the second item of the first group), so one
// delegated handler can edit any depth.
//
// The design system ships no tree, so a nested group is indented from
// --space-4 and wears a left rule as its bracket — the same inline-token
// approach the CDM component tree uses.

import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { esc } from '../../../../shared/format.js';
import * as attrs from '../../../../data/engines/rule-attributes.js';
import { isGroup } from '../../../../data/engines/rule-evaluator.js';

/** Enum options a repository owns, resolved where the contract is known. */
export function optionsFor(attr, contract) {
  if (attr?.options) return attr.options.map((v) => ({ value: v, label: v }));
  if (attr?.optionsFrom === 'plans') {
    return contracts.plansOf(contract).map((p) => ({ value: p.id, label: p.name }));
  }
  if (attr?.optionsFrom === 'categories') return cdm.CATEGORIES.map((v) => ({ value: v, label: v }));
  if (attr?.optionsFrom === 'serviceGroups') return contracts.SERVICE_GROUPS.map((v) => ({ value: v, label: v }));
  if (attr?.optionsFrom === 'admissionTypes') return contracts.ADMISSION_TYPES.map((v) => ({ value: v, label: v }));
  return [];
}

export const blankCondition = () => ({
  attr: 'item.category',
  operator: attrs.defaultOperator('enum'),
  value: '',
});

export const blankGroup = () => ({ op: 'AND', items: [blankCondition()] });

// --- markup ------------------------------------------------------------------

export function builderHtml(root, contract) {
  return `
    <p class="t-body-sm">Build the test a claim has to pass. Conditions inside a group are joined by its
       AND / OR toggle, and a group can hold another group.</p>
    ${groupHtml(root, '', 0, contract)}`;
}

function groupHtml(group, path, depth, contract) {
  const items = group?.items || [];
  const indent = depth
    ? ` style="padding-inline-start: var(--space-4); border-inline-start: 2px solid var(--border-1)"`
    : '';
  return `
    <div data-group="${esc(path)}"${indent}>
      <div class="toolbar">
        <span class="segmented" role="group" aria-label="Join conditions">
          <button type="button" data-op="AND" data-path="${esc(path)}" aria-pressed="${group.op !== 'OR'}">AND</button>
          <button type="button" data-op="OR" data-path="${esc(path)}" aria-pressed="${group.op === 'OR'}">OR</button>
        </span>
        <span class="t-body-sm">${depth ? 'Nested group' : 'All conditions below'}</span>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="add-condition" data-path="${esc(path)}">
          <span class="icon icon--sm">add</span>Condition
        </button>
        <button class="btn btn--secondary btn--sm" data-act="add-group" data-path="${esc(path)}">
          <span class="icon icon--sm">account_tree</span>Group
        </button>
        ${depth ? `
          <button class="btn btn--ghost btn--icon btn--sm" data-act="remove" data-path="${esc(path)}"
                  title="Remove this group"><span class="icon icon--sm">delete</span></button>` : ''}
      </div>
      ${items.length
        ? items.map((item, i) => {
          const child = path === '' ? String(i) : `${path}.${i}`;
          return isGroup(item) ? groupHtml(item, child, depth + 1, contract) : conditionHtml(item, child, contract);
        }).join('')
        : '<p class="t-body-sm">This group is empty, so it never matches. Add a condition.</p>'}
    </div>`;
}

function conditionHtml(cond, path, contract) {
  const attr = attrs.byKey(cond.attr);
  const operators = attrs.operatorsFor(attr?.type);
  return `
    <div class="rule-child-row" data-condition="${esc(path)}">
      <label class="field">
        <select data-field="attr" data-path="${esc(path)}" aria-label="Attribute">${attrOptions(cond.attr)}</select>
      </label>
      <label class="field">
        <select data-field="operator" data-path="${esc(path)}" aria-label="Operator">
          ${operators.map((o) => `<option value="${o.key}"${o.key === cond.operator ? ' selected' : ''}>${esc(o.symbol)}</option>`).join('')}
        </select>
      </label>
      ${valueHtml(attr, cond, path, contract)}
      <span class="spacer"></span>
      <button class="btn btn--ghost btn--icon btn--sm" data-act="remove" data-path="${esc(path)}"
              title="Remove this condition"><span class="icon icon--sm">delete</span></button>
    </div>`;
}

function attrOptions(chosen) {
  return attrs.GROUPS.map((group) => `
    <optgroup label="${esc(group)}">
      ${attrs.inGroup(group).map((a) => `<option value="${esc(a.key)}"${a.key === chosen ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}
    </optgroup>`).join('');
}

function valueHtml(attr, cond, path, contract) {
  const type = attr?.type || 'text';
  if (attrs.isRangeOperator(cond.operator)) {
    const range = cond.value || {};
    return `${oneInput(attr, range.from, path, 'from')}<span class="t-body-sm">and</span>${oneInput(attr, range.to, path, 'to')}`;
  }
  if (attrs.isListOperator(cond.operator)) {
    return type === 'enum' ? chipsHtml(attr, cond, path, contract) : listTextHtml(cond, path);
  }
  if (type === 'enum') {
    const options = optionsFor(attr, contract);
    return `
      <label class="field">
        <select data-field="value" data-path="${esc(path)}" aria-label="Value">
          <option value=""${cond.value ? '' : ' selected'}>Choose a value</option>
          ${options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(cond.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </label>`;
  }
  if (type === 'bool') {
    return `
      <label class="field">
        <select data-field="value" data-path="${esc(path)}" aria-label="Value">
          <option value="true"${cond.value === true || cond.value === 'true' ? ' selected' : ''}>Yes</option>
          <option value="false"${cond.value === true || cond.value === 'true' ? '' : ' selected'}>No</option>
        </select>
      </label>`;
  }
  return oneInput(attr, cond.value, path, 'value');
}

function oneInput(attr, value, path, field) {
  const type = attr?.type === 'number' ? 'number' : attr?.type === 'date' ? 'date' : 'text';
  const icon = attr?.money ? 'attach_money' : attr?.type === 'date' ? 'event' : '';
  return `
    <label class="field">
      ${icon ? `<span class="icon icon--sm">${icon}</span>` : ''}
      <input type="${type}"${type === 'number' ? ' step="0.01"' : ''} value="${esc(value ?? '')}"
             data-field="${field}" data-path="${esc(path)}"
             placeholder="${esc(attr?.placeholder || attr?.unit || '')}" aria-label="Value">
    </label>`;
}

/** in / not_in over an enum: the chosen values as chips, plus a picker. */
function chipsHtml(attr, cond, path, contract) {
  const chosen = Array.isArray(cond.value) ? cond.value : [];
  const options = optionsFor(attr, contract);
  const labelOf = (v) => options.find((o) => String(o.value) === String(v))?.label || v;
  return `
    ${chosen.map((v, i) => `
      <span class="badge badge--accent">${esc(labelOf(v))}
        <button class="btn btn--ghost btn--icon btn--sm" data-act="chip-remove" data-path="${esc(path)}"
                data-index="${i}" title="Remove ${esc(labelOf(v))}"><span class="icon icon--sm">close</span></button>
      </span>`).join('')}
    <label class="field">
      <select data-field="chip-add" data-path="${esc(path)}" aria-label="Add a value">
        <option value="" selected>Add a value…</option>
        ${options.filter((o) => !chosen.some((v) => String(v) === String(o.value)))
          .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
      </select>
    </label>`;
}

/** in / not_in over free text: one field, values separated by commas. */
function listTextHtml(cond, path) {
  const chosen = Array.isArray(cond.value) ? cond.value : [];
  return `
    <label class="field field--grow">
      <input type="text" value="${esc(chosen.join(', '))}" data-field="list" data-path="${esc(path)}"
             placeholder="Separate values with commas" aria-label="Values">
    </label>`;
}

// --- state -------------------------------------------------------------------

export function nodeAt(root, path) {
  if (!path) return root;
  return path.split('.').reduce((node, i) => node?.items?.[Number(i)], root);
}

function removeAt(root, path) {
  const parts = String(path).split('.');
  const index = Number(parts.pop());
  const parent = nodeAt(root, parts.join('.'));
  if (parent?.items) parent.items.splice(index, 1);
}

/**
 * One delegated handler for the whole tree. Returns true when the caller has
 * to redraw — every change that swaps a field does, typing into one does not.
 */
export function handleEvent(e, root) {
  const target = e.target.closest('[data-path]');
  if (!target) return false;
  const { path } = target.dataset;

  if (e.type === 'click') {
    const act = target.dataset.act;
    const op = target.dataset.op;
    if (op) {
      nodeAt(root, path).op = op;
      return true;
    }
    if (act === 'add-condition') {
      nodeAt(root, path).items.push(blankCondition());
      return true;
    }
    if (act === 'add-group') {
      nodeAt(root, path).items.push(blankGroup());
      return true;
    }
    if (act === 'remove') {
      removeAt(root, path);
      return true;
    }
    if (act === 'chip-remove') {
      const cond = nodeAt(root, path);
      cond.value = (cond.value || []).filter((_, i) => i !== Number(target.dataset.index));
      return true;
    }
    return false;
  }

  const cond = nodeAt(root, path);
  if (!cond) return false;
  const field = target.dataset.field;

  if (field === 'attr') {
    cond.attr = target.value;
    const type = attrs.byKey(cond.attr)?.type;
    cond.operator = attrs.defaultOperator(type);
    cond.value = attrs.blankValue(cond.operator);
    return true;
  }
  if (field === 'operator') {
    const shapeChanged = shapeOf(cond.operator) !== shapeOf(target.value);
    cond.operator = target.value;
    if (shapeChanged) cond.value = attrs.blankValue(cond.operator);
    return true;
  }
  if (field === 'chip-add') {
    if (!target.value) return false;
    cond.value = [...(Array.isArray(cond.value) ? cond.value : []), target.value];
    return true;
  }
  if (field === 'list') {
    cond.value = target.value.split(',').map((v) => v.trim()).filter(Boolean);
    return false;
  }
  if (field === 'from' || field === 'to') {
    cond.value = { ...(cond.value || {}), [field]: target.value };
    return false;
  }
  if (field === 'value') {
    cond.value = target.value;
    // A select swaps nothing else, but the summary under the step follows it.
    return target.tagName === 'SELECT' ? 'summary' : false;
  }
  return false;
}

const shapeOf = (operator) =>
  (attrs.isRangeOperator(operator) ? 'range' : attrs.isListOperator(operator) ? 'list' : 'one');
