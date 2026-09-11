// The risk-rule editor, one dialog for the three ways a rule is written: from
// a pattern (the conditions mirror it and are read-only, the message is the
// pattern's own numbers until it is edited), by hand (a reason, and the
// conditions picked from the shared lists — the payer register, the root
// causes, the charge master's categories and service groups), or an existing
// rule (the message; the conditions only when it is a manual one). Severity
// is shown locked: a rule warns and never blocks. Resolves with the rule or
// undefined.

import * as riskRules from '../../../../data/repositories/risk-rules.js';
import * as denialPatterns from '../../../../data/repositories/denial-patterns.js';
import * as payers from '../../../../data/repositories/payers.js';
import * as cdm from '../../../../data/repositories/cdm.js';
import * as contracts from '../../../../data/repositories/contracts.js';
import * as modal from '../../../../shared/modal.js';
import { toast } from '../../../../shared/toast.js';
import { esc } from '../../../../shared/format.js';
import { severityHtml } from './prevention-chips.js';

const errorBox = (el, problems) => {
  el.innerHTML = problems.length ? `<div class="alert alert--critical"><span class="icon">error</span><div>${problems.map(esc).join('<br>')}</div></div>` : '';
};

export async function openRuleEditor({ patternId = '', ruleId = '' } = {}) {
  const rule = ruleId ? riskRules.get(ruleId) : null;
  const pattern = denialPatterns.get(patternId || rule?.patternId || '');
  const manualEditable = !pattern;
  const conditions = rule?.conditions || (pattern ? riskRules.conditionsFrom(pattern) : { payerId: '', causeId: '', service: { level: 'any', value: '*' } });
  const dialog = modal.open({
    title: rule ? `Edit ${rule.id}` : pattern ? `Rule from ${pattern.id}` : 'New risk rule',
    sub: pattern ? denialPatterns.labelOf(pattern) : 'A warning at the claim scrub',
    icon: 'rule',
    size: 'lg',
    body: `
      ${pattern ? `<div class="alert alert--info"><span class="icon">info</span><div>The conditions mirror the pattern and move with it. ${pattern.counters?.occurrences || 0} in ${pattern.window?.days || denialPatterns.windowDays()} days, ${esc(denialPatterns.trendLabel(pattern.counters?.trend || 'steady').toLowerCase())}.</div></div>`
    : rule ? '' : `<label class="field field--area"><span class="icon icon--sm">notes</span><textarea id="re-reason" rows="2" placeholder="Why this rule, with no pattern behind it" aria-label="Reason" maxlength="300"></textarea></label>`}
      <div class="toolbar">
        <span class="t-title-sm">Conditions</span>
        <span class="spacer"></span>
        <span class="t-body-sm">${manualEditable ? 'At least one of the three' : 'Mirrored from the pattern'}</span>
      </div>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">apartment</span>
          <select id="re-payer" aria-label="Payer"${manualEditable ? '' : ' disabled'}>
            <option value="">Any payer</option>${payers.findActive().map((p) => `<option value="${esc(p.id)}"${p.id === conditions.payerId ? ' selected' : ''}>${esc(p.nameEn)}</option>`).join('')}
          </select></label>
        <label class="field field--grow"><span class="icon icon--sm">psychology</span>
          <select id="re-cause" aria-label="Root cause"${manualEditable ? '' : ' disabled'}>
            <option value="">Any cause</option>${denialPatterns.groupedRootCauses().map((g) => `<optgroup label="${esc(g.group)}">${g.causes.map((c) => `<option value="${esc(c.id)}"${c.id === conditions.causeId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('')}
          </select></label>
      </div>
      <div class="toolbar">
        <label class="field"><span class="icon icon--sm">layers</span>
          <select id="re-level" aria-label="Service level"${manualEditable ? '' : ' disabled'}>${riskRules.LEVELS.map((l) => `<option value="${l}"${l === conditions.service?.level ? ' selected' : ''}>${esc(riskRules.LEVEL_LABELS[l])}</option>`).join('')}</select></label>
        <span id="re-value-host"></span>
      </div>
      <div class="toolbar">
        <span class="t-title-sm">Message</span>
        <span class="spacer"></span>
        <span class="t-body-sm">What the biller reads on the scrub tab</span>
      </div>
      <label class="field field--area"><span class="icon icon--sm">campaign</span>
        <textarea id="re-message" rows="3" aria-label="Message" maxlength="400">${esc(rule?.message || (pattern ? riskRules.defaultMessage(pattern) : ''))}</textarea>
      </label>
      <div class="toolbar"><span class="t-body-sm">Severity</span> ${severityHtml()} <span class="t-body-sm">— locked; the scrub raises a Warning whatever the rule asks for.</span></div>
      <div id="re-error"></div>`,
    foot: `<button class="btn btn--secondary" data-close>Cancel</button><button class="btn btn--primary" id="re-save">${rule ? 'Save' : 'Create rule'}</button>`,
  });
  const $ = (sel) => dialog.el.querySelector(sel);

  function drawValue() {
    const level = $('#re-level').value;
    const current = conditions.service?.level === level ? conditions.service.value : '';
    const dis = manualEditable ? '' : ' disabled';
    const host = $('#re-value-host');
    if (level === 'any') { host.innerHTML = '<span class="t-body-sm">Every line on the claim</span>'; return; }
    if (level === 'item') {
      host.innerHTML = `<label class="field field--grow"><span class="icon icon--sm">inventory_2</span><select id="re-value" aria-label="Charge line"${dis}>${cdm.findActive().filter((i) => i.kind !== 'bundle').map((i) => `<option value="${esc(i.id)}"${i.id === current ? ' selected' : ''}>${esc(i.chargeCode)} ${esc(i.descriptionEn || i.name || '')}</option>`).join('')}</select></label>`;
      return;
    }
    const options = level === 'category' ? cdm.ITEM_CATEGORIES : contracts.SERVICE_GROUPS;
    host.innerHTML = `<label class="field field--grow"><span class="icon icon--sm">category</span><select id="re-value" aria-label="${level === 'category' ? 'Category' : 'Service group'}"${dis}>${options.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  }
  $('#re-level').addEventListener('change', drawValue);
  drawValue();

  $('#re-save').addEventListener('click', () => {
    const message = $('#re-message').value;
    if (rule) {
      const patch = { message };
      if (manualEditable) patch.conditions = readConditions();
      const r = riskRules.update(rule.id, patch);
      if (r?.error) return errorBox($('#re-error'), [r.error]);
      toast(`${rule.id} saved`);
      return dialog.close(r);
    }
    const r = pattern
      ? riskRules.create({ patternId: pattern.id, message })
      : riskRules.create({ manual: { reason: $('#re-reason')?.value || '' }, conditions: readConditions(), message });
    if (r?.error) return errorBox($('#re-error'), [r.error]);
    toast(`${r.id} warns at the scrub`);
    return dialog.close(r);
  });
  function readConditions() {
    const level = $('#re-level').value;
    return { payerId: $('#re-payer').value || null, causeId: $('#re-cause').value || null, service: { level, value: level === 'any' ? '*' : $('#re-value')?.value || '' } };
  }
  return dialog.closed;
}
