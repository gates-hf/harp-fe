// Pactum home — the module's landing screen. Everything on it is computed live
// from the repositories: there is no dashboard entity and nothing is cached,
// so a payer saved in a modal moves the number behind it on the same tick.

import * as kpis from './home-kpis.js';
import * as attention from './home-attention.js';
import * as activity from './home-activity.js';
import * as quick from './home-quick-actions.js';

export const meta = { title: 'Pactum' };

const RECENT = 5;

export async function render(mount, ctx) {
  const res = await fetch(new URL('./home.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load home.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);

  // The quick actions sit in the panel header, beside the module name — the
  // same place every other Pactum screen carries its page actions.
  $('#hm-head').insertAdjacentHTML('beforeend', quick.buttonsHtml());

  function draw() {
    $('#hm-kpis').innerHTML = kpis.kpisHtml();
    $('#hm-attention').innerHTML = attention.attentionHtml();
    $('#hm-activity').innerHTML = activity.activityHtml(RECENT);
  }

  mount.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) return void quick.handle(act, ctx);

    // Every attention row and every activity entry opens its record.
    const go = e.target.closest('[data-go]');
    if (go) ctx.navigate(go.dataset.go);
  });

  mount.addEventListener('keydown', (e) => {
    const go = e.target.closest('[data-go]');
    if (go && e.target === go && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ctx.navigate(go.dataset.go);
    }
  });

  // Live: a modal saved from the quick actions redraws the whole dashboard.
  ctx.onData(draw);

  draw();
}
