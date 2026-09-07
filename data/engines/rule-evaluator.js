// The rule engine itself: pure functions over a rule and a claim context, with
// no DOM and no repository import — the repository wraps these, the wizard and
// the simulator call them directly.
//
// A context is flat, keyed by attribute: { 'item.category': 'Consumables',
// 'patient.age': 8, … }. An attribute the context does not carry is unknown,
// and a condition on an unknown attribute does not fire.

import { usd } from '../../shared/format.js';
import * as attrs from './rule-attributes.js';

export const EVALUATIONS = [
  { key: 'first-match', label: 'First match', hint: 'The first rule that fires decides, and the rest are skipped.' },
  { key: 'all-match', label: 'All match', hint: 'Every rule that fires applies; a later rule overrides an earlier one of the same type.' },
];

/**
 * What a rule can do. `params` names each parameter and where its options come
 * from — the wizard resolves 'shareTypes' and 'overageActions' against the
 * repository, the way the attribute catalog resolves its enums.
 */
export const ACTION_TYPES = [
  { key: 'Not Billable', params: [] },
  { key: '% Discount', params: [{ name: 'percent', label: 'Discount', type: 'percent' }] },
  { key: 'Fixed Rate', params: [{ name: 'amount', label: 'Rate', type: 'money' }] },
  { key: 'Requires Prior Approval', params: [] },
  { key: 'Co-pay', params: [
    { name: 'shareType', label: 'Share type', type: 'enum', optionsFrom: 'shareTypes' },
    { name: 'value', label: 'Value', type: 'number' },
  ] },
  { key: 'Ceiling', params: [{ name: 'amount', label: 'Ceiling', type: 'money' }] },
  { key: 'Route to Payer', params: [] },
  { key: 'Route to Patient', params: [] },
  { key: 'Override Overage Action', params: [
    { name: 'action', label: 'Overage action', type: 'enum', optionsFrom: 'overageActions' },
  ] },
];

/** Actions that decide what a charge costs — two of them on one charge clash. */
const PRICING_ACTIONS = new Set(['Not Billable', '% Discount', 'Fixed Rate', 'Co-pay', 'Ceiling']);

export const actionByKey = (key) => ACTION_TYPES.find((a) => a.key === key) || null;

export const rulesOf = (contract) => (Array.isArray(contract?.rules) ? contract.rules : []);

/** Active rules in the order they run: lowest priority number first. */
export const orderedRules = (contract) =>
  rulesOf(contract)
    .filter((r) => r.status === 'Active')
    .slice()
    .sort((a, b) => (a.priority - b.priority) || String(a.id).localeCompare(String(b.id)));

// --- evaluation --------------------------------------------------------------

const asNumber = (v) => (v === '' || v == null ? NaN : Number(v));

