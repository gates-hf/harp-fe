// Recent activity — the shared audit trail, read across every entity Pactum
// owns rather than one row at a time. The resolver here is what turns an audit
// entry back into the screen that made it, and the full list at
// #/pactum/activity uses the same one.

import * as audit from '../../../../data/repositories/audit.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as policies from '../../../../data/repositories/policies.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { dateTime, esc, relativeTime } from '../../../../shared/format.js';

/** The entity keys the trail uses, for the full list's filter. */
export const ENTITY_TYPES = [
  { key: 'payers', label: 'Payers' },
  { key: 'contract', label: 'Contracts' },
  { key: 'cdm', label: 'Charge master' },
  { key: 'patients', label: 'Patients' },
  { key: 'policy', label: 'Policies' },
  { key: 'eligibility', label: 'Eligibility checks' },
  { key: 'encounters', label: 'Encounters' },
  { key: 'prereg', label: 'Pre-registrations' },
];

/** Every entry, newest first. */
export function recent(limit = 0) {
  const rows = [...audit.all()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return limit ? rows.slice(0, limit) : rows;
}

/**
 * One audit entry as { type, name, path } — what it was about and where that
 * record lives. A row whose record has since gone gets no link rather than a
 * link to a screen that would fail.
 */
export function describe(entry) {
  const { entity, entityId } = entry;

  if (entity === 'payers') {
    const payer = entityId ? payers.get(entityId) : null;
    if (!entityId) return { type: 'Payer import', name: 'Bulk import', path: '/pactum/payers/import' };
    return { type: 'Payer', name: payer?.nameEn || entityId, path: payer ? `/pactum/payers/${entityId}` : '' };
  }

  if (entity === 'cdm') {
    const row = entityId ? cdm.get(entityId) : null;
    if (!entityId) return { type: 'CDM import', name: 'Bulk import', path: '/pactum/cdm/import' };
    return {
      type: row && cdm.isBundle(row) ? 'Bundle' : 'Charge line',
      name: row ? `${row.chargeCode} — ${cdm.label(row)}` : entityId,
      path: row ? `/pactum/cdm/${entityId}` : '',
    };
  }

  if (entity === 'contract') {
    // Contract entries are keyed on the lineage, with the version in the
    // details; a rule entry names the rule, which is how it reaches the wizard.
    const current = entityId ? contracts.currentOf(entityId) : null;
    const ruleId = String(entry.details || '').match(/\b(RL-\d+)\s*·/)?.[1] || '';
    const rule = ruleId && current ? contracts.getRule(current, ruleId) : null;
    return {
      type: rule ? 'Rule' : 'Contract',
      name: current ? `${current.contractNo} — ${current.name}` : entityId || '—',
      path: !current ? '' : rule ? `/pactum/contracts/${current.id}/rules/${ruleId}` : `/pactum/contracts/${current.id}`,
    };
  }

  // Frontis owns the patient, so the link leaves this module for the record
  // page — the trail is shared, and a row belongs to whoever holds the entity.
  // The name is read through view(), so a restricted record reads masked here
  // too.
  if (entity === 'patients') {
    if (!entityId) return { type: 'Patient import', name: 'Bulk import', path: '/frontis/patients/import' };
    const row = patients.view(patients.get(entityId), currentRole());
    return {
      type: 'Patient',
      name: row ? `${row.mrn} — ${row.nameEn}` : entityId,
      path: row ? `/frontis/patients/${row.mrn}` : '',
    };
  }

  // The other two Frontis entities that hang off a patient. A policy has no
  // page of its own — it lives on the record's Insurance tab — while a check
  // does, so each links where its record is actually read.
  if (entity === 'policy') {
    const row = entityId ? policies.get(entityId) : null;
    // The policy's own label names the payer and the plan, so a restricted
    // record is reduced to its MRN here as well as in the detail.
    const withheld = isMasked(row?.patientMrn);
    return {
      type: 'Policy',
      name: !row ? entityId || '—'
        : withheld ? row.patientMrn : `${row.patientMrn} — ${policies.label(row)}`,
      path: row ? `/frontis/patients/${row.patientMrn}/insurance` : '',
      withheld,
    };
  }

  if (entity === 'eligibility') {
    const row = entityId ? eligibility.get(entityId) : null;
    return {
      type: 'Eligibility check',
      name: row ? `${row.ref} — ${row.patientMrn}` : entityId || '—',
      path: row ? `/frontis/eligibility/${row.ref}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  // An encounter's own entry names its financial class, so it withholds on the
  // same rule the encounter board does: that a restricted patient was seen is
  // not the secret, who pays for them is.
  if (entity === 'encounters') {
    const row = entityId ? encounters.get(entityId) : null;
    return {
      type: 'Encounter',
      name: row ? `${row.no} — ${row.patientMrn}` : entityId || '—',
      path: row ? `/frontis/encounters/${row.no}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  // A pre-registration names the cover the desk was given, so it withholds on
  // the same rule — and it may name no patient at all, which is the one Frontis
  // entity that can exist before the record does.
  if (entity === 'prereg') {
    const row = entityId ? prereg.get(entityId) : null;
    return {
      type: 'Pre-registration',
      name: row ? `${row.no} — ${prereg.patientName(row)}` : entityId || '—',
      path: row ? `/frontis/prereg/${row.no}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  return { type: entity || 'Record', name: entityId || '—', path: '' };
}

export function activityHtml(limit = 5) {
  const rows = recent(limit);
  if (!rows.length) return emptyHtml();
  return `<ol class="journey">${rows.map(entryHtml).join('')}</ol>`;
}

function entryHtml(entry) {
  const about = describe(entry);
  return `
    <li class="journey__row"${about.path ? ` data-go="${esc(about.path)}" tabindex="0" title="Open ${esc(about.name)}"` : ''}>
      <span class="journey__at t-mono-sm" title="${esc(dateTime(entry.at))}">${esc(relativeTime(entry.at))}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      <span class="journey__detail">${esc(detailLine(entry, about))}</span>
    </li>`;
}

/**
 * The record, then what changed. A "Created" entry's details are the record's
 * own name and a contract's carry its version prefix, so the line drops
 * whatever the record label already said rather than saying it twice.
 */
export function detailLine(entry, about = describe(entry)) {
  const label = `${about.type} · ${about.name}`;
  // A policy and a check both name the payer and the plan in their details,
  // which is exactly what the record page withholds on a restricted patient.
  // The row still shows that something happened, and to whose record.
  if (about.withheld) return `${label} — withheld`;
  const detail = String(entry.details || '').replace(/^v\d+\s*·\s*/, '').trim();
  if (!detail || label.includes(detail) || detail.includes(about.name)) return label;
  return `${label} — ${detail}`;
}

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing has happened yet</div>
      <p class="state-view__body">Every change to a payer, a charge line, a contract, a patient, a policy, an
        eligibility check, a pre-registration or an encounter lands here, with who made it.</p>
    </div>`;
}

/** Whether this role reads that patient masked — the record page's own rule. */
function isMasked(mrn) {
  return Boolean(mrn && patients.view(patients.get(mrn), currentRole())?.masked);
}
