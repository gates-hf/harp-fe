// View history — the payer's audit trail, newest first, read-only.
// The design system has no drawer primitive, so this is the shared modal shell
// wearing the audit strip (.journey), which is the component for who did what.

import * as audit from '../../../../data/repositories/audit.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as modal from '../../../../shared/modal.js';
import { dateTime, esc } from '../../../../shared/format.js';

export async function openPayerHistory(id) {
  const payer = payers.get(id);
  if (!payer) return undefined;

  const entries = audit.forEntity('payers', id);
  const dialog = modal.open({
    title: `History — ${esc(payer.nameEn)}`,
    sub: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · append-only`,
    icon: 'history',
    size: 'xl',
    body: entries.length ? `<ol class="journey">${entries.map(row).join('')}</ol>` : empty(),
    foot: '<button class="btn btn--secondary" data-close>Close</button>',
  });

  return dialog.closed;
}

function row(entry) {
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      ${entry.details ? `<span class="journey__detail">${esc(entry.details)}</span>` : ''}
    </li>`;
}

function empty() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">No history yet</div>
      <p class="state-view__body">Every change to this payer is recorded here, with the user and the time.</p>
    </div>`;
}
