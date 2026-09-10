// Repository — contracts. Owner: modules/pactum (Payer & Contract Management).
// The only way any module reads or writes payer contracts.
//
// A contract is versioned: every version of one agreement shares a `lineageId`
// and carries its own `version`, dates and configuration. Activating a new
// version closes the previous one. Contracts are never deleted once they have
// been Active — only a Draft can be removed.
//
// The audit trail is keyed on the lineage, not on the row, so one query returns
// the history of every version. This repository reads payers through their
// repository (never their table) for the payer name and type.

import { store } from '../store.js';
import * as audit from './audit.js';
import * as payers from './payers.js';
import * as cdm from './cdm.js';
import { usd, int, todayIso, iso, compareDates, withinDates } from '../../shared/format.js';
import { current as currentRole } from '../../shared/roles.js';
// The rule engine is a leaf: it reads no repository, so this repository can
// wrap it rather than carry a second implementation of the same logic.
import * as engine from '../engines/rule-evaluator.js';

const TABLE = 'contracts';
const ENTITY = 'contract';

export const STATUSES = ['Draft', 'Active', 'Expired', 'Terminated'];
export const EXPIRY_WINDOWS = [30, 60, 90];

const FIELD_LABELS = {
  name: 'name',
  contractNo: 'contract no.',
  startDate: 'start date',
  endDate: 'end date',
};

/** Today as an ISO date — the one shape every stored date and comparison uses. */
export const today = todayIso;

export function all() {
  return store.table(TABLE);
}

export function get(id) {
  return all().find((c) => c.id === id) || null;
}

/** One payer's contracts, newest agreement first. */
export function byPayer(payerId) {
  return all()
    .filter((c) => c.payerId === payerId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version);
}

export function activeOnly() {
  return all().filter((c) => c.status === 'Active');
}

/** Every version of one agreement, oldest first. */
export function versionsOf(lineageId) {
  return all()
    .filter((c) => c.lineageId === lineageId)
    .sort((a, b) => a.version - b.version);
}

export function nextVersion(lineageId) {
  return versionsOf(lineageId).reduce((n, c) => Math.max(n, c.version), 0) + 1;
}

/**
 * The contract version that billed one plan on a date: the version whose term
 * covers that date and that was live then — active today, or a version since
 * closed. A draft never bills, and a terminated contract stops on its
 * termination date. The newest matching version wins, so a corrective version
 * written later still prices the older date it covers.
 */
export function contractForService(payerId, planId, on = today()) {
  const at = iso(on) || today();
  const covers = (c) => withinDates(at, c.startDate, c.endDate);
  const wasLive = (c) => {
    if (c.status === 'Draft') return false;
    if (c.effectiveDate && compareDates(c.effectiveDate, at) > 0) return false;
    if (c.status === 'Terminated') {
      return Boolean(c.terminationDate) && compareDates(c.terminationDate, at) >= 0;
    }
    return !c.closedAt || compareDates(c.closedAt, at) >= 0;
  };
  return (
    all()
      .filter((c) => c.payerId === payerId && (c.planIds || []).includes(planId) && covers(c) && wasLive(c))
      .sort((a, b) => b.version - a.version)[0] || null
  );
}

/** The version a payer list shows for a lineage: the newest one. */
export function currentOf(lineageId) {
  const rows = versionsOf(lineageId);
  return rows[rows.length - 1] || null;
}

export const payerOf = (contract) => (contract ? payers.get(contract.payerId) : null);
export const payerName = (contract) => payerOf(contract)?.nameEn || '—';

export function statusTone(status) {
  if (status === 'Active') return 'success';
  if (status === 'Expired') return 'warning';
  if (status === 'Terminated') return 'critical';
  return '';
}

/** Whole days from today to the end date. Negative once the date has passed. */
export function daysLeft(contract) {
  const end = iso(contract?.endDate);
  if (!end) return null;
  return Math.round((Date.parse(end) - Date.parse(today())) / 86400000);
}

/** The linked plans, read off the payer — name, code and current status. */
export function plansOf(contract) {
  const payer = payerOf(contract);
  return (contract?.planIds || []).map((id) => {
    const plan = payer?.plans.find((p) => p.id === id);
    return plan ? { ...plan } : { id, name: id, code: '—', status: 'Inactive' };
  });
}

/**
 * Contract numbers are unique within a payer. Versions of one agreement keep
 * the same number, so the lineage of `excludeId` never counts against itself.
 */
export function isContractNoUnique(payerId, no, excludeId = null) {
  const needle = String(no || '').trim().toLowerCase();
  const lineage = excludeId ? get(excludeId)?.lineageId : null;
  return !all().some(
    (c) =>
      c.payerId === payerId &&
      c.id !== excludeId &&
      c.lineageId !== lineage &&
      c.contractNo.trim().toLowerCase() === needle,
  );
}

/**
 * The first Active or Draft contract already covering one of these plans over
 * an intersecting date range, or null. Expired and Terminated contracts never
 * conflict, and neither do other versions of the same agreement. Returns
 * { contract, planId, planName } so the form can name both.
 */
export function planOverlap(planIds, start, end, excludeId = null) {
  const wanted = new Set(planIds || []);
  const lineage = excludeId ? get(excludeId)?.lineageId : null;
  for (const c of all()) {
    if (c.id === excludeId || (lineage && c.lineageId === lineage)) continue;
    if (c.status !== 'Active' && c.status !== 'Draft') continue;
    if (!(start <= c.endDate && c.startDate <= end)) continue;
    const hit = c.planIds.find((id) => wanted.has(id));
    if (hit) {
      const plan = plansOf(c).find((p) => p.id === hit);
      return { contract: c, planId: hit, planName: plan?.name || hit };
    }
  }
  return null;
}

/** list({ q, payerType, expiring, status, payerId, onlyActive, sort, dir }). */
export function list({
  q = '', payerType = '', expiring = '', status = '', payerId = '',
  onlyActive = false, sort = 'endDate', dir = 'asc',
} = {}) {
  const needle = q.trim().toLowerCase();
  const rows = all().filter((c) => {
    if (onlyActive && c.status !== 'Active') return false;
    if (status && c.status !== status) return false;
    if (payerId && c.payerId !== payerId) return false;
    if (payerType && payerOf(c)?.type !== payerType) return false;
    if (expiring) {
      const days = daysLeft(c);
      if (days == null || days < 0 || days > Number(expiring)) return false;
    }
    if (!needle) return true;
    return (
      c.name.toLowerCase().includes(needle) ||
      c.contractNo.toLowerCase().includes(needle) ||
      payerName(c).toLowerCase().includes(needle)
    );
  });

  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    if (sort === 'version') return (a.version - b.version) * sign;
    if (sort === 'rules') return (a.rules.length - b.rules.length) * sign;
    const av = sort === 'payer' ? payerName(a) : a[sort];
    const bv = sort === 'payer' ? payerName(b) : b[sort];
    return String(av ?? '').localeCompare(String(bv ?? '')) * sign;
  });
}

/**
 * The active contracts running out inside `days`, soonest first. One helper so
 * a dashboard card and the list it opens (#/pactum/contracts?expiring=60)
 * count the same rows.
 */
export function expiringWithin(days = 60) {
  return activeOnly()
    .filter((c) => {
      const left = daysLeft(c);
      return left != null && left >= 0 && left <= Number(days);
    })
    .sort((a, b) => daysLeft(a) - daysLeft(b));
}

