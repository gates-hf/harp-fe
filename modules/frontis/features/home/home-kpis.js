// The six numbers at the top of the Frontis dashboard. Each one is read from
// the repository that owns it and links to the screen holding the rows it
// counted — the headline and the row count under the link are the same query,
// so a demo can click through and reconcile.
//
// Nothing here computes a rule of its own: `createdToday`, `activeNow`,
// `needsAction`, `outstandingItem` and `byStatus` are the owning repositories'
// helpers, and the two arrival figures are the worklist's own slice.

import * as patients from '../../../../data/repositories/patients.js';
import * as encounters from '../../../../data/repositories/encounters.js';
import * as prereg from '../../../../data/repositories/prereg.js';
import * as preauth from '../../../../data/repositories/preauth-requests.js';
import * as clearance from '../../../../data/repositories/clearance.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { todayIso } from '../../../../shared/format.js';

/**
 * Today's arrivals — exactly the rows `#/frontis/prereg?date=today` lists,
 * which is that screen's own "Expected today" slice. An arrival that has since
 * been converted stays in the count: it was still expected today.
 */
export const arrivalsToday = () => prereg.search('', { from: todayIso(), to: todayIso() });

/** The visits whose eligibility item is still somebody's job. */
export const pendingEligibility = () => clearance.outstandingItem('eligibility');

export function cards() {
  const registered = patients.createdToday();
  // A record the desk opened from an arrival it was already expecting: the
  // pre-registration says so itself, which is why nothing is asked of the
  // patient register.
  const viaPrereg = registered.filter(
    (p) => prereg.byPatient(p.mrn).some((row) => row.status === 'Converted')).length;

  const active = encounters.activeNow();
  const split = encounters.typeSplit(active);

  const arrivals = arrivalsToday();
  const ready = arrivals.filter((row) => row.status === 'Ready').length;

  const eligibility = pendingEligibility();
  // A re-check is the answer the item itself offers; the rest are waiting on a
  // check that was never run.
  const rechecks = eligibility.filter((enc) => clearance.itemOf(enc, 'eligibility')?.action).length;

  const auths = preauth.needsAction();
  const expiring = auths.filter((row) => preauth.isExpiring(row)).length;

  const blocked = clearance.byStatus('Blocked');
  const conditional = clearance.byStatus('Conditionally Cleared').length;

  return [
    {
      value: registered.length,
      label: 'Registrations today',
      sub: `${viaPrereg} via pre-registration`,
      href: '#/frontis/patients?created=today',
    },
    {
      value: active.length,
      label: 'Active encounters',
      sub: `OP ${split.OP} · IP ${split.IP} · ER ${split.ER}`,
      href: '#/frontis/encounters?status=Active',
    },
    {
      value: arrivals.length,
      label: 'Expected arrivals',
      sub: `${ready} ready to convert`,
      href: '#/frontis/prereg?date=today',
    },
    {
      value: eligibility.length,
      label: 'Pending eligibility',
      sub: `${rechecks} re-check${rechecks === 1 ? '' : 's'} needed`,
      href: '#/frontis/clearance?item=eligibility',
    },
    {
      value: auths.length,
      label: 'Pending pre-auths',
      sub: `${expiring} expiring ≤ ${preauth.CONFIG.expiringDays} days`,
      href: '#/frontis/preauth?view=needs-action',
      tone: expiring ? 'warning' : '',
    },
    {
      value: blocked.length,
      label: 'Not financially cleared',
      sub: `${conditional} conditional`,
      href: '#/frontis/clearance?status=Blocked',
      tone: blocked.length ? 'warning' : '',
    },
  ];
}

export function kpisHtml() {
  return metricRailHtml(cards().map((c) => ({ ...c, title: `${c.label} — ${c.sub}` })));
}
