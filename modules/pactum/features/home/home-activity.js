// Recent activity — the shared audit trail, read across every entity Pactum
// owns rather than one row at a time. The resolver here is what turns an audit
// entry back into the screen that made it, and the full list at
// #/pactum/activity uses the same one.

import * as audit from '../../../../data/repositories/audit.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { dateTime, esc, relativeTime } from '../../../../shared/format.js';

/** The entity keys the trail uses, for the full list's filter. */
export const ENTITY_TYPES = [
  { key: 'payers', label: 'Payers' },
  { key: 'contract', label: 'Contracts' },
  { key: 'cdm', label: 'Charge master' },
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
  const detail = String(entry.details || '').replace(/^v\d+\s*·\s*/, '').trim();
  if (!detail || label.includes(detail) || detail.includes(about.name)) return label;
  return `${label} — ${detail}`;
}

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">Nothing has happened yet</div>
      <p class="state-view__body">Every payer, charge line and contract change lands here, with who made it.</p>
    </div>`;
}