export function counts() {
  const active = activeOnly();
  return {
    total: all().length,
    active: active.length,
    expiring30: active.filter((c) => {
      const days = daysLeft(c);
      return days != null && days >= 0 && days <= 30;
    }).length,
    draft: all().filter((c) => c.status === 'Draft').length,
    payers: new Set(active.map((c) => c.payerId)).size,
  };
}

/**
 * Active contracts past their end date are Expired. Runs once when this module
 * loads, so every screen reads a current list.
 */
export function expireContracts() {
  const now = today();
  let expired = 0;
  for (const row of all()) {
    if (row.status !== 'Active' || !row.endDate || compareDates(row.endDate, now) >= 0) continue;
    row.status = 'Expired';
    row.updatedAt = new Date().toISOString();
    expired += 1;
    log(row, 'Expired', `Term ended ${row.endDate}`);
  }
  if (expired) store.commit('contract.expire');
  return expired;
}

// --- writes ------------------------------------------------------------------

export function create(data) {
  const now = new Date().toISOString();
  const row = {
    id: store.nextId(TABLE, 'CTR-'),
    payerId: '',
    contractNo: '',
    name: '',
    version: 1,
    lineageId: newLineageId(),
    status: 'Draft',
    startDate: '',
    endDate: '',
    effectiveDate: null,
    closedAt: null,
    terminationDate: null,
    terminationReason: '',
    // Filled by later amendments — empty structures so the contract page can
    // count them today.
    methodologies: [],
    overagePolicies: [],
    coverage: [],
    preAuth: [],
    referralRequired: [],
    documentationRequired: [],
    rules: [],
    ruleEvaluation: 'first-match',
    ...data,
    planIds: [...(data.planIds || [])],
    document: data.document ? { ...data.document } : null,
    createdBy: currentRole().name,
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('contract.create');
  log(row, 'Created', `${row.contractNo} — ${row.name}`);
  return row;
}

/** Corrective edit — same version, field-level diff in the trail. */
export function update(id, patch) {
  const row = get(id);
  if (!row) return null;

  const before = { ...row, planIds: [...row.planIds], document: row.document ? { ...row.document } : null };
  Object.assign(row, patch, {
    planIds: [...(patch.planIds ?? row.planIds)],
    document:
      patch.document === undefined ? row.document : (patch.document ? { ...patch.document } : null),
    updatedAt: new Date().toISOString(),
  });
  store.commit('contract.update');

  const changed = diff(before, row);
  if (changed.length) log(row, 'Corrective edit', changed.join('; '));
  return row;
}

/** Activate a Draft. The previous Active version of the lineage is closed. */
export function activate(id, effectiveDate) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return null;

  const previous = versionsOf(row.lineageId).find((c) => c.status === 'Active' && c.id !== id);
  if (previous) {
    previous.status = 'Expired';
    previous.closedAt = effectiveDate;
    previous.updatedAt = new Date().toISOString();
    log(previous, 'Expired', `Closed ${effectiveDate} — replaced by version ${row.version}`);
  }

  row.status = 'Active';
  row.effectiveDate = effectiveDate;
  row.updatedAt = new Date().toISOString();
  store.commit('contract.activate');
  log(row, 'Activated', `Active from ${effectiveDate}${previous ? `, version ${previous.version} closed` : ''}`);
  return row;
}

export function terminate(id, { terminationDate, terminationReason }) {
  const row = get(id);
  if (!row || row.status !== 'Active') return null;
  row.status = 'Terminated';
  row.terminationDate = terminationDate;
  row.terminationReason = terminationReason;
  row.updatedAt = new Date().toISOString();
  store.commit('contract.terminate');
  log(row, 'Terminated', `Terminated ${terminationDate} — ${terminationReason}`);
  return row;
}

/** Only a Draft can be removed; every other status stays on file. */
export function deleteDraft(id) {
  const row = get(id);
  if (!row || row.status !== 'Draft') return false;
  all().splice(all().indexOf(row), 1);
  store.commit('contract.delete');
  log(row, 'Draft deleted', `${row.contractNo} — ${row.name}`);
  return true;
}

/** Change edit — a deep copy at the next version, Draft, same lineage. */
export function createVersion(id, note = '') {
  const source = get(id);
  if (!source) return null;
  const version = nextVersion(source.lineageId);
  const now = new Date().toISOString();
  const row = {
    ...structuredClone(source),
    id: store.nextId(TABLE, 'CTR-'),
    version,
    status: 'Draft',
    effectiveDate: null,
    closedAt: null,
    terminationDate: null,
    terminationReason: '',
    createdBy: currentRole().name,
    createdAt: now,
    updatedAt: now,
  };
  all().push(row);
  store.commit('contract.version');
  audit.log({
    entity: ENTITY,
    entityId: source.lineageId,
    action: `Change edit → v${version}`,
    details: `v${source.version} · Version ${version} draft created${note ? ` — ${note}` : ''}`,
  });
  return row;
}

/** Which service group a CDM category bills under — the middle rung of the ladder. */
const SERVICE_GROUP_OF = {
  Consultation: 'Outpatient', Lab: 'Lab', Radiology: 'Imaging', Procedure: 'Day Case',
  Surgery: 'Inpatient', 'Room & Board': 'Inpatient', Pharmacy: 'Pharmacy',
  Consumables: 'Inpatient', 'Professional Fee': 'Inpatient', 'Non-Clinical': 'Outpatient',
  Bundle: 'Day Case',
};

/**
 * The groups a charge can actually land in, read off the map above rather than
 * written out beside it: a picker that offered a group no category maps to
 * would let you scope a rate to a slice of the catalogue that is always empty.
 */
export const SERVICE_GROUPS = [...new Set(Object.values(SERVICE_GROUP_OF))].sort();

// --- rate methodologies ------------------------------------------------------
// A methodology says what the payer pays for a slice of the catalogue. Rows are
// nested on the contract (so a new version copies them with it), scoped from the
// whole contract down to one charge line, and read back by precedence:
// Item -> Category -> Service Group -> Admission Type -> Default.

export const SCOPE_LEVELS = ['Default', 'Service Group', 'Category', 'Item', 'Admission Type'];
export const ADMISSION_TYPES = ['Elective', 'Emergency', 'Maternity', 'Day Case'];
export const METHODS = ['% of Charges', 'Fixed Amount', 'Per Diem', 'Case Rate', 'DRG', 'Capitation'];
export const WARD_TYPES = ['General', 'Semi-Private', 'Private', 'ICU', 'NICU'];
export const WEIGHT_SOURCES = ['Local', 'MS-DRG'];
export const OVERAGE_ACTIONS = [
  'Not Billable (Absorb)', 'Bill Payer at Contract Rate', 'Bill Patient',
  'Split per Coverage', 'Requires Approval',
];
export const TOLERANCE_TYPES = ['%', 'Amount'];

export const serviceGroupOf = (category) => SERVICE_GROUP_OF[category] || 'Outpatient';

/** A blank effective date is open-ended in that direction. */
const startsAt = (row) => row.effectiveFrom || '0000-01-01';
const endsAt = (row) => row.effectiveTo || '9999-12-31';
const covers = (row, on) => withinDates(on, row.effectiveFrom, row.effectiveTo);

export const methodologies = (contract) => contract?.methodologies || [];

/** What a scope reads as on screen: "Category: Lab", "Item: LAB-0001". */
export function scopeLabel(row) {
  if (!row) return '—';
  if (row.scopeLevel === 'Default') return 'Default';
  if (row.scopeLevel === 'Item') return `Item: ${cdm.get(row.scopeValue)?.chargeCode || row.scopeValue}`;
  return `${row.scopeLevel}: ${row.scopeValue}`;
}

