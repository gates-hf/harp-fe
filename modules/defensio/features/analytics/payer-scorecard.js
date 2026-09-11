// Defensio payer scorecard at #/defensio/scorecard — pick a payer, a period
// and whether to compare, write the notes, generate the document from the
// engine, and save it as an immutable snapshot on
// data/repositories/scorecards.js (a new version when the payer and period
// were generated before). /scorecard/archive and /scorecard/<no> are the
// archive's, which renders from the frozen row alone — the mount is handed
// over on the deeper path.

import * as engine from '../../../../data/engines/denial-analytics.js';
import * as scorecards from '../../../../data/repositories/scorecards.js';
import * as payers from '../../../../data/repositories/payers.js';
import { toast } from '../../../../shared/toast.js';
import { esc, todayIso } from '../../../../shared/format.js';
import { docHtml } from './scorecard-doc.js';

export const meta = { title: 'Payer scorecard' };

export async function render(mount, ctx) {
  if (ctx.params[0]) return (await import('./scorecard-archive.js')).render(mount, ctx);

  const res = await fetch(new URL('./payer-scorecard.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load payer-scorecard.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);
  const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const state = {
    payerId: ctx.query?.payerId || engine.payersWithDenials()[0]?.id || payers.all()[0]?.id || '',
    period: ctx.query?.period || 'lastMonth',
    month: /^\d{4}-\d{2}$/.test(ctx.query?.period || '') ? ctx.query.period : lastMonth,
    compare: true,
    figures: null,
  };
  if (/^\d{4}-\d{2}$/.test(state.period)) state.period = 'month';

  $('#sc-payer').innerHTML = payers.all().map((p) => `<option value="${esc(p.id)}">${esc(p.nameEn)}</option>`).join('');
  $('#sc-period').innerHTML = `${engine.PERIODS.map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('')}<option value="month">A calendar month…</option>`;
  $('#sc-payer').value = state.payerId;
  $('#sc-period').value = state.period;
  $('#sc-month').value = state.month;
  $('#sc-month').max = todayIso().slice(0, 7);
  $('#sc-compare').value = '1';

  const periodOf = () => (state.period === 'month' ? state.month : state.period);

  function syncForm() {
    $('#sc-month-field').hidden = state.period !== 'month';
    const range = engine.periodRange(periodOf());
    const versions = scorecards.versionsOf(state.payerId, range);
    $('#sc-hint').textContent = `${range.from} → ${range.to}${versions.length ? ` · v${versions.length} on file (${versions[versions.length - 1].scorecardNo}) — saving makes v${versions.length + 1}` : ' · nothing on file for this payer and period'}`;
    const ready = Boolean(state.figures);
    for (const act of ['print', 'save']) {
      const btn = $(`[data-act="${act}"]`);
      btn.disabled = !ready;
      btn.title = ready ? (act === 'save' ? 'Freeze this document as the next version' : 'Print the document alone') : 'Generate the scorecard first';
    }
  }

  function generate() {
    state.figures = engine.scorecard(state.payerId, periodOf(), { compare: state.compare });
    $('#sc-preview').innerHTML = docHtml(state.figures, { notes: $('#sc-notes').value });
    syncForm();
  }

  /** A change to the question invalidates the answer on screen; the preview says so until Generate runs again. */
  function invalidate() {
    if (state.figures) {
      state.figures = null;
      $('#sc-preview').innerHTML = `
        <div class="panel"><div class="panel-body"><div class="state-view">
          <div class="state-view__glyph"><span class="icon">refresh</span></div>
          <div class="state-view__title">The question changed</div>
          <p class="state-view__body">Generate again to read the scorecard for the payer and period now chosen. A snapshot is only ever saved from a document you have seen.</p>
        </div></div></div>`;
    }
    syncForm();
  }

  $('#sc-payer').addEventListener('change', (e) => { state.payerId = e.target.value; invalidate(); });
  $('#sc-period').addEventListener('change', (e) => { state.period = e.target.value; invalidate(); });
  $('#sc-month').addEventListener('change', (e) => { if (e.target.value) { state.month = e.target.value; invalidate(); } });
  $('#sc-compare').addEventListener('change', (e) => { state.compare = Boolean(e.target.value); invalidate(); });
  $('#sc-notes').addEventListener('input', () => { if (state.figures) $('#sc-preview').innerHTML = docHtml(state.figures, { notes: $('#sc-notes').value }); });

  mount.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'generate') return generate();
    if (act === 'print') { if (state.figures) window.print(); return undefined; }
    if (act === 'save') {
      if (!state.figures) return undefined;
      const row = scorecards.create({ payerId: state.payerId, period: state.figures.range, compare: state.compare, figures: state.figures, notes: $('#sc-notes').value });
      if (row?.error) return void toast(row.error, 'critical');
      toast(`${row.scorecardNo} saved as v${row.version}`);
      return ctx.navigate(`/defensio/scorecard/${row.scorecardNo}`);
    }
    return undefined;
  });

  // A register that moves under a generated preview does not silently change the preview — the desk regenerates; the hint's version count follows the archive.
  ctx.onData(syncForm);
  syncForm();
  if (ctx.query?.payerId) generate();
}
