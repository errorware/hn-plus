// ==UserScript==
// @name         HN+
// @namespace    https://github.com/errorware/hn-plus
// @version      0.3.0
// @description  A dark, configurable power-user layer for Hacker News.
// @homepageURL  https://github.com/errorware/hn-plus
// @supportURL   https://github.com/errorware/hn-plus/issues
// @updateURL    https://raw.githubusercontent.com/errorware/hn-plus/main/hn-plus.user.js
// @downloadURL  https://raw.githubusercontent.com/errorware/hn-plus/main/hn-plus.user.js
// @match        https://news.ycombinator.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      hacker-news.firebaseio.com
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.3.0';
  const API = 'https://hacker-news.firebaseio.com/v0';

  /* =====================================================================
   * Storage
   * ===================================================================== */

  const gmGet = (k, d) => {
    try { const v = GM_getValue(k); return v === undefined ? d : v; } catch { return d; }
  };
  const gmSet = (k, v) => {
    try { GM_setValue(k, v); } catch (e) { console.warn('[hn+] save failed', e); }
  };

  const THEMES = {
    abyss:    { label: 'Abyss',    bg: '#0c0c0d', surface: '#141416', raised: '#1c1c1f', border: '#2a2a2f', text: '#ececee', dim: '#b4b4ba', muted: '#77777f' },
    graphite: { label: 'Graphite', bg: '#18181b', surface: '#1f1f23', raised: '#28282d', border: '#36363c', text: '#f0f0f2', dim: '#bcbcc2', muted: '#7f7f88' },
    ash:      { label: 'Ash',      bg: '#222226', surface: '#2a2a2f', raised: '#333339', border: '#45454c', text: '#f4f4f5', dim: '#c6c6cc', muted: '#8d8d96' },
    oled:     { label: 'OLED',     bg: '#000000', surface: '#0a0a0a', raised: '#141414', border: '#242424', text: '#e8e8e8', dim: '#a9a9a9', muted: '#6b6b6b' },
  };
  const TONE_KEYS = [
    ['bg', 'Background'], ['surface', 'Surface'], ['raised', 'Raised'], ['border', 'Borders'],
    ['text', 'Text'], ['dim', 'Secondary text'], ['muted', 'Muted text'],
  ];
  const ACCENTS = ['#ff6600', '#ff8a3d', '#ffb020', '#ff4f4f', '#f472b6', '#a78bfa', '#60a5fa', '#2dd4bf', '#a3e635'];
  const USER_COLORS = ['#ff6600', '#ffb020', '#ff4f4f', '#f472b6', '#a78bfa', '#60a5fa', '#2dd4bf', '#a3e635'];

  const FONTS = {
    sans:    { label: 'Sans',    stack: 'system-ui, -apple-system, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif' },
    serif:   { label: 'Serif',   stack: '"Iowan Old Style", Charter, "Source Serif 4", "Source Serif Pro", Georgia, "Times New Roman", serif' },
    mono:    { label: 'Mono',    stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
    classic: { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  };
  const MONO_STACK = FONTS.mono.stack;

  const DEFAULTS = {
    theme: 'abyss',
    tones: pickTones(THEMES.abyss),
    accent: '#ff6600',
    font: 'sans',
    fontSize: 14,
    lineHeight: 1.55,
    width: 'readable',
    stickyHeader: true,
    // comments
    rails: true,
    rainbowRails: false,
    railCollapse: true,
    opBadge: true,
    newMarkers: true,
    quotes: true,
    imageExpand: true,
    hoverPreviews: true,
    userCards: true,
    highlightSelf: true,
    // lists
    newTab: true,
    newCountBadge: true,
    dimRead: true,
    favicons: false,
    filterMode: 'hide',
    filterKeywords: '',
    filterDomains: '',
    // behaviour
    keyboard: true,
    // account
    accountMenu: true,
    replyTracking: true,
    // christmas
    xmas: 'off',            // off | on | auto (1 Dec - 6 Jan)
    xmasSnow: true,
    xmasSnowAmount: 'medium', // light | medium | blizzard
    xmasHats: true,
    xmasOrnaments: true,
    xmasLights: true,
    // word swaps: [{ from, to }]
    swaps: [],
    swapStyle: 'shine', // shine | glow | squiggle | marker | none
  };

  function pickTones(t) {
    const o = {};
    for (const [k] of TONE_KEYS) o[k] = t[k];
    return o;
  }

  function loadSettings() {
    const saved = gmGet('settings', {}) || {};
    return { ...DEFAULTS, ...saved, tones: { ...DEFAULTS.tones, ...(saved.tones || {}) } };
  }

  let S = loadSettings();
  let USERS = gmGet('users', {}) || {};

  const saveSettings = () => gmSet('settings', S);
  const saveUsers = () => {
    for (const [k, u] of Object.entries(USERS)) if (!u.color && !u.tag && !u.muted && !u.alias && !u.note) delete USERS[k];
    gmSet('users', USERS);
  };
  const loadSeen = () => gmGet('seen', {}) || {};
  const saveSeen = (seen) => {
    const keys = Object.keys(seen);
    if (keys.length > 3000) {
      keys.sort((a, b) => (seen[a].t || 0) - (seen[b].t || 0));
      for (const k of keys.slice(0, keys.length - 2500)) delete seen[k];
    }
    gmSet('seen', seen);
  };

  /* =====================================================================
   * Small utilities
   * ===================================================================== */

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'selected') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : String(c));
    }
    return e;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const inkFor = (hex) => (luminance(hex) > 0.18 ? '#111111' : '#ffffff');
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

  function timeAgo(unixSeconds) {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - unixSeconds));
    const steps = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
    for (const [sec, name] of steps) {
      if (s >= sec) { const n = Math.floor(s / sec); return `${n} ${name}${n === 1 ? '' : 's'} ago`; }
    }
    return 'just now';
  }

  function itemIdFromHref(href) {
    if (!href) return null;
    const m = /^(?:https?:\/\/news\.ycombinator\.com\/)?item\?id=(\d+)/.exec(href);
    return m ? m[1] : null;
  }

  const userFromLink = (a) => {
    const m = /^user\?id=([^&#]+)/.exec(a.getAttribute('href') || '');
    return m ? decodeURIComponent(m[1]) : null;
  };

  // Allow-list sanitizer for HTML coming back from the HN API (user "about", item text).
  const ALLOWED_TAGS = new Set(['P', 'A', 'I', 'B', 'EM', 'STRONG', 'PRE', 'CODE', 'BR']);
  function sanitizeInto(html, container) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) dst.append(n.nodeValue);
        else if (n.nodeType === Node.ELEMENT_NODE) {
          if (ALLOWED_TAGS.has(n.tagName)) {
            const el = document.createElement(n.tagName);
            if (n.tagName === 'A') {
              const href = n.getAttribute('href') || '';
              if (/^https?:\/\//i.test(href) || /^(item|user)\?id=/.test(href)) {
                el.href = href;
                el.target = '_blank';
                el.rel = 'noopener noreferrer';
              }
            }
            walk(n, el);
            dst.append(el);
          } else walk(n, dst);
        }
      }
    };
    walk(doc.body.firstChild, container);
    return container;
  }

  /* =====================================================================
   * HN API (GM_xmlhttpRequest sidesteps page CSP; plain fetch as fallback)
   * ===================================================================== */

  const apiCache = new Map();
  function api(path, fresh) {
    if (fresh) apiCache.delete(path);
    if (apiCache.has(path)) return apiCache.get(path);
    const url = `${API}/${path}.json`;
    const p = new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url, responseType: 'json', timeout: 10000,
          onload: (r) => {
            try { resolve(typeof r.response === 'object' && r.response !== null ? r.response : JSON.parse(r.responseText)); }
            catch (e) { reject(e); }
          },
          onerror: reject, ontimeout: reject,
        });
      } else {
        fetch(url).then((r) => r.json()).then(resolve, reject);
      }
    });
    p.catch(() => apiCache.delete(path));
    apiCache.set(path, p);
    return p;
  }

  /* =====================================================================
   * Theme
   * ===================================================================== */

  const CSS_BASE = `
html.hnp { color-scheme: dark; background: var(--hnp-bg) !important; }
html.hnp body { background: var(--hnp-bg) !important; margin: 0; padding: 0 0 64px; }
html.hnp body, html.hnp td, html.hnp .default, html.hnp .title, html.hnp .subtext, html.hnp .subtext td,
html.hnp .comhead, html.hnp .comment, html.hnp .pagetop, html.hnp .yclinks, html.hnp .admin, html.hnp .admin td,
html.hnp input[type=submit], html.hnp button { font-family: var(--hnp-font) !important; }
html.hnp body, html.hnp td { font-size: var(--hnp-fs); color: var(--hnp-dim); }
html.hnp ::selection { background: var(--hnp-accent); color: var(--hnp-ink); }
html.hnp a:link { color: var(--hnp-text); }
html.hnp a:visited { color: var(--hnp-dim); }
html.hnp a:hover { color: var(--hnp-accent); }
html.hnp font[color] { color: var(--hnp-muted) !important; }
html.hnp hr { border: 0; border-top: 1px solid var(--hnp-border); }
html.hnp ::-webkit-scrollbar { width: 11px; height: 11px; }
html.hnp ::-webkit-scrollbar-track { background: var(--hnp-bg); }
html.hnp ::-webkit-scrollbar-thumb { background: var(--hnp-raised); border: 2px solid var(--hnp-bg); border-radius: 8px; }
html.hnp ::-webkit-scrollbar-thumb:hover { background: var(--hnp-border); }

/* ---------- frame ---------- */
html.hnp #hnmain { background: var(--hnp-bg) !important; width: var(--hnp-width) !important; max-width: var(--hnp-maxw); min-width: 0 !important; margin: 0 auto; }
html.hnp #hnmain > tbody > tr:first-child > td {
  background: var(--hnp-surface) !important; border-bottom: 2px solid var(--hnp-accent);
  padding: 7px 12px !important; border-radius: 0 0 10px 10px;
}
html.hnp.hnp-sticky #hnmain > tbody > tr:first-child > td { position: sticky; top: 0; z-index: 900; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
html.hnp #hnmain > tbody > tr:first-child img[src="y18.svg"] { border: 1px solid var(--hnp-accent) !important; border-radius: 3px; }
html.hnp .pagetop { color: var(--hnp-muted) !important; font-size: var(--hnp-fs) !important; line-height: 1.7 !important; }
html.hnp .pagetop a:link, html.hnp .pagetop a:visited { color: var(--hnp-dim) !important; }
html.hnp .pagetop a:hover { color: var(--hnp-accent) !important; }
html.hnp .hnname a:link, html.hnp .hnname a:visited { color: var(--hnp-text) !important; font-weight: 700; }
html.hnp .hnname a::after { content: "+"; color: var(--hnp-accent); margin-left: 1px; }
html.hnp .hnname { margin-right: 10px !important; }
html.hnp .topsel a:link, html.hnp .topsel a:visited { color: var(--hnp-accent) !important; }
html.hnp #me { color: var(--hnp-accent) !important; }
html.hnp #hnmain > tbody > tr:not(:first-child) td[bgcolor="#ff6600"] { background: var(--hnp-accent) !important; opacity: .5; }
html.hnp #bigbox > td { padding: 12px 8px 6px !important; }
html.hnp .yclinks, html.hnp .yclinks a:link, html.hnp .yclinks a:visited { color: var(--hnp-muted) !important; }

/* ---------- stories ---------- */
html.hnp td.title { font-size: var(--hnp-fs-title) !important; }
html.hnp .rank { color: var(--hnp-muted); font-variant-numeric: tabular-nums; font-size: .85em; }
html.hnp .titleline { line-height: 1.35; }
html.hnp .titleline > a:link { color: var(--hnp-text) !important; font-weight: 500; }
html.hnp .titleline > a:visited { color: var(--hnp-muted) !important; }
html.hnp .titleline > a:hover { color: var(--hnp-accent) !important; }
html.hnp .sitebit, html.hnp .sitebit a:link, html.hnp .sitebit a:visited, html.hnp .sitestr { color: var(--hnp-muted) !important; font-size: .82em; }
html.hnp .sitebit a:hover .sitestr { color: var(--hnp-accent) !important; }
html.hnp .subtext, html.hnp .subline, html.hnp .subtext td { font-size: var(--hnp-fs-small) !important; color: var(--hnp-muted) !important; }
html.hnp .subtext a:link, html.hnp .subtext a:visited { color: var(--hnp-muted) !important; }
html.hnp .subtext a:hover { color: var(--hnp-accent) !important; text-decoration: none !important; }
html.hnp .score { color: color-mix(in srgb, var(--hnp-accent) 85%, var(--hnp-text)) !important; }
html.hnp tr.spacer { height: 10px !important; }
html.hnp .morelink:link, html.hnp .morelink:visited { color: var(--hnp-accent) !important; font-weight: 600; }
html.hnp tr.athing.submission > td, html.hnp tr.hnp-sub > td { transition: background .12s; }
html.hnp tr.athing.submission.hnp-sel > td, html.hnp tr.athing.submission.hnp-sel + tr > td { background: var(--hnp-surface) !important; }
html.hnp tr.athing.hnp-sel > td:first-child { box-shadow: inset 3px 0 0 var(--hnp-accent); }
html.hnp.hnp-dimread tr.athing.hnp-read .titleline > a:link { color: var(--hnp-muted) !important; }
html.hnp .hnp-fav { width: 14px; height: 14px; vertical-align: -2px; margin-right: 6px; border-radius: 3px; }
html.hnp .hnp-newcount { color: var(--hnp-ink); background: var(--hnp-accent); border-radius: 999px; padding: 0 6px; margin-left: 4px; font-weight: 700; font-size: .9em; }
html:not(.hnp-newcounts) .hnp-newcount { display: none; }
html.hnp tr.hnp-filtered { display: none !important; }
html.hnp.hnp-show-filtered tr.hnp-filtered, html.hnp.hnp-filter-dim tr.hnp-filtered { display: table-row !important; opacity: .28; }
html.hnp .hnp-filtercount { cursor: pointer; color: var(--hnp-muted); }
html.hnp .hnp-filtercount:hover { color: var(--hnp-accent); }

/* ---------- item page ---------- */
html.hnp table.fatitem { background: var(--hnp-surface); border: 1px solid var(--hnp-border); border-radius: 12px; padding: 10px 14px 14px 6px; width: 100%; box-sizing: border-box; }
html.hnp .toptext { color: var(--hnp-text) !important; line-height: var(--hnp-lh); font-size: var(--hnp-fs); max-width: 90ch; }
html.hnp .toptext a:link, html.hnp .toptext a:visited { color: var(--hnp-accent) !important; text-decoration: underline; text-underline-offset: 2px; }

/* ---------- forms ---------- */
html.hnp :is(textarea, select, input[type=text], input[type=password], input[type=url], input[type=number], input[type=email], input:not([type])):not(.hnp-ui *) {
  background: var(--hnp-raised) !important; color: var(--hnp-text) !important; border: 1px solid var(--hnp-border) !important;
  border-radius: 7px; padding: 6px 9px; font-family: var(--hnp-mono) !important; font-size: var(--hnp-fs) !important; outline: none;
}
html.hnp :is(textarea, select, input):not(.hnp-ui *):focus { border-color: var(--hnp-accent) !important; box-shadow: 0 0 0 3px var(--hnp-accent-soft); }
html.hnp textarea:not(.hnp-ui *) { width: min(100%, 760px); box-sizing: border-box; min-height: 130px; line-height: 1.5; }
html.hnp input[type=submit]:not(.hnp-ui *) { background: var(--hnp-accent) !important; color: var(--hnp-ink) !important; border: 0 !important; border-radius: 7px; padding: 7px 16px; font-weight: 650; cursor: pointer; }
html.hnp input[type=submit]:not(.hnp-ui *):hover { filter: brightness(1.1); }

/* ---------- votes ---------- */
html.hnp .votearrow { background: var(--hnp-muted) !important; clip-path: polygon(50% 6%, 100% 94%, 0 94%); }
html.hnp .votelinks a:hover .votearrow { background: var(--hnp-accent) !important; }

/* ---------- comments ---------- */
html.hnp table.comment-tree { width: 100%; margin-top: 8px; border-spacing: 0; }
html.hnp tr.hnp-c td.default { position: relative; padding: 7px 12px 9px 16px !important; border-radius: 0 8px 8px 0; transition: background .15s; }
html.hnp tr.hnp-c td.ind { vertical-align: top; }
html.hnp .hnp-rail { position: absolute; left: 0; top: 6px; bottom: 6px; width: 12px; }
html.hnp .hnp-rail::after { content: ""; position: absolute; left: 3px; top: 0; bottom: 0; width: 2px; border-radius: 2px; background: transparent; transition: background .12s, width .12s; }
html.hnp.hnp-rails .hnp-rail::after { background: var(--hnp-border); }
html.hnp.hnp-rails.hnp-rainbow tr[data-hnp-dm="0"] .hnp-rail::after { background: color-mix(in srgb, var(--hnp-accent) 70%, var(--hnp-bg)); }
html.hnp.hnp-rails.hnp-rainbow tr[data-hnp-dm="1"] .hnp-rail::after { background: color-mix(in srgb, #60a5fa 65%, var(--hnp-bg)); }
html.hnp.hnp-rails.hnp-rainbow tr[data-hnp-dm="2"] .hnp-rail::after { background: color-mix(in srgb, #a78bfa 65%, var(--hnp-bg)); }
html.hnp.hnp-rails.hnp-rainbow tr[data-hnp-dm="3"] .hnp-rail::after { background: color-mix(in srgb, #2dd4bf 65%, var(--hnp-bg)); }
html.hnp.hnp-rails.hnp-rainbow tr[data-hnp-dm="4"] .hnp-rail::after { background: color-mix(in srgb, #f472b6 65%, var(--hnp-bg)); }
html.hnp.hnp-rails.hnp-rainbow tr[data-hnp-dm="5"] .hnp-rail::after { background: color-mix(in srgb, #facc15 65%, var(--hnp-bg)); }
html.hnp.hnp-railcollapse .hnp-rail { cursor: pointer; }
html.hnp.hnp-railcollapse .hnp-rail:hover::after { background: var(--hnp-accent) !important; width: 3px; }
html.hnp tr.hnp-c.hnp-hl-row .hnp-rail::after { background: var(--hnp-uc) !important; }
html.hnp.hnp-self tr.hnp-c.hnp-mine .hnp-rail::after { background: var(--hnp-accent) !important; }
html.hnp .comhead { font-size: var(--hnp-fs-small) !important; color: var(--hnp-muted) !important; }
html.hnp .comhead a:link, html.hnp .comhead a:visited { color: var(--hnp-muted) !important; }
html.hnp .comhead a:hover { color: var(--hnp-accent) !important; text-decoration: none !important; }
html.hnp .comhead a.hnp-user:link, html.hnp .comhead a.hnp-user:visited { color: var(--hnp-dim) !important; font-weight: 650; }
html.hnp .togg { font-family: var(--hnp-mono) !important; }
html.hnp .comment { font-size: var(--hnp-fs) !important; line-height: var(--hnp-lh); }
html.hnp .commtext { color: var(--hnp-text); max-width: 100ch; }
html.hnp .commtext :is(.c00), html.hnp .c00 { color: var(--hnp-text) !important; }
html.hnp :is(.c5a, .c5A) { color: color-mix(in srgb, var(--hnp-text) 82%, var(--hnp-bg)) !important; }
html.hnp .c73 { color: color-mix(in srgb, var(--hnp-text) 72%, var(--hnp-bg)) !important; }
html.hnp .c82 { color: color-mix(in srgb, var(--hnp-text) 64%, var(--hnp-bg)) !important; }
html.hnp .c88 { color: color-mix(in srgb, var(--hnp-text) 60%, var(--hnp-bg)) !important; }
html.hnp :is(.c9c, .c9C) { color: color-mix(in srgb, var(--hnp-text) 52%, var(--hnp-bg)) !important; }
html.hnp :is(.cae, .cAE) { color: color-mix(in srgb, var(--hnp-text) 44%, var(--hnp-bg)) !important; }
html.hnp :is(.cbe, .cBE) { color: color-mix(in srgb, var(--hnp-text) 38%, var(--hnp-bg)) !important; }
html.hnp :is(.cce, .cCE) { color: color-mix(in srgb, var(--hnp-text) 32%, var(--hnp-bg)) !important; }
html.hnp :is(.cdd, .cDD) { color: color-mix(in srgb, var(--hnp-text) 26%, var(--hnp-bg)) !important; }
html.hnp .comment a:link, html.hnp .comment a:visited {
  color: var(--hnp-accent) !important; text-decoration: underline !important;
  text-decoration-color: color-mix(in srgb, var(--hnp-accent) 40%, transparent) !important; text-underline-offset: 2px;
}
html.hnp .comment a:hover { text-decoration-color: var(--hnp-accent) !important; }
html.hnp pre { background: var(--hnp-raised); border: 1px solid var(--hnp-border); border-radius: 7px; padding: 9px 11px !important; color: var(--hnp-text); }
html.hnp pre, html.hnp code { font-family: var(--hnp-mono) !important; font-size: .9em; }
html.hnp .reply, html.hnp .reply a:link, html.hnp .reply a:visited { color: var(--hnp-muted) !important; text-decoration: none !important; }
html.hnp .reply a:hover { color: var(--hnp-accent) !important; }
html.hnp .reply font { font-size: var(--hnp-fs-small) !important; }
html.hnp .reply u { text-decoration: none; }
html.hnp tr.hnp-c.coll td.default { opacity: .62; }
html.hnp tr.hnp-c.hnp-hl-row td.default { background: color-mix(in srgb, var(--hnp-uc) 8%, transparent); }
html.hnp.hnp-newmark tr.hnp-c.hnp-new td.default { background: var(--hnp-accent-soft); }
html.hnp tr.hnp-c.hnp-sel td.default { background: var(--hnp-raised) !important; box-shadow: inset 0 0 0 1px var(--hnp-border); }
html.hnp tr.hnp-c.hnp-sel .hnp-rail::after { background: var(--hnp-accent) !important; width: 3px; }
html.hnp tr.hnp-c.hnp-muted:not(.hnp-reveal) .comment { display: none; }
html.hnp tr.hnp-c.hnp-muted:not(.hnp-reveal) td.default { opacity: .55; }
html.hnp tr.hnp-c.hnp-flash td.default { animation: hnp-flash 1.1s ease-out; }
@keyframes hnp-flash { 0%, 30% { background: color-mix(in srgb, var(--hnp-accent) 28%, transparent); } 100% { background: transparent; } }
html.hnp.hnp-quotes .hnp-quote { display: block; border-left: 3px solid color-mix(in srgb, var(--hnp-accent) 55%, var(--hnp-bg)); padding: 1px 0 1px 10px; color: var(--hnp-dim) !important; font-style: italic; }

/* ---------- badges, tags, user highlighting ---------- */
html.hnp .hnp-badge { display: inline-block; font-size: .78em; font-weight: 750; letter-spacing: .04em; line-height: 1.45; padding: 0 5px; border-radius: 4px; margin-left: 6px; vertical-align: 1px; }
html.hnp .hnp-badge-op { background: var(--hnp-accent); color: var(--hnp-ink); }
html:not(.hnp-op) .hnp-badge-op { display: none; }
html.hnp .hnp-badge-new { color: var(--hnp-accent); border: 1px solid var(--hnp-accent); }
html:not(.hnp-newmark) .hnp-badge-new { display: none; }
html.hnp .hnp-badge-you { color: var(--hnp-ink); background: var(--hnp-dim); }
html:not(.hnp-self) .hnp-badge-you { display: none; }
html.hnp .hnp-mutebtn { cursor: pointer; color: var(--hnp-muted); border: 1px dashed var(--hnp-border); background: none; }
html.hnp .hnp-mutebtn:hover { color: var(--hnp-accent); border-color: var(--hnp-accent); }
html.hnp a.hnp-user.hnp-hl:link, html.hnp a.hnp-user.hnp-hl:visited { color: var(--hnp-uc) !important; font-weight: 700 !important; }
html.hnp .hnp-tag {
  display: inline-block; padding: 0 7px; margin-left: 6px; border-radius: 999px; font-size: .88em; line-height: 1.5; font-weight: 600;
  color: var(--hnp-uc, var(--hnp-accent)); background: color-mix(in srgb, var(--hnp-uc, var(--hnp-accent)) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--hnp-uc, var(--hnp-accent)) 40%, transparent);
}
html.hnp tr.athing.submission.hnp-hl-row > td, html.hnp tr.hnp-sub.hnp-hl-row > td { background: color-mix(in srgb, var(--hnp-uc) 8%, transparent); }
html.hnp tr.athing.submission.hnp-hl-row > td:first-child { box-shadow: inset 3px 0 0 var(--hnp-uc); }

/* ---------- word swaps ---------- */
html.hnp .hnp-swap { --hnp-swap-base: var(--hnp-text); border-radius: 3px; }
html.hnp-swapfx-shine .hnp-swap {
  background: linear-gradient(110deg, var(--hnp-swap-base) 0 38%, var(--hnp-accent) 50%, var(--hnp-swap-base) 62% 100%);
  background-size: 300% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  border-bottom: 1px dotted color-mix(in srgb, var(--hnp-accent) 50%, transparent);
  animation: hnp-shine 5s ease-in-out infinite;
}
@keyframes hnp-shine { 0%, 50% { background-position: 100% 0; } 80%, 100% { background-position: 0 0; } }
html.hnp-swapfx-glow .hnp-swap {
  color: color-mix(in srgb, var(--hnp-accent) 45%, var(--hnp-swap-base)) !important;
  animation: hnp-glow 3.2s ease-in-out infinite;
}
@keyframes hnp-glow {
  0%, 100% { text-shadow: 0 0 4px color-mix(in srgb, var(--hnp-accent) 35%, transparent); }
  50% { text-shadow: 0 0 11px color-mix(in srgb, var(--hnp-accent) 70%, transparent); }
}
html.hnp-swapfx-squiggle .hnp-swap {
  text-decoration: underline wavy color-mix(in srgb, var(--hnp-accent) 75%, transparent) !important;
  text-decoration-thickness: 1px !important; text-underline-offset: 3px; text-decoration-skip-ink: none;
}
html.hnp-swapfx-marker .hnp-swap {
  background: linear-gradient(transparent 58%, color-mix(in srgb, var(--hnp-accent) 32%, transparent) 58%);
  padding: 0 2px; margin: 0 -2px; -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
@media (prefers-reduced-motion: reduce) {
  html.hnp .hnp-swap { animation: none !important; }
  html.hnp-swapfx-shine .hnp-swap { background: none; -webkit-text-fill-color: currentColor; color: color-mix(in srgb, var(--hnp-accent) 60%, var(--hnp-swap-base)) !important; }
}

/* ---------- aliases & notes ---------- */
html.hnp a.hnp-user.hnp-aliased { font-style: italic; }
html.hnp .hnp-noteicon { color: var(--hnp-accent); margin-left: 3px; font-size: .9em; opacity: .85; cursor: help; }
.hnp-card .hnp-card-handle { color: var(--hnp-muted); font-size: 12px; }
.hnp-card textarea.hnp-card-notes {
  width: 100%; min-height: 56px; margin-top: 10px; resize: vertical; font-family: var(--hnp-font); font-size: 13px; line-height: 1.45;
  background: color-mix(in srgb, var(--hnp-accent) 7%, var(--hnp-raised)); border-color: color-mix(in srgb, var(--hnp-accent) 30%, var(--hnp-border));
}
.hnp-card .hnp-card-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--hnp-muted); margin-top: 10px; }
.hnp-urow { padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--hnp-border) 55%, transparent); }
.hnp-urow-top { display: grid; grid-template-columns: minmax(90px, 140px) 1fr 1fr auto auto auto; gap: 6px; align-items: center; }
.hnp-urow-top > a { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hnp-ui .hnp-urow textarea { margin-top: 6px; min-height: 40px; font-family: var(--hnp-font); font-size: 12.5px; }

/* ---------- account menu & replies ---------- */
html.hnp .pagetop a.hnp-replybadge:link, html.hnp .pagetop a.hnp-replybadge:visited { display: inline-block; min-width: 16px; padding: 0 5px; margin-left: 5px; border-radius: 999px; background: var(--hnp-accent); color: var(--hnp-ink) !important; font-size: .78em; font-weight: 800; line-height: 1.5; text-align: center; cursor: pointer; vertical-align: 1px; }
.hnp-card.hnp-acct { width: min(400px, 94vw); max-height: min(78vh, 640px); padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.hnp-acct-head { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid var(--hnp-border); }
.hnp-acct-head b { font-size: 15px; color: var(--hnp-text); }
.hnp-acct-head .hnp-card-karma { font-size: 12px; }
.hnp-acct-head .hnp-acct-tools { margin-left: auto; display: flex; gap: 6px; }
.hnp-acct-head button { background: none; border: 1px solid var(--hnp-border); color: var(--hnp-dim); border-radius: 6px; padding: 1px 8px; cursor: pointer; font-size: 12px; }
.hnp-acct-head button:hover { color: var(--hnp-accent); border-color: var(--hnp-accent); }
.hnp-acct-replies { overflow: auto; flex: 1 1 auto; min-height: 0; }
.hnp-acct-label { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 4px; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--hnp-muted); }
.hnp-acct-label span { color: var(--hnp-accent); }
a.hnp-reply:link, a.hnp-reply:visited { display: block; padding: 8px 14px 9px; color: var(--hnp-dim); border-left: 3px solid transparent; }
a.hnp-reply:hover { background: var(--hnp-raised); }
a.hnp-reply.unread { border-left-color: var(--hnp-accent); background: var(--hnp-accent-soft); }
a.hnp-reply .hnp-reply-meta { font-size: 12px; color: var(--hnp-muted); }
a.hnp-reply .hnp-reply-meta b { color: var(--hnp-text); font-weight: 650; }
a.hnp-reply .hnp-reply-text { margin-top: 2px; color: var(--hnp-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
a.hnp-reply .hnp-reply-on { font-size: 11.5px; color: var(--hnp-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hnp-acct-empty { padding: 8px 14px 12px; color: var(--hnp-muted); font-size: 12.5px; }
.hnp-acct-links { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 8px; border-top: 1px solid var(--hnp-border); background: var(--hnp-bg); flex: none; }
.hnp-acct-links a:link, .hnp-acct-links a:visited { display: flex; align-items: baseline; gap: 6px; padding: 6px 10px; border-radius: 7px; color: var(--hnp-dim); }
.hnp-acct-links a:hover { background: var(--hnp-raised); color: var(--hnp-accent); }
.hnp-acct-links .hnp-acct-pair { grid-column: span 2; display: flex; align-items: baseline; padding: 6px 10px; gap: 6px; color: var(--hnp-muted); }
.hnp-acct-links .hnp-acct-pair > span:first-child { min-width: 72px; }
.hnp-acct-links .hnp-acct-pair a:link, .hnp-acct-links .hnp-acct-pair a:visited { display: inline; padding: 0; color: var(--hnp-dim); }
.hnp-acct-links .hnp-acct-pair a:hover { background: none; color: var(--hnp-accent); }
.hnp-acct-links .hnp-acct-pair > span:first-child { color: var(--hnp-dim); }
.hnp-acct-links a.hnp-acct-logout:link, .hnp-acct-links a.hnp-acct-logout:visited { color: var(--hnp-muted); }

/* ---------- image expand ---------- */
html.hnp .hnp-imgbtn { cursor: pointer; font-size: .78em; font-weight: 700; margin-left: 4px; padding: 0 5px; border-radius: 4px; color: var(--hnp-muted); border: 1px solid var(--hnp-border); background: none; font-family: var(--hnp-mono); }
html.hnp .hnp-imgbtn:hover, html.hnp .hnp-imgbtn.on { color: var(--hnp-accent); border-color: var(--hnp-accent); }
html:not(.hnp-images) .hnp-imgbtn { display: none; }
html.hnp .hnp-img { display: block; max-width: min(100%, 640px); max-height: 70vh; margin: 8px 0; border-radius: 8px; border: 1px solid var(--hnp-border); cursor: zoom-out; }

/* ---------- HN+ UI ---------- */
.hnp-ui, .hnp-ui * { box-sizing: border-box; }
.hnp-ui { font-family: var(--hnp-font); font-size: 13px; color: var(--hnp-text); line-height: 1.45; }
.hnp-ui a:link, .hnp-ui a:visited { color: var(--hnp-accent); text-decoration: none; }
.hnp-ui button { font: inherit; }
.hnp-gear { cursor: pointer; font-weight: 700; }
html.hnp .pagetop a.hnp-gear:link, html.hnp .pagetop a.hnp-gear:visited { color: var(--hnp-accent) !important; }

.hnp-card {
  position: fixed; z-index: 2147483000; width: min(440px, 92vw); max-height: 62vh; overflow: auto;
  background: var(--hnp-surface); border: 1px solid var(--hnp-border); border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0,0,0,.55); padding: 12px 14px; animation: hnp-pop .12s ease-out;
}
.hnp-card.hnp-preview { pointer-events: none; }
@keyframes hnp-pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.hnp-card .hnp-card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.hnp-card a.hnp-card-name:link, .hnp-card a.hnp-card-name:visited { font-weight: 750; font-size: 15px; color: var(--hnp-uc, var(--hnp-text)); }
.hnp-card .hnp-card-meta { color: var(--hnp-muted); font-size: 12px; }
.hnp-card .hnp-card-karma { color: var(--hnp-accent); font-weight: 700; }
.hnp-card .hnp-card-about { margin-top: 8px; color: var(--hnp-dim); max-height: 140px; overflow: auto; overflow-wrap: anywhere; font-size: 12.5px; }
.hnp-card .hnp-card-about p { margin: 6px 0 0; }
.hnp-card .hnp-card-text { color: var(--hnp-text); overflow-wrap: anywhere; margin-top: 6px; line-height: var(--hnp-lh); }
.hnp-card .hnp-card-text p { margin: 8px 0 0; }
.hnp-card .hnp-card-text pre { white-space: pre-wrap; }
.hnp-card .hnp-card-title { font-weight: 650; font-size: 14px; color: var(--hnp-text); }
.hnp-card .hnp-card-sep { border-top: 1px solid var(--hnp-border); margin: 10px 0; }
.hnp-card .hnp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.hnp-card .hnp-links { display: flex; gap: 12px; margin-top: 10px; font-size: 12px; }
.hnp-swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; background: var(--sw); outline: none; }
.hnp-swatch:hover { transform: scale(1.12); }
.hnp-swatch.on { border-color: var(--hnp-text); box-shadow: 0 0 0 2px var(--hnp-bg) inset; }
.hnp-swatch.none { background: transparent; border: 2px dashed var(--hnp-muted); }
.hnp-input, .hnp-ui input[type=text], .hnp-ui textarea, .hnp-ui select {
  background: var(--hnp-raised); color: var(--hnp-text); border: 1px solid var(--hnp-border); border-radius: 7px;
  padding: 5px 8px; font: inherit; outline: none; min-width: 0;
}
.hnp-ui input[type=text]:focus, .hnp-ui textarea:focus, .hnp-ui select:focus { border-color: var(--hnp-accent); box-shadow: 0 0 0 3px var(--hnp-accent-soft); }
.hnp-ui textarea { width: 100%; min-height: 90px; resize: vertical; font-family: var(--hnp-mono); font-size: 12px; }
.hnp-btn {
  background: var(--hnp-raised); color: var(--hnp-text); border: 1px solid var(--hnp-border); border-radius: 7px;
  padding: 5px 11px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.hnp-btn:hover { border-color: var(--hnp-accent); color: var(--hnp-accent); }
.hnp-btn.primary { background: var(--hnp-accent); color: var(--hnp-ink); border-color: var(--hnp-accent); }
.hnp-btn.primary:hover { filter: brightness(1.1); color: var(--hnp-ink); }
.hnp-btn.danger:hover { border-color: #ff4f4f; color: #ff4f4f; }
.hnp-btn.on { border-color: var(--hnp-accent); color: var(--hnp-accent); }

.hnp-overlay { position: fixed; inset: 0; z-index: 2147482000; background: rgba(0,0,0,.6); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: hnp-fade .12s; }
@keyframes hnp-fade { from { opacity: 0; } }
.hnp-panel { width: min(860px, 100%); height: min(640px, 100%); background: var(--hnp-surface); border: 1px solid var(--hnp-border); border-radius: 16px; box-shadow: 0 30px 80px rgba(0,0,0,.6); display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
.hnp-panel-head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--hnp-border); }
.hnp-panel-head h2 { margin: 0; font-size: 17px; font-weight: 800; color: var(--hnp-text); }
.hnp-panel-head h2 span { color: var(--hnp-accent); }
.hnp-panel-head .hnp-ver { color: var(--hnp-muted); font-size: 12px; }
.hnp-panel-head .hnp-close { margin-left: auto; }
.hnp-panel-body { display: grid; grid-template-columns: 170px 1fr; min-height: 0; }
.hnp-tabs { border-right: 1px solid var(--hnp-border); padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; background: var(--hnp-bg); }
.hnp-tab { text-align: left; background: none; border: 0; color: var(--hnp-dim); padding: 8px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; }
.hnp-tab:hover { color: var(--hnp-text); background: var(--hnp-raised); }
.hnp-tab.on { color: var(--hnp-accent); background: var(--hnp-accent-soft); }
.hnp-pane { padding: 6px 22px 22px; overflow: auto; }
.hnp-section { margin-top: 18px; }
.hnp-section > h3 { margin: 0 0 8px; font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--hnp-muted); }
.hnp-field { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid color-mix(in srgb, var(--hnp-border) 55%, transparent); }
.hnp-field:last-child { border-bottom: 0; }
.hnp-field-label { flex: 1; min-width: 0; }
.hnp-field-label b { display: block; font-weight: 600; color: var(--hnp-text); }
.hnp-field-label small { display: block; color: var(--hnp-muted); font-size: 12px; margin-top: 1px; }
.hnp-field.col { flex-direction: column; align-items: stretch; gap: 6px; }
.hnp-switch { position: relative; width: 36px; height: 20px; flex: none; border-radius: 999px; background: var(--hnp-raised); border: 1px solid var(--hnp-border); cursor: pointer; transition: background .15s; padding: 0; }
.hnp-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--hnp-muted); transition: transform .15s, background .15s; }
.hnp-switch.on { background: var(--hnp-accent); border-color: var(--hnp-accent); }
.hnp-switch.on::after { transform: translateX(16px); background: var(--hnp-ink); }
.hnp-seg { display: inline-flex; background: var(--hnp-bg); border: 1px solid var(--hnp-border); border-radius: 8px; padding: 2px; gap: 2px; flex-wrap: wrap; }
.hnp-seg button { background: none; border: 0; color: var(--hnp-dim); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; }
.hnp-seg button:hover { color: var(--hnp-text); }
.hnp-seg button.on { background: var(--hnp-raised); color: var(--hnp-accent); box-shadow: 0 0 0 1px var(--hnp-border); }
.hnp-range { display: flex; align-items: center; gap: 8px; }
.hnp-range input { accent-color: var(--hnp-accent); width: 160px; }
.hnp-range output { min-width: 42px; text-align: right; color: var(--hnp-dim); font-variant-numeric: tabular-nums; font-family: var(--hnp-mono); font-size: 12px; }
.hnp-colorin { width: 34px; height: 26px; padding: 0; border: 1px solid var(--hnp-border); border-radius: 6px; background: none; cursor: pointer; }
.hnp-colorin::-webkit-color-swatch-wrapper { padding: 2px; }
.hnp-colorin::-webkit-color-swatch { border: 0; border-radius: 4px; }
.hnp-tones { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.hnp-tone { display: flex; align-items: center; gap: 8px; background: var(--hnp-bg); border: 1px solid var(--hnp-border); border-radius: 8px; padding: 6px 8px; }
.hnp-tone span { flex: 1; color: var(--hnp-dim); font-size: 12px; }
.hnp-tone code { color: var(--hnp-muted); font-size: 11px; font-family: var(--hnp-mono); }
.hnp-themecards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.hnp-themecard { border: 1px solid var(--hnp-border); border-radius: 10px; padding: 8px; cursor: pointer; background: var(--t-bg); text-align: left; }
.hnp-themecard.on { border-color: var(--hnp-accent); box-shadow: 0 0 0 1px var(--hnp-accent); }
.hnp-themecard i { display: block; height: 30px; border-radius: 6px; background: var(--t-surface); border: 1px solid var(--t-border); position: relative; }
.hnp-themecard i::after { content: ""; position: absolute; left: 8px; right: 30%; top: 9px; height: 4px; border-radius: 2px; background: var(--t-text); box-shadow: 0 8px 0 -0.5px var(--t-muted); }
.hnp-themecard b { display: block; margin-top: 6px; color: var(--t-text); font-weight: 650; font-size: 12px; }
.hnp-swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.hnp-users { width: 100%; border-collapse: collapse; }
.hnp-users td { padding: 6px 6px; border-bottom: 1px solid color-mix(in srgb, var(--hnp-border) 55%, transparent); vertical-align: middle; font-size: 13px !important; color: var(--hnp-text) !important; }
.hnp-users input[type=text] { width: 100%; }
.hnp-empty { color: var(--hnp-muted); padding: 14px 0; }
.hnp-keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; align-items: center; }
.hnp-keys kbd { font-family: var(--hnp-mono); font-size: 12px; background: var(--hnp-raised); border: 1px solid var(--hnp-border); border-bottom-width: 2px; border-radius: 5px; padding: 1px 7px; color: var(--hnp-text); justify-self: start; }
.hnp-keys span { color: var(--hnp-dim); }
.hnp-swap-out { margin-top: 8px; padding: 8px 10px; border-radius: 7px; background: var(--hnp-bg); border: 1px dashed var(--hnp-border); color: var(--hnp-text); min-height: 34px; }
.hnp-btnrow { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

.hnp-fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147481000; display: flex; gap: 6px; align-items: center; background: var(--hnp-surface); border: 1px solid var(--hnp-border); border-radius: 999px; padding: 5px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.hnp-fab button { background: none; border: 0; color: var(--hnp-dim); min-width: 30px; height: 30px; border-radius: 999px; cursor: pointer; font-weight: 700; padding: 0 9px; }
.hnp-fab button:hover { background: var(--hnp-raised); color: var(--hnp-accent); }
.hnp-fab .hnp-fab-new { color: var(--hnp-ink); background: var(--hnp-accent); }
.hnp-fab .hnp-fab-new:hover { color: var(--hnp-ink); background: var(--hnp-accent); filter: brightness(1.1); }
.hnp-fab .hnp-sep { width: 1px; height: 18px; background: var(--hnp-border); }
.hnp-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483600; background: var(--hnp-raised); color: var(--hnp-text); border: 1px solid var(--hnp-border); border-left: 3px solid var(--hnp-accent); padding: 8px 14px; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.5); animation: hnp-pop .15s; }

@media (max-width: 750px) {
  .hnp-panel-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .hnp-tabs { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--hnp-border); }
  .hnp-themecards { grid-template-columns: repeat(2, 1fr); }
  html.hnp #hnmain > tbody > tr:first-child > td { border-radius: 0; }
}
`;

  function themeVars() {
    const t = S.tones;
    const accent = isHex(S.accent) ? S.accent : DEFAULTS.accent;
    const width = { classic: ['85%', 'none'], full: ['100%', 'none'], readable: ['100%', '1120px'] }[S.width] || ['100%', '1120px'];
    const font = (FONTS[S.font] || FONTS.sans).stack;
    return `:root {
  --hnp-bg: ${t.bg}; --hnp-surface: ${t.surface}; --hnp-raised: ${t.raised}; --hnp-border: ${t.border};
  --hnp-text: ${t.text}; --hnp-dim: ${t.dim}; --hnp-muted: ${t.muted};
  --hnp-accent: ${accent}; --hnp-ink: ${inkFor(accent)};
  --hnp-accent-soft: color-mix(in srgb, ${accent} 14%, transparent);
  --hnp-font: ${font}; --hnp-mono: ${MONO_STACK};
  --hnp-fs: ${S.fontSize}px; --hnp-fs-title: calc(${S.fontSize}px * 1.08); --hnp-fs-small: calc(${S.fontSize}px * .84);
  --hnp-lh: ${S.lineHeight};
  --hnp-width: ${width[0]}; --hnp-maxw: ${width[1]};
}`;
  }

  function mountStyle(id, css) {
    let st = document.getElementById(id);
    if (!st) {
      st = document.createElement('style');
      st.id = id;
      (document.head || document.documentElement).append(st);
    }
    if (st.textContent !== css) st.textContent = css;
    return st;
  }

  function ensureFontLink() {
    if (document.getElementById('hnp-fontlink')) return;
    const l = document.createElement('link');
    l.id = 'hnp-fontlink';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap';
    (document.head || document.documentElement).append(l);
  }

  /* =====================================================================
   * Christmas mode: snow, Santa hats, title ornaments, fairy lights
   * ===================================================================== */

  function isXmas() {
    if (S.xmas === 'on') return true;
    if (S.xmas !== 'auto') return false;
    const d = new Date();
    return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 6);
  }

  const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}")`;
  const X_RED = '#e5383b', X_GREEN = '#22a559', X_GOLD = '#fbbf24', X_SNOW = '#f8f8f8';

  const SANTA_HAT = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28">
    <path d="M5 21 C7 11 14 4 25 5 C27 5.3 28.5 6.5 28 8 C24 9 21.5 14 23 21 Z" fill="${X_RED}"/>
    <path d="M14 8 C18 5.5 22 5 25 5.4 C21.5 6.5 18.5 9 17 12 Z" fill="#ff6b6b" opacity=".55"/>
    <rect x="2" y="18.5" width="24" height="7.5" rx="3.75" fill="${X_SNOW}"/>
    <rect x="4" y="19.5" width="20" height="2" rx="1" fill="#ffffff"/>
    <circle cx="28" cy="8.5" r="3.6" fill="${X_SNOW}"/>
  </svg>`);

  const ORNAMENTS = {
    holly: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M8 9 C5 9 2.5 7.5 1 4.5 C2.5 4.8 3.2 4 3.5 3 C4.5 4 5.8 4.2 6.5 3.5 C6.8 5.5 7.6 7.5 8 9 Z" fill="${X_GREEN}"/>
      <path d="M8 9 C11 9 13.5 7.5 15 4.5 C13.5 4.8 12.8 4 12.5 3 C11.5 4 10.2 4.2 9.5 3.5 C9.2 5.5 8.4 7.5 8 9 Z" fill="#1c8a4a"/>
      <circle cx="6.6" cy="10.6" r="2" fill="${X_RED}"/><circle cx="9.6" cy="10.6" r="2" fill="${X_RED}"/><circle cx="8.1" cy="12.9" r="2" fill="#c81d25"/>
    </svg>`,
    bauble: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M8 .8 C9.4 .8 9.4 2.6 8 2.6" fill="none" stroke="${X_GOLD}" stroke-width=".9"/>
      <rect x="6.2" y="2.4" width="3.6" height="2.2" rx=".6" fill="${X_GOLD}"/>
      <circle cx="8" cy="10" r="5.6" fill="${X_RED}"/>
      <path d="M2.8 9.2 C5 10.6 11 10.6 13.2 9.2" fill="none" stroke="${X_GOLD}" stroke-width=".9"/>
      <circle cx="5.9" cy="7.9" r="1.4" fill="#fff" opacity=".55"/>
    </svg>`,
    star: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M8 .9 L10.1 5.6 L15.2 6.1 L11.4 9.5 L12.5 14.6 L8 12 L3.5 14.6 L4.6 9.5 L.8 6.1 L5.9 5.6 Z" fill="${X_GOLD}" stroke="#f59e0b" stroke-width=".6" stroke-linejoin="round"/>
      <path d="M8 3.2 L9.2 6.2 L8 8.6 Z" fill="#fff" opacity=".5"/>
    </svg>`,
    gift: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M8 4.6 C6.5 1.6 3.6 2.2 4.6 4.4 M8 4.6 C9.5 1.6 12.4 2.2 11.4 4.4" fill="none" stroke="${X_GOLD}" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="1.6" y="4.6" width="12.8" height="3.4" rx=".7" fill="#c81d25"/>
      <rect x="2.6" y="8" width="10.8" height="7" rx=".7" fill="${X_RED}"/>
      <rect x="7" y="4.6" width="2" height="10.4" fill="${X_GOLD}"/>
    </svg>`,
    cane: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M10 15 V6 A3.2 3.2 0 0 0 3.6 6" fill="none" stroke="${X_SNOW}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M10 15 V6 A3.2 3.2 0 0 0 3.6 6" fill="none" stroke="${X_RED}" stroke-width="2.6" stroke-dasharray="1.8 1.8"/>
    </svg>`,
    bell: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <path d="M8 1.6 C5 1.6 3.8 4 3.8 7 C3.8 9.6 3 11 1.8 12.2 H14.2 C13 11 12.2 9.6 12.2 7 C12.2 4 11 1.6 8 1.6 Z" fill="${X_GOLD}" stroke="#d99a06" stroke-width=".6"/>
      <circle cx="8" cy="13.4" r="1.6" fill="#d99a06"/>
      <path d="M5.6 4.4 C5 5.4 4.9 6.6 5 7.6" fill="none" stroke="#fff" stroke-width=".9" opacity=".6" stroke-linecap="round"/>
      <path d="M6.6 1.2 L8 2.6 L9.4 1.2" fill="none" stroke="${X_GREEN}" stroke-width="1.1"/>
    </svg>`,
  };
  // start / end ornament per row, cycled by data-hnp-xo
  const ORNAMENT_PAIRS = [['holly', 'bauble'], ['star', 'gift'], ['cane', 'bell'], ['bauble', 'holly'], ['gift', 'star'], ['bell', 'cane']];

  const XMAS_CSS = `
