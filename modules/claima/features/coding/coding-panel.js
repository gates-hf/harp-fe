// The coding pane of the workspace: the diagnoses and procedures editors, the
// queries strip, the validation panel and the buttons under them. Markup only
// — coding-workspace.js owns the draft, the searches and the clicks — so the
// pane can be redrawn from state after every change without losing it.
//
// Each section carries an id and tabindex="-1" so a blocking entry's Jump can
// land focus on it; the workspace moves focus before it scrolls.

import * as coding from '../../../../data/repositories/coding.js';
import { icd, proc, label as codeLabel } from '../../../../data/repositories/code-sets.js';
import { DOCTORS } from '../../../../data/seed/reference.js';
import { date, esc } from '../../../../shared/format.js';
import { queryRowHtml } from './cdi-queries.js';

/**
 * The date a chart's codes are resolved on (amendment 44): the catalogue is
 * versioned, and a visit from last year is coded on last year's release.
 */
export const dosOf = (enc) => String(enc?.startAt || '').slice(0, 10);

export function panelHtml(view) {
  const { editable, why } = view;
  return `
    ${editable ? '' : `<div class="alert alert--info"><span class="icon">lock</span><div>${esc(why)}</div></div>`}
    ${view.requestsHtml}
    <div id="cx-sec-diagnoses" tabindex="-1">${diagnosesHtml(view)}</div>
    <div id="cx-sec-procedures" tabindex="-1">${proceduresHtml(view)}</div>
    <div id="cx-sec-queries" tabindex="-1">${queriesHtml(view)}</div>
    <div id="cx-sec-validation" tabindex="-1">${validationHtml(view)}</div>
    ${footerHtml(view)}
    ${view.versionsHtml}`;
}

// --- diagnoses ------------------------------------------------------------------

