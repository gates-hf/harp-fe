// The batches table — newest first, each row carrying what the batch holds,
// how it goes out, where it stands and the next thing it needs: Generate,
// Mark submitted, Acknowledge, Rejections. A button that cannot act says why.

import * as batches from '../../../../data/repositories/batches.js';
import { esc } from '../../../../shared/format.js';
import { contentsHtml, datesHtml, modeHtml, payerName, statusHtml } from './batch-chips.js';

export function batchesTableHtml(rows, state) {
  if (!rows.length) return emptyHtml(state);
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Batch no.</th>
          <th scope="col">Payer</th>
          <th scope="col">Contents</th>
          <th scope="col">Mode</th>
          <th scope="col">Status</th>
          <th scope="col">Created · sent · ack</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>`;
}

function rowHtml(b) {
  const gen = batches.latestGeneration(b);
  const open = batches.isOpen(b);
  const submitWhy = batches.submitBlocker(b);
  const ackable = (b.status === 'Submitted' || b.status === 'Partially Rejected') && !b.acknowledgment;
  const answerable = batches.ANSWERABLE.includes(b.status);
  return `
    <tr data-no="${esc(b.batchNo)}" tabindex="0" title="Open ${esc(b.batchNo)}">
      <td><span class="t-mono-sm">${esc(b.batchNo)}</span>${gen ? `<br><span class="t-body-sm">files v${gen.version}</span>` : ''}</td>
      <td>${esc(payerName(b.payerId))}</td>
      <td>${contentsHtml(b)}</td>
      <td>${modeHtml(b.mode)}</td>
      <td>${statusHtml(b)}</td>
      <td>${datesHtml(b)}</td>
      <td>
        <button class="btn btn--ghost btn--icon btn--sm" data-act="open" title="Open ${esc(b.batchNo)}">
          <span class="icon icon--sm">visibility</span>
        </button>
        ${action('generate', 'description', open && b.claimNos.length > 0,
    open ? (b.claimNos.length ? (gen ? `Generate v${gen.version + 1} — the files again after a change` : 'Generate the files') : 'Nothing in the batch to generate')
      : `A ${b.status.toLowerCase()} batch is not generated again`)}
        ${action('submit', 'send', !submitWhy, submitWhy || 'Mark submitted — method, reference and date')}
        ${action('acknowledge', 'mark_email_read', ackable, ackable ? 'Record the payer’s acknowledgment'
    : b.acknowledgment ? 'Already acknowledged' : open ? 'Submit the batch first' : `A ${b.status.toLowerCase()} batch is not acknowledged`)}
        ${action('rejections', 'assignment_return', answerable, answerable ? `Rejections (${b.rejections.length})` : 'A batch takes rejections once it has gone out')}
        <button class="btn btn--ghost btn--icon btn--sm" data-act="history" title="View history">
          <span class="icon icon--sm">history</span>
        </button>
      </td>
    </tr>`;
}

const action = (act, icon, allowed, why) => `
  <button class="btn btn--ghost btn--icon btn--sm" data-act="${act}"${allowed ? '' : ' disabled'} title="${esc(why)}">
    <span class="icon icon--sm">${icon}</span>
  </button>`;

function emptyHtml(state) {
  const filtered = state.q || state.payerId || state.status || state.from || state.to;
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">${filtered ? 'search_off' : 'inventory_2'}</span></div>
      <div class="state-view__title">${filtered ? 'No batches found' : 'No batches yet'}</div>
      <p class="state-view__body">${filtered
    ? 'No batch matches. Change the search text or clear the filters to see every batch.'
    : 'Create a batch from the ready queue above. It is generated, marked submitted and acknowledged from here.'}</p>
      <div class="state-view__actions">
        ${filtered ? '<button class="btn btn--secondary" data-act="clear">Clear filters</button>' : ''}
      </div>
    </div>`;
}
