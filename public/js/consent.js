/*
 * MDO3 first-party cookie consent + GA4 loader (lab decision #29). No third-party CMP.
 * Pattern: runwae.com js/consent.js (SURF-008), generalised.
 *
 * Load once per page:  <script src="/js/consent.js" defer></script>
 *
 * GA_ID is this site's GA4 measurement id. Empty = analytics is not enabled on this site:
 * no banner, no "Cookie settings" link, nothing loads, no cookie is set.
 * With an id: Consent Mode v2 defaults to denied; gtag.js is only fetched after the visitor
 * clicks Accept. Reject (or no answer) loads nothing and sets no analytics cookie.
 * The choice is kept in a first-party cookie (mdo_consent, 180 days) mirrored to localStorage.
 * A "Cookie settings" button is added to the page footer (or any [data-cookie-settings] element
 * is used) and reopens the banner. Site code may call window.MdoConsent.track(name, params).
 */
(function () {
  'use strict';

  var GA_ID = '';
  var PRIVACY_URL = 'https://mdo3d.com/privacy#cookies';

  var COOKIE = 'mdo_consent';
  var VERSION = '1';
  var MAX_AGE = 60 * 60 * 24 * 180;
  var enabled = /^G-[A-Z0-9]{4,}$/.test(GA_ID);

  function noop() {}
  if (!enabled) {
    window.MdoConsent = { status: function () { return 'off'; }, open: noop, track: noop };
    return;
  }

  function readChoice() {
    var m = document.cookie.match(/(?:^|;\s*)mdo_consent=([^;]*)/);
    var v = m ? decodeURIComponent(m[1]) : null;
    if (!v) { try { v = window.localStorage.getItem(COOKIE); } catch (e) { v = null; } }
    if (v === VERSION + '.granted') return 'granted';
    if (v === VERSION + '.denied') return 'denied';
    return null;
  }

  function writeChoice(c) {
    var v = VERSION + '.' + c;
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = COOKIE + '=' + encodeURIComponent(v) + '; Max-Age=' + MAX_AGE + '; Path=/; SameSite=Lax' + secure;
    try { window.localStorage.setItem(COOKIE, v); } catch (e) { /* cookie is enough */ }
  }

  // Consent Mode v2: everything denied until the visitor accepts. Nothing is fetched here.
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  window.gtag('consent', 'default', {
    ad_storage: 'denied', analytics_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied'
  });

  var choice = readChoice();
  var activated = false;

  function activate() {
    if (activated) return;
    activated = true;
    // Analytics only; we run no ads, so the ad signals stay denied.
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    // No Google signals or ad personalisation.
    window.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function clearTrackingCookies() {
    var host = location.hostname;
    var parts = host.split('.');
    var domains = ['', host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (/^(_ga|_gid|_gat)/.test(n)) {
        domains.forEach(function (d) {
          document.cookie = n + '=; Max-Age=0; Path=/' + (d ? '; Domain=' + d : '');
        });
      }
    });
  }

  // ---- styles (constructed stylesheet: works under a strict style-src) ----
  var CSS = [
    '#mdo-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#16161d;color:#fff;',
    'box-shadow:0 -4px 16px rgba(0,0,0,.3);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:16px}',
    '#mdo-consent[hidden]{display:none}',
    '#mdo-consent .mdo-c-inner{max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px}',
    '#mdo-consent .mdo-c-text{flex:1 1 420px;margin:0;color:#fff}',
    '#mdo-consent .mdo-c-title{display:block;font-weight:700;font-size:16px;margin:0 0 4px;color:#fff}',
    '#mdo-consent a{color:#cdd6ff;text-decoration:underline}',
    '#mdo-consent .mdo-c-actions{display:flex;gap:12px;flex:0 0 auto}',
    '#mdo-consent button{min-width:112px;min-height:44px;padding:10px 20px;border-radius:6px;border:2px solid #fff;',
    'background:#fff;color:#16161d;font:700 15px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer}',
    '#mdo-consent button:hover{background:#e6e9ff}',
    '#mdo-consent a:focus-visible,#mdo-consent button:focus-visible{outline:3px solid #ffd54a;outline-offset:2px}',
    '@media (max-width:600px){#mdo-consent .mdo-c-actions{width:100%}#mdo-consent button{flex:1 1 0}}',
    '.mdo-cookie-settings{background:none;border:0;padding:0 4px;margin:0;color:inherit;font:inherit;',
    'text-decoration:underline;cursor:pointer;min-height:24px;display:inline-flex;align-items:center}',
    '.mdo-cookie-settings:focus-visible{outline:3px solid #ffd54a;outline-offset:2px}',
    '.mdo-cookie-slot{text-align:center;padding:8px 16px;font-size:14px}'
  ].join('');

  var styled = false;
  function ensureStyle() {
    if (styled) return;
    styled = true;
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
    } catch (e) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
    }
  }

  var banner = null;
  var returnFocusTo = null;

  function buildBanner() {
    ensureStyle();
    banner = document.createElement('section');
    banner.id = 'mdo-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-labelledby', 'mdo-consent-title');
    banner.setAttribute('aria-describedby', 'mdo-consent-desc');
    banner.hidden = true;
    banner.innerHTML =
      '<div class="mdo-c-inner">' +
        '<p class="mdo-c-text"><span class="mdo-c-title" id="mdo-consent-title">Cookies and analytics</span>' +
        '<span id="mdo-consent-desc">With your OK we use Google Analytics to count visits and see which pages ' +
        'are useful. It sets cookies and sends usage data to Google. It does not load unless you accept. ' +
        '<a href="' + PRIVACY_URL + '">How we use cookies</a></span></p>' +
        '<div class="mdo-c-actions" role="group" aria-label="Cookie choice">' +
          '<button type="button" data-mdo-consent="granted">Accept</button>' +
          '<button type="button" data-mdo-consent="denied">Reject</button>' +
        '</div>' +
      '</div>';
    banner.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-mdo-consent]') : null;
      if (t) decide(t.getAttribute('data-mdo-consent'));
    });
    var first = document.body.firstElementChild;
    if (first && first.matches && first.matches('a.skip-link, a.skip, a[href="#main"], a[href="#main-content"], a[href="#content"]')) {
      document.body.insertBefore(banner, first.nextSibling);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  function show(focus) {
    if (!banner) buildBanner();
    banner.hidden = false;
    if (focus) { var b = banner.querySelector('button'); if (b) b.focus(); }
  }

  function hide() {
    if (banner) banner.hidden = true;
    if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    returnFocusTo = null;
  }

  function decide(next) {
    var prev = choice;
    choice = next;
    writeChoice(next);
    hide();
    if (next === 'granted') { activate(); return; }
    if (activated) {
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
    }
    clearTrackingCookies();
    if (prev === 'granted' || activated) location.reload(); // a loaded tag cannot be unloaded
  }

  function open(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    returnFocusTo = (ev && ev.currentTarget) || document.activeElement;
    show(true);
  }

  // The auto-inserted link inherits the footer's text colour; if that is unreadable on the footer's
  // background (some footers never set a colour), switch it to black or white, whichever reads better.
  function rgb(c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; var v = m[1].split(',').map(parseFloat); return v.length > 3 && v[3] === 0 ? null : v; }
  function lum(v) { var a = v.slice(0, 3).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function fixContrast(el) {
    try {
      var fg = rgb(getComputedStyle(el).color), bg = null, n = el.parentElement;
      while (n && n.nodeType === 1 && !bg) { bg = rgb(getComputedStyle(n).backgroundColor); n = n.parentElement; }
      bg = bg || [255, 255, 255];
      if (fg && ratio(fg, bg) >= 4.5) return;
      el.style.color = ratio([0, 0, 0], bg) >= ratio([255, 255, 255], bg) ? '#000' : '#fff';
    } catch (e) { /* cosmetic only */ }
  }

  var bound = [];
  function addSettingsLinks() {
    var triggers = document.querySelectorAll('[data-cookie-settings]');
    if (!triggers.length) {
      var footers = document.querySelectorAll('footer');
      var slot = footers.length ? footers[footers.length - 1] : null;
      var wrap = document.createElement('p');
      wrap.className = 'mdo-cookie-slot';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mdo-cookie-settings';
      btn.setAttribute('data-cookie-settings', '');
      btn.textContent = 'Cookie settings';
      wrap.appendChild(btn);
      (slot || document.body).appendChild(wrap);
      ensureStyle();
      fixContrast(btn);
      triggers = [btn];
    }
    ensureStyle();
    for (var i = 0; i < triggers.length; i++) {
      if (bound.indexOf(triggers[i]) < 0) { triggers[i].addEventListener('click', open); bound.push(triggers[i]); }
    }
  }

  // Put the banner / settings link (back) into the page. Framework hydration (React/Next) can
  // replace server-rendered markup and drop nodes it did not render, so this re-runs when they go.
  function mount() {
    addSettingsLinks();
    if (banner && !document.contains(banner)) {
      var wasOpen = !banner.hidden;
      banner = null;
      if (wasOpen) show(false);
    }
  }

  function onReady() {
    mount();
    if (choice === 'granted') activate();
    else if (choice === 'denied') clearTrackingCookies();
    else show(false);
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if ((banner && !document.contains(banner)) || !document.querySelector('[data-cookie-settings]')) mount();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () { mo.disconnect(); }, 20000);
    }
  }

  // Next.js pages hydrate after load: wait for it so the banner is not inserted mid-hydration.
  function isNext() { return !!(window.__next_f || window.__NEXT_DATA__ || document.getElementById('__next')); }

  window.MdoConsent = {
    status: function () { return choice; },
    open: open,
    track: function (name, params) { if (activated) window.gtag('event', name, params || {}); }
  };

  function start() {
    if (isNext() && document.readyState !== 'complete') {
      window.addEventListener('load', function () { setTimeout(onReady, 0); });
    } else {
      onReady();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