/** The parameters of one row in a line — "80%", "$150.00 / night · Private". */
export function methodologySummary(row) {
  const p = row?.params || {};
  if (row?.method === '% of Charges') return `${Number(p.percent) || 0}%`;
  if (row?.method === 'Fixed Amount') {
    const n = (p.feeSchedule || []).length;
    return `${n} item${n === 1 ? '' : 's'}`;
  }
  if (row?.method === 'Per Diem') return `${usd(p.amount)} / night · ${p.wardType || 'General'}`;
  if (row?.method === 'Case Rate') return `${usd(p.amount)} · ${cdm.label(cdm.get(p.bundleId)) || 'no bundle'}`;
  if (row?.method === 'DRG') return `${usd(p.baseRate)} base · ${p.weightSource || 'Local'}`;
  if (row?.method === 'Capitation') return `${usd(p.perMemberPerMonth)} PMPM · ${int(p.memberCount)} members`;
  return '—';
}

export const toleranceLabel = (t) =>
  !t || !t.type ? 'no tolerance'
    : t.type === '%' ? `${Number(t.value) || 0}% tolerance`
      : `${usd(t.value)} tolerance`;

/** The row that already holds this scope over an intersecting term, or null. */
export function methodologyOverlap(contract, row) {
  return (
    methodologies(contract).find(
      (m) =>
        m.id !== row.id &&
        m.scopeLevel === row.scopeLevel &&
        String(m.scopeValue ?? '') === String(row.scopeValue ?? '') &&
        startsAt(m) <= endsAt(row) &&
        startsAt(row) <= endsAt(m),
    ) || null
  );
}

export const hasDefaultMethodology = (contract) =>
  methodologies(contract).some((m) => m.scopeLevel === 'Default');

/** A fee schedule prices the lines it names and no others. */
const prices = (row, item) =>
  row.method !== 'Fixed Amount' || (row.params?.feeSchedule || []).some((f) => f.itemId === item?.id);

/**
 * The row that prices one CDM item on a date. Admission type is a claim-time
 * fact, so it only takes part when the caller knows it. A row whose fee
 * schedule does not name the item is skipped, not applied — resolution carries
 * on to the next-widest scope, and reaches the standard price only when nothing
 * covers the line.
 */
export function resolveMethodology(contract, item, on = today(), admissionType = null) {
  const rows = methodologies(contract).filter((m) => covers(m, on) && prices(m, item));
  const pick = (level, value) =>
    rows.find((m) => m.scopeLevel === level && String(m.scopeValue ?? '') === String(value ?? ''));
  return (
    pick('Item', item?.id) ||
    pick('Category', item?.category) ||
    pick('Service Group', serviceGroupOf(item?.category)) ||
    (admissionType ? pick('Admission Type', admissionType) : null) ||
    rows.find((m) => m.scopeLevel === 'Default') ||
    null
  );
}

/** What the payer pays for one item under this contract on that date. */
export function resolvedPrice(contract, item, on = today(), admissionType = null) {
  const standard = Number(item?.standardPrice) || 0;
  const row = resolveMethodology(contract, item, on, admissionType);
  if (!row) return standard;
  const p = row.params || {};
  // resolveMethodology only hands back a Fixed Amount row that names the item.
  if (row.method === 'Fixed Amount') return Number((p.feeSchedule || []).find((f) => f.itemId === item?.id).price);
  if (row.method === '% of Charges') return Math.round(standard * (Number(p.percent) || 0)) / 100;
  if (row.method === 'Per Diem' || row.method === 'Case Rate') return Number(p.amount) || 0;
  if (row.method === 'DRG') return Number(p.baseRate) || 0;
  if (row.method === 'Capitation') return Number(p.perMemberPerMonth) || 0;
  return standard;
}

/** Case Rate rows — the bundle-priced ones an overage policy answers for. */
export const bundlePricedRows = (contract) =>
  methodologies(contract).filter((m) => m.method === 'Case Rate');

export function overagePolicyFor(contract, methodologyId) {
  return (contract?.overagePolicies || []).find((p) => p.methodologyId === methodologyId) || null;
}

export function bundleRowsNeedingOverage(contract) {
  return bundlePricedRows(contract).filter((m) => !overagePolicyFor(contract, m.id));
}

/** Everything standing between this draft and Activate, in plain sentences. */
export function activationBlockers(contract) {
  const out = [];
  if (!cdm.findActive().length) {
    out.push('The charge master holds no active lines. Populate the CDM first — a contract prices charges, and there are none to price.');
  }
  for (const row of bundlePricedRows(contract)) {
    const loose = componentsWithoutLimits(row.params?.bundleId);
    if (loose.length) {
      out.push(`Bundle ${cdm.label(cdm.get(row.params?.bundleId)) || 'on this case rate'} has components without limits (${loose.join(', ')}). Set a limit on each one so an overrun can be measured.`);
    }
  }
  if (!hasDefaultMethodology(contract)) {
    out.push('No default methodology. Add a Default row on the Methodologies tab so every charge the contract does not name still has a rate.');
  }
  for (const row of bundleRowsNeedingOverage(contract)) {
    out.push(`${scopeLabel(row)} is priced as a case rate with no overage policy. Set one on the Overage tab.`);
  }
  for (const plan of plansMissingDefaultCoverage(contract)) {
    out.push(`Plan ${plan.name} has no Default coverage row. Add one on the Coverage tab so every charge the contract does not name still splits between the payer and the patient.`);
  }
  return out;
}

// --- methodology and overage writes ------------------------------------------

/** Components a bundle price covers without saying how much of them it covers. */
function componentsWithoutLimits(bundleId) {
  if (!bundleId) return [];
  return cdm
    .componentRows(bundleId)
    .filter((c) => (c.limitType === 'Amount Allowance' ? !(c.limitAmount > 0) : !(c.limitQty > 0)))
    .map((c) => c.row.chargeCode);
}

/** Insert or replace one methodology row. Returns the stored row. */
export function saveMethodology(contractId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  const rows = contract.methodologies;
  const existing = data.id ? rows.find((m) => m.id === data.id) : null;
  const before = existing ? structuredClone(existing) : null;
  const row = {
    id: existing?.id || nestedId(rows, 'MT'),
    scopeLevel: data.scopeLevel,
    scopeValue: data.scopeLevel === 'Default' ? null : data.scopeValue,
    method: data.method,
    params: cleanParams(data.method, data.params),
    effectiveFrom: data.effectiveFrom || '',
    effectiveTo: data.effectiveTo || '',
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, row);
  else rows.push(row);
  contract.updatedAt = row.updatedAt;
  store.commit('contract.methodology');

  if (!existing) {
    log(contract, 'Methodology added', `${scopeLabel(row)} · ${row.method} · ${methodologySummary(row)}`);
  } else {
    const changed = methodologyDiff(before, row);
    if (changed.length) log(contract, 'Methodology updated', `${scopeLabel(row)} — ${changed.join('; ')}`);
  }
  return row;
}

/** Remove a row. Its overage policy goes with it — the policy has no subject left. */
export function removeMethodology(contractId, methodologyId) {
  const contract = get(contractId);
  const row = methodologies(contract).find((m) => m.id === methodologyId);
  if (!row) return false;
  const dropped = (contract.overagePolicies || []).filter((p) => p.methodologyId === methodologyId).length;
  contract.methodologies = contract.methodologies.filter((m) => m.id !== methodologyId);
  contract.overagePolicies = (contract.overagePolicies || []).filter((p) => p.methodologyId !== methodologyId);
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.methodology');
  log(contract, 'Methodology removed',
    `${scopeLabel(row)} · ${row.method}${dropped ? ' — its overage policy was removed with it' : ''}`);
  return true;
}

