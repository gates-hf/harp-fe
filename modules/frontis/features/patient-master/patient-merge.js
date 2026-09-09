// Merge two records — three steps: choose, decide field by field, confirm what
// gets re-linked. #/frontis/patients/merge?survivor=&duplicate=, prefilled from
// the duplicates worklist.
//
// Nothing is written until Confirm: the field choices and the re-link counts
// are read live from the repository, and the merge itself happens in one call.

import * as patients from '../../../../data/repositories/patients.js';
import * as duplicates from '../../../../data/repositories/duplicates.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, esc } from '../../../../shared/format.js';

export const meta = { title: 'Merge patients' };

const STEPS = [
  { title: 'Choose the records', hint: 'The survivor keeps its MRN; the duplicate is kept read-only and points at it.' },
  { title: 'Field by field', hint: 'Only the fields that differ can be chosen. Everything else stays as it is.' },
  { title: 'Re-link and confirm', hint: 'What follows the patient across, and what the trail will record.' },
];

export async function render(mount, ctx) {
  const res = await fetch(new URL('./patient-merge.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load patient-merge.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Merge patients');
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Duplicates', path: '/frontis/patients/duplicates' },
    { label: 'Merge' },
  ]);

  const role = currentRole();
  const pick = (mrn) => (patients.get(mrn) && patients.get(mrn).status !== 'Merged' ? mrn : '');
  const state = {
    step: 0,
    survivor: pick(ctx.query.survivor),
    duplicate: pick(ctx.query.duplicate),
    choices: {},
    done: null,
  };
  const $ = (sel) => mount.querySelector(sel);

  const survivor = () => patients.get(state.survivor);
  const duplicate = () => patients.get(state.duplicate);
  const differing = () =>
    patients.MERGE_FIELDS.filter((key) => String(survivor()?.[key] ?? '') !== String(duplicate()?.[key] ?? ''));

  function draw() {
    $('#pm-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#pm-title').textContent = STEPS[state.step].title;
    $('#pm-hint').textContent = STEPS[state.step].hint;
    $('#pm-body').innerHTML = [stepChoose, stepFields, stepConfirm][state.step]();
    drawFooter();
  }

  function stepHtml(step, i) {
    const cls = i === state.step ? ' stepper__step--current' : i < state.step ? ' stepper__step--done' : '';
    return `
      <button class="stepper__step${cls}" data-step="${i}" ${i > state.step ? 'aria-disabled="true"' : ''}
              title="${i > state.step ? 'Finish the current step first' : esc(step.title)}">
        <span class="stepper__n">${i < state.step ? '<span class="icon icon--sm">check</span>' : i + 1}</span>
        <span class="stepper__label">${esc(step.title)}</span>
      </button>`;
  }

  function drawFooter() {
    const back = $('#pm-back');
    const next = $('#pm-next');
    const last = state.step === 2;

    back.disabled = state.step === 0 || Boolean(state.done);
    back.title = state.step === 0 ? 'You are on the first step' : state.done ? 'The merge is done' : '';

    next.innerHTML = state.done
      ? `Open ${esc(state.done)}<span class="icon icon--sm">arrow_forward</span>`
      : last
        ? '<span class="icon icon--sm">merge</span>Confirm merge'
        : 'Next<span class="icon icon--sm">chevron_right</span>';
    next.disabled = state.step === 0 && Boolean(chooseError());
    next.title = next.disabled ? chooseError() : '';
  }

  function chooseError() {
    if (!state.survivor || !state.duplicate) return 'Choose both records first';
    if (state.survivor === state.duplicate) return 'Choose two different records';
    if (blocked(survivor()) || blocked(duplicate())) return 'Your role reads one of these records masked';
    return '';
  }

  const blocked = (p) => Boolean(p?.vip) && !role.canViewVip;

  // --- steps ----------------------------------------------------------------

  function stepChoose() {
    // The picker reads through view() like every other screen, so a role
    // without VIP access never sees a restricted name in a dropdown.
    const rows = patients.search('', { sort: 'nameEn' }, { includeMerged: false })
      .map((p) => patients.view(p, role));
    const error = chooseError();
    return `
      <div class="rule-child-row">
        <label class="field">
          <span class="icon icon--sm">person</span>
          <select id="pm-survivor" aria-label="Survivor">${optionsHtml(rows, state.survivor)}</select>
        </label>
        <button class="btn btn--ghost btn--sm" data-act="swap" title="Swap the two records">
          <span class="icon icon--sm">swap_horiz</span>Swap
        </button>
        <label class="field">
          <span class="icon icon--sm">person_off</span>
          <select id="pm-duplicate" aria-label="Duplicate">${optionsHtml(rows, state.duplicate)}</select>
        </label>
      </div>
      <p class="t-body-sm">The survivor is the record everything is re-linked to. The duplicate keeps its MRN and
        becomes read-only, pointing at the survivor, so an old wristband or claim still resolves.</p>
      ${error && (state.survivor || state.duplicate)
        ? `<div class="alert alert--warning"><span class="icon">priority_high</span><div>${esc(error)}.</div></div>`
        : ''}
      ${state.survivor && state.duplicate && !error ? sideBySide() : ''}`;
  }

  function sideBySide() {
    const a = survivor();
    const b = duplicate();
    return `
      <div class="toolbar"><span class="t-title-sm">The two records</span></div>
      <table class="tbl">
        <thead><tr><th>Field</th><th>Survivor ${esc(a.mrn)}</th><th>Duplicate ${esc(b.mrn)}</th></tr></thead>
        <tbody>
          ${['nameEn', 'dob', 'civilId', 'passportNo', 'phone', 'city'].map((key) => `
            <tr>
              <td>${esc(patients.fieldLabel(key))}</td>
              <td>${esc(show(a[key]))}</td>
              <td>${esc(show(b[key]))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function stepFields() {
    const a = survivor();
    const b = duplicate();
    const diff = differing();
    return `
      <p class="t-body">${diff.length
        ? `${diff.length} field${diff.length === 1 ? '' : 's'} differ. Choose which value the surviving record keeps; the rest are identical and are shown for context.`
        : 'Every field is identical on both records, so there is nothing to choose. Continue to the re-link step.'}</p>
      <table class="tbl">
        <thead>
          <tr><th>Field</th><th>Survivor ${esc(a.mrn)}</th><th>Duplicate ${esc(b.mrn)}</th><th>Keep</th></tr>
        </thead>
        <tbody>
          ${patients.MERGE_FIELDS.map((key) => fieldRow(key, a, b, diff.includes(key))).join('')}
        </tbody>
      </table>`;
  }

  function fieldRow(key, a, b, differs) {
    const choice = state.choices[key] || 'survivor';
    if (!differs) {
      return `
        <tr>
          <td>${esc(patients.fieldLabel(key))}</td>
          <td>${esc(show(a[key]))}</td>
          <td>${esc(show(b[key]))}</td>
          <td><span class="t-body-sm">identical</span></td>
        </tr>`;
    }
    return `
      <tr>
        <td>${esc(patients.fieldLabel(key))}</td>
        <td>${esc(show(a[key]))}</td>
        <td><span class="badge badge--warning">${esc(show(b[key]))}</span></td>
        <td>
          <label class="t-body-sm">
            <input type="radio" name="keep-${key}" value="survivor" data-field="${key}" ${choice === 'survivor' ? 'checked' : ''}>
            survivor
          </label>
          <label class="t-body-sm">
            <input type="radio" name="keep-${key}" value="duplicate" data-field="${key}" ${choice === 'duplicate' ? 'checked' : ''}>
            duplicate
          </label>
        </td>
      </tr>`;
  }

  function stepConfirm() {
    if (state.done) return doneHtml();
    const a = survivor();
    const b = duplicate();
    const taken = differing().filter((key) => state.choices[key] === 'duplicate');
    const rows = patients.relinkPreview(b.mrn);
    return `
      <div class="toolbar"><span class="t-title-sm">Re-link preview</span></div>
      <table class="tbl">
        <thead><tr><th>What moves</th><th class="num">From ${esc(b.mrn)}</th><th>Where it lands</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.label)}</td>
              <td class="num">${r.count}</td>
              <td>${r.count ? `re-linked to ${esc(a.mrn)}` : 'nothing to move'}</td>
            </tr>`).join('')}
          ${['Encounters', 'Policies', 'Accounts'].map((label) => `
            <tr>
              <td>${label}</td>
              <td class="num">0</td>
              <td><span class="t-body-sm">none yet — the module that owns them re-links its own rows</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="alert alert--warning">
        <span class="icon">priority_high</span>
        <div>
          <div class="title">${esc(b.mrn)} becomes read-only</div>
          ${taken.length
            ? `${esc(a.mrn)} keeps ${taken.map((k) => esc(patients.fieldLabel(k))).join(', ')} from the duplicate.`
            : `${esc(a.mrn)} keeps every one of its own values.`}
          Both records are audited with the choices and the counts. A merge is not undone in this demo.
        </div>
      </div>`;
  }

  function doneHtml() {
    return `
      <div class="alert alert--success">
        <span class="icon">check_circle</span>
        <div>
          <div class="title">Merged into ${esc(state.done)}</div>
          The duplicate is read-only and points at the survivor, the worklist pair is closed, and both records
          carry the entry.
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('change', (e) => {
    if (e.target.id === 'pm-survivor') state.survivor = e.target.value;
    else if (e.target.id === 'pm-duplicate') state.duplicate = e.target.value;
    else if (e.target.dataset.field) {
      state.choices[e.target.dataset.field] = e.target.value;
      return;
    } else return;
    draw();
  });

  mount.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="swap"]')) {
      [state.survivor, state.duplicate] = [state.duplicate, state.survivor];
      state.choices = {};
      return draw();
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step && !state.done) {
      state.step = Number(step.dataset.step);
      return draw();
    }

    if (e.target.closest('#pm-back') && !$('#pm-back').disabled) {
      state.step -= 1;
      return draw();
    }
    if (e.target.closest('#pm-next') && !$('#pm-next').disabled) {
      if (state.done) return ctx.navigate(`/frontis/patients/${state.done}`);
      if (state.step === 2) return runMerge();
      state.step += 1;
      draw();
    }
  });

  function runMerge() {
    const result = patients.merge(state.survivor, state.duplicate, state.choices);
    if (!result) return;
    duplicates.markMerged(state.survivor, state.duplicate);
    state.done = result.survivor.mrn;
    draw();
    toast(`Merged into ${result.survivor.mrn}`, 'success');
  }

  draw();
}

function optionsHtml(rows, selected) {
  return `<option value="">Choose a patient…</option>${rows
    .map((p) => `<option value="${esc(p.mrn)}"${p.mrn === selected ? ' selected' : ''}>${esc(p.mrn)} — ${esc(p.nameEn)}, ${date(p.dob)}</option>`)
    .join('')}`;
}

const show = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));
