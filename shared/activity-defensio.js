// Recent activity — the Defensio half of the resolver in shared/activity-trail.js:
// which screen a Defensio audit entry leads back to. Split out by module the
// way the Claima half is, so the trail file stays near the line cap; the
// trail spreads these entity types into its own list and asks
// describeDefensio() before the Claima half, so a denial — Defensio's since
// amendment 36 — resolves to its own page rather than to Claima's redirect
// stub, and the trail's module filter lists it under Defensio.
//
// Two things withhold. A denial, an appeal case and a recovery name the
// payer, the claim and the money, so they withhold on the rule the claim row
// draws (a restricted patient). An accountability case names a person, and
// so does a root-cause case's causer entry: outside the roles the register
// authorises, the row wears the register's own masked label and its detail
// is withheld — the same words the register and the RCA worklist use.

import * as claims from '../data/repositories/claims.js';
import * as denials from '../data/repositories/denials.js';
import * as appealCases from '../data/repositories/appeal-cases.js';
import * as recoveries from '../data/repositories/expected-recoveries.js';
import * as escalations from '../data/repositories/escalation-requests.js';
import * as rcaCases from '../data/repositories/rca-cases.js';
import * as correctiveActions from '../data/repositories/corrective-actions.js';
import * as accountabilityCases from '../data/repositories/accountability-cases.js';
import * as denialPatterns from '../data/repositories/denial-patterns.js';
import * as preventionPlans from '../data/repositories/prevention-plans.js';
import * as riskRules from '../data/repositories/risk-rules.js';
import * as tpas from '../data/repositories/tpas.js';
import * as tpaFeeSchedules from '../data/repositories/tpa-fee-schedules.js';
import * as tpaFeeAccruals from '../data/repositories/tpa-fee-accruals.js';
import * as tpaDisputes from '../data/repositories/tpa-disputes.js';
import * as tpaAmendments from '../data/repositories/tpa-amendments.js';
import * as scorecards from '../data/repositories/scorecards.js';
import { current as currentRole } from './roles.js';

/** The Defensio entity keys the trail uses, in the order the filter lists them. */
export const DEFENSIO_ENTITY_TYPES = [
  { key: 'denials', label: 'Denials', module: 'defensio' },
  { key: 'appealCases', label: 'Appeal cases', module: 'defensio' },
  { key: 'expectedRecoveries', label: 'Expected recoveries', module: 'defensio' },
  { key: 'escalationRequests', label: 'Escalation requests', module: 'defensio' },
  { key: 'rcaCases', label: 'Root-cause cases', module: 'defensio' },
  { key: 'correctiveActions', label: 'Corrective actions', module: 'defensio' },
  { key: 'accountabilityCases', label: 'Accountability cases', module: 'defensio' },
  { key: 'denialPatterns', label: 'Denial patterns', module: 'defensio' },
  { key: 'preventionPlans', label: 'Prevention plans', module: 'defensio' },
  { key: 'riskRules', label: 'Risk rules', module: 'defensio' },
  { key: 'tpas', label: 'TPA administrators', module: 'defensio' },
  { key: 'tpaFeeSchedules', label: 'TPA fee schedules', module: 'defensio' },
  { key: 'tpaFeeAccruals', label: 'TPA fee accruals', module: 'defensio' },
  { key: 'tpaDisputes', label: 'TPA disputes', module: 'defensio' },
  { key: 'tpaAmendments', label: 'TPA amendments', module: 'defensio' },
  { key: 'scorecards', label: 'Payer scorecards', module: 'defensio' },
];

/** The patient behind a claim number, for the withholding rule. */
const mrnOfClaim = (claimNo) => (claimNo ? claims.get(claimNo)?.patientMrn : null) || null;

/** The RCA trail's entries that name a person — withheld outside the authorised roles. */
const NAMES_A_PERSON = new Set(['Causer named', 'Causer updated', 'Causer cleared']);

/**
 * One Defensio audit entry as { type, name, path, withheld? }, or null when
 * the entity is not Defensio's. `isMasked(mrn)` is the trail's own rule for a
 * restricted record, handed in so there is one copy of it.
 */