/** One policy per bundle-priced row: saving replaces that row's policy. */
export function saveOveragePolicy(contractId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  const list = contract.overagePolicies;
  const existing = overagePolicyFor(contract, data.methodologyId);
  const row = {
    id: existing?.id || nestedId(list, 'OV'),
    methodologyId: data.methodologyId,
    action: data.action,
    tolerance: cleanTolerance(data.tolerance),
    overrides: (data.overrides || []).map((o) => ({
      componentId: o.componentId,
      action: o.action,
      tolerance: cleanTolerance(o.tolerance),
    })),
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, row);
  else list.push(row);
  contract.updatedAt = row.updatedAt;
  store.commit('contract.overage');

  const scope = scopeLabel(methodologies(contract).find((m) => m.id === row.methodologyId));
  const n = row.overrides.length;
  log(contract, existing ? 'Overage policy updated' : 'Overage policy set',
    `${scope} · ${row.action} · ${toleranceLabel(row.tolerance)} · ${n} component override${n === 1 ? '' : 's'}`);
  return row;
}

// --- coverage ----------------------------------------------------------------
// Coverage says how an allowed amount splits between the payer and the patient.
// It is written per linked plan — `coverage: [{ planId, rows: [] }]` — and read
// back by precedence: Item -> Category -> Service Group -> Default. There are no
// dates here, so one plan holds at most one row per scope.

export const COVERAGE_SCOPE_LEVELS = ['Default', 'Service Group', 'Category', 'Item'];
export const SHARE_TYPES = ['None', 'Co-pay %', 'Fixed Co-pay', 'Deductible then %'];
export const COPY_MODES = [
  { id: 'Replace', label: 'Replace all rows' },
  { id: 'Merge', label: 'Merge — keep existing, add missing' },
];

/** One plan's rows, in the order they were written. */
export function coverageFor(contract, planId) {
  return (contract?.coverage || []).find((b) => b.planId === planId)?.rows || [];
}

/** The row already holding this scope on the plan, or null. */
export function coverageOverlap(contract, planId, row) {
  return (
    coverageFor(contract, planId).find(
      (r) =>
        r.id !== row.id &&
        r.scopeLevel === row.scopeLevel &&
        String(r.scopeValue ?? '') === String(row.scopeValue ?? ''),
    ) || null
  );
}

export const hasDefaultCoverage = (contract, planId) =>
  coverageFor(contract, planId).some((r) => r.scopeLevel === 'Default');

/** The linked plans with no fallback row — what the activation gate reads. */
export const plansMissingDefaultCoverage = (contract) =>
  plansOf(contract).filter((p) => !hasDefaultCoverage(contract, p.id));

export const planNameOf = (contract, planId) =>
  plansOf(contract).find((p) => p.id === planId)?.name || planId;

/** The row that splits one CDM item on this plan, narrowest first. */
export function resolveCoverage(contract, planId, item) {
  const rows = coverageFor(contract, planId);
  const pick = (level, value) =>
    rows.find((r) => r.scopeLevel === level && String(r.scopeValue ?? '') === String(value ?? ''));
  return (
    pick('Item', item?.id) ||
    pick('Category', item?.category) ||
    pick('Service Group', serviceGroupOf(item?.category)) ||
    rows.find((r) => r.scopeLevel === 'Default') ||
    null
  );
}

/** What the patient owes out of an allowed amount. Capped by the ceiling. */
export function patientShare(allowed, row) {
  const amount = Math.max(0, Number(allowed) || 0);
  if (!row) return 0;
  let share = 0;
  if (!row.covered) share = amount;
  else if (row.shareType === 'Co-pay %') share = (amount * (Number(row.shareValue) || 0)) / 100;
  else if (row.shareType === 'Fixed Co-pay') share = Math.min(Number(row.shareValue) || 0, amount);
  else if (row.shareType === 'Deductible then %') {
    const met = Math.min(Number(row.deductible) || 0, amount);
    share = met + ((amount - met) * (Number(row.shareValue) || 0)) / 100;
  }
  if (row.ceiling) share = Math.min(share, Number(row.ceiling));
  return cents(Math.min(share, amount));
}

export const payerShare = (allowed, row) =>
  cents(Math.max(0, Number(allowed) || 0) - patientShare(allowed, row));

/** The patient share of one row in a line — "20%", "$10.00", "$100.00 then 20%". */
export function shareSummary(row) {
  if (!row) return '—';
  if (!row.covered) return 'Full amount';
  const percent = `${Number(row.shareValue) || 0}%`;
  if (row.shareType === 'Co-pay %') return percent;
  if (row.shareType === 'Fixed Co-pay') return usd(row.shareValue);
  if (row.shareType === 'Deductible then %') return `${usd(row.deductible)} then ${percent}`;
  return '—';
}

// --- coverage writes ---------------------------------------------------------

/** Insert or replace one row on a plan. Returns the stored row. */
export function saveCoverageRow(contractId, planId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  const bucket = coverageBucket(contract, planId);
  const existing = data.id ? bucket.rows.find((r) => r.id === data.id) : null;
  const before = existing ? structuredClone(existing) : null;
  const covered = data.covered !== false;
  const row = {
    id: existing?.id || nestedId(allCoverageRows(contract), 'CV'),
    scopeLevel: data.scopeLevel,
    scopeValue: data.scopeLevel === 'Default' ? null : data.scopeValue,
    covered,
    ...cleanShare(covered, data),
    ceiling: covered && Number(data.ceiling) > 0 ? cents(data.ceiling) : null,
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, row);
  else bucket.rows.push(row);
  contract.updatedAt = row.updatedAt;
  store.commit('contract.coverage');

  const plan = planNameOf(contract, planId);
  if (!existing) {
    log(contract, 'Coverage row added', `${plan} · ${scopeLabel(row)} · ${coveredLabel(row)}`);
  } else {
    const changed = coverageDiff(before, row);
    if (changed.length) log(contract, 'Coverage row updated', `${plan} · ${scopeLabel(row)} — ${changed.join('; ')}`);
  }
  return row;
}

export function removeCoverageRow(contractId, planId, rowId) {
  const contract = get(contractId);
  const bucket = (contract?.coverage || []).find((b) => b.planId === planId);
  const row = bucket?.rows.find((r) => r.id === rowId);
  if (!row) return false;
  bucket.rows = bucket.rows.filter((r) => r.id !== rowId);
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.coverage');
  log(contract, 'Coverage row removed',
    `${planNameOf(contract, planId)} · ${scopeLabel(row)} · ${coveredLabel(row)}`);
  return true;
}

/**
 * Copy one plan's rows onto another. Replace clears the target first; Merge
 * keeps every row the target already holds and adds only the missing scopes.
 * Returns how many rows were written.
 */
export function copyCoverage(contractRef, fromPlanId, toPlanId, mode = 'Replace') {
  const contract = typeof contractRef === 'string' ? get(contractRef) : contractRef;
  if (!contract || !fromPlanId || !toPlanId || fromPlanId === toPlanId) return 0;

  const source = coverageFor(contract, fromPlanId);
  const target = coverageBucket(contract, toPlanId);
  const kept = mode === 'Merge' ? [...target.rows] : [];
  const held = new Set(kept.map(scopeKey));
  const incoming = source.filter((r) => !held.has(scopeKey(r)));

  let serial = maxNestedSerial(allCoverageRows(contract));
  target.rows = [
    ...kept,
    ...incoming.map((r) => ({ ...structuredClone(r), id: `CV-${String(++serial).padStart(3, '0')}` })),
  ];
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.coverage');
  log(contract, 'Coverage copied',
    `${planNameOf(contract, toPlanId)} · Coverage copied from ${planNameOf(contract, fromPlanId)} — `
    + `${mode === 'Merge' ? 'merged' : 'replaced'}, ${incoming.length} row${incoming.length === 1 ? '' : 's'}`);
  return incoming.length;
}

