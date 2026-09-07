// Bootstrap. Draws the shell once, then hands the main region to the router.
// A feature module exports: meta = { title, breadcrumb? } and render(mount, ctx).

import { modules, byId, homePath } from './modules.js';
import * as router from './router.js';
import { mount as mountLayout, bodyEl, actionsEl, setHeader, setCrumb, setActive } from './layout.js';

mountLayout(document.getElementById('app'));

let token = 0;

async function resolve(route) {
  const mod = byId.get(route.module);
  if (!mod) return router.replace(homePath());

  const screen = route.screen || mod.nav[0].screen;
  const loader = mod.routes[screen];
  if (!loader) return router.replace(`/${mod.id}/${mod.nav[0].screen}`);

  const mine = ++token;
  const navEntry = mod.nav.find((n) => n.screen === screen);
  const home = `/${mod.id}/${mod.nav[0].screen}`;

  setActive(mod.id, screen);
  setCrumb([
    { label: 'HARP', path: homePath() },
    { label: mod.name, path: home },
    { label: navEntry?.label || screen },
  ]);
  setHeader(navEntry?.label || screen);
  bodyEl().innerHTML = `
    <div class="sk-stack" aria-busy="true">
      <span class="sk" style="height:52px;width:260px"></span>
      <span class="sk" style="height:32px;width:420px"></span>
      <span class="sk" style="height:240px"></span>
    </div>`;

  try {
    const feature = await loader();
    if (mine !== token) return; // a newer route won the race

    if (feature.meta?.title) setHeader(feature.meta.title);
    await feature.render(bodyEl(), {
      route,
      params: route.params,
      module: mod,
      actions: actionsEl(),
      setHeader,
      setCrumb,
      navigate: router.navigate,
      href: router.href,
    });
  } catch (err) {
    if (mine !== token) return;
    console.error(err);
    bodyEl().innerHTML = `
      <div class="state-view state-view--tall">
        <div class="state-view__glyph state-view__glyph--critical"><span class="icon">error</span></div>
        <div class="state-view__title">Screen failed to load</div>
        <p class="state-view__body">${String(err.message || err)}</p>
        <div class="state-view__ref">${route.path}</div>
        <div class="state-view__actions">
          <a class="btn btn--secondary" href="#${home}">Back to ${mod.name}</a>
        </div>
      </div>`;
  }
}

router.start((route) => {
  if (!route.module) return router.replace(homePath());
  resolve(route);
});

// Convenience for the console during demos.
window.harpApp = { modules, router };
