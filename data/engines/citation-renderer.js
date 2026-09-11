// Engine — contract citations (amendment 38). Given a pointer into the
// contract version stamped on a claim — a methodology row, a coverage row on
// a plan, a pre-auth entry, a referral or documentation rule, a billing rule,
// or the term itself — it renders the sentence an appeal letter cites:
// "Contract CT-2026-002 v1, Coverage (Gold plan) CV-001: Default — covered,
// patient share 20%, ceiling $500.00; in force on the date of service
// 2026-04-15". It also lists everything on that version a picker can cite.
//
// It reads the version by its own id and nothing else. `contracts.get(id)`
// is the stamped-version accessor: a claim stores the id of the version it
// was priced under (`claim.contractId`), and that record never changes
// identity — a corrected agreement is a new version with a new id. Nothing
// here resolves a lineage to its current version or asks which contract
// covers a plan today (`currentOf`, `contractForService`): an appeal argues
// the terms that were in force on the date of service, and those are the
// stamped ones. `assertStamped` is the guard, and the picker asserts it too.
//
// Reads the contracts repository (and, through it, the charge master for
// item names) and is read by no repository — the billing engine's position in
// the layering. The appeal-cases repository stores the rendered text the
// screen hands it, so the citation on a case is what was read at the time it
// was cited and does not move with the version afterwards.

import * as contracts from '../repositories/contracts.js';
import { date, esc, usd, withinDates } from '../../shared/format.js';

export const SECTIONS = [
  { id: 'term', label: 'Term and status' },
  { id: 'methodology', label: 'Rate methodology' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'preAuth', label: 'Pre-authorisation' },
  { id: 'referral', label: 'Referral required' },
  { id: 'documentation', label: 'Documentation required' },
  { id: 'rule', label: 'Billing rule' },
];

export const sectionLabel = (id) => SECTIONS.find((s) => s.id === id)?.label || id || '—';

/** The stamped version, by its id — never by lineage, payer or date. */
export function versionOf(sourceRef) {
  const id = typeof sourceRef === 'string' ? sourceRef : sourceRef?.contractId;
  return id ? contracts.get(id) : null;
}

/** `assertStamped(ref)` → the version, or throws: a citation points at one version record and nothing else. */
export function assertStamped(sourceRef) {
  const contract = versionOf(sourceRef);
  console.assert(!sourceRef?.lineageId && !sourceRef?.planLookup, '[citation-renderer] a citation names a version id, never a lineage');
  if (!contract) throw new Error(`No contract version ${sourceRef?.contractId || sourceRef || '—'} — a citation reads the stamped version only`);
  return contract;
}

const head = (c) => `Contract ${c.contractNo} v${c.version}`;

/** The row a pointer names on the version, or null. */
export function rowOf(sourceRef) {
  const c = versionOf(sourceRef);
  if (!c) return null;
  const { section, rowId, planId } = sourceRef;
  if (section === 'term') return c;
  if (section === 'methodology') return contracts.methodologies(c).find((r) => r.id === rowId) || null;
  if (section === 'coverage') return contracts.coverageFor(c, planId).find((r) => r.id === rowId) || null;
  if (section === 'preAuth') return contracts.preAuthRows(c).find((r) => r.id === rowId) || null;
  if (section === 'referral') return contracts.referralRows(c).find((r) => r.id === rowId) || null;
  if (section === 'documentation') return contracts.documentationRows(c).find((r) => r.id === rowId) || null;
  if (section === 'rule') return contracts.getRule(c, rowId);
  return null;
}

/** The one-line summary of a row in its section's own words. */
export function summarize(sourceRef, row = rowOf(sourceRef)) {
  const c = versionOf(sourceRef);
  if (!c || !row) return '';
  const { section, planId } = sourceRef;
  if (section === 'term') {
    return `${c.name} — term ${date(c.startDate)} to ${date(c.endDate)}, ${c.status.toLowerCase()}${c.terminationDate ? `, terminated ${date(c.terminationDate)}` : ''}; plans ${contracts.plansOf(c).map((p) => p.name).join(', ') || '—'}`;
  }
  if (section === 'methodology') {
    return `${contracts.scopeLabel(row)} — ${row.method} ${contracts.methodologySummary(row)}, effective ${date(row.effectiveFrom)} to ${date(row.effectiveTo)}`;
  }
  if (section === 'coverage') {
    const plan = contracts.planNameOf(c, planId);
    return `${plan} plan, ${contracts.scopeLabel(row)} — ${row.covered ? `covered, patient share ${contracts.shareSummary(row)}` : 'not covered'}${
      row.covered && row.ceiling ? `, ceiling ${usd(row.ceiling)}` : ''}${row.covered && row.deductible ? `, deductible ${usd(row.deductible)}` : ''}`;
  }
  if (section === 'preAuth') {
    return `${contracts.preAuthLabel(row)} — ${row.required ? `pre-authorisation required ${contracts.thresholdLabel(row).toLowerCase()}` : 'exempt from pre-authorisation'}`;
  }
  if (section === 'referral') {
    return `${contracts.referralLabel(row)} — ${row.required ? 'referral required' : 'no referral needed'}`;
  }
  if (section === 'documentation') {
    return `${contracts.documentationLabel(row)} — ${(row.docTypes || []).join(', ')} ${contracts.documentationThresholdLabel(row).toLowerCase()}`;
  }
  if (section === 'rule') {
    return `${row.name} (priority ${row.priority}, ${String(row.status).toLowerCase()}) — ${contracts.ruleSummary(c, row)}`;
  }
  return '';
}

