// The app shell: topbar (brand, module tabs, breadcrumb, reset, user menu),
// a sidebar scoped to the active module, and the main region the router
// renders into. Everything is read from the module manifests in app/modules.js.

import { modules, byId } from './modules.js';
import * as router from './router.js';
import { ROLES, current as currentRole, setRole, subscribe as onRole } from '../shared/roles.js';
import { store } from '../data/store.js';
import { toast } from '../shared/toast.js';
import { confirm } from '../shared/modal.js';
import { esc, initials } from '../shared/format.js';

let root = null;

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#/" title="HARP">
          <img src="design-system/assets/logo-mark.svg" alt="">HARP
        </a>
        <nav class="mod-tabs" id="mod-tabs" aria-label="Modules"></nav>
        <span class="divider-v"></span>
        <nav class="crumb" id="crumb" aria-label="Breadcrumb"></nav>
        <span class="spacer"></span>
        <div class="right">
          <button class="btn btn--secondary btn--sm" id="reset-btn">
            <span class="icon icon--sm">restart_alt</span>Reset demo data
          </button>
          <span class="divider-v"></span>
          <div class="menu-anchor">
            <button class="btn btn--ghost btn--sm" id="user-btn" aria-expanded="false" aria-haspopup="menu">
              <span class="avatar" id="user-avatar"></span>
              <span class="topbar-user" id="user-name"></span>
              <span class="icon icon--sm">expand_more</span>
            </button>
            <div class="menu menu--pop" id="user-menu" role="menu" hidden></div>
          </div>
        </div>
      </header>
      <aside class="side" id="side"></aside>
      <main class="main">
        <div class="main-header">
          <h1 id="page-title">HARP</h1>
          <div class="actions" id="page-actions"></div>
        </div>
        <div class="main-body" id="page-body"></div>
      </main>
    </div>`;

  renderUser();
  wire();

  // Counts in the sidebar are live: redraw the current module on every commit.
  store.subscribe(() => {
    const route = router.current();
    setActive(route.module, route.screen);
  });
  onRole(renderUser);
}

export const bodyEl = () => document.getElementById('page-body');
export const actionsEl = () => document.getElementById('page-actions');

export function setHeader(title, actionsHtml = '') {
  document.getElementById('page-title').textContent = title;
  actionsEl().innerHTML = actionsHtml;
  document.title = `${title} · HARP`;
}

/** trail: [{ label, path? }, …] — the last entry is the current screen. */
export function setCrumb(trail) {
  document.getElementById('crumb').innerHTML = trail
    .map((step, i) => {
      const last = i === trail.length - 1;
      const node = last || !step.path
        ? `<b>${esc(step.label)}</b>`
        : `<a class="crumb-link" href="#${step.path}">${esc(step.label)}</a>`;
      return i === 0 ? node : `<span class="sep">/</span>${node}`;
    })
    .join('');
}

/** Point the whole chrome at one screen: module tab, sidebar, active item. */
export function setActive(moduleId, screen) {
  const mod = byId.get(moduleId) || modules[0];
  renderTabs(mod.id);
  renderSidebar(mod, screen);
}

// --- topbar module tabs -----------------------------------------------------

function renderTabs(activeId) {
  document.getElementById('mod-tabs').innerHTML = modules
    .map((mod) => {
      const on = mod.id === activeId;
      return `
        <a class="mod-tab${on ? ' mod-tab--on' : ''}" href="#${home(mod)}"
           ${on ? 'aria-current="page"' : ''} title="${esc(mod.name)}">
          <span class="icon">${mod.icon || 'widgets'}</span>${esc(mod.name)}
        </a>`;
    })
    .join('');
}

// --- sidebar — the active module's screens only -----------------------------

function renderSidebar(mod, screen) {
  const side = document.getElementById('side');
  if (!side) return;

  const head = `
    <div class="mod-side-head">
      <span>${esc(mod.name)}</span>
      <small>${esc(mod.group || 'Module')}</small>
    </div>`;

  // A manifest may group its screens by giving nav items a `group`; without one
  // the module's screens are a single list under the module head.
  let last = null;
  const items = mod.nav
    .map((item) => {
      const heading = item.group && item.group !== last
        ? `<div class="side-group">${esc(item.group)}</div>`
        : '';
      last = item.group || last;
      return heading + navItem(mod, item, screen);
    })
    .join('');

  side.innerHTML = head + items;
}

function navItem(mod, item, screen) {
  const path = `/${mod.id}/${item.screen}`;
  const count = typeof item.count === 'function' ? item.count() : null;
  const on = item.screen === screen;
  return `
    <a class="side-item" href="#${path}" data-path="${path}" ${on ? 'aria-current="page"' : ''}>
      <span class="icon">${item.icon || 'chevron_right'}</span>${esc(item.label)}
      ${count == null ? '' : `<span class="count">${count}</span>`}
    </a>`;
}

const home = (mod) => `/${mod.id}/${mod.nav[0].screen}`;

// --- user menu / role switcher ---------------------------------------------

function renderUser() {
  const role = currentRole();
  document.getElementById('user-avatar').textContent = initials(role.name);
  document.getElementById('user-name').textContent = role.name;
  document.getElementById('user-menu').innerHTML = `
    <div class="side-group">Switch role</div>
    ${ROLES.map((r) => `
      <div class="menu-item" role="menuitemradio" data-role="${r.id}"
           aria-selected="${r.id === role.id}" tabindex="0">
        <span class="icon">${r.icon}</span>${esc(r.name)} — ${esc(r.title)}
      </div>`).join('')}
    <div class="menu-sep"></div>
    <div class="menu-item" role="menuitem" data-action="theme" tabindex="0">
      <span class="icon">contrast</span>Switch theme
    </div>`;
}

function toggleMenu(open) {
  const btn = document.getElementById('user-btn');
  const menu = document.getElementById('user-menu');
  const next = open ?? menu.hidden;
  menu.hidden = !next;
  btn.setAttribute('aria-expanded', String(next));
}

function wire() {
  document.getElementById('user-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.getElementById('user-menu').addEventListener('click', (e) => {
    const roleItem = e.target.closest('[data-role]');
    if (roleItem) {
      const role = setRole(roleItem.dataset.role);
      toast(`Signed in as ${role.title}`, 'info');
      toggleMenu(false);
      router.reload();
      return;
    }
    if (e.target.closest('[data-action="theme"]')) {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      window.harpTheme.set(dark ? 'light' : 'dark');
      toggleMenu(false);
    }
  });

  document.addEventListener('click', () => toggleMenu(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleMenu(false);
  });

  document.getElementById('reset-btn').addEventListener('click', async () => {
    const ok = await confirm({
      title: 'Reset demo data',
      body: 'Every change made in this session is discarded and the seed data is restored.',
      confirmLabel: 'Reset data',
      tone: 'critical',
      icon: 'restart_alt',
    });
    if (!ok) return;
    store.resetToSeed();
    router.reload();
    toast('Demo data reset', 'success');
  });
}
