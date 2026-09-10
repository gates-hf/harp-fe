// The two quick actions that cannot be a link. Registering, quoting and
// pre-registering all open a page and are ordinary anchors in home.html; a new
// encounter and an eligibility check both start with "for whom", so they ask
// that first and then hand the answer to the flow that owns the work.
//
// The question is the encounter flow's own step 1, drawn in a dialog: one
// patient picker in the module, so a search that finds a record here finds it
// there.

import * as modal from '../../../../shared/modal.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { stepPatient } from '../encounters/encounter-steps.js';

/** Run one quick action. Returns true when the click was ours. */
export async function handle(act, ctx) {
  if (act === 'new-encounter') {
    return start(ctx, {
      title: 'New encounter',
      sub: 'Who is the visit for?',
      icon: 'event_available',
      path: (mrn) => `/frontis/encounters/new?mrn=${mrn}`,
    });
  }
  if (act === 'check-eligibility') {
    return start(ctx, {
      title: 'Check eligibility',
      sub: 'Whose cover are you checking?',
      icon: 'verified_user',
      path: (mrn) => `/frontis/eligibility/new?mrn=${mrn}`,
    });
  }
  return false;
}

async function start(ctx, { title, sub, icon, path }) {
  const picked = await pickPatient({ title, sub, icon });
  if (!picked) return true;
  // Registering is the picker's own answer to "nobody matches", and the
  // duplicate check runs inside the register form.
  ctx.navigate(picked.register ? '/frontis/patients/new' : path(picked.mrn));
  return true;
}

/**
 * The patient picker in a dialog. Resolves { mrn } or { register: true }, or
 * undefined when it is closed. The whole block is redrawn on each keystroke —
 * the step draws its own search field — so the caret is put back afterwards.
 */
export function pickPatient({ title, sub, icon }) {
  const state = { q: '', mrn: '' };
  const dialog = modal.open({
    title,
    sub,
    icon,
    size: 'lg',
    body: '<div id="fh-picker"></div>',
    note: 'Search the register by name, MRN, civil ID or phone.',
    foot: '<button class="btn btn--secondary" data-close>Cancel</button>',
  });

  const box = dialog.el.querySelector('#fh-picker');

  function draw() {
    box.innerHTML = stepPatient(state, currentRole());
    const input = box.querySelector('#en-patient-q');
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  dialog.el.addEventListener('input', (e) => {
    if (e.target.id !== 'en-patient-q') return;
    state.q = e.target.value;
    draw();
  });

  dialog.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="register"]')) return dialog.close({ register: true });
    const row = e.target.closest('tr[data-mrn]');
    if (row) dialog.close({ mrn: row.dataset.mrn });
  });

  draw();
  return dialog.closed;
}