/** Whether the row was in force on the date of service — a dated row by its dates, the rest by the term. */
export function inForceOn(sourceRef, dos, row = rowOf(sourceRef)) {
  const c = versionOf(sourceRef);
  if (!c || !row || !dos) return null;
  if (sourceRef.section === 'methodology') return withinDates(dos, row.effectiveFrom, row.effectiveTo);
  if (sourceRef.section === 'rule') return row.status === 'Active' && withinDates(dos, c.startDate, c.endDate);
  return withinDates(dos, c.startDate, c.endDate);
}

/**
 * render(sourceRef, { dos }) → "Contract {no} v{n}, {section} {row}: {summary};
 * in force on the date of service {dos}". The text the case stores.
 */
export function render(sourceRef, { dos = null } = {}) {
  const c = assertStamped(sourceRef);
  const row = rowOf(sourceRef);
  if (!row) return `${head(c)}, ${sectionLabel(sourceRef.section)} ${sourceRef.rowId || ''}: (row no longer on this version)`;
  const where = sourceRef.section === 'term' ? 'Term' : `${sectionLabel(sourceRef.section)} ${sourceRef.rowId}`;
  const force = inForceOn(sourceRef, dos, row);
  const tail = dos ? (force ? `; in force on the date of service ${date(dos)}` : `; not in force on the date of service ${date(dos)}`) : '';
  return `${head(c)}, ${where}: ${summarize(sourceRef, row)}${tail}`;
}

/**
 * browse(contractId, { planId, dos }) → every citable row on the version,
 * grouped by section, each `{ sourceRef, section, label, summary, inForce,
 * renderedText }`. The picker draws this list; `planId` narrows coverage to
 * the plan the claim was filed on (every plan when omitted).
 */
export function browse(contractId, { planId = null, dos = null } = {}) {
  const c = assertStamped({ contractId });
  const mk = (section, rowId, extra = {}) => {
    const sourceRef = { contractId: c.id, section, rowId, ...extra };
    const row = rowOf(sourceRef);
    return {
      sourceRef, section, rowId,
      label: rowId ? `${sectionLabel(section)} ${rowId}` : 'Term',
      summary: summarize(sourceRef, row),
      inForce: inForceOn(sourceRef, dos, row),
      renderedText: render(sourceRef, { dos }),
    };
  };
  const out = [mk('term', null)];
  for (const r of contracts.methodologies(c)) out.push(mk('methodology', r.id));
  const buckets = (c.coverage || []).filter((b) => !planId || b.planId === planId);
  for (const b of buckets) for (const r of b.rows || []) out.push(mk('coverage', r.id, { planId: b.planId }));
  for (const r of contracts.preAuthRows(c)) out.push(mk('preAuth', r.id));
  for (const r of contracts.referralRows(c)) out.push(mk('referral', r.id));
  for (const r of contracts.documentationRows(c)) out.push(mk('documentation', r.id));
  for (const r of contracts.rules(c)) out.push(mk('rule', r.id));
  return out;
}

/** The sections of a browse list in SECTIONS order: [{ id, label, rows[] }]. */
export const grouped = (rows) => SECTIONS
  .map((s) => ({ ...s, rows: rows.filter((r) => r.section === s.id) }))
  .filter((s) => s.rows.length);

/** The chip a citation wears: the version and the row, safe to put in markup. */
export const chipText = (sourceRef) => {
  const c = versionOf(sourceRef);
  return esc(c ? `${head(c)} · ${sourceRef.section === 'term' ? 'Term' : sourceRef.rowId}` : sourceRef?.contractId || '—');
};

/** The Pactum page a citation opens — the version's own page, on the tab the section lives in. */
export function hrefOf(sourceRef) {
  const c = versionOf(sourceRef);
  if (!c) return '#/pactum/contracts';
  const tab = { methodology: 'methodologies', coverage: 'coverage', preAuth: 'preauth', referral: 'preauth', documentation: 'preauth', rule: 'rules' }[sourceRef.section];
  return `#/pactum/contracts/${c.id}${tab ? `/${tab}` : ''}`;
}