/** How many rows a copy would write — the dialog's "Will copy N rows". */
export function coverageCopyCount(contract, fromPlanId, toPlanId, mode = 'Replace') {
  if (!contract || !fromPlanId || !toPlanId || fromPlanId === toPlanId) return 0;
  const source = coverageFor(contract, fromPlanId);
  if (mode !== 'Merge') return source.length;
  const held = new Set(coverageFor(contract, toPlanId).map(scopeKey));
  return source.filter((r) => !held.has(scopeKey(r))).length;
}

// --- coverage internals ------------------------------------------------------

const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;
const scopeKey = (row) => `${row.scopeLevel}|${row.scopeValue ?? ''}`;
const allCoverageRows = (contract) => (contract.coverage || []).flatMap((b) => b.rows);
const coveredLabel = (row) => (row.covered ? `patient pays ${shareSummary(row)}` : 'not covered');

function coverageBucket(contract, planId) {
  if (!Array.isArray(contract.coverage)) contract.coverage = [];
  let bucket = contract.coverage.find((b) => b.planId === planId);
  if (!bucket) {
    bucket = { planId, rows: [] };
    contract.coverage.push(bucket);
  }
  return bucket;
}

/** Only the share fields the chosen type uses, as numbers. */
function cleanShare(covered, data) {
  const type = covered ? data.shareType || 'None' : 'None';
  if (type === 'None') return { shareType: 'None', shareValue: 0, deductible: 0 };
  if (type === 'Deductible then %') {
    return { shareType: type, shareValue: Number(data.shareValue) || 0, deductible: cents(data.deductible) };
  }
  const value = type === 'Fixed Co-pay' ? cents(data.shareValue) : Number(data.shareValue) || 0;
  return { shareType: type, shareValue: value, deductible: 0 };
}

const COVERAGE_LABELS = {
  scopeLevel: 'scope level',
  scopeValue: 'scope value',
  covered: 'covered',
  shareType: 'share type',
  shareValue: 'share value',
  deductible: 'deductible',
  ceiling: 'ceiling',
};

function coverageDiff(before, after) {
  const yesNo = (row) => ({ ...row, covered: row.covered ? 'yes' : 'no' });
  const was = yesNo(before);
  const now = yesNo(after);
  return Object.entries(COVERAGE_LABELS)
    .filter(([key]) => String(was[key] ?? '') !== String(now[key] ?? ''))
    .map(([key, text]) => `${text} ${show(was[key])} → ${show(now[key])}`);
}

// --- pre-authorization -------------------------------------------------------
// Which charges the payer has to approve before they are delivered. Rows are
// nested on the contract and read back by precedence — Item, then Category,
// then Service Group — so a narrow row overrides a wide one, and an Item row
// that requires nothing is an exemption inside a broader requirement. An empty
// matrix means nothing needs approval, so this is never a gate for activation.

export const PREAUTH_LEVELS = ['Service Group', 'Category', 'Item'];

export const preAuthRows = (contract) => (Array.isArray(contract?.preAuth) ? contract.preAuth : []);

/** What a pre-auth scope value is called on screen — an item by its name. */
export const preAuthScopeName = (row) =>
  (row?.scopeLevel === 'Item' ? cdm.label(cdm.get(row.scopeValue)) || row.scopeValue : row?.scopeValue) || '—';

export const preAuthLabel = (row) => (row ? `${row.scopeLevel}: ${preAuthScopeName(row)}` : '—');

/** "Always", "Above $300", or "—" for a row that requires nothing. */
export function thresholdLabel(row) {
  if (!row?.required) return '—';
  return row.threshold == null || row.threshold === '' ? 'Always' : `Above ${usd(row.threshold)}`;
}

/** The row already holding this scope, or null — one row per scope and value. */
export function preAuthOverlap(contract, row) {
  return (
    preAuthRows(contract).find(
      (p) =>
        p.id !== row.id &&
        p.scopeLevel === row.scopeLevel &&
        String(p.scopeValue ?? '') === String(row.scopeValue ?? ''),
    ) || null
  );
}

/** The scopes wider than this row's. */
function widerScopes(row) {
  if (row.scopeLevel === 'Item') {
    const item = cdm.get(row.scopeValue);
    return [['Category', item?.category], ['Service Group', serviceGroupOf(item?.category)]];
  }
  if (row.scopeLevel === 'Category') return [['Service Group', serviceGroupOf(row.scopeValue)]];
  return [];
}

/** A "No" row sitting inside a broader requirement — what the matrix tags. */
export function isPreAuthExemption(contract, row) {
  if (!row || row.required) return false;
  const rows = preAuthRows(contract);
  return widerScopes(row).some(([level, value]) =>
    rows.some(
      (p) => p.required && p.scopeLevel === level && String(p.scopeValue ?? '') === String(value ?? ''),
    ));
}

/** The rows covering one charge, widest first. */
function preAuthLadder(contract, item) {
  const rows = preAuthRows(contract);
  const pick = (level, value) =>
    rows.find((p) => p.scopeLevel === level && String(p.scopeValue ?? '') === String(value ?? ''));
  return [
    pick('Service Group', serviceGroupOf(item?.category)),
    pick('Category', item?.category),
    pick('Item', item?.id),
  ].filter(Boolean);
}

/**
 * Whether one charge needs pre-authorization at that amount, which row decided
 * it and why. The narrowest row wins outright, so an Item row requiring nothing
 * exempts a charge a broader row would have held.
 *
 * Conditional pre-auth from the rule engine (diagnosis, age, length of stay)
 * merges here in part F — a matching rule overrides this answer.
 */
export function resolvePreAuth(contract, item, amount = 0) {
  const ladder = preAuthLadder(contract, item);
  const source = ladder[ladder.length - 1] || null;
  if (!source) return { required: false, source: null, reason: 'Not required — no rule covers this charge' };

  const level = source.scopeLevel.toLowerCase();
  if (!source.required) {
    return {
      required: false,
      source,
      reason: ladder.slice(0, -1).some((p) => p.required)
        ? `Not required (exempt by ${level} rule: ${preAuthScopeName(source)})`
        : `Not required — ${level} rule: ${preAuthScopeName(source)}`,
    };
  }
  if (source.threshold == null) {
    return {
      required: true,
      source,
      reason: `Pre-auth required — ${source.scopeLevel} rule: ${preAuthScopeName(source)} (always)`,
    };
  }
  const value = Number(amount) || 0;
  if (value > Number(source.threshold)) {
    return { required: true, source, reason: `Required above ${usd(source.threshold)} — amount ${usd(value)} exceeds it` };
  }
  return {
    required: false,
    source,
    reason: `Not required — ${preAuthScopeName(source)} needs approval above ${usd(source.threshold)}, and ${usd(value)} is under it`,
  };
}

