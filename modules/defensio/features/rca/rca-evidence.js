// The origin trail a root-cause case is read from: what the registers wrote
// as the denied claims came to be — registration, the eligibility check and
// any override, the authorisations, the coding and its recode requests, the
// charges, the assembly with its scrub findings, the submission, the
// remittance, and the denials themselves. Every entry is an audit row
// another register wrote, read through the published repositories and
// attributed to whoever wrote it; nothing is synthesised, which is what lets
// an entry be linked as evidence against a person. Read-only markup; the
// Evidence tab draws it plain and the Causer tab draws it with a checkbox
// per entry.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as denials from '../../../../data/repositories/denials.js';
import * as audit from '../../../../data/repositories/audit.js';
import * as claims from '../../../../data/repositories/claims.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as eligibility from '../../../../data/repositories/eligibility.js';
import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as charges from '../../../../data/repositories/charges.js';
import * as coding from '../../../../data/repositories/coding.js';
import * as batches from '../../../../data/repositories/batches.js';
import { dateTime, esc } from '../../../../shared/format.js';

const STAGES = [
  { key: 'registration', label: 'Registration', icon: 'how_to_reg' },
  { key: 'eligibility', label: 'Eligibility & overrides', icon: 'verified_user' },
  { key: 'authorisation', label: 'Authorisations', icon: 'approval' },
  { key: 'coding', label: 'Coding & recodes', icon: 'code' },
  { key: 'charges', label: 'Charges', icon: 'receipt_long' },
  { key: 'assembly', label: 'Assembly & scrub', icon: 'inventory_2' },
  { key: 'submission', label: 'Submission', icon: 'send' },
  { key: 'remittance', label: 'Remittance', icon: 'payments' },
  { key: 'denial', label: 'Denial', icon: 'report' },
];

/** The key a checkbox carries for an evidence ref. */
export const refKey = (ref) => `${ref.entity}|${ref.entityId}|${ref.auditId}`;

/**
 * originTrail(rcaCase) → [{ key, label, icon, entries[], notes[] }], one per
 * stage, oldest entry first. An entry is { ref, at, user, action, details,
 * href } where ref is what rca-cases.js stores as evidence.
 */
export function originTrail(rcaCase) {
  const stages = STAGES.map((s) => ({ ...s, entries: [], notes: [], seen: new Set() }));
  const stage = (key) => stages.find((s) => s.key === key);
  const push = (key, rows, href = null, tag = '') => {
    const s = stage(key);
    for (const row of rows) {
      if (!row || s.seen.has(row.id)) continue;
      s.seen.add(row.id);
      s.entries.push({ ref: rcaCases.evidenceRef(row), at: row.at, user: row.user, action: row.action, details: row.details || '', href, tag });
    }
  };
  const claimsSeen = new Set();
  for (const d of rcaCases.denialsOf(rcaCase)) {
    const claim = denials.claimOf(d);
    push('denial', audit.forEntity('denials', d.id), `#/defensio/denials/${d.id}`, d.id);
    if (d.remittanceNo) push('remittance', audit.forEntity('remittances', d.remittanceNo), `#/claima/remittances/${d.remittanceNo}`, d.remittanceNo);
    if (!claim || claimsSeen.has(claim.id)) continue;
    claimsSeen.add(claim.id);
    push('assembly', audit.forEntity('claims', claim.id).filter((a) => !/^Status/.test(a.action) || /Draft|Ready/.test(a.details || '')), `#/claima/claims/${claim.claimNo}`, claim.claimNo);
    push('submission', audit.forEntity('claims', claim.id).filter((a) => /^Status/.test(a.action) && /Submitted|Acknowledged|Rejected/.test(a.details || '')), `#/claima/claims/${claim.claimNo}`, claim.claimNo);
    for (const b of batches.byClaim?.(claim.claimNo) || []) {
      const no = b.batchNo || b.batch?.batchNo;
      if (no) push('submission', audit.forEntity('batches', no).filter((a) => String(a.details || '').includes(claim.claimNo) || /Generated|Submitted|Acknowledged/.test(a.action)), `#/claima/submission/${no}`, no);
    }
    const last = claims.latestScrub?.(claim);
    if (last) stage('assembly').notes.push(`Latest scrub ${String(last.at || '').slice(0, 10)}: ${last.result}${last.findings?.length ? ` — ${last.findings.map((f) => `${f.severity || f.level || ''} ${f.message || f.title || f.text || ''}`.trim()).join('; ')}` : ''}`);
    if (!claim.encounterNo) { stage('registration').notes.push(`${claim.claimNo} is a generated claim — no visit behind it, so registration, eligibility, coding and charges have no trail to read.`); continue; }
    const enc = encounters.get(claim.encounterNo);
    push('registration', audit.forEntity('patients', claim.patientMrn), `#/frontis/patients/${claim.patientMrn}`, claim.patientMrn);
    push('registration', audit.forEntity('encounters', claim.encounterNo), `#/frontis/encounters/${claim.encounterNo}`, claim.encounterNo);
    if (enc?.financial) stage('registration').notes.push(`Classified ${String(enc.financial.classifiedAt || '').slice(0, 10)} by ${enc.financial.classifiedBy || '—'}${enc.financial.snapshotRef ? ` on ${enc.financial.snapshotRef}` : ''}.`);
    const refs = new Set([claim.snapshotRef, enc?.financial?.snapshotRef].filter(Boolean));
    for (const s of eligibility.byPatient(claim.patientMrn)) if (s.encounterId === claim.encounterNo || refs.has(s.ref)) refs.add(s.ref);
    for (const ref of refs) {
      const snap = eligibility.get(ref);
      push('eligibility', audit.forEntity('eligibility', ref), `#/frontis/eligibility/${ref}`, ref);
      if (snap) stage('eligibility').notes.push(`${ref}: ${snap.finalResult}${snap.override ? ` — overridden (${snap.override.reason || snap.override.type || 'override'})` : ''}, checked ${String(snap.checkedAt || '').slice(0, 10)} by ${snap.checkedBy || '—'}.`);
    }
    for (const p of preauth.byEncounter(claim.encounterNo)) push('authorisation', audit.forEntity('preauth', p.no), `#/frontis/preauth/${p.no}`, p.no);
    push('coding', audit.forEntity('coding', claim.encounterNo), `#/claima/coding/${claim.encounterNo}`, claim.encounterNo);
    const rec = coding.get(claim.encounterNo);
    for (const r of rec?.recodeRequests || []) stage('coding').notes.push(`${r.id}: recode request ${String(r.status || '').toLowerCase()} — ${r.source}${r.ref ? ` ${r.ref}` : ''}, ${String(r.at || '').slice(0, 10)}.`);
    for (const line of charges.byEncounter(claim.encounterNo)) push('charges', audit.forEntity('charges', line.id), `#/claima/charges?encounter=${claim.encounterNo}`, line.id);
  }
  for (const s of stages) { s.entries.sort((a, b) => String(a.at).localeCompare(String(b.at))); delete s.seen; }
  return stages;
}

