// View history — one charge line's audit trail, newest first, read-only. Same
// shape as the payer trail: the shared drawer wearing the audit strip
// (.journey), so history reads the same wherever you open it.

import * as audit from '../../../../data/repositories/audit.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

export async function openCdmHistory(id) {
  const line = cdm.get(id);
  if (!line) return undefined;

  const entries = audit.forEntity('cdm', id);
  const sheet = drawer.open({
    title: `History — ${esc(line.chargeCode)}`,
    sub: `${esc(cdm.label(line))} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · append-only`,
    icon: 'history',
    body: entries.length ? `<ol class="journey">${entries.map(row).join('')}</ol>` : empty(),
  });

  return sheet.closed;
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
      <p class="state-view__body">Every price, status and composition change is recorded here, with the user and the time.</p>
    </div>`;
}
