// Module manifest — Frontis, patient access and eligibility.
// Owns the `patients`, `duplicates`, `policies`, `eligibility` and `encounters`
// entities
// (data/repositories/): the MRN registry every downstream workflow hangs off,
// the potential-duplicate pairs waiting for a decision, the insurance chain
// encounters and billing reference by policy id, and the append-only
// verification snapshots a payer dispute is argued from, and the encounter
// every later feature hangs off — pre-auth, clearance, estimates, referrals and
// the patient account all point at one encounter number. Other modules read
// those through the repositories and reference the ids.

import * as patients from '../../data/repositories/patients.js';
import * as eligibility from '../../data/repositories/eligibility.js';
import * as encounters from '../../data/repositories/encounters.js';
// Imported for its side effect as much as its API: loading the policies and
// encounters repositories registers the re-link hooks the merge screen counts,
// and runs the expiry and outpatient auto-complete sweeps, before any screen
// renders.
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
  ],

  // Three screens. The list at #/frontis/patients hands the mount over to the
  // register form, the record page, the duplicates worklist, the merge screen
  // and the importer on its deeper paths; the eligibility worklist hands it to
  // the check screen on /new and to the snapshot page on any reference; the
  // encounter board hands it to the registration flow on /new and to the
  // encounter page on any number.
  routes: {
    patients: () => import('./features/patient-master/patient-list.js'),
    eligibility: () => import('./features/eligibility/eligibility-worklist.js'),
    encounters: () => import('./features/encounters/encounter-board.js'),
  },
};
