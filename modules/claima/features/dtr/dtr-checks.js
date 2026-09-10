// The checks strip: five cards, OK or RED, each a control that opens the
// check's detail under the strip — its figures, the offending transactions
// with their links and the action that answers each, and the exception a
// supervisor documented over it. The strip is drawn from a report, live or
// frozen; only the actions need the day to be open.

import * as businessDays from '../../../../data/repositories/business-days.js';
import { metricRailHtml } from '../../../../shared/metric-card.js';
import { dateTime, esc, usd } from '../../../../shared/format.js';
import { checkBadgeHtml, moneyHtml } from './dtr-chips.js';

/** The rail. `selected` is the pressed card's key. */
export function checksRailHtml(report, selected = '') {
  return metricRailHtml(report.checks.map((c) => ({
    value: c.status === 'RED' ? (c.documented ? 'RED · noted' : 'RED') : 'OK',
    text: true,
    label: c.label,
    sub: c.summary,
    key: c.key,
    pressed: selected === c.key,
    tone: c.status === 'RED' ? (c.documented ? 'warning' : 'critical') : '',
    title: `${c.hint} — ${c.summary}. Select to read the detail${c.offenders.length ? ` and the ${c.offenders.length} offending row${c.offenders.length === 1 ? '' : 's'}` : ''}`,
  })));
}

/**
 * checkDetailHtml(check, { live, role, date }) — the panel under the strip.
 * `live` is whether the day still takes actions and notes.
 */
export function checkDetailHtml(check, { live = false, role = null, date = '' } = {}) {
  const canNote = live && check.status === 'RED' && role?.[businessDays.exceptionFlag()];
  const noteWhy = !live ? 'The day is closed — reopen it to change anything' : check.status !== 'RED' ? 'Only a RED check takes a note' : `${role?.name} cannot document an exception — a role with that right can`;
  return `
    <div class="panel panel--bordered" id="dtr-check-detail" data-check="${esc(check.key)}">
      <div class="panel-header">
        <span>${esc(check.label)}</span>
        ${checkBadgeHtml(check.status)}
        <span class="t-body-sm">${esc(check.hint)}</span>
        <span class="spacer"></span>
        <button class="btn btn--secondary btn--sm" data-act="document" data-check="${esc(check.key)}"${canNote ? '' : ` disabled title="${esc(noteWhy)}"`}>
          <span class="icon icon--sm">edit_note</span>${check.documented ? 'Edit exception note' : 'Document exception'}
        </button>
        <button class="btn btn--ghost btn--sm btn--icon" data-act="close-detail" title="Close the detail"><span class="icon">close</span></button>
      </div>
      <div class="panel-body">
        <p class="t-body-sm">${esc(check.summary)}</p>
        ${check.documented ? `
          <div class="alert alert--warning">
            <span class="icon">edit_note</span>
            <div>
              <div class="title">Exception documented — the day may close over this check</div>
              ${esc(check.documented.note)}<br>
              <span class="t-body-sm">${esc(check.documented.by)} · ${dateTime(check.documented.at)}</span>
            </div>
          </div>` : ''}
        <dl class="dl">
          ${check.figures.map(([label, value, kind]) => `<dt>${esc(label)}</dt><dd class="t-mono-sm">${kind === 'count' ? esc(String(value)) : esc(usd(value))}</dd>`).join('')}
        </dl>
        ${check.offenders.length ? offendersHtml(check, live) : (check.status === 'OK' ? '<p class="t-body-sm">Nothing to answer — the check reconciles.</p>' : '')}
      </div>
    </div>`;
}

function offendersHtml(check, live) {
  return `
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">Offending transaction</th>
          <th scope="col" class="num">Amount</th>
          <th scope="col">Answer</th>
        </tr>
      </thead>
      <tbody>
        ${check.offenders.map((o) => `
          <tr>
            <td>
              ${o.href ? `<a class="crumb-link" href="${esc(o.href)}">${esc(o.label)}</a>` : esc(o.label)}
              ${o.priorDay ? '<span class="badge badge--warning">Prior-day</span>' : ''}
              ${o.sub ? `<br><span class="t-body-sm">${esc(o.sub)}</span>` : ''}
            </td>
            <td class="num">${moneyHtml(o.amount, { zero: '—' })}</td>
            <td>${actionHtml(o, live)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function actionHtml(o, live) {
  if (!o.action) return '<span class="t-body-sm">Read the record</span>';
  const disabled = live ? '' : ' disabled title="The day is closed — reopen it to change anything"';
  if (o.action === 'attach') return `<button class="btn btn--primary btn--sm" data-act="attach" data-tx="${esc(o.id)}"${disabled}><span class="icon icon--sm">link</span>${esc(o.actionLabel || 'Attach')}</button>`;
  if (o.action === 'close-session') return `<button class="btn btn--secondary btn--sm" data-act="close-session" data-session="${esc(o.id)}"${disabled}><span class="icon icon--sm">lock</span>${esc(o.actionLabel || 'Close session')}</button>`;
  return '';
}
