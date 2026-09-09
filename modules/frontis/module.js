// Module manifest — Frontis, patient access and eligibility.
// Owns the `patients`, `duplicates` and `policies` entities
// (data/repositories/): the MRN registry every downstream workflow hangs off,
// the potential-duplicate pairs waiting for a decision, and the insurance
// chain encounters and billing reference by policy id. Other modules read
// those through the repositories and reference the ids.

import * as patients from '../../data/repositories/patients.js';
// Imported for its side effect as much as its API: loading the policies
// repository registers the re-link hook the merge screen counts, and runs the
// expiry sweep, before any screen renders.
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
  ],

  // One screen, seven routes: the list at #/frontis/patients hands the mount
  // over to the register form, the record page, the duplicates worklist, the
  // merge screen and the importer on its deeper paths.
  routes: {
    patients: () => import('./features/patient-master/patient-list.js'),
  },
};
