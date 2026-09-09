// Engine — pre-registration completeness. Pure: it reads a pre-registration and,
// when one is linked, the patient record behind it, and answers what is still
// missing before the record can be converted. No DOM, no writes.
//
// One definition, four readers: the worklist's bar, the form's rail, the
// repository (which flips Pending <-> Ready on every save off `ready`) and the
// conversion screen, which names the identity items it is about to ask for. The
// markup that draws all this is modules/frontis/features/prereg/
// prereg-completeness.js — this file is the answer, that one is the picture.
//
// It sits in data/engines/ rather than beside the screens because the
// repository reads it, and data/ never imports from modules/.

import * as patients from '../repositories/patients.js';

/** The four checklists, in the order the form asks them. */
export const GROUPS = [
  { key: 'identity', label: 'Identity', icon: 'badge' },
  { key: 'insurance', label: 'Insurance', icon: 'contract' },
  { key: 'eligibility', label: 'Eligibility', icon: 'verified_user' },
  { key: 'visit', label: 'Expected visit', icon: 'event' },
];

/**
 * computeCompleteness(prereg)
 *   -> { pct, ready, passed, total, missing: ['Arabic name', …], groups: [...] }
 *
 * Every item counts the same: a percentage that weighted one group over another
 * would be a judgement the desk did not make. `missing` is the flat list of the
 * phrases a reader sees in the tooltip and the rail, in checklist order.
 */
export function computeCompleteness(prereg) {
  const groups = GROUPS.map((group) => {
    const items = ITEMS[group.key](prereg || {});
    return { ...group, items, done: items.every((i) => i.ok) };
  });
  const items = groups.flatMap((g) => g.items);
  const passed = items.filter((i) => i.ok).length;
  const total = items.length || 1;
  return {
    pct: Math.round((passed / total) * 100),
    ready: passed === items.length,
    passed,
    total: items.length,
    missing: items.filter((i) => !i.ok).map((i) => i.label),
    groups,
  };
}

/** Whether a pre-registration has everything conversion needs. */
export const isComplete = (prereg) => computeCompleteness(prereg).ready;

// --- the four checklists -------------------------------------------------------

const ITEMS = {
  /**
   * A linked record answers for itself: the register already holds the name,
   * the date of birth and the identifiers, so the pre-registration is complete
   * on identity the moment it is linked to a record that carries them.
   */
  identity(prereg) {
    const p = prereg.patientMrn ? patients.get(prereg.patientMrn) : null;
    const source = p || prereg.newPatient || {};
    return [
      item('English name', source.nameEn),
      item('Arabic name', source.nameAr),
      item('Date of birth', source.dob),
      item('Gender', source.gender),
      item('Mobile number', source.phone),
      { label: 'Identifier (civil ID or passport)', ok: Boolean(source.civilId || source.passportNo) },
    ];
  },

  /** One question: is it a policy, or is the patient paying? */
  insurance(prereg) {
    const insurance = prereg.insurance || {};
    const attached = insurance.mode === 'selfpay'
      || (insurance.mode === 'policy' && Boolean(insurance.policyId || insurance.pendingPolicy));
    return [{ label: 'Insurance or Self-Pay', ok: attached }];
  },

  /** A pre-check that failed is still a pre-check that was run. */
  eligibility(prereg) {
    return [{ label: 'Eligibility pre-check', ok: prereg.precheck?.status === 'Done' }];
  },

  /**
   * The visit as the desk knows it before arrival. Ward, bed class and the
   * length of stay are not asked here — they are completed at conversion, in
   * the encounter flow that owns them.
   */
  visit(prereg) {
    const visit = prereg.visit || {};
    return [
      item('Visit type', visit.type),
      item('Expected arrival', visit.expectedAt),
      item('Department', visit.department),
    ];
  },
};

const item = (label, value) => ({ label, ok: Boolean(String(value ?? '').trim()) });
