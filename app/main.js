// Bootstrap. Draws the shell once, then hands the main region to the router.
// A feature module exports: meta = { title, breadcrumb? } and render(mount, ctx).

import { modules, byId, homePath } from './modules.js';
import * as router from './router.js';
import { mount as mountLayout, bodyEl, actionsEl, setHeader, setCrumb, setActive } from './layout.js';
import { store } from '../data/store.js';

mountLayout(document.getElementById('app'));

let token = 0;
let stopLive = () => {};

/**
 * A fresh body node for every render. Emptying the old one would leave any
 * listener a feature bound to the mount itself alive — delegated to markup
 * that no longer exists, and firing on whatever screen renders next.
 * Replacing the node retires those listeners with it, so a feature can bind
 * to its mount the ordinary way.
 */
function freshBody() {
  const old = bodyEl();
  const next = document.createElement('div');
  next.className = old.className;
  next.id = old.id;
  old.replaceWith(next);
  return next;
}

async function resolve(route) {
  const mod = byId.get(route.module);
  if (!mod) return router.replace(homePath());

  const screen = route.screen || mod.nav[0].screen;
  const loader = mod.routes[screen];
  if (!loader) return router.replace(`/${mod.id}/${mod.nav[0].screen}`);

  const mine = ++token;

  // The screen being replaced stops listening to the store before the next one
  // starts: a subscription belongs to the render that opened it, the way the
  // listeners on the body node do.
  stopLive();
  const offs = [];
  stopLive = () => {
    for (const off of offs) off();
    offs.length = 0;
  };
  /** Redraw on every store commit, for as long as this screen is on show. */
  const onData = (fn) => {
    offs.push(store.subscribe(() => {
      if (mine === token) fn();
    }));
  };

  const navEntry = mod.nav.find((n) => n.screen === screen);
  const home = `/${mod.id}/${mod.nav[0].screen}`;

  // The brand and the active module tab already say where you are, so the
  // trail starts at the module: Module / Screen.
  setActive(mod.id, screen);
  setCrumb([
    { label: mod.name, path: home },
    { label: navEntry?.label || screen },
  ]);
  setHeader(navEntry?.label || screen);
  const body = freshBody();
  body.innerHTML = `
    <div class="sk-stack" aria-busy="true">
      <span class="sk" style="height:52px;width:260px"></span>
      <span class="sk" style="height:32px;width:420px"></span>
      <span class="sk" style="height:240px"></span>
    </div>`;

  try {
    const feature = await loader();
    if (mine !== token) return; // a newer route won the race

    if (feature.meta?.title) setHeader(feature.meta.title);
    await feature.render(body, {
      route,
      params: route.params,
      module: mod,
      actions: actionsEl(),
      setHeader,
      setCrumb,
      navigate: router.navigate,
      href: router.href,
      onData,
    });
  } catch (err) {
    if (mine !== token) return;
    console.error(err);
    body.innerHTML = `
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
