// The app shell: topbar (brand, breadcrumb, reset, user menu) + sidebar built
// from module manifests + the main region the router renders into.

import { modules } from './modules.js';
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

  renderSidebar();
  renderUser();
  wire();

  store.subscribe(renderSidebar);
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

export function setActive(moduleId, screen) {
  const path = `/${moduleId}/${screen}`;
  for (const item of document.querySelectorAll('.side-item')) {
    if (item.dataset.path === path) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

// --- sidebar ----------------------------------------------------------------

function renderSidebar() {
  const side = document.getElementById('side');
  if (!side) return;
  const active = router.current();

  const groups = new Map();
  for (const mod of modules) {
    const key = mod.group || mod.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mod);
  }

  side.innerHTML = [...groups]
    .map(([label, mods]) => {
      const items = mods.flatMap((mod) => mod.nav.map((item) => navItem(mod, item))).join('');
      return `<div class="side-group">${esc(label)}</div>${items}`;
    })
    .join('');

  setActive(active.module, active.screen);
}

function navItem(mod, item) {
  const path = `/${mod.id}/${item.screen}`;
  const count = typeof item.count === 'function' ? item.count() : null;
  return `
    <a class="side-item" href="#${path}" data-path="${path}">
      <span class="icon">${item.icon || 'chevron_right'}</span>${esc(item.label)}
      ${count == null ? '' : `<span class="count">${count}</span>`}
    </a>`;
}

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
