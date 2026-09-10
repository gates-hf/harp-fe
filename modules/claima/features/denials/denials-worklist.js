// Denials worklist at #/claima/denials — a redirect stub since amendment 36.
// Denial management moved to Defensio (#/defensio/denials): the entity, the
// triage and the routing are that module's now, and this route says so and
// hands the reader over, keeping the deeper path and the query (a card on a
// dashboard that still points here lands on the same slice there). The
// analytics screen stays in Claima and is still handed the mount on
// /analytics; the worklist and the page are gone from this folder's routes
// only — the chip and analytics files stay, since the Claima home reads them.

import { esc } from '../../../../shared/format.js';

export const meta = { title: 'Denials' };

const REDIRECT_AFTER_MS = 1400;

export async function render(mount, ctx) {
  if (ctx.params[0] === 'analytics') return (await import('./denial-analytics.js')).render(mount, ctx);
  return redirectTo(mount, ctx, `/defensio/denials${ctx.params.length ? `/${ctx.params.join('/')}` : ''}`);
}

/** The notice and the auto-link: the page reads it for a moment, then the shell moves on. */
export function redirectTo(mount, ctx, path) {
  const query = Object.entries(ctx.query || {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const target = `${path}${query ? `?${query}` : ''}`;
  mount.innerHTML = `
    <div class="panel">
      <div class="panel-body">
        <div class="state-view state-view--tall">
          <div class="state-view__glyph"><span class="icon">shield</span></div>
          <div class="state-view__title">Denial management has moved to Defensio</div>
          <p class="state-view__body">Claima still posts a denial when a remittance line is refused; everything after — the worklist, the triage, the routing and the resolution — is Defensio's since amendment 36. Taking you there.</p>
          <div class="state-view__ref">${esc(`#${target}`)}</div>
          <div class="state-view__actions">
            <a class="btn btn--primary" href="#${esc(target)}"><span class="icon icon--sm">arrow_forward</span>Open in Defensio</a>
          </div>
        </div>
      </div>
    </div>`;
  setTimeout(() => { if (mount.isConnected) ctx.navigate(target); }, REDIRECT_AFTER_MS);
}
