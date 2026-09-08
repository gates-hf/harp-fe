// The three things on the Pactum home screen that want a decision: contracts
// running out, drafts waiting to be activated, and bundles a component change
// has put in doubt. Each panel shows the first five and hands the rest to the
// list its header links to.

import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import { date, dateTime, esc } from '../../../../shared/format.js';
import { EXPIRY_WINDOW, readyDrafts } from './home-kpis.js';

const MAX_ROWS = 5;

export function attentionHtml() {
  return [expiringPanel(), draftPanel(), flaggedPanel()].join('');
}

// --- panels ------------------------------------------------------------------

function expiringPanel() {
  const rows = contracts.expiringWithin(EXPIRY_WINDOW);
  return panel({
    title: 'Contracts expiring soon',
    href: `#/pactum/contracts?expiring=${EXPIRY_WINDOW}`,
    total: rows.length,
    headers: ['Contract', 'Ends', 'Days left'],
    body: rows.slice(0, MAX_ROWS).map(expiringRow).join(''),
    empty: {
      icon: 'event_available',
      title: 'Nothing running out',
      body: `No contracts expiring in the next ${EXPIRY_WINDOW} days.`,
    },
  });
}

function expiringRow(c) {
  const days = contracts.daysLeft(c);
  return `
    ${rowStart(`/pactum/contracts/${c.id}`, `Open ${c.name}`)}
      <td>${esc(c.name)}<br><span class="t-body-sm">${esc(contracts.payerName(c))}</span></td>
      <td class="t-mono-sm">${date(c.endDate)}</td>
      <td><span class="badge badge--warning"><span class="dot"></span>${days} day${days === 1 ? '' : 's'}</span></td>
    </tr>`;
}

function draftPanel() {
  const rows = contracts.list({ status: 'Draft', sort: 'updatedAt', dir: 'desc' });
  const ready = readyDrafts().length;
  return panel({
    title: 'Draft contracts',
    href: '#/pactum/contracts?status=Draft',
    total: rows.length,
    hint: ready ? `${ready} ready` : '',
    headers: ['Contract', 'Missing', 'Last updated'],
    body: rows.slice(0, MAX_ROWS).map(draftRow).join(''),
    empty: {
      icon: 'task_alt',
      title: 'Nothing in the drawer',
      body: 'No drafts waiting. Every agreement on file is activated or closed.',
    },
  });
}

function draftRow(c) {
  return `
    ${rowStart(`/pactum/contracts/${c.id}`, `Open ${c.name}`)}
      <td>${esc(c.name)}<br><span class="t-body-sm">${esc(contracts.payerName(c))}</span></td>
      <td>${blockerChips(contracts.activationBlockers(c))}</td>
      <td class="t-mono-sm">${dateTime(c.updatedAt)}</td>
    </tr>`;
}

function flaggedPanel() {
  const rows = cdm.flaggedBundles();
  return panel({
    title: 'Bundles flagged for review',
    href: '#/pactum/cdm/bundles?flagged=1',
    total: rows.length,
    headers: ['Bundle', 'Reason', 'Flagged since'],
    body: rows.slice(0, MAX_ROWS).map(flaggedRow).join(''),
    empty: {
      icon: 'inventory_2',
      title: 'Nothing to re-price',
      body: 'All bundles are in good shape. A component change flags its parents here.',
    },
  });
}

function flaggedRow(b) {
  return `
    ${rowStart(`/pactum/cdm/bundles/${b.id}`, `Open ${b.chargeCode}`)}
      <td>${esc(cdm.label(b))}<br><span class="t-body-sm t-mono-sm">${esc(b.chargeCode)}</span></td>
      <td>${esc(b.flagReason || 'Flagged for review')}</td>
      <td class="t-mono-sm">${date(cdm.flaggedSince(b))}</td>
    </tr>`;
}

// --- shared markup -----------------------------------------------------------

/**
 * One attention panel: a header that says how many there are and links to the
 * whole list, and a five-row table or a positive empty state.
 */
function panel({ title, href, total, hint = '', headers, body, empty }) {
  return `
    <div class="panel">
      <div class="panel-header">
        <span>${esc(title)}</span>
        ${total ? `<span class="badge">${total}${hint ? ` · ${esc(hint)}` : ''}</span>` : ''}
        <span class="spacer"></span>
        <a class="btn btn--ghost btn--sm" href="${esc(href)}" title="Open the full list">
          View all<span class="icon icon--sm">arrow_forward</span>
        </a>
      </div>
      <div class="panel-body">
        ${total ? `
          <table class="tbl">
            <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${body}</tbody>
          </table>
          ${total > MAX_ROWS ? `<p class="t-body-sm">${total - MAX_ROWS} more in the full list.</p>` : ''}
        ` : `
          <div class="state-view">
            <div class="state-view__glyph"><span class="icon">${empty.icon}</span></div>
            <div class="state-view__title">${esc(empty.title)}</div>
            <p class="state-view__body">${esc(empty.body)}</p>
          </div>`}
      </div>
    </div>`;
}

const rowStart = (path, title) =>
  `<tr data-go="${esc(path)}" tabindex="0" title="${esc(title)}">`;

/**
 * What a draft still needs, as chips. The blockers are whole sentences — the
 * panel has room for a name, so each chip is the short name and carries the
 * sentence in its tooltip.
 */
function blockerChips(blockers) {
  if (!blockers.length) return '<span class="badge badge--success"><span class="dot"></span>Ready to activate</span>';
  const shown = blockers.slice(0, 2)
    .map((b) => `<span class="badge" title="${esc(b)}">${esc(shortBlocker(b))}</span>`)
    .join(' ');
  const rest = blockers.length - 2;
  return shown + (rest > 0 ? ` <span class="badge" title="${esc(blockers.slice(2).join(' '))}">+${rest}</span>` : '');
}

function shortBlocker(text) {
  if (text.includes('charge master holds no active lines')) return 'Charge master';
  if (text.includes('components without limits')) return 'Component limits';
  if (text.startsWith('No default methodology')) return 'Default rate';
  if (text.includes('no overage policy')) return 'Overage policy';
  if (text.includes('no Default coverage row')) return 'Default coverage';
  return text.split(/[.—(]/)[0].trim().slice(0, 24);
}
