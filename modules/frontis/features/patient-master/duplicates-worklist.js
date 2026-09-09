// Duplicates worklist — every pair the register raised, and what was decided.
// #/frontis/patients/duplicates.
//
// Two answers: Review opens the merge screen with both records prefilled, and
// Dismiss records that they are different people. Neither deletes the row —
// the worklist is the record of the decision.

import * as duplicates from '../../../../data/repositories/duplicates.js';
import * as patients from '../../../../data/repositories/patients.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { current as currentRole } from '../../../../shared/roles.js';
import { date, dateTime, esc } from '../../../../shared/format.js';

export const meta = { title: 'Duplicates' };

export async function render(mount, ctx) {
  const res = await fetch(new URL('./duplicates-worklist.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load duplicates-worklist.html (${res.status})`);
  mount.innerHTML = await res.text();

  ctx.setHeader('Potential duplicates');
  ctx.setCrumb([
    { label: 'Frontis', path: '/frontis/patients' },
    { label: 'Patients', path: '/frontis/patients' },
    { label: 'Duplicates' },
  ]);

  const state = { basis: ctx.query.basis || '', status: ctx.query.status || 'Open' };
  const $ = (sel) => mount.querySelector(sel);

  $('#dw-basis').innerHTML = options('All bases', duplicates.BASES, state.basis);
  $('#dw-status').innerHTML = options('All statuses', duplicates.STATUSES, state.status);

  function draw() {
    const rows = duplicates.list(state);
    const open = duplicates.openCount();
    $('#dw-count').textContent = open
      ? `${open} open ${open === 1 ? 'pair' : 'pairs'}`
      : 'Nothing open';
    $('#dw-rows').innerHTML = rows.map(rowHtml).join('');

    const empty = $('#dw-empty');
    empty.hidden = rows.length > 0;
    mount.querySelector('.tbl').hidden = rows.length === 0;
    if (!rows.length) empty.innerHTML = emptyHtml(state);
  }

  function rowHtml(pair) {
    const role = currentRole();
    const open = pair.status === 'Open';
    const tone = pair.status === 'Open' ? 'warning' : pair.status === 'Merged' ? 'success' : '';
    return `
      <tr data-id="${esc(pair.id)}">
        <td>${who(pair.mrnA, role)}</td>
        <td>${who(pair.mrnB, role)}</td>
        <td><span class="badge">${esc(pair.basis)}</span></td>
        <td class="t-mono-sm" title="${esc(dateTime(pair.detectedAt))}">${date(pair.detectedAt)}</td>
        <td>
          <span class="badge${tone ? ` badge--${tone}` : ''}"><span class="dot"></span>${pair.status}</span>
          ${pair.justification ? `<br><span class="t-body-sm" title="${esc(pair.justification)}">${esc(clip(pair.justification))}</span>` : ''}
        </td>
        <td>
          <button class="btn btn--secondary btn--sm" data-act="review" ${open ? '' : 'disabled'}
                  title="${open ? 'Compare the two records and merge' : `This pair was already ${pair.status.toLowerCase()}`}">
            <span class="icon icon--sm">compare_arrows</span>Review
          </button>
          <button class="btn btn--ghost btn--sm" data-act="dismiss" ${open ? '' : 'disabled'}
                  title="${open ? 'Record that these are different people' : `This pair was already ${pair.status.toLowerCase()}`}">
            <span class="icon icon--sm">close</span>Dismiss
          </button>
        </td>
      </tr>`;
  }

  function who(mrn, role) {
    const p = patients.view(patients.get(mrn), role);
    if (!p) return `<span class="t-mono-sm">${esc(mrn)}</span> — record not found`;
    return `
      <a class="crumb-link" href="#/frontis/patients/${esc(p.mrn)}">${esc(p.nameEn)}</a>
      <br><span class="t-mono-sm">${esc(p.mrn)}</span>
      ${p.status === 'Merged' ? ' <span class="badge">merged</span>' : ''}`;
  }

  function emptyHtml(s) {
    const filtered = s.basis || s.status;
    return `
      <div class="state-view">
        <div class="state-view__glyph"><span class="icon">check_circle</span></div>
        <div class="state-view__title">No potential duplicates</div>
        <p class="state-view__body">${filtered
          ? 'Nothing matches these filters. Clear them to see every pair the register has raised.'
          : 'Nothing is waiting. A pair lands here when a registration looks like someone already on file.'}</p>
        <div class="state-view__actions">
          ${filtered ? '<button class="btn btn--secondary" data-action="clear">Clear filters</button>' : ''}
          <a class="btn btn--primary" href="#/frontis/patients">Back to Patient Master</a>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------

  for (const [el, key] of [[$('#dw-basis'), 'basis'], [$('#dw-status'), 'status']]) {
    el.addEventListener('change', () => {
      state[key] = el.value;
      draw();
    });
  }

  mount.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="clear"]')) {
      state.basis = '';
      state.status = '';
      $('#dw-basis').value = '';
      $('#dw-status').value = '';
      return draw();
    }

    const row = e.target.closest('tr[data-id]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const pair = duplicates.get(row.dataset.id);
    if (!pair) return;

    if (act === 'review') {
      return ctx.navigate(`/frontis/patients/merge?survivor=${pair.mrnA}&duplicate=${pair.mrnB}`);
    }
    if (act === 'dismiss') await dismiss(pair);
  });

  ctx.onData(draw);
  draw();
}

async function dismiss(pair) {
  const dialog = modal.open({
    title: 'Dismiss the pair',
    sub: `${pair.mrnA} and ${pair.mrnB} · ${pair.basis}`,
    icon: 'close',
    tone: 'warning',
    size: 'md',
    body: `
      <p class="modal__lede">Dismissing says these are two different people. Both records stay as they are, and the
        pair stops being raised.</p>
      <dl class="dl">
        <dt>Reason *</dt>
        <dd>
          <label class="field field--area">
            <textarea name="reason" rows="3" placeholder="Two brothers born the same day; both civil IDs checked at the desk."></textarea>
          </label>
          <div class="field-error" data-error="reason" hidden></div>
        </dd>
      </dl>`,
    note: 'The reason is recorded against the first record in the pair.',
    foot: `
      <button class="btn btn--secondary" data-close>Cancel</button>
      <button class="btn btn--primary" data-act="ok">Dismiss pair</button>`,
  });

  dialog.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="ok"]')) return;
    const field = dialog.el.querySelector('[name="reason"]');
    const reason = field.value.trim();
    if (reason.length < 10) {
      const box = dialog.el.querySelector('[data-error="reason"]');
      box.textContent = 'Enter a reason — the next reviewer needs to know why this was closed.';
      box.hidden = false;
      field.closest('.field').classList.add('field--invalid');
      return field.focus();
    }
    dialog.close(reason);
  });

  const reason = await dialog.closed;
  if (!reason) return;
  duplicates.dismiss(pair.id, reason);
  toast('Pair dismissed', 'success');
}

function options(allLabel, values, selected) {
  return `<option value="">${allLabel}</option>${values
    .map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`)
    .join('')}`;
}

const clip = (text) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
