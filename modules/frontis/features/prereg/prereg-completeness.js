// Completeness, drawn. The answer itself is
// data/engines/prereg-completeness.js — the repository reads it too, and data/
// never imports from modules/ — so this file is only the picture: the bar the
// worklist puts in a cell, and the card the form keeps in its rail.
//
// The bar is inline SVG over design-system colour tokens, the way Pactum's
// performance charts are drawn: the system ships no progress bar, and a module
// writes no CSS. Two colours, because there are two answers — a row is either
// convertible or it is not, which is the same thing the status badge says.

import { esc } from '../../../../shared/format.js';
import { computeCompleteness, GROUPS } from '../../../../data/engines/prereg-completeness.js';

export { computeCompleteness, GROUPS };

const TRACK = 'var(--border-subtle)';
const FILL = { done: 'var(--viz-2)', open: 'var(--viz-warning)' };

/** The bar on its track. `width` is in pixels — a cell is narrower than a rail. */
export function completenessBar(pct, { width = 88, height = 8 } = {}) {
  const w = Math.max(pct > 0 ? 2 : 0, Math.round((Math.min(100, Math.max(0, pct)) / 100) * width));
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${pct}% complete" style="vertical-align:middle">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK}"></rect>
      <rect x="0" y="0" width="${w}" height="${height}" rx="${height / 2}" fill="${pct === 100 ? FILL.done : FILL.open}"></rect>
    </svg>`;
}

/** The worklist cell: the figure, the bar, and what is missing in the tooltip. */
export function completenessCell(prereg) {
  const c = computeCompleteness(prereg);
  return `
    <span title="${esc(tooltip(c))}">
      <span class="t-mono-sm">${c.pct}%</span> ${completenessBar(c.pct)}
    </span>`;
}

/** "Complete", or the four things still to capture, in one line. */
export function tooltip(c) {
  return c.ready
    ? `Complete — all ${c.total} items captured`
    : `${c.passed} of ${c.total} captured. Missing: ${c.missing.join(', ')}`;
}

/**
 * The form's rail card: the figure, the bar, the status chip and the four
 * checklists. It redraws on every keystroke the form reads, so a clerk sees the
 * row become Ready as they type rather than on save.
 */
export function completenessCardHtml(prereg, { status = 'Pending' } = {}) {
  const c = computeCompleteness(prereg);
  return `
    <div class="toolbar">
      <span class="t-title-sm">${c.pct}% complete</span>
      <span class="spacer"></span>
      <span class="badge${status === 'Ready' ? ' badge--success' : status === 'Pending' ? ' badge--warning' : ''}">
        <span class="dot"></span>${esc(status)}</span>
    </div>
    ${completenessBar(c.pct, { width: 260, height: 10 })}
    <p class="t-body-sm">${!c.ready ? `${c.total - c.passed} of ${c.total} items still to capture.`
      : status === 'Ready' ? 'Everything conversion needs is captured. Convert when the patient arrives.'
        : 'Everything conversion needs was captured.'}</p>
    ${c.groups.map(groupHtml).join('')}`;
}

function groupHtml(group) {
  return `
    <div class="rule-child-row">
      <span class="icon" title="${esc(group.label)}">${group.done ? 'check_circle' : group.icon}</span>
      <div>
        <div class="t-title-sm">${esc(group.label)}</div>
        ${group.items.map((i) => `
          <span class="t-body-sm">${i.ok ? '✓' : '○'} ${esc(i.label)}</span><br>`).join('')}
      </div>
    </div>`;
}
