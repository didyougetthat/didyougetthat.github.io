/* theme-switcher.js — wires every theme button on the page (the small ones in the header and the big ones on the preview page).
   A button is <button data-theme-choice="light|dark|vivid" aria-pressed="...">. Clicking one:
     - puts the look on <html data-theme>, so the whole page changes at once
     - saves the choice in this browser only (localStorage "dyg-theme", in try/catch)
     - drops a ?theme=... preview parameter from the address so a reload keeps the saved choice
     - keeps aria-pressed right on all buttons, so screen readers announce which look is on
   While the person has not chosen (no saved look) and the site offers several looks, the page follows the device's dark/light
   setting live, within the offered looks (<html data-themes>, as in theme-init.js). One look offered: the device is not followed.
   No cookies, no network. */
(function () {
  "use strict";

  var STORAGE_KEY = "dyg-theme";
  var THEMES = ["light", "dark", "vivid"];
  var root = document.documentElement;

  function isTheme(value) {
    return THEMES.indexOf(value) !== -1;
  }

  function offered() {
    var listed = (root.getAttribute("data-themes") || "").split(" ").filter(isTheme);
    return listed.length ? listed : THEMES;
  }

  function currentTheme() {
    var value = root.getAttribute("data-theme");
    return isTheme(value) ? value : "light";
  }

  function syncButtons() {
    var now = currentTheme();
    var buttons = document.querySelectorAll("[data-theme-choice]");
    for (var i = 0; i < buttons.length; i += 1) {
      var pressed = buttons[i].getAttribute("data-theme-choice") === now;
      buttons[i].setAttribute("aria-pressed", pressed ? "true" : "false");
    }
  }

  function save(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      /* private mode or blocked storage: the look still changes for this visit */
    }
  }

  function forgetPreviewParameter() {
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.has("theme")) {
        url.searchParams.delete("theme");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch (error) {
      /* nothing to clean up */
    }
  }

  function choose(theme) {
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-source", "saved");
    save(theme);
    forgetPreviewParameter();
    syncButtons();
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest("[data-theme-choice]") : null;
    if (!button) {
      return;
    }
    var theme = button.getAttribute("data-theme-choice");
    if (isTheme(theme)) {
      choose(theme);
    }
  });

  try {
    var query = window.matchMedia("(prefers-color-scheme: dark)");
    var follow = function () {
      if (root.getAttribute("data-theme-source") === "system") {
        var looks = offered();
        var wanted = query.matches && looks.indexOf("dark") !== -1 ? "dark" : looks.indexOf("light") !== -1 ? "light" : looks[0];
        root.setAttribute("data-theme", wanted);
        syncButtons();
      }
    };
    if (query.addEventListener) {
      query.addEventListener("change", follow);
    } else if (query.addListener) {
      query.addListener(follow);
    }
  } catch (error) {
    /* no matchMedia: the look simply stays as it was at load */
  }

  syncButtons();
})();
