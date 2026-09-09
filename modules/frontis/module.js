// Module manifest — Frontis, patient access and eligibility.
// Owns the `patients`, `duplicates`, `policies`, `eligibility`, `encounters`,
// `prereg`, `estimates`, `referrals` and `referralSources` entities
// (data/repositories/): the MRN registry every downstream workflow hangs off,
// the potential-duplicate pairs waiting for a decision, the insurance chain
// encounters and billing reference by policy id, and the append-only
// verification snapshots a payer dispute is argued from, and the encounter
// every later feature hangs off — pre-auth, clearance, estimates, referrals and
// the patient account all point at one encounter number, and the
// pre-registration that becomes a patient and an encounter on arrival, and the
// cost estimate the patient is handed before any of it happens, and the
// referral a doctor wrote — with the register of facilities and external
// doctors it names, which grows by being used. Other modules read those through
// the repositories and reference the ids.

import * as patients from '../../data/repositories/patients.js';
import * as eligibility from '../../data/repositories/eligibility.js';
import * as encounters from '../../data/repositories/encounters.js';
import * as prereg from '../../data/repositories/prereg.js';
import * as estimates from '../../data/repositories/estimates.js';
import * as referrals from '../../data/repositories/referrals.js';
// Imported for its side effect as much as its API: loading the policies,
// encounters, estimates and referrals repositories registers the re-link hooks
// the merge screen counts and the after-create hook that resolves a referral
// taken for somebody with no record, and runs the expiry and outpatient
// auto-complete sweeps, before any screen renders.
import '../../data/repositories/policies.js';

export default {
  id: 'frontis',
  name: 'Frontis',
  group: 'Patient access',
  icon: 'badge',

  nav: [
    {
      // The badge counts the rows the list holds: merged records are folded
      // into the survivor and are out of the register.
      screen: 'patients',
      label: 'Patients',
      icon: 'groups',
      count: () => patients.counts().total,
    },
    {
      // The badge counts today's work, not the whole trail: the trail only
      // grows, and a number that only grows says nothing at a glance.
      screen: 'eligibility',
      label: 'Eligibility',
      icon: 'verified_user',
      count: () => eligibility.counts().today,
    },
    {
      // The badge is who is in the building: encounters open right now, which
      // is the number a desk asks the board for.
      screen: 'encounters',
      label: 'Encounters',
      icon: 'event_available',
      count: () => encounters.counts().active,
    },
    {
      // The badge is what the desk still owes on today's arrivals: expected
      // today, or overdue and still open, and not yet converted.
      screen: 'prereg',
      label: 'Expected arrivals',
      icon: 'event_upcoming',
      count: () => prereg.counts(prereg.today()).open,
    },
    {
      // The badge is the quotations in force: issued and still inside their
      // validity, which is the only set anything downstream may act on.
      screen: 'estimates',
      label: 'Estimates',
      icon: 'calculate',
      count: () => estimates.counts().live,
    },
    {
      // The badge is the questions still waiting for an appointment: inbound
      // referrals that are New or Scheduled, which is what the desk works from.
      screen: 'referrals',
      label: 'Referrals',
      icon: 'forward',
      count: () => referrals.activeInbound().length,
    },
  ],

  // Six screens. The list at #/frontis/patients hands the mount over to the
  // register form, the record page, the duplicates worklist, the merge screen
  // and the importer on its deeper paths; the eligibility worklist hands it to
  // the check screen on /new and to the snapshot page on any reference; the
  // encounter board hands it to the registration flow on /new and to the
  // encounter page on any number; the expected-arrivals worklist hands it to
  // the form on /new and on any pre-registration number, and to the conversion
  // screen on /<no>/convert; the estimates list hands it to the builder on /new
  // and on any draft's number, and to the printable document on any other; the
  // referrals worklist hands it to the form on /new and on any open referral's
  // number, and to the read-only page on /<no>/view.
  routes: {
    patients: () => import('./features/patient-master/patient-list.js'),
    eligibility: () => import('./features/eligibility/eligibility-worklist.js'),
    encounters: () => import('./features/encounters/encounter-board.js'),
    prereg: () => import('./features/prereg/prereg-worklist.js'),
    estimates: () => import('./features/estimates/estimate-list.js'),
    referrals: () => import('./features/referrals/referral-worklist.js'),
  },
};