/** Insert or replace one pre-auth row. Returns the stored row. */
export function savePreAuth(contractId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  if (!Array.isArray(contract.preAuth)) contract.preAuth = [];
  const rows = contract.preAuth;
  const existing = data.id ? rows.find((p) => p.id === data.id) : null;
  const before = existing ? { ...existing } : null;
  const required = data.required !== false;
  const threshold = String(data.threshold ?? '').trim();
  const row = {
    id: existing?.id || nestedId(rows, 'PA'),
    scopeLevel: data.scopeLevel,
    scopeValue: data.scopeValue,
    required,
    threshold: required && threshold !== '' ? Math.round(Number(threshold) * 100) / 100 : null,
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, row);
  else rows.push(row);
  contract.updatedAt = row.updatedAt;
  store.commit('contract.preauth');

  if (!existing) {
    log(contract, 'Pre-auth row added',
      `${preAuthLabel(row)} · ${row.required ? 'required' : 'not required'} · ${thresholdLabel(row)}`);
  } else {
    const changed = preAuthDiff(before, row);
    if (changed.length) log(contract, 'Pre-auth row updated', `${preAuthLabel(row)} — ${changed.join('; ')}`);
  }
  return row;
}

export function removePreAuth(contractId, preAuthId) {
  const contract = get(contractId);
  const row = preAuthRows(contract).find((p) => p.id === preAuthId);
  if (!row) return false;
  contract.preAuth = preAuthRows(contract).filter((p) => p.id !== preAuthId);
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.preauth');
  log(contract, 'Pre-auth row removed',
    `${preAuthLabel(row)} · ${row.required ? 'required' : 'not required'} · ${thresholdLabel(row)}`);
  return true;
}

// --- referral required -------------------------------------------------------
// Whether the payer wants a doctor's referral before it will answer for a
// charge. It reads the way pre-auth does, with one level more: a Contract row
// is the blanket answer for everything the agreement covers, and a narrower row
// overrides it — which is how a plan that requires a referral for everything
// still lets a consultation walk in.

export const REFERRAL_LEVELS = ['Contract', 'Service Group', 'Category', 'Item'];

export const referralRows = (contract) =>
  (Array.isArray(contract?.referralRequired) ? contract.referralRequired : []);

/** What a referral scope value is called on screen — an item by its name. */
export const referralScopeName = (row) => {
  if (!row) return '—';
  if (row.scopeLevel === 'Contract') return 'Whole contract';
  return (row.scopeLevel === 'Item' ? cdm.label(cdm.get(row.scopeValue)) || row.scopeValue : row.scopeValue) || '—';
};

export const referralLabel = (row) =>
  (!row ? '—' : row.scopeLevel === 'Contract' ? 'Whole contract' : `${row.scopeLevel}: ${referralScopeName(row)}`);

/** The row already holding this scope, or null — one row per scope and value. */
export function referralOverlap(contract, row) {
  return (
    referralRows(contract).find(
      (p) =>
        p.id !== row.id &&
        p.scopeLevel === row.scopeLevel &&
        String(p.scopeValue ?? '') === String(row.scopeValue ?? ''),
    ) || null
  );
}

/** The rows covering one charge, widest first. A null item asks the contract. */
function referralLadder(contract, item) {
  const rows = referralRows(contract);
  const pick = (level, value) =>
    rows.find((p) => p.scopeLevel === level && String(p.scopeValue ?? '') === String(value ?? ''));
  return [
    pick('Contract', null),
    item ? pick('Service Group', serviceGroupOf(item.category)) : null,
    item ? pick('Category', item.category) : null,
    item ? pick('Item', item.id) : null,
  ].filter(Boolean);
}

/**
 * Whether one charge needs a referral, and which row decided it. The narrowest
 * row wins outright, so a category row saying No exempts a charge the contract
 * row would have held. With no item the question is the contract's own answer,
 * which is what a pre-admission check with no services named can ask.
 */
export function referralAnswer(contract, item = null) {
  const ladder = referralLadder(contract, item);
  const source = ladder[ladder.length - 1] || null;
  if (!source) return { required: false, source: null, reason: 'No referral rule covers this charge' };
  return {
    required: Boolean(source.required),
    source,
    reason: source.required
      ? `Referral required — ${referralLabel(source)}`
      : `No referral needed — ${referralLabel(source)}`,
  };
}

/** The boolean the eligibility engine and the encounter flag both read. */
export const referralRequired = (contract, item = null) => referralAnswer(contract, item).required;

/** Insert or replace one referral-required row. Returns the stored row. */
export function saveReferralRequired(contractId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  if (!Array.isArray(contract.referralRequired)) contract.referralRequired = [];
  const rows = contract.referralRequired;
  const existing = data.id ? rows.find((p) => p.id === data.id) : null;
  const before = existing ? { ...existing } : null;
  const row = {
    id: existing?.id || nestedId(rows, 'RR'),
    scopeLevel: data.scopeLevel,
    scopeValue: data.scopeLevel === 'Contract' ? null : data.scopeValue,
    required: data.required !== false,
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, row);
  else rows.push(row);
  contract.updatedAt = row.updatedAt;
  store.commit('contract.referral');

  const said = (r) => (r.required ? 'required' : 'not required');
  if (!existing) log(contract, 'Referral row added', `${referralLabel(row)} · ${said(row)}`);
  else if (said(before) !== said(row) || before.scopeValue !== row.scopeValue) {
    log(contract, 'Referral row updated',
      `${referralLabel(row)} — referral ${said(before)} → ${said(row)}`);
  }
  return row;
}

export function removeReferralRequired(contractId, rowId) {
  const contract = get(contractId);
  const row = referralRows(contract).find((p) => p.id === rowId);
  if (!row) return false;
  contract.referralRequired = referralRows(contract).filter((p) => p.id !== rowId);
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.referral');
  log(contract, 'Referral row removed',
    `${referralLabel(row)} · ${row.required ? 'required' : 'not required'}`);
  return true;
}

// --- documentation required --------------------------------------------------
// What the payer wants attached to a claim before it will read it: a discharge
// summary with every admission, an operative note with any surgery over a
// threshold, an imaging report with the film. Rows are scoped the way referral
// rows are, but they do not override each other — every row whose scope covers
// a line adds its document types, because a payer that wants a summary for the
// whole contract and a report for the imaging on it wants both. A threshold
// narrows a row to lines (or, on a Contract row, claims) worth more than it.
// Amendment 27; read by the claim assembler and the scrubber through the
// claims repository.

export const DOC_LEVELS = ['Contract', 'Service Group', 'Category', 'Item'];

/** The document types a clinical record can hold — the vocabulary the coding feature files under. */
export const DOC_TYPES = [
  'Discharge Summary', 'Operative Note', 'Progress Note', 'Lab Report', 'Imaging Report', 'Consent',
];

export const documentationRows = (contract) =>
  (Array.isArray(contract?.documentationRequired) ? contract.documentationRequired : []);

export const documentationScopeName = (row) => {
  if (!row) return '—';
  if (row.scopeLevel === 'Contract') return 'Whole contract';
  return (row.scopeLevel === 'Item' ? cdm.label(cdm.get(row.scopeValue)) || row.scopeValue : row.scopeValue) || '—';
};

export const documentationLabel = (row) =>
  (!row ? '—' : row.scopeLevel === 'Contract' ? 'Whole contract' : `${row.scopeLevel}: ${documentationScopeName(row)}`);

export const documentationThresholdLabel = (row) =>
  (row?.thresholdAmount == null ? 'Always' : `Above ${usd(row.thresholdAmount)}`);

/** The row already holding this scope, or null — one row per scope and value. */
export function documentationOverlap(contract, row) {
  return (
    documentationRows(contract).find(
      (p) =>
        p.id !== row.id &&
        p.scopeLevel === row.scopeLevel &&
        String(p.scopeValue ?? '') === String(row.scopeValue ?? ''),
    ) || null
  );
}