function diagnosesHtml({ enc, draft, editable, dxQuery }) {
  const ip = enc.type === 'IP';
  return `
    <div class="toolbar">
      <span class="t-title-sm">Diagnoses</span>
      <span class="spacer"></span>
      ${editable ? `
        <label class="field">
          <span class="icon icon--sm">search</span>
          <input type="search" data-search="dx" value="${esc(dxQuery)}" placeholder="ICD-10 code or words" aria-label="Search diagnoses">
        </label>` : ''}
    </div>
    <div id="cx-dx-hits">${hitsHtml('dx', dxQuery, dosOf(enc))}</div>
    ${draft.diagnoses.length ? `
      <table class="tbl">
        <thead><tr>
          <th scope="col" title="One diagnosis is principal">Principal</th><th scope="col">Code</th><th scope="col">Description</th>
          ${ip ? '<th scope="col" title="Present on admission">POA</th>' : ''}<th scope="col"></th>
        </tr></thead>
        <tbody>
          ${draft.diagnoses.map((d, i) => `
            <tr>
              <td><input type="radio" name="principal" value="${i}"${d.principal ? ' checked' : ''}${editable ? '' : ' disabled'}
                         aria-label="Principal diagnosis ${esc(d.code)}"></td>
              <td class="t-mono-sm">${esc(d.code)}</td>
              <td>${esc(d.desc)}</td>
              ${ip ? `<td><label class="field"><select data-poa="${i}" aria-label="Present on admission for ${esc(d.code)}"${editable ? '' : ' disabled'}>
                <option value=""${d.poa ? '' : ' selected'}>—</option>
                ${coding.POA.map((v) => `<option value="${v}"${d.poa === v ? ' selected' : ''}>${v === 'Y' ? 'Y — yes' : v === 'N' ? 'N — no' : 'U — unknown'}</option>`).join('')}
              </select></label></td>` : ''}
              <td>${editable
                ? `<button class="btn btn--ghost btn--icon btn--sm" data-remove="dx" data-index="${i}" title="Remove ${esc(d.code)}"><span class="icon icon--sm">close</span></button>`
                : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
      : `<p class="t-body-sm">No diagnosis yet. ${editable ? 'Search the catalogue above and add the principal diagnosis first.' : ''}</p>`}`;
}

/**
 * The catalogue hits under a search field, with Add on each. `atDate` is the
 * visit's date of service: the hits come from the code-system version in force
 * that day, and the line under them says which one answered.
 */
export function hitsHtml(kind, q, atDate = '') {
  if (!String(q || '').trim()) return '';
  const rows = kind === 'dx' ? icd.search(q, { atDate }) : proc.search(q, { atDate });
  if (!rows.length) return `<p class="t-body-sm">Nothing in the ${kind === 'dx' ? 'ICD-10' : 'procedure'} catalogue matches “${esc(q)}”.</p>`;
  const sources = [...new Set(rows.map((r) => `${r.systemName} ${r.versionLabel}`))].join(', ');
  const fallback = rows.find((r) => r.fallback);
  return `
    <p class="t-body-sm">Resolved on ${esc(sources)}${atDate ? ` as of ${date(atDate)}` : ''}${fallback
      ? ` <span class="badge badge--warning" title="No version covers the date of service — the ${fallback.fallback === 'no-current' ? 'newest active' : 'current'} version answered"><span class="dot"></span>fallback</span>`
      : ''}</p>
    <table class="tbl">
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td class="t-mono-sm">${esc(r.code)}</td>
            <td>${esc(r.desc)}${r.category ? ` <span class="t-body-sm">· ${esc(r.category)}</span>` : ''}</td>
            <td><button class="btn btn--secondary btn--sm" data-add="${kind}" data-code="${esc(r.code)}">
              <span class="icon icon--sm">add</span>Add</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// --- procedures ------------------------------------------------------------------

function proceduresHtml({ enc, draft, editable, pxQuery, lines }) {
  const linkable = lines.filter(coding.isLinkable);
  const start = String(enc.startAt).slice(0, 10);
  const end = String(enc.endAt || '').slice(0, 10);
  return `
    <div class="toolbar">
      <span class="t-title-sm">Procedures</span>
      <span class="spacer"></span>
      ${editable ? `
        <label class="field">
          <span class="icon icon--sm">search</span>
          <input type="search" data-search="px" value="${esc(pxQuery)}" placeholder="Procedure code or words" aria-label="Search procedures">
        </label>` : ''}
    </div>
    <div id="cx-px-hits">${hitsHtml('px', pxQuery, dosOf(enc))}</div>
    ${draft.procedures.length ? draft.procedures.map((p, i) => `
      <div class="panel panel--sunken">
        <div class="panel-header">
          <span class="t-mono-sm">${esc(p.code)}</span>
          <span>${esc(p.desc)}</span>
          <span class="spacer"></span>
          ${editable ? `<button class="btn btn--ghost btn--icon btn--sm" data-remove="px" data-index="${i}" title="Remove ${esc(p.code)}"><span class="icon icon--sm">close</span></button>` : ''}
        </div>
        <div class="panel-body">
          <dl class="dl dl--narrow">
            <dt><label>Date performed</label></dt>
            <dd><label class="field"><input type="date" data-px="date" data-index="${i}" value="${esc(p.date)}" min="${esc(start)}" max="${esc(end)}"${editable ? '' : ' disabled'}></label></dd>
            <dt><label>Performed by</label></dt>
            <dd><label class="field"><select data-px="doctorId" data-index="${i}"${editable ? '' : ' disabled'}>
              <option value="">—</option>
              ${DOCTORS.map((d) => `<option value="${esc(d.id)}"${d.id === p.doctorId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
            </select></label></dd>
            <dt>Charge lines</dt>
            <dd>${linkable.length ? linkable.map((l) => `
              <label class="rule-child-row">
                <input type="checkbox" data-px-line="${esc(l.id)}" data-index="${i}"${p.chargeLineIds.includes(l.id) ? ' checked' : ''}${editable ? '' : ' disabled'}>
                <div><span class="t-mono-sm">${esc(l.chargeCode)}</span> ${esc(l.description)}</div>
              </label>`).join('')
              : '<span class="t-body-sm">No released line in a procedure category — link nothing, and the validation says so.</span>'}</dd>
          </dl>
        </div>
      </div>`).join('')
      : `<p class="t-body-sm">No procedure yet.${linkable.length ? ` ${linkable.length} released line${linkable.length === 1 ? '' : 's'} need${linkable.length === 1 ? 's' : ''} a code.` : ' Nothing released on this visit needs one.'}</p>`}`;
}

// --- queries -----------------------------------------------------------------------

function queriesHtml({ queries, editable, role }) {
  const open = queries.filter(coding.isQueryOpen).length;
  const raise = editable
    ? '<button class="btn btn--secondary btn--sm" data-act="raise"><span class="icon icon--sm">contact_support</span>Raise query</button>'
    : `<button class="btn btn--secondary btn--sm" disabled title="${esc(role.canCode ? 'A query is raised on a chart you can edit' : `${role.title} cannot raise a query`)}"><span class="icon icon--sm">contact_support</span>Raise query</button>`;
  return `
    <div class="toolbar">
      <span class="t-title-sm">Queries</span>
      ${open ? `<span class="badge badge--warning"><span class="dot"></span>${open} open</span>` : ''}
      <span class="spacer"></span>
      ${raise}
    </div>
    ${queries.length ? `
      <table class="tbl">
        <thead><tr>
          <th scope="col">Query</th><th scope="col">Type</th><th scope="col">Physician</th>
          <th scope="col">Question</th><th scope="col">Status</th><th scope="col">Turnaround</th><th scope="col"></th>
        </tr></thead>
        <tbody>${queries.map((q) => queryRowHtml(q)).join('')}</tbody>
      </table>`
      : '<p class="t-body-sm">No query has been raised on this chart.</p>'}`;
}

// --- validation --------------------------------------------------------------------

function validationHtml({ validation, draft, editable }) {
  const { blocking, warnings, acknowledged } = validation;
  const acks = new Map((draft.warningsAcknowledged || []).map((w) => [w.code, w.reason]));
  const real = blocking.filter((b) => b.key !== 'warnings');
  return `
    <div class="toolbar">
      <span class="t-title-sm">Validation</span>
      <span class="spacer"></span>
      ${validation.ok
        ? '<span class="badge badge--success"><span class="dot"></span>Ready to code</span>'
        : `<span class="badge badge--critical"><span class="dot"></span>${blocking.length} blocking</span>`}
    </div>
    ${real.length ? real.map((b) => `
      <div class="rule-child-row">
        <span class="icon icon--sm">error</span>
        <div>${esc(b.label)}</div>
        <span class="spacer"></span>
        ${b.jumpTo ? `<button class="btn btn--ghost btn--sm" data-jump="${esc(b.jumpTo)}">Jump</button>` : ''}
      </div>`).join('') : ''}
    ${warnings.length ? warnings.map((w) => `
      <div class="rule-child-row">
        <span class="icon icon--sm">${acknowledged.has(w.key) ? 'check_circle' : 'warning'}</span>
        <div>${esc(w.label)}${acknowledged.has(w.key) ? `<br><span class="t-body-sm">Acknowledged — ${esc(acks.get(w.key) || '')}</span>` : ''}</div>
        <span class="spacer"></span>
        ${editable
          ? (acknowledged.has(w.key)
            ? `<button class="btn btn--ghost btn--sm" data-unack="${esc(w.key)}">Undo</button>`
            : `<button class="btn btn--secondary btn--sm" data-ack="${esc(w.key)}">Acknowledge</button>`)
          : ''}
        ${w.jumpTo ? `<button class="btn btn--ghost btn--sm" data-jump="${esc(w.jumpTo)}">Jump</button>` : ''}
      </div>`).join('') : ''}
    ${!real.length && !warnings.length ? '<p class="t-body-sm">Nothing stands in the way. Every check has passed.</p>' : ''}`;
}

// --- footer ----------------------------------------------------------------------------

function footerHtml({ editable, why, validation, dirty, rec, role }) {
  const gate = (allowed, reason, label, act, cls, icon) => (allowed
    ? `<button class="btn ${cls}" data-act="${act}"><span class="icon icon--sm">${icon}</span>${label}</button>`
    : `<button class="btn ${cls}" disabled title="${esc(reason)}"><span class="icon icon--sm">${icon}</span>${label}</button>`);
  const codedWhy = !editable ? why : dirty ? 'Save the draft first — what is marked coded is what is saved' : !validation.ok ? 'Something still blocks it — see Validation' : '';
  const releaseWhy = !rec?.assignedTo ? 'The chart is in the pool already' : rec.status === 'Coded' ? 'A coded chart is not released' : (rec.assignedTo !== role.id && !role.canAssignCoding) ? `Assigned to ${coding.coderName(rec.assignedTo)}` : '';
  return `
    <div class="toolbar">
      <span class="t-body-sm">${dirty ? 'Unsaved changes' : ''}</span>
      <span class="spacer"></span>
      ${gate(!releaseWhy, releaseWhy, 'Release to pool', 'release', 'btn--ghost', 'undo')}
      ${gate(editable, why, 'Save draft', 'save', 'btn--secondary', 'save')}
      ${gate(!codedWhy, codedWhy, 'Mark coded', 'coded', 'btn--primary', 'task_alt')}
    </div>`;
}

export { codeLabel };