/**
 * evidenceHtml(stages, { selectable, selected }) — every stage as a
 * `<details>` open when it has entries; with `selectable`, a checkbox per
 * entry carrying the ref key, ticked when it is in `selected`.
 */
export function evidenceHtml(stages, { selectable = false, selected = new Set() } = {}) {
  const total = stages.reduce((n, s) => n + s.entries.length, 0);
  if (!total && !stages.some((s) => s.notes.length)) {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">history</span></div>
        <div class="state-view__title">No trail to read</div>
        <p class="state-view__body">The registers wrote nothing about the claims behind this case.</p>
      </div>`;
  }
  return stages.map((s) => `
    <details${s.entries.length ? ' open' : ''}>
      <summary class="panel-header">
        <span class="icon icon--sm">${s.icon}</span>
        <span>${esc(s.label)}</span>
        <span class="badge">${s.entries.length}</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${s.entries.length ? `${esc(s.entries[0].at.slice(0, 10))} – ${esc(s.entries[s.entries.length - 1].at.slice(0, 10))}` : 'nothing recorded'}</span>
      </summary>
      ${s.notes.length ? `<p class="t-body-sm">${s.notes.map(esc).join('<br>')}</p>` : ''}
      ${s.entries.length ? `<ol class="journey">${s.entries.map((e) => {
    const key = refKey(e.ref);
    return `
        <li class="journey__row">
          <span class="journey__at t-mono-sm">${selectable ? `<input type="checkbox" data-evidence="${esc(key)}" aria-label="Link ${esc(e.action)} ${esc(e.at)} as evidence"${selected.has(key) ? ' checked' : ''}> ` : ''}${dateTime(e.at)}</span>
          <span class="journey__action"><span class="badge">${esc(e.action)}</span></span>
          <span class="journey__actor">${esc(e.user || '')}</span>
          <span class="journey__detail">${e.tag ? `<a class="crumb-link t-mono-sm" href="${esc(e.href || '#')}">${esc(e.tag)}</a> · ` : ''}${esc(e.details)}</span>
        </li>`;
  }).join('')}</ol>` : ''}
    </details>`).join('');
}

/** Every entry of the trail keyed for lookup — what the Causer tab resolves a ticked box back to. */
export function entriesByKey(stages) {
  const map = new Map();
  for (const s of stages) for (const e of s.entries) map.set(refKey(e.ref), e);
  return map;
}