/* Santa hats */
html.hnp-xmas-hats a.hnp-user, html.hnp-xmas-hats #me { position: relative; margin-right: 5px; }
html.hnp-xmas-hats a.hnp-user::after, html.hnp-xmas-hats #me::after {
  content: ""; position: absolute; right: -11px; top: -.85em; width: 1.45em; height: 1.25em; pointer-events: none;
  background: ${SANTA_HAT} no-repeat center / contain; transform: rotate(22deg); filter: drop-shadow(0 1px 1px rgba(0,0,0,.45));
}
/* Title ornaments */
html.hnp-xmas-orn .titleline::before, html.hnp-xmas-orn .titleline > a::after {
  content: ""; display: inline-block; width: 1em; height: 1em; vertical-align: -.14em; background: no-repeat center / contain;
}
html.hnp-xmas-orn .titleline::before { margin-right: .4em; }
html.hnp-xmas-orn .titleline > a::after { margin-left: .4em; }
${ORNAMENT_PAIRS.map(([a, b], i) => `html.hnp-xmas-orn .titleline[data-hnp-xo="${i}"]::before { background-image: ${svgUrl(ORNAMENTS[a])}; }
html.hnp-xmas-orn .titleline[data-hnp-xo="${i}"] > a::after { background-image: ${svgUrl(ORNAMENTS[b])}; }`).join('\n')}
/* Fairy lights under the header */
html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td { position: relative; }
html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td::before,
html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td::after {
  content: ""; position: absolute; left: 16px; right: 16px; bottom: -6px; height: 10px; pointer-events: none;
  animation: hnp-twinkle 2.6s ease-in-out infinite;
}
html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td::before {
  background:
    radial-gradient(circle at 6px 5px, ${X_RED} 0 2.6px, transparent 3.2px) 0 0 / 48px 10px repeat-x,
    radial-gradient(circle at 30px 5px, ${X_GOLD} 0 2.6px, transparent 3.2px) 0 0 / 48px 10px repeat-x;
  filter: drop-shadow(0 0 3px rgba(255, 190, 120, .7));
}
html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td::after {
  background:
    radial-gradient(circle at 18px 5px, #34d17a 0 2.6px, transparent 3.2px) 0 0 / 48px 10px repeat-x,
    radial-gradient(circle at 42px 5px, #60a5fa 0 2.6px, transparent 3.2px) 0 0 / 48px 10px repeat-x;
  filter: drop-shadow(0 0 3px rgba(140, 200, 255, .7));
  animation-delay: -1.3s;
}
@keyframes hnp-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
/* Snow */
.hnp-snow { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147480000; }
@media (prefers-reduced-motion: reduce) {
  html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td::before,
  html.hnp-xmas-lights #hnmain > tbody > tr:first-child > td::after { animation: none; }
}
`;

  // ---- snow: one canvas, a few hundred dots at most, paused when the tab is hidden
  const SNOW_DENSITY = { light: 26000, medium: 12000, blizzard: 4500 }; // px² of viewport per flake
  let snow = null;

  function startSnow() {
    if (snow || !document.body) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = h('canvas', { class: 'hnp-snow', 'aria-hidden': 'true' });
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    const st = { canvas, raf: 0, flakes: [], w: 0, h: 0, last: 0 };
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      st.w = window.innerWidth;
      st.h = window.innerHeight;
      canvas.width = Math.round(st.w * dpr);
      canvas.height = Math.round(st.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const flake = (fromTop) => {
      const r = 0.7 + Math.random() ** 2 * 2.8; // mostly small, a few big ones
      return {
        x: Math.random() * st.w, y: fromTop ? -6 - Math.random() * 40 : Math.random() * st.h,
        r, vy: 0.35 + r * 0.32 + Math.random() * 0.35, sway: 0.2 + Math.random() * 0.6,
        ph: Math.random() * Math.PI * 2, freq: 0.6 + Math.random() * 1.2, o: 0.35 + Math.random() * 0.55,
      };
    };
    const frame = (t) => {
      const k = st.last ? Math.min(3, (t - st.last) / 16.7) : 1;
      st.last = t;
      const want = Math.round((st.w * st.h) / (SNOW_DENSITY[S.xmasSnowAmount] || SNOW_DENSITY.medium));
      while (st.flakes.length < want) st.flakes.push(flake(st.ready)); // first fill spreads over the screen
      st.ready = true;
      if (st.flakes.length > want) st.flakes.length = want;
      ctx.clearRect(0, 0, st.w, st.h);
      ctx.fillStyle = '#ffffff';
      const time = t / 1000;
      for (const f of st.flakes) {
        f.y += f.vy * k;
        f.x += Math.sin(time * f.freq + f.ph) * f.sway * k * 0.6;
        if (f.y > st.h + 6 || f.x < -10 || f.x > st.w + 10) Object.assign(f, flake(true));
        ctx.globalAlpha = f.o;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      st.raf = requestAnimationFrame(frame);
    };
    st.onResize = resize;
    st.onVis = () => {
      cancelAnimationFrame(st.raf);
      st.last = 0;
      if (document.visibilityState === 'visible') st.raf = requestAnimationFrame(frame);
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', st.onVis);
    resize();
    st.raf = requestAnimationFrame(frame);
    snow = st;
  }

  function stopSnow() {
    if (!snow) return;
    cancelAnimationFrame(snow.raf);
    window.removeEventListener('resize', snow.onResize);
    document.removeEventListener('visibilitychange', snow.onVis);
    snow.canvas.remove();
    snow = null;
  }

  function applyXmas() {
    if (!document.body) return;
    if (isXmas() && S.xmasSnow) startSnow(); else stopSnow();
    $$('.titleline').forEach((t, i) => { if (t.dataset.hnpXo == null) t.dataset.hnpXo = String(i % ORNAMENT_PAIRS.length); });
  }

  const HTML_FLAGS = {
    'hnp-sticky': () => S.stickyHeader,
    'hnp-rails': () => S.rails,
    'hnp-rainbow': () => S.rainbowRails,
    'hnp-railcollapse': () => S.railCollapse,
    'hnp-op': () => S.opBadge,
    'hnp-newmark': () => S.newMarkers,
    'hnp-quotes': () => S.quotes,
    'hnp-images': () => S.imageExpand,
    'hnp-self': () => S.highlightSelf,
    'hnp-newcounts': () => S.newCountBadge,
    'hnp-dimread': () => S.dimRead,
    'hnp-filter-dim': () => S.filterMode === 'dim',
    'hnp-xmas': () => isXmas(),
    'hnp-xmas-hats': () => isXmas() && S.xmasHats,
    'hnp-xmas-orn': () => isXmas() && S.xmasOrnaments,
    'hnp-xmas-lights': () => isXmas() && S.xmasLights,
  };

  function applyTheme() {
    const root = document.documentElement;
    root.classList.add('hnp');
    for (const [cls, on] of Object.entries(HTML_FLAGS)) root.classList.toggle(cls, !!on());
    for (const c of [...root.classList]) if (c.startsWith('hnp-swapfx-')) root.classList.remove(c);
    root.classList.add(`hnp-swapfx-${S.swapStyle || 'shine'}`);
    mountStyle('hnp-base', CSS_BASE);
    mountStyle('hnp-vars', themeVars());
    mountStyle('hnp-xmas', XMAS_CSS);
    ensureFontLink();
    applyXmas();
  }

  // Paint the dark theme before HN renders anything (no white flash).
  applyTheme();

  /* =====================================================================
   * Page model
   * ===================================================================== */

  const PAGE = {};
  let COMMENTS = [];   // comment <tr> rows in document order
  let STORIES = [];    // story <tr class="athing submission"> rows outside the item header

  function detectPage() {
    PAGE.path = location.pathname;
    PAGE.id = new URLSearchParams(location.search).get('id');
    PAGE.isItem = PAGE.path === '/item';
    PAGE.me = $('#me')?.textContent.trim() || null;
    PAGE.op = PAGE.isItem ? ($('.fatitem .subtext a[href^="user?id="]') && userFromLink($('.fatitem .subtext a[href^="user?id="]'))) : null;
    COMMENTS = $$('tr.athing').filter((r) => r.querySelector('td.default'));
    STORIES = $$('tr.athing.submission').filter((r) => !r.closest('.fatitem'));
  }

  const subRowOf = (story) => story.nextElementSibling;
  const isHidden = (row) => row.classList.contains('noshow') || row.offsetParent === null;
  const headerOffset = () => (S.stickyHeader ? ($('#hnmain > tbody > tr:first-child')?.getBoundingClientRect().height || 0) : 0) + 10;

  function scrollToRow(row, force) {
    const r = row.getBoundingClientRect();
    const top = headerOffset();
    if (force || r.top < top || r.bottom > window.innerHeight - 70) {
      window.scrollTo({ top: window.scrollY + r.top - top - 8, behavior: 'smooth' });
    }
  }

  /* =====================================================================
   * Header & toast
   * ===================================================================== */

  /* =====================================================================
   * Account menu & reply tracking
   * Replies come from the official API: your most recent submissions (stories
   * and comments) are scanned for direct children you haven't seen yet.
   * ===================================================================== */

  const REPLY_SCAN = 30;              // how many of your latest items to scan
  const REPLY_KEEP = 40;              // newest replies kept for the menu
  const REPLY_REFRESH = 3 * 60 * 1000;
  let REPLIES = null;                 // { user, checked, items: [...], seen: [ids] }
  let replyScan = null;               // in-flight scan promise
  let acctEl = null, acctTimer = 0, acctHideTimer = 0;

  const loadReplies = () => {
    const st = gmGet('replies', null);
    return st && st.user === PAGE.me ? st : null;
  };
  const unreadReplies = () => (REPLIES ? REPLIES.items.filter((r) => !REPLIES.seen.includes(r.id)) : []);

  function plainText(html, max = 220) {
    const t = new DOMParser().parseFromString(`<div>${(html || '').replace(/<p>/gi, ' ')}</div>`, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  async function mapPool(list, limit, fn) {
    const out = new Array(list.length);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        try { out[i] = await fn(list[i]); } catch { out[i] = null; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
    return out;
  }

  function markRepliesSeen(ids) {
    if (!REPLIES || !ids.length) return;
    const seen = new Set(REPLIES.seen);
    let changed = false;
    for (const id of ids) if (!seen.has(id)) { seen.add(id); changed = true; }
    if (!changed) return;
    REPLIES.seen = [...seen].sort((a, b) => b - a).slice(0, 1000);
    gmSet('replies', REPLIES);
    renderReplyBadge();
  }

  function scanReplies(force) {
    if (!PAGE.me || !S.replyTracking) return Promise.resolve();
    const cached = loadReplies();
    if (cached) REPLIES = cached;
    if (!force && cached && Date.now() - cached.checked < REPLY_REFRESH) { afterReplies(); return Promise.resolve(); }
    if (replyScan) return replyScan;
    replyScan = (async () => {
      const me = PAGE.me;
      const user = await api(`user/${encodeURIComponent(me)}`, true);
      const mine = (user?.submitted || []).slice(0, REPLY_SCAN);
      const parents = (await mapPool(mine, 8, (id) => api(`item/${id}`, true))).filter((it) => it && !it.deleted && !it.dead);
      const parentById = new Map(parents.map((it) => [it.id, it]));
      const kidIds = [...new Set(parents.flatMap((it) => it.kids || []))].sort((a, b) => b - a).slice(0, REPLY_KEEP);
      const known = new Map((cached?.items || []).map((r) => [r.id, r]));
      const fresh = await mapPool(kidIds.filter((id) => !known.has(id)), 8, (id) => api(`item/${id}`));
      const fetched = new Map(fresh.filter(Boolean).map((it) => [it.id, it]));
      const items = [];
      for (const id of kidIds) {
        if (known.has(id)) { items.push(known.get(id)); continue; }
        const it = fetched.get(id);
        if (!it || it.deleted || it.dead || it.by === me) continue;
        const parent = parentById.get(it.parent);
        items.push({
          id: it.id, by: it.by, time: it.time, parent: it.parent,
          text: plainText(it.text),
          on: parent ? (parent.title || plainText(parent.text, 90)) : '',
        });
      }
      // First scan ever: treat what already exists as read, so you only hear about new replies.
      const seen = cached ? cached.seen : items.map((r) => r.id);
      REPLIES = { user: me, checked: Date.now(), items, seen };
      gmSet('replies', REPLIES);
      afterReplies();
    })().catch((e) => console.warn('[hn+] reply scan failed', e)).finally(() => { replyScan = null; });
    return replyScan;
  }

  function afterReplies() {
    // Replies already visible on this page count as read.
    if (REPLIES) markRepliesSeen(REPLIES.items.filter((r) => document.getElementById(String(r.id))?.classList.contains('hnp-c')).map((r) => r.id));
    renderReplyBadge();
    if (acctEl) renderAccountMenu();
  }

  function renderReplyBadge() {
    const me = $('#me');
    if (!me) return;
    let badge = $('.hnp-replybadge');
    const n = S.replyTracking ? unreadReplies().length : 0;
    if (!n) { badge?.remove(); return; }
    if (!badge) {
      badge = h('a', { class: 'hnp-replybadge', href: '#', title: 'New replies to you' });
      badge.addEventListener('click', (e) => { e.preventDefault(); openAccountMenu(me); });
      me.after(badge);
    }
    badge.textContent = String(n);
    badge.title = `${n} new repl${n === 1 ? 'y' : 'ies'} to you`;
  }

  function renderAccountMenu() {
    const meLink = $('#me');
    if (!acctEl || !meLink) return;
    const me = PAGE.me;
    const enc = encodeURIComponent(me);
    const karma = $('#karma')?.textContent.trim();
    const logout = $('#logout')?.getAttribute('href');
    const unread = new Set(unreadReplies().map((r) => r.id));

    const refresh = h('button', { type: 'button', title: 'Check for replies now' }, replyScan ? 'checking…' : 'refresh');
    refresh.addEventListener('click', () => { scanReplies(true); renderAccountMenu(); });
    const readAll = h('button', { type: 'button', title: 'Mark every reply as read' }, 'mark read');
    readAll.addEventListener('click', () => { markRepliesSeen([...unread]); renderAccountMenu(); });

    const head = h('div', { class: 'hnp-acct-head' },
      h('b', {}, me),
      karma && h('span', { class: 'hnp-card-karma' }, `${karma} karma`),
      h('span', { class: 'hnp-acct-tools' }, S.replyTracking && unread.size ? readAll : null, S.replyTracking ? refresh : null));

    let replies = null;
    if (S.replyTracking) {
      const list = REPLIES?.items || [];
      replies = h('div', { class: 'hnp-acct-replies' },
        h('div', { class: 'hnp-acct-label' }, 'Replies to you', unread.size ? h('span', {}, `${unread.size} new`) : null),
        !REPLIES ? h('div', { class: 'hnp-acct-empty' }, 'Checking your recent comments for replies…')
          : !list.length ? h('div', { class: 'hnp-acct-empty' }, `No replies to your last ${REPLY_SCAN} posts yet.`)
            : list.map((r) => {
              const a = h('a', { class: `hnp-reply${unread.has(r.id) ? ' unread' : ''}`, href: `item?id=${r.parent}#${r.id}` },
                h('div', { class: 'hnp-reply-meta' }, h('b', {}, USERS[r.by]?.alias || r.by), ` · ${timeAgo(r.time)}`),
                h('div', { class: 'hnp-reply-text' }, swapString(r.text)),
                r.on && h('div', { class: 'hnp-reply-on' }, `on: ${r.on}`));
              a.addEventListener('click', () => markRepliesSeen([r.id]));
              return a;
            }));
    }

    const link = (href, label) => h('a', { href }, label);
    const pair = (label, a, b) => h('div', { class: 'hnp-acct-pair' }, h('span', {}, label), a, '·', b);
    const links = h('div', { class: 'hnp-acct-links' },
      link(`user?id=${enc}`, 'Profile'),
      link(`threads?id=${enc}`, 'Comments'),
      link(`submitted?id=${enc}`, 'Submissions'),
      link('hidden', 'Hidden'),
      pair('Upvoted', link(`upvoted?id=${enc}`, 'stories'), link(`upvoted?id=${enc}&comments=t`, 'comments')),
      pair('Favorites', link(`favorites?id=${enc}`, 'stories'), link(`favorites?id=${enc}&comments=t`, 'comments')),
      link(`flagged?id=${enc}`, 'Flagged'),
      link('changepw', 'Change password'),
      logout && h('a', { class: 'hnp-acct-logout', href: logout }, 'Log out'));

    acctEl.replaceChildren(head, replies, links);
  }

  function openAccountMenu(anchor) {
    if (!S.accountMenu || !PAGE.me) return;
    clearTimeout(acctHideTimer);
    if (acctEl) return;
    acctEl = h('div', { class: 'hnp-ui hnp-card hnp-acct' });
    acctEl.addEventListener('mouseenter', () => clearTimeout(acctHideTimer));
    acctEl.addEventListener('mouseleave', () => { acctHideTimer = setTimeout(closeAccountMenu, 300); });
    renderAccountMenu();
    document.body.append(acctEl);
    const r = anchor.getBoundingClientRect();
    const header = $('#hnmain > tbody > tr:first-child > td')?.getBoundingClientRect();
    acctEl.style.top = `${Math.max(r.bottom, header ? header.bottom : r.bottom) + 6}px`;
    acctEl.style.left = `${Math.max(8, Math.min(r.right - acctEl.offsetWidth + 40, window.innerWidth - acctEl.offsetWidth - 8))}px`;
    if (S.replyTracking && (!REPLIES || Date.now() - REPLIES.checked > 60 * 1000)) scanReplies(true).then(() => acctEl && renderAccountMenu());
  }

  function closeAccountMenu() {
    acctEl?.remove();
    acctEl = null;
  }

  function setupAccount() {
    const me = $('#me');
    if (!me || !PAGE.me) return;
    const enter = () => { clearTimeout(acctHideTimer); clearTimeout(acctTimer); acctTimer = setTimeout(() => openAccountMenu(me), 120); };
    const leave = () => { clearTimeout(acctTimer); acctHideTimer = setTimeout(closeAccountMenu, 300); };
    me.addEventListener('mouseenter', enter);
    me.addEventListener('mouseleave', leave);
    document.addEventListener('mousedown', (e) => {
      if (acctEl && !(e.target instanceof Element && e.target.closest('.hnp-acct, #me, .hnp-replybadge'))) closeAccountMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAccountMenu(); });
    scanReplies(false);
    setInterval(() => { if (document.visibilityState === 'visible') scanReplies(false); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scanReplies(false); });
  }

  function enhanceHeader() {
    const tops = $$('#hnmain > tbody > tr:first-child .pagetop');
    const right = tops[tops.length - 1];
    if (!right || right.querySelector('.hnp-gear')) return;
    const gear = h('a', { class: 'hnp-gear', href: '#', title: 'HN+ settings (,)', onclick: (e) => { e.preventDefault(); openSettings(); } }, 'hn+');
    right.prepend(gear, ' | ');
  }

  function toast(msg, ms = 1600) {
    $('.hnp-toast')?.remove();
    const t = h('div', { class: 'hnp-ui hnp-toast', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  }

  /* =====================================================================
   * Stories (lists)
   * ===================================================================== */

  function processStories() {
    const seen = loadSeen();
    for (const story of STORIES) {
      const sub = subRowOf(story);
      if (sub) sub.classList.add('hnp-sub');
      const id = story.id;
      const prev = seen[id];
      story.classList.toggle('hnp-read', !!prev);
      if (prev && sub && !sub.querySelector('.hnp-newcount')) {
        const link = $$('a[href^="item?id="]', sub).find((a) => /comment|discuss/i.test(a.textContent));
        const n = link ? parseInt(link.textContent, 10) : NaN;
        if (Number.isFinite(n) && prev.n != null && n > prev.n) {
          link.after(h('span', { class: 'hnp-newcount', title: 'New since your last visit' }, `+${n - prev.n}`));
        }
      }
    }
  }

  function applyNewTab() {
    for (const a of $$('.titleline > a, .commtext a, .toptext a')) {
      const external = /^https?:\/\//i.test(a.getAttribute('href') || '') && !/^https?:\/\/news\.ycombinator\.com/i.test(a.href);
      if (!external) continue;
      if (S.newTab) { a.target = '_blank'; a.rel = 'noopener'; a.dataset.hnpNt = '1'; }
      else if (a.dataset.hnpNt) { a.removeAttribute('target'); delete a.dataset.hnpNt; }
    }
  }

  function applyFavicons() {
    for (const story of $$('tr.athing.submission')) {
      const a = $('.titleline > a', story);
      const existing = $('.hnp-fav', story);
      if (!S.favicons) { existing?.remove(); continue; }
      if (existing || !a || !/^https?:/i.test(a.getAttribute('href') || '')) continue;
      let host;
      try { host = new URL(a.href).hostname; } catch { continue; }
      a.before(h('img', { class: 'hnp-fav', src: `https://icons.duckduckgo.com/ip3/${host}.ico`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }));
    }
  }

  function compileFilters() {
    const kw = S.filterKeywords.split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
      const m = /^\/(.+)\/([a-z]*)$/.exec(line);
      if (m) { try { return new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i'); } catch { return null; } }
      const lower = line.toLowerCase();
      return { test: (s) => s.toLowerCase().includes(lower) };
    }).filter(Boolean);
    const domains = S.filterDomains.split('\n').map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')).filter(Boolean);
    return { kw, domains };
  }

  function applyFilters() {
    const { kw, domains } = compileFilters();
    let count = 0;
    for (const story of STORIES) {
      const sub = subRowOf(story);
      const title = $('.titleline > a', story)?.textContent || '';
      const site = ($('.sitestr', story)?.textContent || '').toLowerCase();
      const host = site.split('/')[0];
      const author = sub && $('a[href^="user?id="]', sub) ? userFromLink($('a[href^="user?id="]', sub)) : null;
      const hit = kw.some((r) => r.test(title))
        || domains.some((d) => host === d || host.endsWith('.' + d) || site.startsWith(d))
        || (author && USERS[author]?.muted);
      const rows = [story, sub, sub?.nextElementSibling?.classList.contains('spacer') ? sub.nextElementSibling : null];
      for (const r of rows) r?.classList.toggle('hnp-filtered', !!hit);
      if (hit) count++;
    }
    const tops = $$('#hnmain > tbody > tr:first-child .pagetop');
    const left = tops[0];
    let badge = $('.hnp-filtercount');
    if (count && left && S.filterMode === 'hide') {
      if (!badge) {
        badge = h('span', { class: 'hnp-filtercount', title: 'Click to show/hide filtered stories', onclick: () => document.documentElement.classList.toggle('hnp-show-filtered') });
        left.append(' | ', badge);
      }
      badge.textContent = `${count} filtered`;
    } else if (badge) {
      badge.previousSibling?.nodeType === Node.TEXT_NODE && badge.previousSibling.remove();
      badge.remove();
    }
  }

  /* =====================================================================
   * Comments
   * ===================================================================== */

  const IMG_RE = /\.(png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i;

  function processComments() {
    for (const row of COMMENTS) {
      if (row.dataset.hnpDone) continue;
      row.dataset.hnpDone = '1';
      row.classList.add('hnp-c');
      const d = parseInt($('td.ind', row)?.getAttribute('indent') || '0', 10) || 0;
      row.dataset.hnpD = d;
      row.dataset.hnpDm = d % 6;
      const td = $('td.default', row);
      if (td && $('a.togg', row)) td.prepend(h('span', { class: 'hnp-rail', title: 'Collapse / expand thread' }));

      const author = $('.comhead a[href^="user?id="]', row);
      const name = author && userFromLink(author);
      if (author && name && PAGE.op && name === PAGE.op) author.after(h('span', { class: 'hnp-badge hnp-badge-op', title: 'Original poster' }, 'OP'));
      if (author && name && PAGE.me && name === PAGE.me) {
        row.classList.add('hnp-mine');
        author.after(h('span', { class: 'hnp-badge hnp-badge-you' }, 'YOU'));
      }

      const ct = $('.commtext', row);
      if (ct) { processQuotes(ct); processImages(ct); }
    }
  }

  function processQuotes(ct) {
    const lead = [];
    for (const n of ct.childNodes) { if (n.nodeName === 'P' || n.nodeName === 'PRE') break; lead.push(n); }
    if (lead.length && lead.map((n) => n.textContent).join('').trimStart().startsWith('>')) {
      const span = h('span', { class: 'hnp-quote' });
      ct.insertBefore(span, lead[0]);
      span.append(...lead);
    }
    for (const p of $$(':scope > p', ct)) if (p.textContent.trimStart().startsWith('>')) p.classList.add('hnp-quote');
  }

  function processImages(ct) {
    for (const a of $$('a[href]', ct)) {
      if (!IMG_RE.test(a.href) || a.nextElementSibling?.classList.contains('hnp-imgbtn')) continue;
      const btn = h('button', { class: 'hnp-imgbtn', type: 'button', title: 'Show image inline' }, 'img');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const next = btn.nextElementSibling;
        if (next?.classList.contains('hnp-img')) { next.remove(); btn.classList.remove('on'); return; }
        const img = h('img', { class: 'hnp-img', src: a.href, alt: '', referrerpolicy: 'no-referrer', title: 'Click to hide' });
        img.addEventListener('click', () => { img.remove(); btn.classList.remove('on'); });
        btn.after(img);
        btn.classList.add('on');
      });
      a.after(btn);
    }
  }

  // New-comment tracking. HN item ids are global and increasing, so "new since last
  // visit" is simply any comment id greater than the highest id we saw last time.
  let NEW_ROWS = [];
  function trackItem() {
    if (!PAGE.isItem || !PAGE.id) return;
    const seen = loadSeen();
    const prev = seen[PAGE.id];
    let max = prev?.max || 0;
    NEW_ROWS = [];
    for (const row of COMMENTS) {
      const id = +row.id;
      if (prev && id > prev.max) {
        row.classList.add('hnp-new');
        NEW_ROWS.push(row);
        const age = $('.comhead .age', row);
        if (age && !$('.hnp-badge-new', row)) age.after(h('span', { class: 'hnp-badge hnp-badge-new' }, 'NEW'));
      }
      if (id > max) max = id;
    }
    const countLink = $$('.fatitem .subtext a[href^="item?id="]').find((a) => /comment|discuss/i.test(a.textContent));
    const n = countLink ? (parseInt(countLink.textContent, 10) || 0) : COMMENTS.length;
    seen[PAGE.id] = { max, n, t: Date.now() };
    saveSeen(seen);
  }

  /* =====================================================================
   * Word swaps
   * Whole-word, case-insensitive: "cat" matches Cat / cAt / CAT, never "category".
   * The replacement copies the matched word's capitalisation. Original text is
   * remembered per text node, so editing or removing a swap reverts cleanly.
   * ===================================================================== */

  const SWAP_SCOPES = '.titleline > a, .commtext, .toptext, .hnp-card-title, .hnp-card-text';
  const SWAP_SKIP = 'pre, code, a.hnp-user, .hnp-badge, .hnp-tag, .hnp-imgbtn, .hnp-rail, .hnp-swap, .hnp-noteicon';
  let swapRecords = []; // { orig: Text, parts: Node[] } so every swap can be undone exactly
  let swapCache = { key: null, rx: null };

  const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function compileSwaps() {
    const rules = (Array.isArray(S.swaps) ? S.swaps : [])
      .map((r) => ({ from: String(r?.from ?? '').trim().replace(/\s+/g, ' '), to: String(r?.to ?? '') }))
      .filter((r) => r.from);
    const key = JSON.stringify(rules);
    if (swapCache.key === key) return swapCache.rx;
    let rx = null;
    if (rules.length) {
      const map = new Map();
      for (const r of rules) map.set(r.from.toLowerCase(), r.to); // later rules win on duplicates
      const alt = [...map.keys()].sort((a, b) => b.length - a.length)
        .map((k) => k.split(' ').map(escapeRe).join('\\s+')).join('|');
      rx = { re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alt})(?![\\p{L}\\p{N}_])`, 'giu'), map };
    }
    swapCache = { key, rx };
    return rx;
  }

  function matchCase(src, to) {
    const hasCase = (c) => c.toUpperCase() !== c.toLowerCase();
    const letters = [...src].filter(hasCase);
    if (letters.length > 1 && letters.every((c) => c === c.toUpperCase())) return to.toUpperCase();
    if (letters.length && letters[0] === letters[0].toUpperCase()) return to.charAt(0).toUpperCase() + to.slice(1);
    return to;
  }

  // Split text into plain text nodes and <span class="hnp-swap"> nodes. Returns null when nothing matches.
  function swapParts(text, rx = compileSwaps()) {
    if (!rx || !text) return null;
    const parts = [];
    let last = 0;
    rx.re.lastIndex = 0;
    for (let m = rx.re.exec(text); m; m = rx.re.exec(text)) {
      const to = rx.map.get(m[0].toLowerCase().replace(/\s+/g, ' '));
      if (to === undefined) continue;
      if (m.index > last) parts.push(document.createTextNode(text.slice(last, m.index)));
      parts.push(h('span', { class: 'hnp-swap', title: `Swapped: ${m[0]}` }, matchCase(m[0], to)));
      last = m.index + m[0].length;
    }
    if (!parts.length) return null;
    if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
    return parts;
  }

  function swapString(text) {
    const parts = swapParts(text);
    return parts ? parts.map((n) => n.textContent).join('') : text;
  }

  function revertSwaps() {
    for (const rec of swapRecords) {
      const first = rec.parts[0];
      if (!first?.isConnected) continue;
      first.before(rec.orig);
      for (const n of rec.parts) n.remove();
    }
    swapRecords = [];
  }

  // root === document: undo everything and re-apply with the current rules.
  // Any other root (a freshly built preview card): only swap inside it.
  function applySwaps(root = document) {
    if (root === document) revertSwaps();
    const rx = compileSwaps();
    if (!rx) return;
    const scopes = $$(SWAP_SCOPES, root);
    if (root instanceof Element && root.matches(SWAP_SCOPES)) scopes.push(root);
    const nodes = [];
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest(SWAP_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    }
    for (const n of nodes) {
      const parts = swapParts(n.nodeValue, rx);
      if (!parts) continue;
      n.replaceWith(...parts);
      swapRecords.push({ orig: n, parts });
    }
  }

  /* =====================================================================
   * Users: highlight, tag, mute
   * ===================================================================== */

  function setUserVar(el, color) {
    if (color) el.style.setProperty('--hnp-uc', color); else el.style.removeProperty('--hnp-uc');
  }

  function decorateUsers() {
    for (const a of $$('a[href^="user?id="]')) {
      if (a.closest('.pagetop, .hnp-ui')) continue;
      const name = userFromLink(a);
      if (!name) continue;
      const u = USERS[name];
      if (!a.dataset.hnpUser) { a.dataset.hnpUser = name; a.dataset.hnpText = a.textContent; }
      a.classList.add('hnp-user');

      // alias replaces the visible name; the real handle stays in the tooltip and the card
      const shown = u?.alias || a.dataset.hnpText;
      if (a.textContent !== shown) a.textContent = shown;
      a.classList.toggle('hnp-aliased', !!u?.alias);
      if (u?.alias) a.title = name; else a.removeAttribute('title');

      a.classList.toggle('hnp-hl', !!u?.color);
      setUserVar(a, u?.color);

      let icon = a.nextElementSibling?.classList.contains('hnp-noteicon') ? a.nextElementSibling : null;
      if (u?.note) {
        if (!icon) { icon = h('span', { class: 'hnp-noteicon', 'aria-label': 'You have notes on this user' }, '✎'); a.after(icon); }
      } else if (icon) { icon.remove(); icon = null; }

      const anchor = icon || a;
      let tag = anchor.nextElementSibling?.classList.contains('hnp-tag') ? anchor.nextElementSibling : null;
      if (u?.tag) {
        if (!tag) { tag = h('span', { class: 'hnp-tag' }); anchor.after(tag); }
        tag.textContent = u.tag;
        setUserVar(tag, u.color);
      } else tag?.remove();

      const crow = a.closest('.comhead') && a.closest('tr.hnp-c');
      if (crow) {
        crow.classList.toggle('hnp-hl-row', !!u?.color);
        setUserVar(crow, u?.color);
        crow.classList.toggle('hnp-muted', !!u?.muted);
        const head = $('.comhead', crow);
        let mb = $('.hnp-mutebtn', head);
        if (u?.muted && !mb) {
          mb = h('button', { class: 'hnp-badge hnp-mutebtn', type: 'button', title: 'Show/hide this muted comment' }, 'muted');
          mb.addEventListener('click', () => crow.classList.toggle('hnp-reveal'));
          head.append(mb);
        } else if (!u?.muted && mb) { mb.remove(); crow.classList.remove('hnp-reveal'); }
      }

      const sub = a.closest('td.subtext');
      if (sub) {
        const srow = sub.parentElement;
        const arow = srow.previousElementSibling;
        for (const r of [srow, arow]) {
          if (!r) continue;
          r.classList.toggle('hnp-hl-row', !!u?.color);
          setUserVar(r, u?.color);
        }
      }
    }
  }

  function updateUser(name, patch) {
    USERS[name] = { ...(USERS[name] || {}), ...patch };
    saveUsers();
    decorateUsers();
    applyFilters();
  }

  /* =====================================================================
   * Hover cards: users and item previews
   * ===================================================================== */

  let cardEl = null, cardKey = null, showTimer = 0, hideTimer = 0;

  function placeCard(card, anchor) {
    const r = anchor.getBoundingClientRect();
    card.style.left = '0px';
    card.style.top = '0px';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - cw - 12);
    let top = r.bottom + 8;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function hideCard(force) {
    if (!cardEl) return;
    if (!force && cardEl.contains(document.activeElement)) return;
    cardEl.remove();
    cardEl = null;
    cardKey = null;
  }

  function showCard(key, anchor, build, interactive) {
    hideCard(true);
    const card = h('div', { class: `hnp-ui hnp-card${interactive ? '' : ' hnp-preview'}` });
    cardEl = card;
    cardKey = key;
    document.body.append(card);
    build(card, () => cardEl === card && anchor.isConnected && placeCard(card, anchor));
    placeCard(card, anchor);
  }

  function buildUserCard(name) {
    return (card, reflow) => {
      const u = USERS[name] || {};
      setUserVar(card, u.color);
      const enc = encodeURIComponent(name);
      const title = h('a', { class: 'hnp-card-name', href: `user?id=${enc}` }, u.alias || name);
      const handle = h('span', { class: 'hnp-card-handle' }, u.alias ? `@${name}` : '');
      const meta = h('span', { class: 'hnp-card-meta' }, 'loading…');
      const head = h('div', { class: 'hnp-card-head' }, title, handle, meta);

      // Notes come first: this is the popup the user wants to see on hover.
      const notes = h('textarea', { class: 'hnp-card-notes', placeholder: 'Private notes about this user…', value: u.note || '', spellcheck: 'true' });
      const saveNotes = () => {
        const v = notes.value.trim();
        if ((USERS[name]?.note || '') !== v) updateUser(name, { note: v });
      };
      notes.addEventListener('input', debounce(saveNotes, 400));
      notes.addEventListener('blur', saveNotes);
      notes.addEventListener('keydown', (e) => { if (e.key === 'Escape') notes.blur(); e.stopPropagation(); });

      const about = h('div', { class: 'hnp-card-about' });
      card.append(head, notes, about);

      api(`user/${enc}`).then((d) => {
        if (!d) { meta.textContent = 'no profile'; return; }
        meta.replaceChildren(
          h('span', { class: 'hnp-card-karma' }, `${(d.karma || 0).toLocaleString()} karma`),
          ` · joined ${timeAgo(d.created)}`);
        if (d.about) sanitizeInto(d.about, about);
        reflow();
      }).catch(() => { meta.textContent = 'could not load profile'; });

      const swatches = h('div', { class: 'hnp-swatches' });
      const renderSwatches = () => {
        const cur = (USERS[name] || {}).color;
        swatches.replaceChildren(
          h('button', { class: `hnp-swatch none${cur ? '' : ' on'}`, type: 'button', title: 'No highlight', onclick: () => { updateUser(name, { color: null }); setUserVar(card, null); renderSwatches(); } }),
          ...USER_COLORS.map((c) => h('button', {
            class: `hnp-swatch${cur === c ? ' on' : ''}`, type: 'button', title: `Highlight ${c}`, style: { '--sw': c },
            onclick: () => { updateUser(name, { color: c }); setUserVar(card, c); renderSwatches(); },
          })),
          h('input', {
            class: 'hnp-colorin', type: 'color', value: cur || '#ff6600', title: 'Custom colour',
            onchange: (e) => { updateUser(name, { color: e.target.value }); setUserVar(card, e.target.value); renderSwatches(); },
          }));
      };
      renderSwatches();

      const textField = (key, placeholder, after) => {
        const inp = h('input', { type: 'text', placeholder, value: u[key] || '', style: { flex: '1' } });
        const save = () => {
          const v = inp.value.trim();
          if ((USERS[name]?.[key] || '') !== v) { updateUser(name, { [key]: v }); after?.(v); }
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { save(); inp.blur(); } if (e.key === 'Escape') inp.blur(); e.stopPropagation(); });
        inp.addEventListener('blur', save);
        return inp;
      };
      const aliasIn = textField('alias', 'Alias (shown instead of name)', (v) => {
        title.textContent = v || name;
        handle.textContent = v ? `@${name}` : '';
      });
      const tagIn = textField('tag', 'Tag (pill next to name)');

      const muteBtn = h('button', { class: `hnp-btn${u.muted ? ' on' : ''}`, type: 'button' }, u.muted ? 'Muted' : 'Mute');
      muteBtn.addEventListener('click', () => {
        const m = !(USERS[name] || {}).muted;
        updateUser(name, { muted: m });
        muteBtn.textContent = m ? 'Muted' : 'Mute';
        muteBtn.classList.toggle('on', m);
      });

      card.append(
        h('div', { class: 'hnp-card-sep' }),
        h('div', { class: 'hnp-row' }, aliasIn, tagIn),
        h('div', { class: 'hnp-row' }, swatches, h('span', { style: { flex: '1' } }), muteBtn),
        h('div', { class: 'hnp-links' },
          h('a', { href: `submitted?id=${enc}` }, 'submissions'),
          h('a', { href: `threads?id=${enc}` }, 'comments'),
          h('a', { href: `favorites?id=${enc}` }, 'favorites')));
    };
  }

  function cleanClone(node) {
    const c = node.cloneNode(true);
    for (const x of $$('[id]', c)) x.removeAttribute('id');
    for (const x of $$('.reply, .navs, .hnp-rail, .votelinks, .hnp-imgbtn, .hnp-mutebtn', c)) x.remove();
    for (const x of $$('br', c)) if (x.parentElement === c) x.remove();
    return c;
  }

  function buildItemPreview(id) {
    return (card, reflow) => {
      const local = document.getElementById(id);
      if (local && local.classList.contains('hnp-c')) {
        const td = $('td.default', local);
        const c = cleanClone(td);
        c.style.padding = '0';
        card.append(c);
        return;
      }
      const body = h('div', { class: 'hnp-card-meta' }, 'loading…');
      card.append(body);
      api(`item/${id}`).then((d) => {
        if (!d) { body.textContent = 'not found'; return; }
        const kids = [];
        const meta = [d.by && `by ${d.by}`, d.time && timeAgo(d.time), d.score != null && `${d.score} points`, d.descendants != null && `${d.descendants} comments`].filter(Boolean).join(' · ');
        if (d.title) kids.push(h('div', { class: 'hnp-card-title' }, d.title));
        kids.push(h('div', { class: 'hnp-card-meta' }, (d.deleted ? '[deleted] ' : '') + (d.dead ? '[dead] ' : '') + meta));
        if (d.text) kids.push(sanitizeInto(d.text, h('div', { class: 'hnp-card-text' })));
        body.replaceWith(...kids);
        applySwaps(card);
        reflow();
      }).catch(() => { body.textContent = 'could not load item'; });
    };
  }

  function previewTargetId(a) {
    if (a.closest('.hnp-ui, .age, .subtext, .titleline, .pagetop')) return null;
    const href = a.getAttribute('href') || '';
    let id = null;
    if (/^#\d+$/.test(href)) id = href.slice(1);
    else id = itemIdFromHref(href);
    if (!id || id === PAGE.id) return null;
    if (a.closest('tr.athing')?.id === id) return null;
    if (/#\d+$/.test(href) && !href.startsWith('#')) return null; // "context" links
    return id;
  }

  function setupHover() {
    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.hnp-card:not(.hnp-preview)')) { clearTimeout(hideTimer); return; }
      const a = t.closest('a');
      if (!a) return;

      if (a.classList.contains('hnp-user') && S.userCards) {
        clearTimeout(hideTimer);
        const key = `u:${a.dataset.hnpUser}`;
        if (cardKey === key) return;
        clearTimeout(showTimer);
        showTimer = setTimeout(() => showCard(key, a, buildUserCard(a.dataset.hnpUser), true), 380);
        return;
      }

      if (S.hoverPreviews) {
        const id = previewTargetId(a);
        if (!id || cardKey === `i:${id}`) return;
        const local = document.getElementById(id);
        if (local?.classList.contains('hnp-c') && !isHidden(local)) {
          const r = local.getBoundingClientRect();
          if (r.top >= headerOffset() && r.bottom <= window.innerHeight) {
            local.classList.remove('hnp-flash');
            void local.offsetWidth;
            local.classList.add('hnp-flash');
            return;
          }
        }
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        showTimer = setTimeout(() => showCard(`i:${id}`, a, buildItemPreview(id), false), 160);
      }
    });

    document.addEventListener('mouseout', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const from = t.closest('a, .hnp-card');
      if (!from) return;
      if (e.relatedTarget instanceof Node && from.contains(e.relatedTarget)) return;
      clearTimeout(showTimer);
      const interactive = cardEl && !cardEl.classList.contains('hnp-preview');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => hideCard(false), interactive ? 280 : 0);
    });

    document.addEventListener('mousedown', (e) => {
      if (cardEl && !(e.target instanceof Element && e.target.closest('.hnp-card'))) hideCard(true);
    });
    window.addEventListener('scroll', () => { if (cardEl?.classList.contains('hnp-preview')) hideCard(true); }, { passive: true });

    // Click on a comment's rail to collapse it.
    document.addEventListener('click', (e) => {
      const rail = e.target instanceof Element && e.target.closest('.hnp-rail');
      if (!rail || !S.railCollapse) return;
      e.preventDefault();
      const row = rail.closest('tr.hnp-c');
      toggleComment(row);
      if (row.getBoundingClientRect().top < headerOffset()) scrollToRow(row, true);
    });
  }

  function toggleComment(row) {
    $('a.togg', row)?.click();
  }

  /* =====================================================================
   * Keyboard navigation
   * ===================================================================== */

  let SEL = null;

  function select(row, scroll = true) {
    SEL?.classList.remove('hnp-sel');
    SEL = row;
    if (!row) return;
    row.classList.add('hnp-sel');
    if (scroll) scrollToRow(row);
  }

  function visibleComments() { return COMMENTS.filter((r) => !isHidden(r)); }
  function visibleStories() { return STORIES.filter((r) => !isHidden(r)); }

  function firstInView(rows) {
    const top = headerOffset();
    return rows.find((r) => r.getBoundingClientRect().bottom > top) || rows[0];
  }

  function step(rows, dir) {
    if (!rows.length) return;
    if (!SEL || !rows.includes(SEL)) {
      const f = firstInView(rows);
      select(dir > 0 ? f : rows[Math.max(0, rows.indexOf(f) - 1)]);
      return;
    }
    const i = rows.indexOf(SEL) + dir;
    if (i >= 0 && i < rows.length) select(rows[i]);
  }

  function jumpNew(dir) {
    const rows = NEW_ROWS.filter((r) => !isHidden(r));
    if (!rows.length) { toast('No new comments'); return; }
    const top = headerOffset() + 12;
    const ref = SEL && COMMENTS.includes(SEL) ? COMMENTS.indexOf(SEL) : null;
    let target;
    if (dir > 0) target = rows.find((r) => (ref != null ? COMMENTS.indexOf(r) > ref : r.getBoundingClientRect().top > top));
    else target = [...rows].reverse().find((r) => (ref != null ? COMMENTS.indexOf(r) < ref : r.getBoundingClientRect().top < top - 4));
    if (!target) { toast(dir > 0 ? 'No more new comments below' : 'No new comments above'); return; }
    select(target, false);
    scrollToRow(target, true);
  }

  function parentOf(row) {
    const d = +row.dataset.hnpD;
    for (let i = COMMENTS.indexOf(row) - 1; i >= 0; i--) if (+COMMENTS[i].dataset.hnpD < d) return COMMENTS[i];
    return null;
  }

  function openUrl(url, newTab) {
    if (!url) return;
    if (newTab) window.open(url, '_blank', 'noopener'); else location.href = url;
  }

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if ($('.hnp-overlay')) { closeSettings(); return; }
        if (cardEl) { hideCard(true); return; }
        if (SEL) { select(null); return; }
      }
      if (!S.keyboard || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof Element && (t.closest('input, textarea, select, [contenteditable]') || t.isContentEditable)) return;
      if (e.key === 'Enter' && t instanceof Element && t.closest('a, button')) return;
      if ($('.hnp-overlay')) return;

      const k = e.key;
      const onComments = COMMENTS.length > 0;
      let handled = true;

      if (k === ',') openSettings();
      else if (k === '?') openSettings('keys');
      else if (onComments && k === 'j') step(visibleComments(), 1);
      else if (onComments && k === 'k') step(visibleComments(), -1);
      else if (onComments && k === 'J') step(visibleComments().filter((r) => r.dataset.hnpD === '0' || r === SEL), 1);
      else if (onComments && k === 'K') step(visibleComments().filter((r) => r.dataset.hnpD === '0' || r === SEL), -1);
      else if (onComments && k === 'n') jumpNew(1);
      else if (onComments && k === 'N') jumpNew(-1);
      else if (onComments && (k === 'x' || k === 'Enter') && SEL?.classList.contains('hnp-c')) { toggleComment(SEL); scrollToRow(SEL); }
      else if (onComments && k === 'p' && SEL?.classList.contains('hnp-c')) { const p = parentOf(SEL); if (p) select(p); }
      else if (onComments && k === 'r' && SEL?.classList.contains('hnp-c')) { const r = $('.reply a', SEL); if (r) location.href = r.href; }
      else if (!onComments && k === 'j') step(visibleStories(), 1);
      else if (!onComments && k === 'k') step(visibleStories(), -1);
      else if (!onComments && (k === 'o' || k === 'Enter') && SEL) { const a = $('.titleline > a', SEL); openUrl(a?.href, S.newTab && a?.dataset.hnpNt); }
      else if (!onComments && k === 'c' && SEL) { openUrl(`item?id=${SEL.id}`, false); }
      else if (PAGE.isItem && k === 'o') { const a = $('.fatitem .titleline > a'); openUrl(a?.href, S.newTab && a?.dataset.hnpNt); }
      else handled = false;

      if (handled) e.preventDefault();
    });
  }

  const KEYS = [
    ['j / k', 'Next / previous story or comment'],
    ['J / K', 'Next / previous top-level comment'],
    ['n / N', 'Next / previous new comment'],
    ['x or Enter', 'Collapse / expand selected comment'],
    ['p', 'Jump to parent comment'],
    ['r', 'Reply to selected comment'],
    ['o or Enter', 'Open selected story link (on item pages: the story link)'],
    ['c', 'Open selected story’s comments'],
    [',', 'Open HN+ settings'],
    ['?', 'Show this list'],
    ['Esc', 'Close panel / card, clear selection'],
  ];

  /* =====================================================================
   * Floating thread toolbar
   * ===================================================================== */

  function setupFab() {
    $('.hnp-fab')?.remove();
    if (!PAGE.isItem || !COMMENTS.length) return;
    const kids = [
      h('button', { type: 'button', title: 'Back to top', onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }, '⤒'),
    ];
    if (NEW_ROWS.length) {
      kids.push(
        h('span', { class: 'hnp-sep' }),
        h('button', { type: 'button', title: 'Previous new comment (N)', onclick: () => jumpNew(-1) }, '▲'),
        h('button', { type: 'button', class: 'hnp-fab-new', title: 'Next new comment (n)', onclick: () => jumpNew(1) }, `${NEW_ROWS.length} new`),
        h('button', { type: 'button', title: 'Next new comment (n)', onclick: () => jumpNew(1) }, '▼'));
    }
    kids.push(h('span', { class: 'hnp-sep' }), h('button', { type: 'button', title: 'HN+ settings (,)', onclick: () => openSettings() }, '⚙'));
    document.body.append(h('div', { class: 'hnp-ui hnp-fab' }, kids));
  }

  /* =====================================================================
   * Settings panel
   * ===================================================================== */

  let panelTab = 'appearance';

  function applyAll() {
    saveSettings();
    applyTheme();
    if (!document.body) return;
    applyFilters();
    applyNewTab();
    applyFavicons();
    applySwaps();
    renderReplyBadge();
    if (!S.accountMenu) closeAccountMenu();
  }

  function set(key, value) {
    S[key] = value;
    applyAll();
  }

  function closeSettings() {
    $('.hnp-overlay')?.remove();
    document.documentElement.style.overflow = '';
  }

  function openSettings(tab) {
    if (tab) panelTab = tab;
    closeSettings();
    hideCard(true);
    const overlay = h('div', { class: 'hnp-ui hnp-overlay' });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSettings(); });
    const pane = h('div', { class: 'hnp-pane' });
    const tabs = h('div', { class: 'hnp-tabs' });
    const TABS = [['appearance', 'Appearance'], ['comments', 'Comments'], ['lists', 'Stories & filters'], ['users', 'Users'], ['swaps', 'Word swaps'], ['keys', 'Keyboard'], ['data', 'Data']];
    const render = () => {
      tabs.replaceChildren(...TABS.map(([id, label]) => h('button', { class: `hnp-tab${panelTab === id ? ' on' : ''}`, type: 'button', onclick: () => { panelTab = id; render(); } }, label)));
      pane.replaceChildren(...PANES[panelTab](render));
      pane.scrollTop = 0;
    };
    overlay.append(h('div', { class: 'hnp-panel', role: 'dialog', 'aria-label': 'HN+ settings' },
      h('div', { class: 'hnp-panel-head' },
        h('h2', {}, 'HN', h('span', {}, '+')),
        h('span', { class: 'hnp-ver' }, `v${VERSION} · changes apply live`),
        h('button', { class: 'hnp-btn hnp-close', type: 'button', onclick: closeSettings }, 'Close')),
      h('div', { class: 'hnp-panel-body' }, tabs, pane)));
    document.body.append(overlay);
    document.documentElement.style.overflow = 'hidden';
    render();
  }

  // --- control builders ---
  const field = (label, hint, control, col) => h('div', { class: `hnp-field${col ? ' col' : ''}` },
    h('div', { class: 'hnp-field-label' }, h('b', {}, label), hint && h('small', {}, hint)), control);
  const section = (title, ...kids) => h('div', { class: 'hnp-section' }, h('h3', {}, title), ...kids);

  function toggle(key, label, hint) {
    const sw = h('button', { class: `hnp-switch${S[key] ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(!!S[key]), 'aria-label': label });
    sw.addEventListener('click', () => {
      set(key, !S[key]);
      sw.classList.toggle('on', S[key]);
      sw.setAttribute('aria-checked', String(S[key]));
    });
    return field(label, hint, sw);
  }

  function segmented(key, label, hint, options, after) {
    const seg = h('div', { class: 'hnp-seg' });
    const draw = () => seg.replaceChildren(...options.map(([v, l]) => h('button', {
      class: S[key] === v ? 'on' : '', type: 'button',
      onclick: () => { set(key, v); draw(); after?.(); },
    }, l)));
    draw();
    return field(label, hint, seg);
  }

  function range(key, label, hint, min, max, stepv, fmt) {
    const out = h('output', {}, fmt(S[key]));
    const input = h('input', { type: 'range', min, max, step: stepv, value: S[key] });
    input.addEventListener('input', () => { const v = parseFloat(input.value); out.textContent = fmt(v); set(key, v); });
    return field(label, hint, h('div', { class: 'hnp-range' }, input, out));
  }

  function textArea(key, label, hint, placeholder) {
    const ta = h('textarea', { placeholder, value: S[key], spellcheck: 'false' });
    ta.addEventListener('input', debounce(() => set(key, ta.value), 300));
    return field(label, hint, ta, true);
  }

  const PANES = {
    appearance(rerender) {
      const themeCards = h('div', { class: 'hnp-themecards' }, Object.entries(THEMES).map(([id, t]) => h('button', {
        class: `hnp-themecard${S.theme === id ? ' on' : ''}`, type: 'button',
        style: { '--t-bg': t.bg, '--t-surface': t.surface, '--t-border': t.border, '--t-text': t.text, '--t-muted': t.muted },
        onclick: () => { S.theme = id; S.tones = pickTones(t); applyAll(); rerender(); },
      }, h('i'), h('b', {}, t.label))));

      const accentRow = h('div', { class: 'hnp-swatches' },
        ACCENTS.map((c) => h('button', {
          class: `hnp-swatch${S.accent.toLowerCase() === c ? ' on' : ''}`, type: 'button', title: c, style: { '--sw': c },
          onclick: () => { set('accent', c); rerender(); },
        })),
        h('input', { class: 'hnp-colorin', type: 'color', value: S.accent, title: 'Custom accent', oninput: (e) => set('accent', e.target.value), onchange: () => rerender() }));

      const tones = h('div', { class: 'hnp-tones' }, TONE_KEYS.map(([k, label]) => {
        const code = h('code', {}, S.tones[k]);
        return h('label', { class: 'hnp-tone' },
          h('input', {
            class: 'hnp-colorin', type: 'color', value: S.tones[k],
            oninput: (e) => { S.tones = { ...S.tones, [k]: e.target.value }; code.textContent = e.target.value; applyAll(); },
          }),
          h('span', {}, label), code);
      }));

      return [
        section('Base theme', themeCards),
        section('Accent', field('Accent colour', 'Header bar, links in comments, badges, selection', accentRow)),
        section('Tones', tones, h('div', { class: 'hnp-btnrow' },
          h('button', { class: 'hnp-btn', type: 'button', onclick: () => { const base = THEMES[S.theme] || THEMES.abyss; S.tones = pickTones(base); applyAll(); rerender(); } }, 'Reset tones to theme'))),
        section('Typography',
          segmented('font', 'Font', 'Mono uses JetBrains Mono; code blocks always do', Object.entries(FONTS).map(([id, f]) => [id, f.label])),
          range('fontSize', 'Text size', null, 11, 20, 0.5, (v) => `${v}px`),
          range('lineHeight', 'Comment line height', null, 1.2, 2, 0.05, (v) => v.toFixed(2))),
        section('Layout',
          segmented('width', 'Page width', null, [['readable', 'Readable'], ['classic', 'Classic 85%'], ['full', 'Full']]),
          toggle('stickyHeader', 'Sticky header', 'Keep the top bar visible while scrolling')),
        section('Christmas mode \u2744',
          segmented('xmas', 'Christmas mode', '"December" switches it on from 1 Dec to 6 Jan, then off again', [['off', 'Off'], ['on', 'On'], ['auto', 'December']]),
          toggle('xmasSnow', 'Snow', 'Paused in background tabs; off when your system asks for reduced motion'),
          segmented('xmasSnowAmount', 'Snowfall', null, [['light', 'Light'], ['medium', 'Medium'], ['blizzard', 'Blizzard']]),
          toggle('xmasHats', 'Santa hats', 'A tipped hat on every username'),
          toggle('xmasOrnaments', 'Title ornaments', 'Holly, baubles, stars, gifts, candy canes and bells around story titles'),
          toggle('xmasLights', 'Fairy lights', 'Twinkling lights along the header')),
      ];
    },

    comments() {
      return [
        section('Threads',
          toggle('rails', 'Thread rails', 'A vertical line beside each comment'),
          toggle('rainbowRails', 'Colour rails by depth', 'Makes deep threads easier to follow'),
          toggle('railCollapse', 'Click rail to collapse', 'Click the line beside a comment to fold its thread')),
        section('Markers',
          toggle('opBadge', 'OP badge', 'Tag comments written by the story author'),
          toggle('newMarkers', 'New comment markers', 'Highlight comments posted since your last visit'),
          toggle('highlightSelf', 'Highlight my comments', 'When logged in')),
        section('Content',
          toggle('quotes', 'Style quotes', 'Paragraphs starting with ">" render as quotes'),
          toggle('imageExpand', 'Inline image expander', 'Adds an [img] button after image links')),
        section('Hover',
          toggle('hoverPreviews', 'Comment & item previews', 'Hover "parent", "context" and item links to preview them'),
          toggle('userCards', 'User cards', 'Hover a username for karma, about and quick highlight/tag/mute')),
        section('Account (when logged in)',
          toggle('accountMenu', 'Account menu', 'Hover your username for replies, comments, upvoted, favorites and more'),
          toggle('replyTracking', 'Reply tracking', `Checks your last ${REPLY_SCAN} posts for new replies every few minutes and shows a count next to your name`)),
      ];
    },

    lists() {
      return [
        section('Stories',
          toggle('newTab', 'Open external links in new tab'),
          toggle('newCountBadge', 'New comment counts', 'Show +N on stories you opened before'),
          toggle('dimRead', 'Dim stories you opened'),
          toggle('favicons', 'Site icons', 'Loads favicons from icons.duckduckgo.com')),
        section('Filters',
          segmented('filterMode', 'Filtered stories', null, [['hide', 'Hide'], ['dim', 'Dim']]),
          textArea('filterKeywords', 'Title keywords', 'One per line, case-insensitive. Use /regex/ for patterns.', 'crypto\n/\\bblockchain\\b/'),
          textArea('filterDomains', 'Domains', 'One per line. Subdomains match too.', 'example.com\nmedium.com'),
          h('p', { class: 'hnp-field-label' }, h('small', {}, 'Stories by muted users are filtered too.'))),
      ];
    },

    users(rerender) {
      const all = Object.entries(USERS).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      const addIn = h('input', { type: 'text', placeholder: 'username', style: { width: '200px' } });
      const add = () => {
        const n = addIn.value.trim();
        if (!n) return;
        updateUser(n, { color: USERS[n]?.color || USER_COLORS[Object.keys(USERS).length % USER_COLORS.length] });
        rerender();
      };
      addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

      const search = h('input', { type: 'text', placeholder: 'Search people, aliases, tags, notes…', style: { width: '100%' } });
      const list = h('div');
      const row = (name, u) => {
        const text = (key, placeholder) => h('input', {
          type: 'text', value: u[key] || '', placeholder,
          oninput: debounce((e) => updateUser(name, { [key]: e.target.value.trim() }), 300),
        });
        const notes = h('textarea', {
          value: u.note || '', placeholder: 'Notes', spellcheck: 'true',
          oninput: debounce((e) => updateUser(name, { note: e.target.value.trim() }), 400),
        });
        return h('div', { class: 'hnp-urow', 'data-q': [name, u.alias, u.tag, u.note].filter(Boolean).join(' ').toLowerCase() },
          h('div', { class: 'hnp-urow-top' },
            h('a', { href: `user?id=${encodeURIComponent(name)}`, title: name, style: { color: u.color || 'var(--hnp-text)' } }, name),
            text('alias', 'alias'),
            text('tag', 'tag'),
            h('input', {
              class: 'hnp-colorin', type: 'color', value: u.color || '#777777', title: 'Highlight colour',
              onchange: (e) => { updateUser(name, { color: e.target.value }); rerender(); },
            }),
            h('button', { class: `hnp-btn${u.muted ? ' on' : ''}`, type: 'button', onclick: () => { updateUser(name, { muted: !u.muted }); rerender(); } }, u.muted ? 'Muted' : 'Mute'),
            h('button', { class: 'hnp-btn danger', type: 'button', title: 'Forget this user', onclick: () => { if (u.note && !confirm(`Forget ${name}? Your notes on them will be lost.`)) return; delete USERS[name]; saveUsers(); decorateUsers(); applyFilters(); rerender(); } }, '✕')),
          notes,
          u.color && h('button', { class: 'hnp-btn', type: 'button', style: { marginTop: '6px', fontSize: '11px' }, onclick: () => { updateUser(name, { color: null }); rerender(); } }, 'Remove colour'));
      };
      list.append(...(all.length ? all.map(([n, u]) => row(n, u)) : [h('div', { class: 'hnp-empty' }, 'Nobody yet. Hover any username to add an alias, notes, a tag or a colour.')]));
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        for (const r of list.children) if (r.dataset.q != null) r.style.display = !q || r.dataset.q.includes(q) ? '' : 'none';
      });
      return [
        section('Add user', h('div', { class: 'hnp-row', style: { display: 'flex', gap: '8px' } }, addIn, h('button', { class: 'hnp-btn primary', type: 'button', onclick: add }, 'Add'))),
        section(`People (${all.length})`, all.length > 4 ? search : null, list),
      ];
    },

    swaps(rerender) {
      const rules = Array.isArray(S.swaps) ? S.swaps.map((r) => ({ ...r })) : [];
      const tryIn = h('input', { type: 'text', value: 'Rust is great, but is Rust-lang a category of RUST?', style: { width: '100%' } });
      const tryOut = h('div', { class: 'hnp-swap-out' });
      const updateTry = () => { tryOut.replaceChildren(...(swapParts(tryIn.value) || [tryIn.value])); };
      tryIn.addEventListener('input', updateTry);
      const save = debounce(() => { set('swaps', rules.filter((r) => r.from || r.to)); updateTry(); }, 250);
      updateTry();

      const list = rules.length ? h('table', { class: 'hnp-users' }, rules.map((r, i) => h('tr', {},
        h('td', { style: { width: '45%' } }, h('input', { type: 'text', value: r.from || '', placeholder: 'word or phrase', oninput: (e) => { r.from = e.target.value; save(); } })),
        h('td', { style: { width: '30px', textAlign: 'center', color: 'var(--hnp-muted)' } }, '→'),
        h('td', { style: { width: '45%' } }, h('input', { type: 'text', value: r.to || '', placeholder: 'replacement (empty removes it)', oninput: (e) => { r.to = e.target.value; save(); } })),
        h('td', {}, h('button', { class: 'hnp-btn danger', type: 'button', title: 'Remove swap', onclick: () => { rules.splice(i, 1); set('swaps', rules.filter((x) => x.from || x.to)); rerender(); } }, '✕')))))
        : h('div', { class: 'hnp-empty' }, 'No swaps yet.');

      return [
        section('Word swaps',
          h('small', { class: 'hnp-field-label' }, 'Whole words or phrases, case-insensitive: "cat" matches Cat, cat and cAt, but not "category". The replacement copies the original capitalisation (Rust → Crust, RUST → CRUST). Applies to story titles, comments and post text; code blocks are left alone.'),
          list,
          h('div', { class: 'hnp-btnrow' }, h('button', {
            class: 'hnp-btn primary', type: 'button',
            onclick: () => { S.swaps = [...rules, { from: '', to: '' }]; saveSettings(); rerender(); const ins = $$('.hnp-pane .hnp-users input'); ins[ins.length - 2]?.focus(); },
          }, '+ Add swap'))),
        section('Style',
          segmented('swapStyle', 'Swapped-word flair', 'How replaced words stand out. Hover one to see the original.', [['shine', 'Shine'], ['glow', 'Glow'], ['squiggle', 'Squiggle'], ['marker', 'Marker'], ['none', 'None']], updateTry)),
        section('Try it', tryIn, tryOut),
      ];
    },

    keys() {
      return [
        toggle('keyboard', 'Keyboard shortcuts', 'Ignored while typing in a text box'),
        section('Shortcuts', h('div', { class: 'hnp-keys' }, KEYS.map(([k, d]) => [h('kbd', {}, k), h('span', {}, d)]))),
      ];
    },

    data(rerender) {
      const ta = h('textarea', { spellcheck: 'false', style: { minHeight: '180px' }, value: JSON.stringify({ hnPlus: VERSION, settings: S, users: USERS }, null, 2) });
      const seenCount = Object.keys(loadSeen()).length;
      return [
        section('Backup',
          h('small', { class: 'hnp-field-label' }, 'Copy this JSON to back up or move your setup. Paste a backup here and import it to restore.'),
          ta,
          h('div', { class: 'hnp-btnrow' },
            h('button', { class: 'hnp-btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied to clipboard'); } catch { ta.select(); toast('Select-all done; press Cmd+C'); } } }, 'Copy'),
            h('button', {
              class: 'hnp-btn primary', type: 'button', onclick: () => {
                try {
                  const d = JSON.parse(ta.value);
                  if (!d || typeof d !== 'object') throw new Error('not an object');
                  if (d.settings) S = { ...DEFAULTS, ...d.settings, tones: { ...DEFAULTS.tones, ...(d.settings.tones || {}) } };
                  if (d.users && typeof d.users === 'object') USERS = d.users;
                  saveUsers(); applyAll(); decorateUsers(); applyFilters();
                  toast('Imported'); rerender();
                } catch (e) { toast(`Import failed: ${e.message}`, 3000); }
              },
            }, 'Import'))),
        section('Reset',
          h('div', { class: 'hnp-btnrow' },
            h('button', { class: 'hnp-btn', type: 'button', onclick: () => { if (confirm('Clear the list of stories you visited? New-comment tracking starts over.')) { gmSet('seen', {}); toast('Visit history cleared'); rerender(); } } }, `Clear visit history (${seenCount})`),
            h('button', { class: 'hnp-btn danger', type: 'button', onclick: () => { if (confirm('Reset all settings to defaults? Your users list is kept.')) { S = loadDefaultsCopy(); applyAll(); toast('Settings reset'); rerender(); } } }, 'Reset settings'),
            h('button', { class: 'hnp-btn danger', type: 'button', onclick: () => { if (confirm('Forget every highlighted, tagged and muted user?')) { USERS = {}; saveUsers(); decorateUsers(); applyFilters(); toast('Users cleared'); rerender(); } } }, 'Clear users'))),
      ];
    },
  };

  const loadDefaultsCopy = () => ({ ...DEFAULTS, tones: { ...DEFAULTS.tones } });

  /* =====================================================================
   * Boot
   * ===================================================================== */

  function main() {
    applyTheme(); // re-run now that <head> exists so our styles sit in the head
    detectPage();
    enhanceHeader();
    processStories();
    processComments();
    decorateUsers();
    applyFilters();
    applyNewTab();
    applyFavicons();
    applySwaps();
    trackItem();
    setupHover();
    setupKeyboard();
    setupFab();
    setupAccount();
    // Location hash (e.g. arriving from a "context" link): select that comment.
    const hashRow = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (hashRow?.classList.contains('hnp-c')) select(hashRow, false);
  }

  try {
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('HN+ settings', () => openSettings());
  } catch { /* menu commands are optional */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();

  // Keep every open HN tab in sync when settings change elsewhere.
  window.addEventListener('focus', () => {
    const fresh = loadSettings();
    const freshUsers = gmGet('users', {}) || {};
    if (JSON.stringify(fresh) !== JSON.stringify(S) || JSON.stringify(freshUsers) !== JSON.stringify(USERS)) {
      S = fresh;
      USERS = freshUsers;
      applyAll();
      decorateUsers();
    }
  });
})();
