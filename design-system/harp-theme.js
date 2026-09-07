// harp© module: Platform spec: 0.1
// Theme switching per the design system's :root[data-theme="light|dark"] contract.
window.harpTheme = {
  set: function (theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("harp-theme", theme); } catch { /* private mode */ }
  },
  init: function () {
    let theme = null;
    try { theme = localStorage.getItem("harp-theme"); } catch { /* private mode */ }
    if (!theme) theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    return theme;
  },
};

// Dialog focus management for HModal: trap Tab within the dialog while open and restore
// focus to the invoking element on close (WCAG 2.4.3, and the chained matrix->clone flow).
window.harpModal = {
  _restore: [],   // stack — chained modals (matrix -> clone) push/pop their openers
  trap: function (dialog) {
    if (!dialog) return;
    this._restore.push(document.activeElement);
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    dialog.__harpKeydown = function (e) {
      if (e.key !== "Tab") return;
      const items = Array.prototype.filter.call(dialog.querySelectorAll(sel), function (el) {
        return el.offsetParent !== null; // visible only
      });
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    };
    dialog.addEventListener("keydown", dialog.__harpKeydown);
  },
  // Called after the dialog element is already removed from the DOM (its keydown listener is
  // GC'd with it), so restore only needs the stored opener — no element argument required.
  release: function () {
    const el = this._restore.pop();
    if (el && typeof el.focus === "function") { el.focus(); }
  },
};
