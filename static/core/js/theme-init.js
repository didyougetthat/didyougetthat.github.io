/* theme-init.js — runs in <head>, BEFORE the first paint, so the page never flashes the wrong look.
   Decides the look and writes it on <html data-theme="...">. The page lists the looks the site offers in <html data-themes="...">
   (the setting SITE_THEMES; the server already wrote the first one in data-theme, so it shows even with scripting off).
   No data-themes attribute = all three offered. Order of choice:
     1. ?theme=light|dark|vivid in the address — a preview of any look, offered or not; it is applied but NOT saved
     2. the look saved in this browser (localStorage key "dyg-theme"), if the site still offers it
     3. one look offered: that look. Several: the device setting — dark when the device asks for dark colours and dark is
        offered, otherwise light if offered, otherwise the first offered look
   No cookies, no network. Every browser-storage access sits in try/catch because private mode can throw. */
(function () {
  "use strict";

  var STORAGE_KEY = "dyg-theme";
  var THEMES = ["light", "dark", "vivid"];
  var root = document.documentElement;
  var theme = "";
  var source = "system";

  function isTheme(value) {
    return THEMES.indexOf(value) !== -1;
  }

  var offered = [];
  var listed = (root.getAttribute("data-themes") || "").split(" ");
  for (var i = 0; i < listed.length; i += 1) {
    if (isTheme(listed[i]) && offered.indexOf(listed[i]) === -1) {
      offered.push(listed[i]);
    }
  }
  if (!offered.length) {
    offered = THEMES.slice();
  }

  function isOffered(value) {
    return offered.indexOf(value) !== -1;
  }

  try {
    var wanted = new URLSearchParams(window.location.search).get("theme");
    if (isTheme(wanted)) {
      theme = wanted;
      source = "url";
    }
  } catch (error) {
    /* an old browser without URLSearchParams: ignore the preview parameter */
  }

  if (!theme) {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (isTheme(saved) && isOffered(saved)) {
        theme = saved;
        source = "saved";
      }
    } catch (error) {
      /* storage blocked: fall through to the site's own choice */
    }
  }

  if (!theme && offered.length === 1) {
    theme = offered[0];
    source = "fixed";
  }

  if (!theme) {
    var dark = false;
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (error) {
      dark = false;
    }
    theme = dark && isOffered("dark") ? "dark" : isOffered("light") ? "light" : offered[0];
  }

  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-source", source);
  root.classList.remove("no-js"); /* scripting works: the theme buttons may be shown */
})();
