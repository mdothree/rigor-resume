/* theme-toggle.js — MDOThree shared template, theme part of site-chrome.js (source: mdothree-text go-final-r4
 * public/js/site-chrome.js "Theme" section, copied unchanged). Surfaces without the Pro/account cluster load
 * only this. Load: <script src="/js/theme-toggle.js" defer></script> (after theme-init.js ran in <head>).
 * Markup (innermost/rightmost in the nav):
 *   <button type="button" class="mdo-theme" data-mdo-theme aria-label="Switch theme" title="Switch theme">…moon/sun svg…</button>
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'mdo-theme';

  function current() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function label(btn) {
    var next = current() === 'dark' ? 'light' : 'dark';
    var text = 'Switch to ' + next + ' theme';
    btn.setAttribute('aria-label', text);
    btn.setAttribute('title', text);
    btn.setAttribute('aria-pressed', current() === 'dark' ? 'true' : 'false');
  }
  function apply(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) {
      root.removeAttribute('data-theme-source');
      try { window.localStorage.setItem(KEY, theme); } catch (e) { /* storage blocked: choice lasts this page */ }
    }
    var btns = document.querySelectorAll('[data-mdo-theme]');
    for (var i = 0; i < btns.length; i++) label(btns[i]);
    try { document.dispatchEvent(new CustomEvent('mdo-theme-change', { detail: { theme: theme } })); } catch (e) {}
  }
  var toggles = document.querySelectorAll('[data-mdo-theme]');
  for (var t = 0; t < toggles.length; t++) {
    label(toggles[t]);
    toggles[t].addEventListener('click', function () { apply(current() === 'dark' ? 'light' : 'dark', true); });
  }
  // No saved choice yet: keep following the OS setting live.
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onOs = function (e) { if (root.getAttribute('data-theme-source') === 'os') apply(e.matches ? 'dark' : 'light', false); };
    if (mq.addEventListener) mq.addEventListener('change', onOs); else if (mq.addListener) mq.addListener(onOs);
  } catch (e) {}
  window.mdoTheme = { set: function (t) { apply(t === 'dark' ? 'dark' : 'light', true); } };
})();
