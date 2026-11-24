// ==UserScript==
// @name         HN+ (dev)
// @namespace    https://github.com/errorware/hn-plus/dev
// @version      0.0.0-dev
// @description  Dev loader: runs hn-plus.user.js straight from disk, so edits apply on page reload.
// @match        https://news.ycombinator.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      hacker-news.firebaseio.com
// @require      file:///ABSOLUTE/PATH/TO/hn-plus/hn-plus.user.js
// ==/UserScript==

// Intentionally empty: the @require above is the whole script.
// 1. Replace the @require path with the absolute path to your clone.
// 2. Turn on "Allow access to file URLs" for Tampermonkey in your browser's extension settings.
// 3. Disable the regular HN+ script while this one is enabled, or both will run.
