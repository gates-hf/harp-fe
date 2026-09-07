// The Overage tab: what happens when a claim runs past what a bundle price
// covers. One section per Case Rate methodology row — a policy for the bundle
// and, under it, overrides for single components. Each section saves on its
// own, so a half-finished second policy never blocks the first.

import * as contracts from '../../../../data/repositories/contracts.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc, usd } from '../../../../shared/format.js';

/** render(host, { contractId, readOnly, refresh }) */
export async function render(host, { contractId, readOnly, refresh }) {
  const res = await fetch(new URL('./tab-overage.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load tab-overage.html (${res.status})`);
  host.innerHTML = await res.text();

  const $ = (sel) => host.querySelector(sel);
  const contract = () => contracts.get(contractId);
  const rows = () => contracts.bundlePricedRows(contract());

  // One draft per section, seeded from the stored policy.
  const drafts = new Map(rows().map((row) => [row.id, draftFor(contract(), row)]));

  function draw() {
    const list = rows();
    $('#to-lede').innerHTML = list.length
      ? `<p class="t-body">A bundle price covers the limits set on its components. Anything past a limit is overage:
           say who pays for it, and set a tolerance if small overruns should pass without a decision.</p>`
      : '';
    $('#to-sections').innerHTML = list.length ? list.map(sectionHtml).join('') : emptyHtml();
  }

  function drawSection(id) {
    const section = host.querySelector(`[data-section="${id}"]`);
    const row = rows().find((m) => m.id === id);
    if (section && row) section.outerHTML = sectionHtml(row);
  }

  function sectionHtml(row) {
    const draft = drafts.get(row.id);
    const saved = contracts.overagePolicyFor(contract(), row.id);
    const bundle = cdm.get(row.params.bundleId);
    return `
      <div class="panel panel--bordered" data-section="${esc(row.id)}">
        <div class="panel-header">
          <span>${esc(contracts.scopeLabel(row))} · ${esc(cdm.label(bundle) || 'no bundle')} · ${usd(row.params.amount)}</span>
          <span class="spacer"></span>
          ${saved
            ? `<span class="badge badge--success"><span class="dot"></span>Policy set</span>`
            : '<span class="badge badge--warning"><span class="dot"></span>Policy required</span>'}
        </div>
        <div class="panel-body">
          <div class="toolbar"><span class="t-title-sm">Bundle policy</span></div>
          <dl class="dl dl--narrow">
            <dt><label>Action *</label></dt>
            <dd class="toolbar">${selectHtml('action', contracts.OVERAGE_ACTIONS, draft.action, 'Choose an action')}</dd>
            <dt><label>Tolerance</label></dt>
            <dd class="toolbar">${toleranceHtml(draft.tolerance, '')}</dd>
          </dl>

          <div class="toolbar">
            <span class="t-title-sm">Component overrides</span>
            <span class="spacer"></span>
            <span class="t-body-sm">${draft.overrides.length} override${draft.overrides.length === 1 ? '' : 's'}</span>
            ${readOnly ? '' : `<button class="btn btn--secondary btn--sm" data-act="add-override">
                 <span class="icon icon--sm">add</span>Add override</button>`}
          </div>
          <table class="tbl">
            <thead><tr><th>Component</th><th>Action *</th><th>Tolerance</th><th></th></tr></thead>
            <tbody>${overrideRows(row, draft)}</tbody>
          </table>

          <div class="field-error" data-error ${draft.error ? '' : 'hidden'}>${esc(draft.error || '')}</div>
          ${readOnly ? '' : `
          <div class="toolbar">
            <span class="t-body-sm">${saved ? `Last saved ${esc(date(saved.updatedAt))}` : 'Not saved yet'}</span>
            <span class="spacer"></span>
            <button class="btn btn--primary btn--sm" data-act="save">
              <span class="icon icon--sm">save</span>Save policy
            </button>
          </div>`}
        </div>
      </div>`;
  }

  function overrideRows(row, draft) {
    const parts = components(row.params.bundleId);
    if (!draft.overrides.length) {
      return `<tr><td colspan="4">No overrides. Every component follows the bundle policy above.</td></tr>`;
    }
    const taken = new Set(draft.overrides.map((o) => o.componentId));
    return draft.overrides
      .map((over, i) => `
        <tr>
          <td>
            <label class="field">
              <select data-field="componentId" data-index="${i}" ${readOnly ? 'disabled' : ''} aria-label="Component for override ${i + 1}">
                <option value=""${over.componentId ? '' : ' selected'}>Choose a component</option>
                ${parts.map((p) => `<option value="${esc(p.id)}"${p.id === over.componentId ? ' selected' : ''}
                        ${taken.has(p.id) && p.id !== over.componentId ? ' disabled' : ''}>${esc(p.label)}</option>`).join('')}
              </select>
            </label>
          </td>
          <td>${selectHtml('action', contracts.OVERAGE_ACTIONS, over.action, 'Choose an action', i)}</td>
          <td class="toolbar">${toleranceHtml(over.tolerance, i)}</td>
          <td>${readOnly ? '' : `
            <button class="btn btn--ghost btn--icon btn--sm" data-act="remove-override" data-index="${i}"
                    title="Remove this override"><span class="icon icon--sm">delete</span></button>`}
          </td>
        </tr>`)
      .join('');
  }

  function selectHtml(field, values, chosen, placeholder, index = '') {
    return `
      <label class="field">
        <select data-field="${field}" data-index="${index}" ${readOnly ? 'disabled' : ''} aria-label="${esc(placeholder)}">
          <option value=""${chosen ? '' : ' selected'}>${esc(placeholder)}</option>
          ${values.map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>`;
  }

  /** Sits in a .toolbar row, so the type and its value stand side by side. */
  function toleranceHtml(tolerance, index) {
    const type = tolerance?.type || '';
    return `
      <label class="field">
        <select data-field="toleranceType" data-index="${index}" ${readOnly ? 'disabled' : ''} aria-label="Tolerance type">
          <option value=""${type ? '' : ' selected'}>None</option>
          ${contracts.TOLERANCE_TYPES.map((t) => `<option value="${esc(t)}"${t === type ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </label>
      ${type ? `
      <label class="field">
        <span class="icon icon--sm">${type === '%' ? 'percent' : 'attach_money'}</span>
        <input type="number" min="0" step="0.01" value="${esc(tolerance?.value ?? '')}" data-field="toleranceValue"
               data-index="${index}" ${readOnly ? 'disabled' : ''} aria-label="Tolerance value">
      </label>` : ''}`;
  }

  function emptyHtml() {
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">rule</span></div>
        <div class="state-view__title">No bundle-priced rows</div>
        <p class="state-view__body">Overage answers for what a bundle price does not cover, so it starts on the
           Methodologies tab: add a Case Rate row against a bundle and its policy appears here.</p>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  host.addEventListener('change', (e) => {
    const field = e.target.closest('[data-field]');
    if (!field || readOnly) return;
    const id = field.closest('[data-section]').dataset.section;
    const draft = drafts.get(id);
    const at = field.dataset.index === '' ? null : Number(field.dataset.index);
    const target = at == null ? draft : draft.overrides[at];
    if (!target) return;

    if (field.dataset.field === 'toleranceType') {
      target.tolerance = field.value ? { type: field.value, value: target.tolerance?.value ?? '' } : null;
      return drawSection(id);
    }
    if (field.dataset.field === 'toleranceValue') {
      if (target.tolerance) target.tolerance.value = field.value;
      return;
    }
    target[field.dataset.field] = field.value;
    if (field.dataset.field === 'componentId') drawSection(id);
  });

  host.addEventListener('input', (e) => {
    const field = e.target.closest('[data-field="toleranceValue"]');
    if (!field || readOnly) return;
    const draft = drafts.get(field.closest('[data-section]').dataset.section);
    const at = field.dataset.index === '' ? null : Number(field.dataset.index);
    const target = at == null ? draft : draft.overrides[at];
    if (target?.tolerance) target.tolerance.value = field.value;
  });

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || readOnly) return;
    const id = e.target.closest('[data-section]').dataset.section;
    const draft = drafts.get(id);

    if (act === 'add-override') {
      draft.overrides.push({ componentId: '', action: '', tolerance: null });
      return drawSection(id);
    }
    if (act === 'remove-override') {
      draft.overrides.splice(Number(e.target.closest('[data-index]').dataset.index), 1);
      return drawSection(id);
    }
    if (act !== 'save') return;

    draft.error = problemWith(draft);
    if (draft.error) return drawSection(id);
    contracts.saveOveragePolicy(contractId, {
      methodologyId: id,
      action: draft.action,
      tolerance: draft.tolerance,
      overrides: draft.overrides,
    });
    toast('Overage policy saved', 'success');
    refresh();
  });

  draw();
}

// --- helpers -------------------------------------------------------------------

function draftFor(contract, row) {
  const saved = contracts.overagePolicyFor(contract, row.id);
  return {
    action: saved?.action || '',
    tolerance: saved?.tolerance ? { ...saved.tolerance } : null,
    overrides: (saved?.overrides || []).map((o) => ({ ...o, tolerance: o.tolerance ? { ...o.tolerance } : null })),
    error: '',
  };
}

/** The bundle's component tree, flattened and indented, one entry per line. */
function components(bundleId, depth = 0, seen = new Set(), out = []) {
  for (const part of cdm.componentRows(bundleId)) {
    if (!out.some((p) => p.id === part.row.id)) {
      out.push({ id: part.row.id, label: `${'· '.repeat(depth)}${part.row.chargeCode} — ${cdm.label(part.row)}` });
    }
    if (cdm.isBundle(part.row) && !seen.has(part.row.id)) {
      components(part.row.id, depth + 1, new Set([...seen, part.row.id]), out);
    }
  }
  return out;
}

function problemWith(draft) {
  const value = (t) => Number(t?.value);
  if (!draft.action) return 'Choose what happens when a claim runs past the bundle price.';
  if (draft.tolerance && !(value(draft.tolerance) > 0)) return 'A tolerance needs a value above zero, or set it to None.';
  for (const [i, over] of draft.overrides.entries()) {
    if (!over.componentId) return `Override ${i + 1} needs a component.`;
    if (!over.action) return `Override ${i + 1} needs an action.`;
    if (over.tolerance && !(value(over.tolerance) > 0)) return `Override ${i + 1} needs a tolerance above zero, or None.`;
  }
  const ids = draft.overrides.map((o) => o.componentId);
  if (new Set(ids).size !== ids.length) return 'The same component is overridden twice — remove the duplicate.';
  return '';
}
