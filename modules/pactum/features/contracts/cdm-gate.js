// The prerequisite every configuration tab shares: a contract prices charges,
// so there is nothing to configure until the charge master holds some. The
// activation gate says the same thing in words (contracts.activationBlockers);
// this is what the tab shows instead of an empty form.

import * as cdm from '../../../../data/repositories/cdm.js';

export const cdmIsEmpty = () => cdm.findActive().length === 0;

export const cdmGateHtml = () => `
  <div class="state-view">
    <div class="state-view__glyph state-view__glyph--critical"><span class="icon">sell</span></div>
    <div class="state-view__title">Populate the CDM before configuring contracts</div>
    <p class="state-view__body">Every rate, overage limit, coverage split and pre-authorization row points at a
       charge line, and the charge master holds no active ones. Import or add the catalogue first.</p>
    <div class="state-view__actions">
      <a class="btn btn--primary" href="#/pactum/cdm">Go to the CDM</a>
      <a class="btn btn--secondary" href="#/pactum/cdm/import">Bulk import</a>
    </div>
  </div>`;