/** Whether one row's scope covers one charge line. A Contract row covers every line. */
function documentationCovers(row, item) {
  if (row.scopeLevel === 'Contract') return true;
  if (!item) return false;
  if (row.scopeLevel === 'Service Group') return row.scopeValue === serviceGroupOf(item.category);
  if (row.scopeLevel === 'Category') return row.scopeValue === item.category;
  return row.scopeValue === item.id;
}

/**
 * The documents a claim has to carry, read over its lines. `lines` are
 * `{ id, item, amount }` and `total` is the claim's payer share, which is what a
 * Contract-level threshold is measured against; a narrower row's threshold is
 * measured against the line. Returns one entry per document type —
 * `{ docType, sources: [row], lineIds, reason }` — so the assembler can mark
 * which attachment satisfies which requirement and the scrubber can name what
 * is missing.
 */
export function documentationFor(contract, lines = [], total = 0) {
  const out = new Map();
  for (const row of documentationRows(contract)) {
    const threshold = row.thresholdAmount == null ? null : Number(row.thresholdAmount);
    let lineIds;
    if (row.scopeLevel === 'Contract') {
      if (threshold != null && !(Number(total) > threshold)) continue;
      lineIds = [];
    } else {
      lineIds = lines
        .filter((line) => documentationCovers(row, line.item))
        .filter((line) => threshold == null || Number(line.amount) > threshold)
        .map((line) => line.id);
      if (!lineIds.length) continue;
    }
    for (const docType of row.docTypes || []) {
      const entry = out.get(docType) || { docType, sources: [], lineIds: [], reason: '' };
      entry.sources.push(row);
      entry.lineIds = [...new Set([...entry.lineIds, ...lineIds])];
      out.set(docType, entry);
    }
  }
  for (const entry of out.values()) {
    entry.reason = entry.sources
      .map((row) => `${documentationLabel(row)} · ${documentationThresholdLabel(row).toLowerCase()}`)
      .join('; ');
  }
  return [...out.values()];
}

/** Insert or replace one documentation-required row. Returns the stored row. */
export function saveDocumentationRequired(contractId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  if (!Array.isArray(contract.documentationRequired)) contract.documentationRequired = [];
  const rows = contract.documentationRequired;
  const existing = data.id ? rows.find((p) => p.id === data.id) : null;
  const before = existing ? { ...existing, docTypes: [...(existing.docTypes || [])] } : null;
  const threshold = String(data.thresholdAmount ?? '').trim();
  const row = {
    id: existing?.id || nestedId(rows, 'DR'),
    scopeLevel: data.scopeLevel,
    scopeValue: data.scopeLevel === 'Contract' ? null : data.scopeValue,
    docTypes: (data.docTypes || []).filter((t) => DOC_TYPES.includes(t)),
    thresholdAmount: threshold === '' ? null : Math.round(Number(threshold) * 100) / 100,
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, row);
  else rows.push(row);
  contract.updatedAt = row.updatedAt;
  store.commit('contract.documentation');

  const said = (r) => `${(r.docTypes || []).join(', ') || '—'} · ${documentationThresholdLabel(r).toLowerCase()}`;
  if (!existing) log(contract, 'Documentation row added', `${documentationLabel(row)} · ${said(row)}`);
  else if (said(before) !== said(row) || before.scopeValue !== row.scopeValue || before.scopeLevel !== row.scopeLevel) {
    log(contract, 'Documentation row updated', `${documentationLabel(row)} — ${said(before)} → ${said(row)}`);
  }
  return row;
}

export function removeDocumentationRequired(contractId, rowId) {
  const contract = get(contractId);
  const row = documentationRows(contract).find((p) => p.id === rowId);
  if (!row) return false;
  contract.documentationRequired = documentationRows(contract).filter((p) => p.id !== rowId);
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.documentation');
  log(contract, 'Documentation row removed',
    `${documentationLabel(row)} · ${(row.docTypes || []).join(', ') || '—'} · ${documentationThresholdLabel(row).toLowerCase()}`);
  return true;
}

// --- rules -------------------------------------------------------------------
// A rule is IF conditions THEN one action, nested on the contract and run in
// priority order. Everything that decides an outcome lives in the engine; this
// section stores the rows, orders them and writes the trail.

export const RULE_STATUSES = ['Active', 'Inactive'];
export const RULE_EVALUATIONS = engine.EVALUATIONS;
export const ACTION_TYPES = engine.ACTION_TYPES;
export const PRIORITY_STEP = 10;

export const rules = (contract) => engine.rulesOf(contract);
export const activeRules = (contract) => engine.orderedRules(contract);
export const activeRuleCount = (contract) => activeRules(contract).length;
export const getRule = (contract, ruleId) => rules(contract).find((r) => r.id === ruleId) || null;

export const ruleEvaluation = (contract) =>
  (contract?.ruleEvaluation === 'all-match' ? 'all-match' : 'first-match');

/** Rules follow the contract's own editability — a closed contract is frozen. */
export const rulesReadOnly = (contract) =>
  contract?.status === 'Expired' || contract?.status === 'Terminated';

/** Plan ids read as plan names inside a rule sentence. */
const planResolver = (contract) => (attrKey, value) =>
  (attrKey === 'patient.plan' && value ? planNameOf(contract, value) : null);

export const ruleSummary = (contract, rule) => engine.summarize(rule, planResolver(contract));
export const ruleConditionsText = (contract, rule) => engine.conditionsText(rule, planResolver(contract));
export const ruleActionSummary = (action) => engine.actionSummary(action);
export const evaluateRules = (contract, ctx) => engine.evaluate(contract, ctx);
export const ruleConflicts = (contract) => engine.findConflicts(contract);

/** The next free slot, leaving room to insert a rule before it later. */
export function nextRulePriority(contract) {
  const highest = rules(contract).reduce((n, r) => Math.max(n, Number(r.priority) || 0), 0);
  return highest + PRIORITY_STEP;
}

/** Insert or replace one rule. Returns the stored rule. */
export function saveRule(contractId, data) {
  const contract = get(contractId);
  if (!contract) return null;
  if (!Array.isArray(contract.rules)) contract.rules = [];
  const list = contract.rules;
  const existing = data.id ? list.find((r) => r.id === data.id) : null;
  const before = existing ? structuredClone(existing) : null;
  const rule = {
    id: existing?.id || nestedId(list, 'RL'),
    name: String(data.name || '').trim(),
    description: String(data.description || '').trim(),
    priority: Number(data.priority) || 0,
    status: data.status === 'Inactive' ? 'Inactive' : 'Active',
    conditions: structuredClone(data.conditions || { op: 'AND', items: [] }),
    action: { type: data.action?.type || '', params: { ...(data.action?.params || {}) } },
    updatedAt: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, rule);
  else list.push(rule);
  contract.updatedAt = rule.updatedAt;
  store.commit('contract.rule');

  if (!existing) logRule(contract, 'Rule added', rule, ruleSummary(contract, rule));
  else {
    const changed = ruleDiff(contract, before, rule);
    if (changed.length) logRule(contract, 'Rule updated', rule, changed.join('; '));
  }
  return rule;
}

export function setRuleStatus(contractId, ruleId, status) {
  const contract = get(contractId);
  const rule = getRule(contract, ruleId);
  if (!rule || !RULE_STATUSES.includes(status) || rule.status === status) return null;
  rule.status = status;
  rule.updatedAt = new Date().toISOString();
  contract.updatedAt = rule.updatedAt;
  store.commit('contract.rule');
  logRule(contract, status === 'Active' ? 'Rule activated' : 'Rule deactivated', rule,
    `priority ${rule.priority} · ${engine.actionSummary(rule.action)}`);
  return rule;
}

