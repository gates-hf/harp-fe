// Claima home — the module's landing screen, the Frontis dashboard's shape.
// Everything on it is read from the helpers the feature sessions published in
// modules/claima/COORDINATION.md: there is no dashboard entity, nothing is
// cached and nothing is computed here, so a posting made in a dialog moves the
// number behind it on the same tick and a change of demo role re-masks the
// rows that name a payer and re-labels the day-close action.

import * as kpis from './home-kpis.js';
import * as attention from './home-attention.js';
import * as quick from './home-quick-actions.js';
import * as activity from '../../../../shared/activity-trail.js';
import { subscribe as onRole } from '../../../../shared/roles.js';

export const meta = { title: 'Claima' };

const RECENT = 5;

/** The trail's Claima half — what `#/pactum/activity?module=claima` lists. */
const ENTITIES = activity.entitiesOf('claima');

export async function render(mount, ctx) {
  const res = await fetch(new URL('./home.html', import.meta.url));
  if (!res.ok) throw new Error(`Cannot load home.html (${res.status})`);
  mount.innerHTML = await res.text();

  const $ = (sel) => mount.querySelector(sel);

  function draw() {
    $('#ch-header').innerHTML = quick.headerHtml();
    $('#ch-kpis').innerHTML = kpis.kpisHtml();
    $('#ch-attention-top').innerHTML = attention.topHtml();
    $('#ch-attention-bottom').innerHTML = attention.bottomHtml();
    $('#ch-activity').innerHTML = activity.activityHtml(RECENT, { entities: ENTITIES });
  }

  mount.addEventListener('click', (e) => {
    // A link inside a row is the more specific answer — the claim number
    // opens the claim, the patient the record — and it navigates on its own.
    if (e.target.closest('a')) return;
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

  // Live on both axes, the way every Claima list is: anything written in the
  // session redraws the dashboard, and so does a change of demo role.
  ctx.onData(draw);
  const offRole = onRole(() => (mount.isConnected ? draw() : offRole()));

  draw();

  // The day's cash is amendment 34's, built alongside this screen: the card
  // says "DTR arriving" until that repository is on disk, and redraws the
  // moment the import settles either way.
  kpis.loadDtr().then(() => { if (mount.isConnected) draw(); });
}
