// Bundle builder — details, components, review. Reached at
// #/pactum/cdm/bundles/new and #/pactum/cdm/bundles/<id>; cdm-list.js hands off
// the mount. Nothing is written until Save on the review step.
//
// A bundle may hold another bundle, so every candidate is checked against
// cdm.wouldCreateCycle before it can be added, and again at save. The markup of
// the three steps lives in bundle-builder-rows.js.

import * as cdm from '../../../../data/repositories/cdm.js';
import { usd, esc } from '../../../../shared/format.js';
import { toast } from '../../../../shared/toast.js';
import { handleTreeClick } from './component-tree.js';
import * as rows from './bundle-builder-rows.js';

export const meta = { title: 'Bundle builder' };

const STEPS = [
  { title: 'Details', hint: 'What the bundle is, and what it costs.' },
  { title: 'Components', hint: 'Active charge lines and bundles only.' },
  { title: 'Review', hint: 'Check the tree, then save.' },
];

const PICKER_LIMIT = 40;

export async function render(mount, ctx) {
  const param = ctx.params[1];
  const editing = param === 'new' ? null : cdm.get(param);
  if (param !== 'new' && !editing) throw new Error(`No bundle with id ${param}`);

  const res = await fetch(new URL('./bundle-builder.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load bundle-builder.html (${res.status})`);
  mount.innerHTML = await res.text();

  const id = editing?.id || null;
  const draft = {
    chargeCode: editing?.chargeCode || '',
    name: editing?.name || '',
    bundleType: editing?.bundleType || 'Procedure',
    standardPrice: editing ? String(editing.standardPrice) : '',
    validFrom: editing?.validFrom || '',
    validTo: editing?.validTo || '',
    status: editing?.status || 'Active',
    components: (editing?.components || []).map((c) => ({
      refId: c.refId,
      qty: c.qty,
      limitType: c.limitType || 'Quantity',
      limitQty: c.limitQty ?? c.qty,
      limitAmount: c.limitAmount || 0,
    })),
  };
  const state = { step: 0, q: '', open: new Set() };
  const $ = (sel) => mount.querySelector(sel);

  ctx.setHeader(editing ? `Bundle — ${editing.chargeCode}` : 'New bundle');
  ctx.setCrumb([
    { label: 'Pactum', path: '/pactum/payers' },
    { label: 'CDM', path: '/pactum/cdm' },
    { label: 'Bundles', path: '/pactum/cdm/bundles' },
    { label: editing ? editing.chargeCode : 'New bundle' },
  ]);

  // --- totals ---------------------------------------------------------------

  const sum = () => draft.components.reduce((total, c) => total + price(c.refId) * Number(c.qty || 0), 0);
  const price = (refId) => Number(cdm.get(refId)?.standardPrice || 0);

  function gapText() {
    const parts = sum();
    const bundlePrice = Number(draft.standardPrice || 0);
    if (!parts || !bundlePrice) return '';
    const delta = ((bundlePrice - parts) / parts) * 100;
    if (Math.abs(delta) < 0.05) return ' · priced at cost';
    return delta < 0 ? ` · ${Math.abs(delta).toFixed(1)}% discount` : ` · ${delta.toFixed(1)}% markup`;
  }

  function drawTotals() {
    $('#bb-totals').textContent = draft.components.length
      ? `Sum of components ${usd(sum())} · bundle price ${usd(Number(draft.standardPrice || 0))}${gapText()}`
      : '';
  }

  // --- steps ----------------------------------------------------------------

  function draw() {
    $('#bb-stepper').innerHTML = STEPS.map(stepHtml).join('<span class="stepper__line"></span>');
    $('#bb-title').textContent = STEPS[state.step].title;
    $('#bb-hint').textContent = STEPS[state.step].hint;
    $('#bb-body').innerHTML = [
      () => rows.stepDetails(draft, editing),
      () => rows.stepComponents(state.q),
      () => rows.stepReview(draft, { total: sum(), gap: gapText() }),
    ][state.step]();
    $('#bb-next').innerHTML = state.step === 2
      ? '<span class="icon icon--sm">save</span>Save bundle'
      : 'Next<span class="icon icon--sm">chevron_right</span>';
    $('#bb-back').disabled = state.step === 0;
    $('#bb-back').title = state.step === 0 ? 'You are on the first step' : '';
    clearError();
    // The components step is two empty tables until they are filled, so every
    // path back onto it — including a failed save — fills them here.
    if (state.step === 1) {
      drawPicker();
      drawChosen();
    }
    drawTotals();
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

  function drawPicker() {
    const needle = state.q.trim().toLowerCase();
    const found = cdm
      .findActive()
      .filter((r) => r.id !== id)
      .filter((r) => !needle || r.chargeCode.toLowerCase().includes(needle) || cdm.label(r).toLowerCase().includes(needle))
      .slice(0, PICKER_LIMIT);

    $('#bb-picker').innerHTML = rows.pickerRows(found, {
      bundleId: id,
      chosen: new Set(draft.components.map((c) => c.refId)),
    });
  }

  function drawChosen() {
    $('#bb-chosen').innerHTML = rows.chosenRows(draft.components, state.open);
    drawTotals();
  }

  // --- validation and save --------------------------------------------------

  function showError(message) {
    const box = $('#bb-error');
    box.textContent = message;
    box.hidden = false;
  }

  const clearError = () => {
    const box = $('#bb-error');
    box.hidden = true;
    box.textContent = '';
  };

  function detailsError() {
    if (draft.chargeCode.trim().length < 3) return 'Enter a bundle code, for example PKG-ORT-009.';
    if (!editing && !cdm.isChargeCodeUnique(draft.chargeCode, id)) return `${draft.chargeCode} is already used by another charge line.`;
    if (draft.name.trim().length < 3) return 'Enter the name staff will see on the bill.';
    const value = Number(draft.standardPrice);
    if (!draft.standardPrice || !Number.isFinite(value) || value <= 0) return 'Enter a bundle price greater than zero.';
    if (draft.bundleType === 'Promotional') {
      if (!draft.validFrom || !draft.validTo) return 'A promotional bundle needs both validity dates.';
      if (draft.validTo < draft.validFrom) return 'Valid to cannot be before valid from.';
    }
    return '';
  }

  function componentsError() {
    if (!draft.components.length) return 'Add at least one component.';
    if (draft.components.some((c) => !(Number(c.qty) > 0))) return 'Every component needs a quantity above zero.';
    for (const c of draft.components) {
      const code = cdm.get(c.refId)?.chargeCode || c.refId;
      const allowance = c.limitType === 'Amount Allowance';
      if (allowance && !(Number(c.limitAmount) > 0)) return `${code} is on an amount allowance, so it needs an allowance above zero.`;
      if (!allowance && !(Number(c.limitQty) > 0)) return `${code} needs an included quantity above zero.`;
    }
    for (const c of draft.components) {
      if (!cdm.wouldCreateCycle(id, c.refId)) continue;
      const chain = cdm.cyclePath(c.refId, id) || [draft.chargeCode, cdm.get(c.refId)?.chargeCode];
      return `${cdm.get(c.refId)?.chargeCode} cannot go in here — it would create a circular reference: ${chain.join(' → ')} → ${draft.chargeCode}.`;
    }
    return '';
  }

  function save() {
    const problem = detailsError() || componentsError();
    if (problem) {
      state.step = detailsError() ? 0 : 1;
      draw();
      showError(problem);
      return;
    }

    const values = {
      kind: 'bundle',
      chargeCode: draft.chargeCode.trim().toUpperCase(),
      name: draft.name.trim(),
      descriptionEn: draft.name.trim(),
      category: 'Bundle',
      uom: 'Package',
      bundleType: draft.bundleType,
      standardPrice: Number(draft.standardPrice),
      status: draft.status,
      validFrom: draft.bundleType === 'Promotional' ? draft.validFrom : '',
      validTo: draft.bundleType === 'Promotional' ? draft.validTo : '',
      components: draft.components.map((c) => ({
        refId: c.refId,
        qty: Number(c.qty),
        limitType: c.limitType,
        limitQty: c.limitType === 'Amount Allowance' ? 0 : Number(c.limitQty),
        limitAmount: c.limitType === 'Amount Allowance' ? Number(c.limitAmount) : 0,
      })),
    };

    const row = id
      ? cdm.update(id, values)
      : cdm.create(values, { details: `${values.chargeCode} — ${values.name}` });
    toast(`${row.chargeCode} ${id ? 'saved' : 'created'}`, 'success');
    ctx.navigate('/pactum/cdm/bundles');
  }

  // --- events ---------------------------------------------------------------

  mount.addEventListener('input', (e) => {
    const field = e.target.closest('[name]');
    if (field && field.name in draft) {
      draft[field.name] = field.value;
      drawTotals();
      return;
    }
    if (e.target.id === 'bb-search') {
      state.q = e.target.value;
      drawPicker();
      return;
    }
    const limit = e.target.closest('[data-limit-qty], [data-limit-amount]');
    if (limit) {
      const { limitQty, limitAmount } = limit.dataset;
      const component = draft.components.find((c) => c.refId === (limitQty || limitAmount));
      if (component) component[limitQty ? 'limitQty' : 'limitAmount'] = limit.value;
      return;
    }

    const qty = e.target.closest('[data-qty]');
    if (!qty) return;
    const component = draft.components.find((c) => c.refId === qty.dataset.qty);
    if (!component) return;
    // A quantity limit follows the quantity while it has not been set apart.
    if (component.limitType !== 'Amount Allowance' && String(component.limitQty) === String(component.qty)) {
      component.limitQty = qty.value;
      const box = mount.querySelector(`[data-limit-qty="${component.refId}"]`);
      if (box) box.value = qty.value;
    }
    component.qty = qty.value;
    const cell = mount.querySelector(`[data-line="${component.refId}"]`);
    if (cell) cell.textContent = usd(price(component.refId) * Number(component.qty || 0));
    drawTotals();
  });

  mount.addEventListener('change', (e) => {
    const limitType = e.target.closest('[data-limit-type]');
    if (limitType) {
      const component = draft.components.find((c) => c.refId === limitType.dataset.limitType);
      if (!component) return;
      component.limitType = limitType.value;
      if (component.limitType === 'Quantity' && !(Number(component.limitQty) > 0)) component.limitQty = component.qty;
      drawChosen();
      return;
    }
    if (e.target.id !== 'bb-type') return;
    draft.bundleType = e.target.value;
    draw();
  });

  mount.addEventListener('click', (e) => {
    if (handleTreeClick(e)) return;

    const add = e.target.closest('[data-add]');
    if (add && !add.disabled) {
      draft.components.push({ refId: add.dataset.add, qty: 1, limitType: 'Quantity', limitQty: 1, limitAmount: 0 });
      drawChosen();
      drawPicker();
      return;
    }

    const remove = e.target.closest('[data-remove]');
    if (remove) {
      draft.components = draft.components.filter((c) => c.refId !== remove.dataset.remove);
      state.open.delete(remove.dataset.remove);
      drawChosen();
      drawPicker();
      return;
    }

    const expand = e.target.closest('[data-expand]');
    if (expand) {
      const refId = expand.dataset.expand;
      if (state.open.has(refId)) state.open.delete(refId);
      else state.open.add(refId);
      drawChosen();
      return;
    }

    const step = e.target.closest('[data-step]');
    if (step && Number(step.dataset.step) < state.step) {
      state.step = Number(step.dataset.step);
      draw();
      return;
    }

    if (e.target.closest('#bb-back') && state.step > 0) {
      state.step -= 1;
      draw();
      return;
    }

    if (!e.target.closest('#bb-next')) return;
    if (state.step === 2) return save();

    const problem = state.step === 0 ? detailsError() : componentsError();
    if (problem) return showError(problem);
    state.step += 1;
    draw();
  });

  draw();
}