/** A copy to edit: same conditions, Inactive, one slot later. */
export function duplicateRule(contractId, ruleId) {
  const contract = get(contractId);
  const source = getRule(contract, ruleId);
  if (!source) return null;
  const copy = {
    ...structuredClone(source),
    id: nestedId(contract.rules, 'RL'),
    name: `${source.name} (copy)`,
    status: 'Inactive',
    priority: (Number(source.priority) || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  contract.rules.push(copy);
  contract.updatedAt = copy.updatedAt;
  store.commit('contract.rule');
  logRule(contract, 'Rule duplicated', copy, `copied from ${source.id} · ${source.name}`);
  return copy;
}

export function setRuleEvaluation(contractId, mode) {
  const contract = get(contractId);
  if (!contract) return null;
  const next = mode === 'all-match' ? 'all-match' : 'first-match';
  const before = ruleEvaluation(contract);
  if (before === next) return contract;
  contract.ruleEvaluation = next;
  contract.updatedAt = new Date().toISOString();
  store.commit('contract.rule');
  log(contract, 'Rule evaluation changed', `${labelOfEvaluation(before)} → ${labelOfEvaluation(next)}`);
  return contract;
}

const labelOfEvaluation = (key) => RULE_EVALUATIONS.find((e) => e.key === key)?.label || key;

// --- internals ---------------------------------------------------------------

/** Rule entries carry the rule id, so one rule's trail can be read back out. */
function logRule(contract, action, rule, details) {
  log(contract, action, `${rule.id} · ${rule.name} — ${details}`);
}

/** The audit entries belonging to one rule, newest first. */
export function ruleHistory(contract, ruleId) {
  if (!contract) return [];
  return audit
    .forEntity(ENTITY, contract.lineageId)
    .filter((row) => String(row.details || '').includes(` ${ruleId} · `));
}

const RULE_LABELS = { name: 'name', description: 'description', priority: 'priority', status: 'status' };

function ruleDiff(contract, before, after) {
  const changed = Object.entries(RULE_LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(before[key])} → ${show(after[key])}`);
  const was = ruleSummary(contract, before);
  const now = ruleSummary(contract, after);
  if (was !== now) changed.push(`${was} → ${now}`);
  return changed;
}

function log(row, action, details) {
  audit.log({ entity: ENTITY, entityId: row.lineageId, action, details: `v${row.version} · ${details}` });
}

/** Ids for the rows nested on a contract: MT-001, OV-001, CV-001. */
function nestedId(list, prefix) {
  return `${prefix}-${String(maxNestedSerial(list) + 1).padStart(3, '0')}`;
}

/** The highest serial in use, so a batch of new rows can keep counting. */
function maxNestedSerial(list) {
  return (list || []).reduce((n, r) => Math.max(n, Number(String(r.id).split('-')[1]) || 0), 0);
}

/** Only the fields the chosen method uses, as numbers. */
function cleanParams(method, p = {}) {
  const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
  if (method === '% of Charges') return { percent: Number(p.percent) || 0 };
  if (method === 'Fixed Amount') {
    return { feeSchedule: (p.feeSchedule || []).map((f) => ({ itemId: f.itemId, price: money(f.price) })) };
  }
  if (method === 'Per Diem') return { amount: money(p.amount), wardType: p.wardType || 'General' };
  if (method === 'Case Rate') return { amount: money(p.amount), bundleId: p.bundleId || '' };
  if (method === 'DRG') return { baseRate: money(p.baseRate), weightSource: p.weightSource || 'Local' };
  if (method === 'Capitation') {
    return { perMemberPerMonth: money(p.perMemberPerMonth), memberCount: Number(p.memberCount) || 0 };
  }
  return {};
}

function cleanTolerance(t) {
  if (!t || !t.type) return null;
  return { type: t.type, value: Math.round((Number(t.value) || 0) * 100) / 100 };
}

const METHODOLOGY_LABELS = {
  scopeLevel: 'scope level',
  scopeValue: 'scope value',
  method: 'methodology',
  effectiveFrom: 'effective from',
  effectiveTo: 'effective to',
};

/** Field-level diff. A fee schedule is listed per item, never as a count. */
function methodologyDiff(before, after) {
  const changed = Object.entries(METHODOLOGY_LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(before[key])} → ${show(after[key])}`);

  if (before.method === 'Fixed Amount' && after.method === 'Fixed Amount') {
    changed.push(...scheduleDiff(before.params.feeSchedule || [], after.params.feeSchedule || []));
  } else if (methodologySummary(before) !== methodologySummary(after)) {
    changed.push(`parameters ${methodologySummary(before)} → ${methodologySummary(after)}`);
  }
  return changed;
}

function scheduleDiff(before, after) {
  const code = (id) => cdm.get(id)?.chargeCode || id;
  const was = new Map(before.map((f) => [f.itemId, Number(f.price)]));
  const now = new Map(after.map((f) => [f.itemId, Number(f.price)]));
  const changed = [];
  for (const [id, price] of now) {
    if (!was.has(id)) changed.push(`${code(id)} added at ${usd(price)}`);
    else if (was.get(id) !== price) changed.push(`${code(id)} ${usd(was.get(id))} → ${usd(price)}`);
  }
  for (const id of was.keys()) if (!now.has(id)) changed.push(`${code(id)} removed`);
  return changed;
}

const PREAUTH_LABELS = { scopeLevel: 'scope level', scopeValue: 'scope value' };

/** Field-level diff for one pre-auth row — the scope, the answer, the money. */
function preAuthDiff(before, after) {
  const name = (row) => (row.scopeLevel === 'Item' ? preAuthScopeName(row) : row.scopeValue);
  const changed = Object.entries(PREAUTH_LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(key === 'scopeValue' ? name(before) : before[key])} → ${
      show(key === 'scopeValue' ? name(after) : after[key])}`);
  const yesNo = (row) => (row.required ? 'Yes' : 'No');
  if (yesNo(before) !== yesNo(after)) changed.push(`pre-auth required ${yesNo(before)} → ${yesNo(after)}`);
  if (String(before.threshold ?? '') !== String(after.threshold ?? '')) {
    changed.push(`threshold ${thresholdLabel(before)} → ${thresholdLabel(after)}`);
  }
  return changed;
}

function newLineageId() {
  const max = all().reduce((n, c) => {
    const digits = Number(String(c.lineageId).replace('CL-', ''));
    return Number.isFinite(digits) && digits > n ? digits : n;
  }, 0);
  return `CL-${String(max + 1).padStart(4, '0')}`;
}

const show = (v) => (v === '' || v == null ? '—' : String(v));

function diff(before, after) {
  const changed = Object.entries(FIELD_LABELS)
    .filter(([key]) => String(before[key] ?? '') !== String(after[key] ?? ''))
    .map(([key, text]) => `${text} ${show(before[key])} → ${show(after[key])}`);
  if (before.planIds.join() !== after.planIds.join()) {
    changed.push(`plans ${before.planIds.length} → ${after.planIds.length}`);
  }
  if ((before.document?.fileName || '') !== (after.document?.fileName || '')) {
    changed.push(`document ${show(before.document?.fileName)} → ${show(after.document?.fileName)}`);
  }
  return changed;
}

// Active contracts past their end date are Expired before any screen reads the
// list — the same rule cdm.js applies to promotional bundles on load.
expireContracts();
