// The History tab of the code system page: the system's own trail, its
// versions' and their codes' merged into one list, newest first, read-only.
// Each entry names its level, and a filter narrows to one — a bulk import
// writes a line per code, and the version-level story is easier to read
// without them. The same trail opens in the shared drawer from the landing.

import * as systems from '../../../../data/repositories/code-systems.js';
import * as codes from '../../../../data/repositories/standard-codes.js';
import * as drawer from '../../../../shared/drawer.js';
import { dateTime, esc } from '../../../../shared/format.js';

const LEVELS = [['', 'All levels'], ['system', 'System'], ['version', 'Versions'], ['code', 'Codes']];

/** render(host, { systemId, state }) */
export function render(host, { systemId, state }) {
  state.history ||= { level: '' };
  const s = state.history;

  function draw() {
    const all = codes.historyOf(systemId);
    const rows = s.level ? all.filter((e) => e.level === s.level) : all;
    host.innerHTML = `
      <div class="toolbar">
        <span class="t-title-sm">History</span>
        <span class="t-body-sm">${rows.length} of ${all.length} ${all.length === 1 ? 'entry' : 'entries'} · append-only</span>
        <span class="spacer"></span>
        <label class="field">
          <span class="icon icon--sm">filter_list</span>
          <select data-level aria-label="Level">
            ${LEVELS.map(([value, label]) => `<option value="${value}"${s.level === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      </div>
      ${rows.length ? `<ol class="journey">${rows.map(rowHtml).join('')}</ol>` : emptyHtml()}`;
  }

  host.addEventListener('change', (e) => {
    if (!e.target.matches('[data-level]')) return;
    s.level = e.target.value;
    draw();
  });

  draw();
}

/** The landing's View history: the same merged trail in the shared drawer. */
export async function openSystemHistory(id) {
  const system = systems.get(id);
  if (!system) return undefined;
  const entries = codes.historyOf(id);
  const sheet = drawer.open({
    title: `History — ${esc(system.name)}`,
    sub: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} across the system, its versions and its codes · append-only`,
    icon: 'history',
    body: entries.length ? `<ol class="journey">${entries.map(rowHtml).join('')}</ol>` : emptyHtml(),
  });
  return sheet.closed;
}

function rowHtml(entry) {
  return `
    <li class="journey__row">
      <span class="journey__at t-mono-sm">${dateTime(entry.at)}</span>
      <span class="journey__action">${esc(entry.label)} · ${esc(entry.action)}</span>
      <span class="journey__actor">${esc(entry.user)}</span>
      ${entry.details ? `<span class="journey__detail">${esc(entry.details)}</span>` : ''}
    </li>`;
}

function emptyHtml() {
  return `
    <div class="state-view">
      <div class="state-view__glyph"><span class="icon">history</span></div>
      <div class="state-view__title">No history yet</div>
      <p class="state-view__body">Every change to this system, its versions and its codes is recorded here, with the user and the time.</p>
    </div>`;
}