export function describeDefensio(entry, isMasked) {
  const { entity, entityId, action } = entry;
  const role = currentRole();

  if (entity === 'denials') {
    const row = entityId ? denials.get(entityId) : null;
    return {
      type: 'Denial',
      name: row ? `${row.id} — ${row.claimNo} · ${row.status}` : entityId || '—',
      path: row ? `/defensio/denials/${row.id}` : entityId ? `/defensio/denials/${entityId}` : '',
      withheld: isMasked(row?.patientMrn || mrnOfClaim(row?.claimNo)),
    };
  }

  if (entity === 'appealCases') {
    const row = entityId ? appealCases.get(entityId) : null;
    return {
      type: 'Appeal case',
      name: row ? `${row.id} — ${row.claimNo} · ${appealCases.statusLabel(row.status)}` : entityId || '—',
      path: row ? `/defensio/appeals/${row.id}` : '',
      withheld: isMasked(mrnOfClaim(row?.claimNo)),
    };
  }

  if (entity === 'expectedRecoveries') {
    const row = entityId ? recoveries.get(entityId) : null;
    return {
      type: 'Expected recovery',
      name: row ? `${row.id} — ${row.claimNo} · ${row.state}` : entityId || '—',
      path: row ? `/defensio/appeal-tracking/${row.appealCaseId}` : '',
      withheld: isMasked(mrnOfClaim(row?.claimNo)),
    };
  }

  if (entity === 'escalationRequests') {
    const row = entityId ? escalations.get(entityId) : null;
    return { type: 'Escalation request', name: row ? `${row.id} — ${row.appealCaseId}` : entityId || '—', path: row ? `/defensio/appeal-tracking/${row.appealCaseId}` : '' };
  }

  // A root-cause case names its causer in three of its entries; outside the
  // authorised roles those details are withheld, the case itself is not.
  if (entity === 'rcaCases') {
    const row = entityId ? rcaCases.get(entityId) : null;
    return {
      type: 'Root-cause case',
      name: row ? `${row.id} — ${rcaCases.statusLabel(row.status)}` : entityId || '—',
      path: row ? `/defensio/rca/${row.id}` : '',
      withheld: NAMES_A_PERSON.has(action) && !accountabilityCases.canRead(role),
    };
  }

  if (entity === 'correctiveActions') {
    const row = entityId ? correctiveActions.get(entityId) : null;
    return { type: 'Corrective action', name: row ? `${row.id} — ${row.rcaCaseId}` : entityId || '—', path: row ? `/defensio/rca/${row.rcaCaseId}/actions` : '' };
  }

  // The register is masked outside the authorised roles: the row wears the
  // register's own "Individual — case N", its detail is withheld, and it
  // opens the root-cause case, which those roles may read.
  if (entity === 'accountabilityCases') {
    const row = entityId ? accountabilityCases.get(entityId) : null;
    const canRead = accountabilityCases.canRead(role);
    return {
      type: 'Accountability case',
      name: row ? `${row.id} — ${accountabilityCases.personLabel(row, role)}` : canRead ? entityId || '—' : 'Individual',
      path: row ? (canRead ? `/defensio/accountability/${row.id}` : `/defensio/rca/${row.rcaCaseId}`) : '',
      withheld: !canRead,
    };
  }

  if (entity === 'denialPatterns') {
    const row = entityId ? denialPatterns.get(entityId) : null;
    return { type: 'Denial pattern', name: row ? `${row.id} — ${denialPatterns.labelOf(row)}` : entityId || '—', path: row ? `/defensio/prevention?pattern=${encodeURIComponent(row.id)}` : '' };
  }

  if (entity === 'preventionPlans') {
    const row = entityId ? preventionPlans.get(entityId) : null;
    return { type: 'Prevention plan', name: row ? `${row.id} — ${row.title}` : entityId || '—', path: row ? `/defensio/prevention/plans/${row.id}` : '' };
  }

  // The rules screen reads no rule id off its query, only the pattern the
  // rule came from; the row opens the list narrowed to that pattern's rules.
  if (entity === 'riskRules') {
    const row = entityId ? riskRules.get(entityId) : null;
    return {
      type: 'Risk rule',
      name: row ? `${row.id} — ${row.status}` : entityId || '—',
      path: row ? `/defensio/prevention/rules${row.patternId ? `?patternId=${encodeURIComponent(row.patternId)}` : ''}` : '',
    };
  }

  if (entity === 'tpas') {
    const row = entityId ? tpas.get(entityId) : null;
    return { type: 'TPA administrator', name: row ? `${row.id} — ${row.name}` : entityId || '—', path: row ? '/defensio/tpa/schedules' : '' };
  }

  if (entity === 'tpaFeeSchedules') {
    const row = entityId ? tpaFeeSchedules.get(entityId) : null;
    return { type: 'TPA fee schedule', name: row ? `${row.id} — ${tpas.nameOf(row.tpaId)}` : entityId || '—', path: row ? '/defensio/tpa/schedules' : '' };
  }

  if (entity === 'tpaFeeAccruals') {
    const row = entityId ? tpaFeeAccruals.get(entityId) : null;
    return {
      type: 'TPA fee accrual',
      name: row ? `${row.id} — ${row.claimNo} · ${row.state}` : entityId || '—',
      path: row ? `/defensio/tpa/accruals/${row.id}` : '',
      withheld: isMasked(mrnOfClaim(row?.claimNo)),
    };
  }

  if (entity === 'tpaDisputes') {
    const row = entityId ? tpaDisputes.get(entityId) : null;
    return { type: 'TPA dispute', name: row ? `${row.id} — ${tpas.nameOf(row.tpaId)} · ${row.status}` : entityId || '—', path: row ? `/defensio/tpa/disputes?dispute=${encodeURIComponent(row.id)}` : '' };
  }

  if (entity === 'tpaAmendments') {
    const row = entityId ? tpaAmendments.get(entityId) : null;
    return { type: 'TPA amendment', name: row ? `${row.id} — ${tpas.nameOf(row.tpaId)} · ${row.status}` : entityId || '—', path: row ? `/defensio/tpa/amendments/${row.id}` : '' };
  }

  if (entity === 'scorecards') {
    const row = entityId ? scorecards.get(entityId) : null;
    return { type: 'Payer scorecard', name: row ? `${row.scorecardNo} — ${scorecards.payerName(row)} · v${row.version}` : entityId || '—', path: row ? `/defensio/scorecard/${row.scorecardNo}` : '' };
  }

  return null;
}