/** Compare as numbers when both sides are numeric, as text otherwise. */
function compare(left, right) {
  const a = asNumber(left);
  const b = asNumber(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b ? 0 : a < b ? -1 : 1;
  const x = String(left ?? '');
  const y = String(right ?? '');
  return x === y ? 0 : x < y ? -1 : 1;
}

const same = (left, right) => {
  if (typeof left === 'boolean' || right === true || right === false) {
    return Boolean(left) === (right === true || right === 'true');
  }
  return compare(left, right) === 0;
};

/** One condition against the context. An unknown attribute never fires. */
export function evalCondition(cond, ctx = {}) {
  if (!cond?.attr) return false;
  if (!(cond.attr in ctx)) return false;
  const actual = ctx[cond.attr];
  const { operator, value } = cond;

  if (operator === 'eq') return same(actual, value);
  if (operator === 'ne') return !same(actual, value);
  if (operator === 'gt') return compare(actual, value) > 0;
  if (operator === 'lt') return compare(actual, value) < 0;
  if (operator === 'gte') return compare(actual, value) >= 0;
  if (operator === 'lte') return compare(actual, value) <= 0;
  if (operator === 'contains') {
    return String(actual ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
  }
  if (operator === 'in') return (value || []).some((v) => same(actual, v));
  if (operator === 'not_in') return !(value || []).some((v) => same(actual, v));
  if (operator === 'between') {
    const { from, to } = value || {};
    return compare(actual, from) >= 0 && compare(actual, to) <= 0;
  }
  return false;
}

/** A group is AND or OR over conditions and nested groups. Empty never fires. */
export function evalGroup(group, ctx = {}) {
  const items = group?.items || [];
  if (!items.length) return false;
  const test = (item) => (isGroup(item) ? evalGroup(item, ctx) : evalCondition(item, ctx));
  return group.op === 'OR' ? items.some(test) : items.every(test);
}

export const isGroup = (item) => Boolean(item && Array.isArray(item.items));

/**
 * Run the contract's Active rules over one context.
 * first-match stops at the first rule that fires; all-match collects them all
 * and a later action of the same type overrides an earlier one.
 */
export function evaluate(contract, ctx = {}) {
  const mode = contract?.ruleEvaluation === 'all-match' ? 'all-match' : 'first-match';
  const fired = [];
  for (const rule of orderedRules(contract)) {
    if (!evalGroup(rule.conditions, ctx)) continue;
    fired.push(rule);
    if (mode === 'first-match') break;
  }

  const outcome = [];
  for (const rule of fired) {
    const at = outcome.findIndex((o) => o.action.type === rule.action?.type);
    const entry = { ruleId: rule.id, ruleName: rule.name, action: rule.action || { type: '', params: {} } };
    if (at === -1) outcome.push(entry);
    else outcome[at] = entry;
  }
  return { mode, fired, outcome };
}

// --- summaries ---------------------------------------------------------------

/** "Not Billable", "% Discount 10%", "Co-pay 20% of the allowed amount". */
export function actionSummary(action) {
  const type = action?.type;
  const p = action?.params || {};
  if (!type) return '—';
  if (type === '% Discount') return `${Number(p.percent) || 0}% discount`;
  if (type === 'Fixed Rate') return `Fixed rate ${usd(p.amount)}`;
  if (type === 'Ceiling') return `Ceiling ${usd(p.amount)}`;
  if (type === 'Co-pay') {
    const share = p.shareType || 'Co-pay %';
    const value = share.includes('%') ? `${Number(p.value) || 0}%` : usd(p.value);
    return `Co-pay — ${share} ${value}`;
  }
  if (type === 'Override Overage Action') return `Override overage action → ${p.action || '—'}`;
  return type;
}

/** "IF Patient Plan = Gold AND (Item Category = Consumables) THEN Not Billable". */
export function summarize(rule, resolve = null) {
  const conditions = groupText(rule?.conditions, resolve, true);
  if (!conditions) return `IF nothing THEN ${actionSummary(rule?.action)}`;
  return `IF ${conditions} THEN ${actionSummary(rule?.action)}`;
}

/** The condition half on its own — the table column and the tooltip use it. */
export function conditionsText(rule, resolve = null) {
  return groupText(rule?.conditions, resolve, true) || 'No conditions';
}

function groupText(group, resolve, root = false) {
  const items = group?.items || [];
  if (!items.length) return '';
  const parts = items
    .map((item) => (isGroup(item) ? groupText(item, resolve) : conditionText(item, resolve)))
    .filter(Boolean);
  if (!parts.length) return '';
  const joined = parts.join(` ${group.op === 'OR' ? 'OR' : 'AND'} `);
  return root || parts.length === 1 ? joined : `(${joined})`;
}

function conditionText(cond, resolve) {
  const attr = attrs.byKey(cond?.attr);
  const operator = attrs.operatorByKey(cond?.operator);
  const value = attrs.formatValue(attr, cond?.operator, cond?.value, resolve);
  return `${attrs.fullLabel(attr)} ${operator.symbol} ${value}`;
}

// --- conflicts ---------------------------------------------------------------

/**
 * Pairs of Active rules that can fire on the same charge and then disagree.
 * The overlap test is deliberately cheap — equal literal values, or numeric
 * ranges that intersect — so it flags the pairs worth a human's attention
 * rather than proving anything about the whole condition tree.
 */
export function findConflicts(contract) {
  const rules = orderedRules(contract);
  const out = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const shared = sharedAttribute(rules[i], rules[j]);
      if (!shared) continue;
      const reason = clash(rules[i].action, rules[j].action);
      if (!reason) continue;
      out.push({ a: rules[i], b: rules[j], attr: shared.attr, value: shared.text, reason });
    }
  }
  return out;
}

/** The first attribute both rules test with overlapping values, or null. */
function sharedAttribute(a, b) {
  const left = flatten(a.conditions);
  const right = flatten(b.conditions);
  for (const one of left) {
    for (const other of right) {
      if (one.attr !== other.attr) continue;
      if (!overlaps(one, other)) continue;
      const attr = attrs.byKey(one.attr);
      return { attr: one.attr, text: `${attrs.fullLabel(attr)} ${attrs.operatorByKey(one.operator).symbol} ${
        attrs.formatValue(attr, one.operator, one.value)}` };
    }
  }
  return null;
}

function flatten(group, out = []) {
  for (const item of group?.items || []) {
    if (isGroup(item)) flatten(item, out);
    else if (item?.attr) out.push(item);
  }
  return out;
}

function overlaps(one, other) {
  const range = (cond) => {
    if (cond.operator === 'between') {
      return [asNumber(cond.value?.from), asNumber(cond.value?.to)];
    }
    const n = asNumber(cond.value);
    if (!Number.isFinite(n)) return null;
    if (cond.operator === 'gt' || cond.operator === 'gte') return [n, Infinity];
    if (cond.operator === 'lt' || cond.operator === 'lte') return [-Infinity, n];
    if (cond.operator === 'eq') return [n, n];
    return null;
  };
  const a = range(one);
  const b = range(other);
  if (a && b) return a[0] <= b[1] && b[0] <= a[1];

  const values = (cond) => (attrs.isListOperator(cond.operator)
    ? (cond.value || []).map(String)
    : [String(cond.value ?? '')]);
  if (['eq', 'in'].includes(one.operator) && ['eq', 'in'].includes(other.operator)) {
    return values(one).some((v) => values(other).includes(v));
  }
  return false;
}

/** Why two actions cannot both stand, or ''. */
function clash(a, b) {
  const left = a?.type;
  const right = b?.type;
  if (!left || !right) return '';
  if (PRICING_ACTIONS.has(left) && PRICING_ACTIONS.has(right) && left !== right) {
    return 'contradictory pricing actions';
  }
  if ((left === 'Route to Payer' && right === 'Route to Patient')
    || (left === 'Route to Patient' && right === 'Route to Payer')) {
    return 'one routes to the payer, the other to the patient';
  }
  if (left === 'Override Overage Action' && right === 'Override Overage Action'
    && a.params?.action !== b.params?.action) {
    return 'different overage overrides';
  }
  return '';
}
