// Recent activity — the shared audit trail, read across every entity on the
// platform rather than one row at a time. The resolver here is what turns an
// audit entry back into the screen that made it: the full list at
// #/pactum/activity and both module dashboards read this one, which is why it
// sits in shared/ rather than inside the module that first drew it. A row
// belongs to whoever owns the entity, so the path it hands back may leave the
// module the panel is on.
//
// Like shared/billing-breakdown.js it reads repositories, which is what sets
// those two apart from the rest of shared/: the arrow runs shared/ -> data/ and
// never back, so nothing in data/ can cycle through it.

import * as audit from '../data/repositories/audit.js';
import * as payers from '../data/repositories/payers.js';
import * as cdm from '../data/repositories/cdm.js';
import * as contracts from '../data/repositories/contracts.js';
import * as patients from '../data/repositories/patients.js';
import * as policies from '../data/repositories/policies.js';
import * as eligibility from '../data/repositories/eligibility.js';
import * as encounters from '../data/repositories/encounters.js';
import * as prereg from '../data/repositories/prereg.js';
import * as estimates from '../data/repositories/estimates.js';
import * as referrals from '../data/repositories/referrals.js';
import * as preauth from '../data/repositories/preauth-requests.js';
import * as accounts from '../data/repositories/accounts.js';
import { CLAIMA_ENTITY_TYPES, describeClaima } from './activity-claima.js';
import { current as currentRole } from './roles.js';
import { dateTime, esc, relativeTime } from './format.js';

/**
 * The entity keys the trail uses, for the full list's filters. `module` is the
 * one that owns the entity, which is what `?module=frontis` narrows by — a
 * clearance move is audited on the encounter, so it needs no key of its own.
 */
export const ENTITY_TYPES = [
  { key: 'payers', label: 'Payers', module: 'pactum' },
  { key: 'contract', label: 'Contracts', module: 'pactum' },
  { key: 'cdm', label: 'Charge master', module: 'pactum' },
  { key: 'patients', label: 'Patients', module: 'frontis' },
  { key: 'policy', label: 'Policies', module: 'frontis' },
  { key: 'eligibility', label: 'Eligibility checks', module: 'frontis' },
  { key: 'encounters', label: 'Encounters', module: 'frontis' },
  { key: 'prereg', label: 'Pre-registrations', module: 'frontis' },
  { key: 'estimate', label: 'Cost estimates', module: 'frontis' },
  { key: 'referrals', label: 'Referrals', module: 'frontis' },
  { key: 'preauth', label: 'Pre-authorisations', module: 'frontis' },
  { key: 'account', label: 'Patient accounts', module: 'frontis' },
  // Claima's live in shared/activity-claima.js, the module's half of this
  // resolver — split by module so this file stays near the cap.
  ...CLAIMA_ENTITY_TYPES,
];

/** The modules the trail knows about, for the full list's module filter. */
export const MODULES = [
  { key: 'pactum', label: 'Pactum' },
  { key: 'frontis', label: 'Frontis' },
  { key: 'claima', label: 'Claima' },
];

/** The entity keys one module owns — what `?module=` narrows the trail to. */
export const entitiesOf = (module) =>
  ENTITY_TYPES.filter((t) => t.module === module).map((t) => t.key);

/**
 * Every entry, newest first. `entities` narrows the trail to the keys named —
 * `entitiesOf('claima')` is how a module dashboard reads its own half.
 */
export function recent(limit = 0, { entities = null } = {}) {
  const keep = entities ? new Set(entities) : null;
  const rows = [...audit.all()]
    .filter((row) => !keep || keep.has(row.entity))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
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

  // An estimate is money on a named person, so it withholds on the same rule.
  // A walk-in quotation names no record at all — the second Frontis entity that
  // can exist before the patient does — and nothing about it is withheld,
  // because there is no restricted record for it to be about.
  if (entity === 'estimate') {
    const row = entityId ? estimates.get(entityId) : null;
    return {
      type: 'Cost estimate',
      name: row ? `${row.no} — ${estimates.subjectName(row)}` : entityId || '—',
      path: row ? `/frontis/estimates/${row.no}` : '',
      withheld: isMasked(row?.subject?.mrn),
    };
  }

  // A referral names a doctor and a specialty and no money at all, so nothing
  // about it is withheld — the same call the Referrals section on the record
  // makes. It is the third Frontis entity that can exist before the patient
  // does: one taken over the phone has a name and a number and no MRN.
  if (entity === 'referrals') {
    const row = entityId ? referrals.get(entityId) : null;
    return {
      type: 'Referral',
      name: row ? `${row.no} — ${referrals.patientName(row)}` : entityId || '—',
      path: row ? `/frontis/referrals/${row.no}/view` : '',
    };
  }

  // A request names the payer, the services and the money, so it withholds on
  // the rule the worklist and the request page already draw.
  if (entity === 'preauth') {
    const row = entityId ? preauth.get(entityId) : null;
    return {
      type: 'Pre-authorisation',
      name: row ? `${row.no} — ${row.patientMrn}` : entityId || '—',
      path: row ? `/frontis/preauth/${row.no}` : '',
      withheld: isMasked(row?.patientMrn),
    };
  }

  // An account is keyed on the MRN — one account per patient — and the ledger
  // audits under the same key, so a charge, a payment and a refund all land on
  // the account page they were written to.
  if (entity === 'account') {
    const row = entityId ? accounts.get(entityId) : null;
    return {
      type: 'Patient account',
      name: row ? `${row.mrn} — ${patients.get(row.mrn)?.nameEn || row.mrn}` : entityId || '—',
      path: row ? `/frontis/accounts/${row.mrn}` : '',
      withheld: isMasked(row?.mrn),
    };
  }

  // A Claima entity — a charge line, a chart's coding, a claim, a batch, a
  // remittance and what follows one — resolves in the module's own half.
  const claima = describeClaima(entry, isMasked);
  if (claima) return claima;

  // Anything else is named and not linked: a receipt and a signature are read
  // on the account and the clearance they belong to, and they join this list
  // when the feature that owns them says where.
  return { type: entity || 'Record', name: entityId || '—', path: '' };
}

export function activityHtml(limit = 5, { entities = null } = {}) {
  const rows = recent(limit, { entities });
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
        eligibility check, a pre-registration, an encounter, a cost estimate, a referral, a pre-authorisation,
        an account, a chart's coding or a claim lands here, with who made it.</p>
    </div>`;
}

/** Whether this role reads that patient masked — the record page's own rule. */
function isMasked(mrn) {
  return Boolean(mrn && patients.view(patients.get(mrn), currentRole())?.masked);
}
