// The catalog a rule condition is built from: every attribute a claim carries,
// grouped the way a biller thinks about one. Static on purpose — it imports no
// repository, so the evaluator can read it without pulling the data layer in.
//
// Enum options that live in a repository (CDM categories, the contract's plans)
// are named here by source and resolved by the screen drawing the picker.

import { usd } from '../../shared/format.js';

export const GROUPS = ['Patient', 'Item', 'Encounter', 'Financial'];

const ALL_TYPES = ['number', 'text', 'date', 'enum', 'bool'];

/** Every operator, with the value types it can be asked of. */
export const OPERATORS = [
  { key: 'eq', symbol: '=', label: 'is', types: ALL_TYPES },
  { key: 'ne', symbol: '≠', label: 'is not', types: ALL_TYPES },
  { key: 'gt', symbol: '>', label: 'is above', types: ['number', 'date'] },
  { key: 'lt', symbol: '<', label: 'is below', types: ['number', 'date'] },
  { key: 'gte', symbol: '≥', label: 'is at least', types: ['number', 'date'] },
  { key: 'lte', symbol: '≤', label: 'is at most', types: ['number', 'date'] },
  { key: 'in', symbol: 'in', label: 'is one of', types: ['enum', 'text'] },
  { key: 'not_in', symbol: 'not in', label: 'is none of', types: ['enum', 'text'] },
  { key: 'contains', symbol: 'contains', label: 'contains', types: ['text'] },
  { key: 'between', symbol: 'between', label: 'is between', types: ['number', 'date'] },
];

export const ATTRIBUTES = [
  // --- Patient ---
  { key: 'patient.plan', label: 'Plan', group: 'Patient', type: 'enum', optionsFrom: 'plans' },
  { key: 'patient.age', label: 'Age', group: 'Patient', type: 'number', unit: 'years' },
  { key: 'patient.gender', label: 'Gender', group: 'Patient', type: 'enum', options: ['Male', 'Female'] },
  { key: 'patient.nationality', label: 'Nationality', group: 'Patient', type: 'text' },
  { key: 'patient.memberSince', label: 'Member since', group: 'Patient', type: 'date' },

  // --- Item ---
  { key: 'item.chargeCode', label: 'Charge code', group: 'Item', type: 'text' },
  { key: 'item.description', label: 'Description', group: 'Item', type: 'text' },
  { key: 'item.category', label: 'Category', group: 'Item', type: 'enum', optionsFrom: 'categories' },
  { key: 'item.serviceGroup', label: 'Service group', group: 'Item', type: 'enum', optionsFrom: 'serviceGroups' },
  { key: 'item.standardPrice', label: 'Standard price', group: 'Item', type: 'number', money: true },
  { key: 'item.allowedAmount', label: 'Allowed amount', group: 'Item', type: 'number', money: true },
  { key: 'item.quantity', label: 'Quantity', group: 'Item', type: 'number' },
  { key: 'item.isBundle', label: 'Is bundle', group: 'Item', type: 'bool' },

  // --- Encounter ---
  { key: 'encounter.admissionType', label: 'Admission type', group: 'Encounter', type: 'enum', optionsFrom: 'admissionTypes' },
  { key: 'encounter.department', label: 'Department', group: 'Encounter', type: 'text' },
  { key: 'encounter.lengthOfStay', label: 'Length of stay', group: 'Encounter', type: 'number', unit: 'days' },
  { key: 'encounter.diagnosisCode', label: 'Diagnosis code', group: 'Encounter', type: 'text', placeholder: 'ICD-10, for example J18.9' },
  { key: 'encounter.attendingDoctor', label: 'Attending doctor', group: 'Encounter', type: 'text' },
  { key: 'encounter.dateOfService', label: 'Date of service', group: 'Encounter', type: 'date' },

  // --- Financial ---
  { key: 'financial.claimTotal', label: 'Claim total', group: 'Financial', type: 'number', money: true },
  { key: 'financial.overageAmount', label: 'Overage amount', group: 'Financial', type: 'number', money: true },
  { key: 'financial.overageComponent', label: 'Overage component', group: 'Financial', type: 'text' },
  { key: 'financial.patientBalance', label: 'Patient balance', group: 'Financial', type: 'number', money: true },
  { key: 'financial.preAuthNumber', label: 'Pre-auth number', group: 'Financial', type: 'text', placeholder: 'May be empty' },
];

export const byKey = (key) => ATTRIBUTES.find((a) => a.key === key) || null;

export const inGroup = (group) => ATTRIBUTES.filter((a) => a.group === group);

/** How an attribute reads inside a sentence: "Item Category". */
export const fullLabel = (attr) => (attr ? `${attr.group} ${attr.label}` : '—');

export const operatorsFor = (type) => OPERATORS.filter((o) => o.types.includes(type || 'text'));

export const operatorByKey = (key) => OPERATORS.find((o) => o.key === key) || OPERATORS[0];

/** Whether an operator takes a list, a range, or one value. */
export const isListOperator = (key) => key === 'in' || key === 'not_in';
export const isRangeOperator = (key) => key === 'between';

/** The first operator an attribute of this type can use. */
export const defaultOperator = (type) => operatorsFor(type)[0]?.key || 'eq';

/**
 * One value as it reads on screen. `resolve(attrKey, value)` gives a screen the
 * chance to name an id — the plan picker stores ids and shows names.
 */
export function formatValue(attr, operator, value, resolve = null) {
  const one = (v) => {
    const named = resolve ? resolve(attr?.key, v) : null;
    if (named != null && named !== '') return String(named);
    if (v === '' || v == null) return '—';
    if (attr?.type === 'bool') return v === true || v === 'true' ? 'Yes' : 'No';
    if (attr?.money) return usd(v);
    if (attr?.unit) return `${v} ${attr.unit}`;
    return String(v);
  };

  if (isRangeOperator(operator)) {
    const range = value || {};
    return `${one(range.from)} and ${one(range.to)}`;
  }
  if (isListOperator(operator)) {
    const list = Array.isArray(value) ? value : [];
    return list.length ? list.map(one).join(', ') : '—';
  }
  return one(value);
}

/** A blank value of the right shape for an operator. */
export function blankValue(operator) {
  if (isRangeOperator(operator)) return { from: '', to: '' };
  if (isListOperator(operator)) return [];
  return '';
}
