// The Analysis tab on the root-cause case page: the problem statement, the
// five-whys as repeatable why/because rows (add and remove freely; the
// conclude gate wants at least two worked through), the confirmed root cause
// off the single list the triage uses, the nature as radios, and the
// configuration-gap toggle with where it is and a note. One Save; read-only
// once the case has concluded. It owns its node and its listener.

import * as rcaCases from '../../../../data/repositories/rca-cases.js';
import * as denials from '../../../../data/repositories/denials.js';
import { toast } from '../../../../shared/toast.js';
import { date, esc } from '../../../../shared/format.js';
import { rootCauseOptions } from '../denials/denial-actions.js';

const MIN_WHYS = 2;

/** render(host, { id, redraw }) — draws the tab for the case and binds its listener on the host. */
export function render(host, { id, redraw }) {
  const row = rcaCases.get(id);
  if (!row) return;
  const a = row.analysis || {};
  const locked = rcaCases.isConcluded(row);
  const dis = locked ? ' disabled' : '';
  const whys = a.whys?.length ? a.whys.map((w) => ({ ...w })) : [{ why: '', because: '' }, { why: '', because: '' }];
  const tagged = [...new Set(rcaCases.denialsOf(row).map((d) => d.rootCauseId).filter(Boolean))];

  host.innerHTML = `
    <div class="toolbar">
      <span class="t-title-sm">Problem</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${esc(locked ? `Concluded ${date(row.concludedAt)} by ${row.concludedBy}` : 'What happened, in one paragraph — the denial, the claim, the money')}</span>
    </div>
    <label class="field field--area">
      <span class="icon icon--sm">notes</span>
      <textarea id="an-problem" rows="3" placeholder="The problem statement" aria-label="Problem" maxlength="600"${dis}>${esc(a.problem || '')}</textarea>
    </label>
    <div class="toolbar">
      <span class="t-title-sm">Five whys</span>
      <span class="badge" id="an-why-count"></span>
      <span class="spacer"></span>
      <span class="t-body-sm">Ask why until the cause is the one that, fixed, stops the denial — at least ${MIN_WHYS} worked through.</span>
      ${locked ? '' : '<button class="btn btn--secondary btn--sm" data-act="add-why"><span class="icon icon--sm">add</span>Add a why</button>'}
    </div>
    <div id="an-whys"></div>
    <div class="toolbar">
      <span class="t-title-sm">Confirmed root cause</span>
      <span class="spacer"></span>
      <span class="t-body-sm">${tagged.length ? `The triage tagged ${tagged.map((t) => denials.rootCauseLabel(t)).join(', ')}; conclusion writes the confirmed cause onto every covered denial.` : 'The denials carry no tag yet; conclusion writes the confirmed cause onto them.'}</span>
    </div>
    <div class="toolbar">
      <label class="field field--grow">
        <span class="icon icon--sm">troubleshoot</span>
        <select id="an-cause" aria-label="Confirmed root cause"${dis}>${rootCauseOptions(a.confirmedRootCause || '')}</select>
      </label>
    </div>
    <div class="toolbar">
      <span class="t-title-sm">Nature</span>
      <span class="spacer"></span>
      <span class="t-body-sm">Systemic is a process or a configuration; individual is one person’s act and opens an accountability case; payer-side is the payer’s own reading.</span>
    </div>
    <div class="rule-child-row" role="radiogroup" aria-label="Nature">
      ${rcaCases.NATURES.map((n) => `<label><input type="radio" name="an-nature" value="${n}"${a.causeNature === n ? ' checked' : ''}${dis}> ${esc(rcaCases.natureLabel(n))}</label>`).join('')}
    </div>
    <div class="toolbar">
      <span class="t-title-sm">Configuration gap</span>
      <span class="segmented" role="group" aria-label="Configuration gap">
        <button type="button" data-gap="1" aria-pressed="${Boolean(a.configGap?.present)}"${dis} title="A setting somewhere let the denial happen — name where">Present</button>
        <button type="button" data-gap="0" aria-pressed="${!a.configGap?.present}"${dis} title="No setting to change">None</button>
      </span>
      <span class="spacer"></span>
    </div>
    <div id="an-gap"${a.configGap?.present ? '' : ' hidden'}>
      <div class="toolbar">
        <label class="field field--grow"><span class="icon icon--sm">link</span>
          <input type="text" id="an-gap-target" placeholder="Where — a route such as #/pactum/contracts/CTR-0001/preauth, or the screen’s name" aria-label="Gap target" maxlength="200" value="${esc(a.configGap?.target || '')}"${dis}>
        </label>
        ${a.configGap?.target && String(a.configGap.target).startsWith('#/') ? `<a class="btn btn--secondary btn--sm" href="${esc(a.configGap.target)}"><span class="icon icon--sm">open_in_new</span>Open</a>` : ''}
      </div>
      <label class="field field--area"><span class="icon icon--sm">notes</span>
        <textarea id="an-gap-note" rows="2" placeholder="What is set wrong and what it should say" aria-label="Gap note" maxlength="400"${dis}>${esc(a.configGap?.note || '')}</textarea>
      </label>
    </div>
    ${locked ? '' : `
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn btn--primary btn--sm" data-act="save"><span class="icon icon--sm">save</span>Save analysis</button>
    </div>`}
    <div id="an-error"></div>`;

  const $ = (sel) => host.querySelector(sel);

  function drawWhys() {
    $('#an-why-count').textContent = `${whys.filter((w) => w.why.trim() && w.because.trim()).length} of ${whys.length} worked through`;
    $('#an-whys').innerHTML = whys.map((w, i) => `
      <div class="toolbar" data-why="${i}">
        <span class="badge">${i + 1}</span>
        <label class="field field--grow"><span class="icon icon--sm">help</span><input type="text" data-field="why" placeholder="Why …?" aria-label="Why ${i + 1}" maxlength="200" value="${esc(w.why)}"${dis}></label>
        <label class="field field--grow"><span class="icon icon--sm">arrow_forward</span><input type="text" data-field="because" placeholder="Because …" aria-label="Because ${i + 1}" maxlength="240" value="${esc(w.because)}"${dis}></label>
        ${locked ? '' : `<button class="btn btn--ghost btn--icon btn--sm" data-act="remove-why" title="Remove this why"${whys.length <= 1 ? ' disabled' : ''}><span class="icon">close</span></button>`}
      </div>`).join('');
  }

  host.addEventListener('input', (e) => {
    const rowEl = e.target.closest('[data-why]');
    if (!rowEl) return;
    const w = whys[Number(rowEl.dataset.why)];
    if (w) w[e.target.dataset.field] = e.target.value;
    $('#an-why-count').textContent = `${whys.filter((x) => x.why.trim() && x.because.trim()).length} of ${whys.length} worked through`;
  });

  host.addEventListener('click', (e) => {
    const gap = e.target.closest('[data-gap]');
    if (gap && !gap.disabled) {
      for (const b of host.querySelectorAll('[data-gap]')) b.setAttribute('aria-pressed', String(b === gap));
      $('#an-gap').hidden = gap.dataset.gap !== '1';
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-why') { whys.push({ why: '', because: '' }); drawWhys(); return; }
    if (act === 'remove-why') { whys.splice(Number(e.target.closest('[data-why]').dataset.why), 1); drawWhys(); return; }
    if (act !== 'save') return;
    const present = host.querySelector('[data-gap="1"]').getAttribute('aria-pressed') === 'true';
    const r = rcaCases.saveAnalysis(id, {
      problem: $('#an-problem').value,
      whys,
      confirmedRootCause: $('#an-cause').value,
      causeNature: host.querySelector('input[name="an-nature"]:checked')?.value || '',
      configGap: { present, target: present ? $('#an-gap-target').value : '', note: present ? $('#an-gap-note').value : '' },
    });
    if (r?.error) { $('#an-error').innerHTML = `<div class="alert alert--critical"><span class="icon">error</span><div>${esc(r.error)}</div></div>`; return; }
    const blockers = rcaCases.concludeBlockers(r);
    toast(blockers.length ? `Analysis saved — ${blockers.length} thing${blockers.length === 1 ? '' : 's'} before it can conclude` : 'Analysis saved — the case can conclude');
    redraw();
  });

  drawWhys();
}
