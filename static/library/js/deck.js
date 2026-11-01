/* deck.js — the site's own slide player (PLAN.md §2 "Showing a material", v1.5; his choice A, PROJECT_LOG ENTRY 014).
   One slide at a time, never a vertical scroll. Moves by: a click / tap on the slide (the left third goes back), the ← / → keys
   anywhere on the page, PageDown / Space and PageUp, Home / End and F (full screen) while the player has the focus or fills the
   screen, the mouse wheel over the slide (one notch = one slide; a guard stops a laptop touchpad from racing), and a touch
   swipe. Full screen = the browser's own, or an in-page layer where there is none (iPhone). Remembers the last slide on this
   device only; no network request of its own; no inline code and no style written from script (strict page policy): the
   stage is scrolled sideways to a slide, and the progress bar is a <progress> element. Its words come from the page
   (data-text-*), so they are translated with the rest of the site. Ported from the comparison page he chose.
   Zoom (a phone showed some slide text too small, and the browser's own two-finger zoom does nothing in full screen): a pinch on
   the slide, the slider and the - / + / level buttons in the bar, or the + - 0 keys set a level from 1x to 3x. Zoomed, the slide
   is a second layer (.deck__zoom, after the track) holding the current slide's picture, sized only through the picture's width
   and height ATTRIBUTES (no style is written from script) and scrolled natively: one finger, the wheel, or a mouse drag moves it,
   while a tap, a click and a swipe no longer turn the slide (the round buttons, the arrow keys and the jump list still do; the
   level is kept and the new slide starts at its top-left corner). Nothing about the zoom is remembered. A page without the layer
   simply has no zoom. */
(function () {
  "use strict";

  var deck = document.getElementById("deck");
  if (!deck) {
    return;
  }
  var stage = deck.querySelector(".deck__stage");
  var track = deck.querySelector(".deck__track");
  var slides = Array.prototype.slice.call(deck.querySelectorAll(".deck__slide"));
  var count = deck.querySelector(".deck__count");
  var progress = deck.querySelector(".deck__progress");
  var done = deck.querySelector(".deck__done");
  var thumbs = deck.querySelector(".deck__thumbs");
  var thumbButtons = Array.prototype.slice.call(deck.querySelectorAll(".deck__thumb"));
  var thumbsToggle = deck.querySelector('[data-action="thumbs"]');
  var fsButton = deck.querySelector('[data-action="fullscreen"]');
  var hint = deck.querySelector(".deck__hint");
  var toast = deck.querySelector(".deck__toast");
  var zoomLayer = deck.querySelector(".deck__zoom");
  var zoomImg = zoomLayer ? zoomLayer.querySelector("img") : null;
  var zoomOutButton = deck.querySelector('[data-action="zoom-out"]');
  var zoomLevelButton = deck.querySelector('[data-action="zoom-reset"]');
  var zoomInButton = deck.querySelector('[data-action="zoom-in"]');
  var zoomSlider = deck.querySelector(".deck__zoom-slider");
  var canZoom = !!(zoomLayer && zoomImg); /* an old cached page with this script has no layer: then there is no zoom at all */
  var MAX_ZOOM = 3;
  var ZOOM_STEP = 10; /* one press of the + or - button or key, in points of the level (his look, LOG ENTRY 036) */
  var CLOSE_BELOW = 1.05; /* a pinch let go under this level closes the zoom */
  var zoom = 1;
  var layerIndex = -1; /* the slide the layer shows now, -1 while it is put away */
  var layerW = 0; /* the picture's width and height in the layer, as last set (px) */
  var layerH = 0;
  var viewW = 0; /* the layer's own visible size at the last fit, to keep the centre of the view when the window changes */
  var viewH = 0;
  var storageKey = "dyg-deck-" + (deck.getAttribute("data-deck-key") || "deck");
  var total = slides.length;
  var index = 0;
  if (!total || !stage || !track) {
    return;
  }

  function text(name, fallback) {
    return deck.getAttribute("data-text-" + name) || fallback;
  }

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  var reduced = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    reduced = false;
  }

  /* the strip of slides (the track) is scrolled sideways to one slide (gliding, unless the device asks for less motion); the
     round buttons, the hint and the end screen sit on the stage around it and never move */
  function show(animate) {
    var left = index * track.clientWidth;
    if (typeof track.scrollTo === "function") {
      track.scrollTo({ left: left, behavior: animate && !reduced ? "smooth" : "auto" });
    } else {
      track.scrollLeft = left;
    }
  }

  /* a new size (window, full screen, the in-page layer) keeps the same slide in view, and, zoomed, the same centre of it */
  function realign() {
    track.scrollLeft = index * track.clientWidth;
    if (canZoom && !zoomLayer.hidden) {
      var cx = layerW > 0 ? (zoomLayer.scrollLeft + viewW / 2) / layerW : 0;
      var cy = layerH > 0 ? (zoomLayer.scrollTop + viewH / 2) / layerH : 0;
      fitPicture();
      noteView();
      zoomLayer.scrollLeft = cx * layerW - viewW / 2;
      zoomLayer.scrollTop = cy * layerH - viewH / 2;
    }
  }

  if (typeof window.ResizeObserver === "function") {
    new window.ResizeObserver(realign).observe(track);
  } else {
    window.addEventListener("resize", realign);
  }

  function remember(value) {
    try {
      window.localStorage.setItem(storageKey, String(value));
    } catch (e) {
      /* private window or blocked storage: no resume, nothing else changes */
    }
  }

  function remembered() {
    try {
      var value = parseInt(window.localStorage.getItem(storageKey), 10);
      return isNaN(value) ? 0 : value;
    } catch (e) {
      return 0;
    }
  }

  function warm(i) {
    var slide = slides[i];
    var img = slide && slide.querySelector("img");
    if (img && img.loading === "lazy") {
      img.loading = "eager";
    }
  }

  function dropHint() {
    if (hint) {
      hint.classList.add("is-gone");
    }
  }

  /* the open list keeps the current slide's small picture in its own view; only the list moves, never the page */
  function showCurrentThumb() {
    var button = thumbButtons[index];
    if (!button || thumbs.hidden) {
      return;
    }
    var list = thumbs.getBoundingClientRect();
    var rect = button.getBoundingClientRect();
    if (rect.top < list.top) {
      thumbs.scrollTop += rect.top - list.top;
    } else if (rect.bottom > list.bottom) {
      thumbs.scrollTop += rect.bottom - list.bottom;
    }
  }

  function render(animate) {
    show(animate);
    var finished = !done.hidden;
    count.textContent = finished ? text("done", "Done!") : (index + 1) + " / " + total;
    if (progress) {
      progress.value = finished ? total : index + 1;
    }
    slides.forEach(function (slide, i) {
      slide.setAttribute("aria-hidden", i === index ? "false" : "true");
    });
    each(deck.querySelectorAll('[data-action="prev"]'), function (button) {
      button.disabled = index === 0 && !finished;
    });
    each(deck.querySelectorAll('[data-action="next"]'), function (button) {
      button.disabled = finished;
    });
    thumbButtons.forEach(function (button, i) {
      button.classList.toggle("is-current", i === index);
      if (i === index) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    showCurrentThumb();
    warm(index);
    warm(index + 1);
    warm(index + 2);
    warm(index - 1);
    syncZoom();
    remember(index);
  }

  /* a one-slide step glides; a jump (Home, End, the list, "watch again") is instant, so the slides never fly past */
  function go(i, animate) {
    var target = Math.max(0, Math.min(total - 1, i));
    var glide = animate !== false && Math.abs(target - index) <= 1;
    done.hidden = true;
    index = target;
    render(glide);
  }

  function next() {
    dropHint();
    if (!done.hidden) {
      return;
    }
    if (index === total - 1) {
      done.hidden = false;
      render(true);
      var first = done.querySelector("button");
      if (first) {
        first.focus({ preventScroll: true });
      }
      return;
    }
    go(index + 1);
  }

  function prev() {
    dropHint();
    if (!done.hidden) {
      var focusWasThere = done.contains(document.activeElement);
      done.hidden = true;
      render(true);
      if (focusWasThere) {
        stage.focus({ preventScroll: true }); /* the focused button is hidden now: the keys keep working on the player */
      }
      return;
    }
    if (index > 0) {
      go(index - 1);
    }
  }

  /* ---- zoom: the layer holds the current slide's picture at (level x the stage's width); the browser scrolls it ---- */
  function pictureSize(level) {
    var pic = slides[index].querySelector("img");
    var w = pic ? parseFloat(pic.getAttribute("width")) : 0;
    var h = pic ? parseFloat(pic.getAttribute("height")) : 0;
    var width = track.clientWidth * level;
    var ratio = w > 0 && h > 0 ? h / w : 9 / 16;
    return { w: Math.round(width), h: Math.round(width * ratio) };
  }

  /* the layer's picture is the current slide at the current level: its address and its size, both as attributes */
  function fitPicture() {
    var pic = slides[index].querySelector("img");
    var src = pic ? pic.getAttribute("src") : null;
    if (src && zoomImg.getAttribute("src") !== src) {
      zoomImg.setAttribute("src", src);
    }
    var size = pictureSize(zoom);
    zoomImg.setAttribute("width", String(size.w));
    zoomImg.setAttribute("height", String(size.h));
    layerW = size.w;
    layerH = size.h;
  }

  function noteView() {
    viewW = zoomLayer.clientWidth;
    viewH = zoomLayer.clientHeight;
  }

  function zoomed() {
    return canZoom && !zoomLayer.hidden;
  }

  function zoomButtons() {
    var points = Math.round(zoom * 100);
    var words = text("zoom", "{number}%").replace("{number}", String(points));
    if (zoomLevelButton) {
      zoomLevelButton.textContent = words;
      zoomLevelButton.disabled = zoom <= 1;
    }
    if (zoomOutButton) {
      zoomOutButton.disabled = zoom <= 1;
    }
    if (zoomInButton) {
      zoomInButton.disabled = zoom >= MAX_ZOOM;
    }
    if (zoomSlider) {
      zoomSlider.value = String(points); /* the browser puts a pinch's level on the slider's nearest stop */
      zoomSlider.setAttribute("aria-valuetext", words);
    }
  }

  /* render() calls this on every change: a new slide gets its picture and the top-left corner at the kept level; the end screen,
     and level 1, put the layer away (its scroll back at 0 first: a hidden layer cannot be scrolled) */
  function syncZoom() {
    if (!canZoom) {
      return;
    }
    if (zoom > 1 && done.hidden) {
      if (zoomLayer.hidden || layerIndex !== index) {
        zoomLayer.hidden = false;
        fitPicture();
        zoomLayer.scrollLeft = 0;
        zoomLayer.scrollTop = 0;
        layerIndex = index;
        noteView();
      }
    } else {
      if (!zoomLayer.hidden) {
        zoomLayer.scrollLeft = 0;
        zoomLayer.scrollTop = 0;
        zoomLayer.hidden = true;
      }
      layerIndex = -1;
    }
    zoomButtons();
  }

  function share(offset, focus, size) {
    return size > 0 ? (offset + focus) / size : 0;
  }

  /* the level, 1 to 3; the point of the slide under (focusX, focusY), in the layer's own view and by default its centre, stays put */
  function setZoom(value, focusX, focusY) {
    if (!canZoom) {
      return;
    }
    var wasOpen = !zoomLayer.hidden;
    var closed = pictureSize(1);
    var oldW = wasOpen ? layerW : closed.w;
    var oldH = wasOpen ? layerH : closed.h;
    var oldLeft = wasOpen ? zoomLayer.scrollLeft : 0;
    var oldTop = wasOpen ? zoomLayer.scrollTop : 0;
    zoom = Math.max(1, Math.min(MAX_ZOOM, value));
    if (zoom === 1 || !done.hidden) {
      syncZoom(); /* level 1, or the end screen: the layer stays away */
      return;
    }
    zoomLayer.hidden = false; /* shown first: a hidden layer has no size and cannot be scrolled */
    fitPicture();
    layerIndex = index;
    var fx = typeof focusX === "number" ? focusX : zoomLayer.clientWidth / 2;
    var fy = typeof focusY === "number" ? focusY : zoomLayer.clientHeight / 2;
    zoomLayer.scrollLeft = share(oldLeft, fx, oldW) * layerW - fx;
    zoomLayer.scrollTop = share(oldTop, fy, oldH) * layerH - fy;
    noteView();
    zoomButtons();
  }

  /* the next round level above or below (a pinch or the slider can leave the level between two); setZoom keeps it within 1 to 3 */
  function stepUp() {
    return ((Math.floor(Math.round(zoom * 100) / ZOOM_STEP) + 1) * ZOOM_STEP) / 100;
  }

  function stepDown() {
    return ((Math.ceil(Math.round(zoom * 100) / ZOOM_STEP) - 1) * ZOOM_STEP) / 100;
  }

  /* ---- full screen ---- */
  function isFull() {
    return document.fullscreenElement === deck || deck.classList.contains("is-pseudo-fullscreen");
  }

  function label() {
    if (fsButton) {
      fsButton.textContent = isFull() ? text("exit-fullscreen", "Exit full screen") : text("fullscreen", "Full screen");
      fsButton.setAttribute("aria-pressed", isFull() ? "true" : "false");
    }
  }

  function enterLayer() {
    deck.classList.add("is-pseudo-fullscreen");
    document.documentElement.classList.add("no-scroll");
    label();
  }

  function leaveLayer() {
    deck.classList.remove("is-pseudo-fullscreen");
    document.documentElement.classList.remove("no-scroll");
    label();
  }

  function toggleFull() {
    if (document.fullscreenElement === deck) {
      document.exitFullscreen();
      return;
    }
    if (deck.classList.contains("is-pseudo-fullscreen")) {
      leaveLayer();
      return;
    }
    if (document.fullscreenEnabled && deck.requestFullscreen) {
      var asked = deck.requestFullscreen();
      if (asked && asked.catch) {
        asked.catch(enterLayer);
      }
    } else {
      enterLayer();
    }
  }

  document.addEventListener("fullscreenchange", label);

  /* ---- buttons (one listener for all) ---- */
  deck.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-action]") : null;
    if (!button || !deck.contains(button)) {
      return;
    }
    var action = button.getAttribute("data-action");
    if (action === "prev") {
      prev();
    } else if (action === "next") {
      next();
    } else if (action === "restart") {
      go(0);
      stage.focus({ preventScroll: true });
    } else if (action === "goto") {
      go(parseInt(button.getAttribute("data-index"), 10) || 0); /* the list stays open until its own button closes it (his look, LOG ENTRY 036) */
    } else if (action === "thumbs") {
      thumbs.hidden = !thumbs.hidden;
      thumbsToggle.setAttribute("aria-expanded", thumbs.hidden ? "false" : "true");
      deck.classList.toggle("is-listing", !thumbs.hidden); /* full screen makes the slide smaller for it */
      showCurrentThumb();
      if (!thumbs.hidden && typeof thumbs.scrollIntoView === "function") {
        thumbs.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); /* the list opens under the bar */
      }
    } else if (action === "fullscreen") {
      toggleFull();
    } else if (action === "toast-restart") {
      toast.hidden = true;
      go(0);
    } else if (action === "zoom-in") {
      setZoom(stepUp());
    } else if (action === "zoom-out") {
      setZoom(stepDown());
    } else if (action === "zoom-reset") {
      setZoom(1);
    }
  });

  /* ---- click / tap and swipe on the slide. A swipe counts wherever it starts (a phone snaps a touch near the ‹ › buttons
     onto them); a plain tap on a button or link is left to that button. ---- */
  var down = null;
  var drag = null; /* a mouse drag of the zoomed slide: where it started and where the layer was */
  stage.addEventListener("pointerdown", function (event) {
    if (event.button !== undefined && event.button !== 0) {
      down = null;
      return;
    }
    down = { x: event.clientX, y: event.clientY, onControl: !!event.target.closest("button, a") };
    if (zoomed() && event.pointerType === "mouse" && !down.onControl) {
      var rect = stage.getBoundingClientRect();
      /* a press on the layer's own scroll bars is the scroll bar's, not a drag */
      if (event.clientX - rect.left < zoomLayer.clientWidth && event.clientY - rect.top < zoomLayer.clientHeight) {
        drag = { x: event.clientX, y: event.clientY, left: zoomLayer.scrollLeft, top: zoomLayer.scrollTop };
        if (typeof stage.setPointerCapture === "function") {
          try {
            stage.setPointerCapture(event.pointerId);
          } catch (error) {
            /* the pointer is gone already: the drag goes on without the capture */
          }
        }
      }
    }
  });
  stage.addEventListener("pointercancel", function () {
    down = null;
    drag = null;
  });
  stage.addEventListener("pointerup", function (event) {
    drag = null;
    if (!down) {
      return;
    }
    if (zoomed()) {
      down = null; /* zoomed, a tap, a click and a swipe move nothing: the slide is moved, not turned */
      return;
    }
    var dx = event.clientX - down.x;
    var dy = event.clientY - down.y;
    var onControl = down.onControl || !!event.target.closest("button, a");
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        next();
      } else {
        prev();
      }
      return;
    }
    if (onControl || Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      return;
    }
    var rect = stage.getBoundingClientRect();
    if (event.clientX - rect.left < rect.width / 3) {
      prev();
    } else {
      next();
    }
  });

  /* ---- mouse wheel: one notch = one slide; a touchpad's many small events add up, then wait for a pause ---- */
  var gathered = 0;
  var lockedUntil = 0;
  var lastWheel = 0;
  stage.addEventListener(
    "wheel",
    function (event) {
      if (event.ctrlKey) {
        return; /* a touchpad pinch: leave the browser's zoom alone */
      }
      if (zoomed()) {
        return; /* zoomed, the wheel scrolls the layer itself */
      }
      event.preventDefault();
      var now = Date.now();
      var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (event.deltaMode === 1) {
        delta *= 40;
      } else if (event.deltaMode === 2) {
        delta *= 400;
      }
      if (now - lastWheel > 250) {
        gathered = 0;
      }
      lastWheel = now;
      var notch = Math.abs(delta) >= 50;
      if (now < lockedUntil) {
        if (!notch) {
          lockedUntil = Math.max(lockedUntil, now + 120);
        }
        return;
      }
      gathered += delta;
      if (notch || Math.abs(gathered) >= 60) {
        if (gathered > 0) {
          next();
        } else {
          prev();
        }
        gathered = 0;
        lockedUntil = now + (notch ? 250 : 600);
      }
    },
    { passive: false }
  );

  /* ---- zoom by touch: two fingers on the slide. Touch events, not pointer events (a pointer cannot be stopped from becoming a
     tap or a swipe, and the browser's own pinch is off on the stage). The second finger's pointerdown comes BEFORE its
     touchstart, so clearing `down` here is enough: neither finger then makes a tap or a swipe, the one left on the glass included.
     The mouse drag of the zoomed slide moves with the pointer, captured by the stage. ---- */
  var pinch = null;

  function spread(touches) {
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.max(1, Math.sqrt(dx * dx + dy * dy));
  }

  if (canZoom) {
    stage.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length < 2 || !done.hidden) {
          return; /* one finger: a tap, a swipe or a scroll, as before */
        }
        if (event.cancelable) {
          event.preventDefault();
        }
        down = null;
        drag = null;
        dropHint();
        pinch = { distance: spread(event.touches), level: zoom };
      },
      { passive: false }
    );
    stage.addEventListener(
      "touchmove",
      function (event) {
        if (!pinch || event.touches.length < 2) {
          return;
        }
        if (event.cancelable) {
          event.preventDefault();
        }
        var rect = stage.getBoundingClientRect();
        var first = event.touches[0];
        var second = event.touches[1];
        setZoom(
          (pinch.level * spread(event.touches)) / pinch.distance,
          (first.clientX + second.clientX) / 2 - rect.left,
          (first.clientY + second.clientY) / 2 - rect.top
        );
      },
      { passive: false }
    );
    var endTouch = function (event) {
      if (!pinch) {
        return;
      }
      if (event.touches.length >= 2) {
        pinch = { distance: spread(event.touches), level: zoom }; /* a third finger left: go on with the two, without a jump */
        return;
      }
      pinch = null;
      down = null;
      if (zoom < CLOSE_BELOW) {
        setZoom(1);
      }
    };
    stage.addEventListener("touchend", endTouch);
    stage.addEventListener("touchcancel", endTouch);
    stage.addEventListener("gesturestart", function (event) {
      event.preventDefault(); /* older Safari: its own pinch would zoom the whole page */
    });
    stage.addEventListener("pointermove", function (event) {
      if (drag) {
        zoomLayer.scrollLeft = drag.left - (event.clientX - drag.x);
        zoomLayer.scrollTop = drag.top - (event.clientY - drag.y);
      }
    });
  }

  /* ---- the slider in the bar: every stop sets the level around the centre of the view. A focused slider keeps the ← → keys for
     itself: let go by mouse or finger, the focus goes back to the player so they turn the slide again; reached with the Tab key
     it keeps them, as a slider should. ---- */
  if (canZoom && zoomSlider) {
    var sliderHeld = false;
    var letGoOfSlider = function () {
      if (sliderHeld) {
        sliderHeld = false;
        stage.focus({ preventScroll: true });
      }
    };
    zoomSlider.addEventListener("input", function () {
      setZoom(parseInt(zoomSlider.value, 10) / 100);
    });
    zoomSlider.addEventListener("pointerdown", function () {
      sliderHeld = true;
    });
    document.addEventListener("pointerup", letGoOfSlider);
    document.addEventListener("pointercancel", letGoOfSlider);
  }

  /* ---- keys: ← / → anywhere on the page; the page's own scroll keys (Space, PageDown / PageUp, Home / End) and F only while
     the visitor is using the player — since the last click, tap or wheel on it, or with the focus in it or the screen filled —
     and back to the page after a click elsewhere ---- */
  var engaged = false;
  deck.addEventListener("pointerdown", function () {
    engaged = true;
  });
  stage.addEventListener("wheel", function () {
    engaged = true;
  });
  document.addEventListener("pointerdown", function (event) {
    if (!deck.contains(event.target)) {
      engaged = false;
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    var target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    var onControl = target && target.closest && target.closest("button, a");
    var inDeck = engaged || isFull() || (target && target.closest && !!target.closest("#deck"));
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        engaged = true;
        next();
        break;
      case "ArrowLeft":
        event.preventDefault();
        engaged = true;
        prev();
        break;
      case "PageDown":
        if (inDeck) {
          event.preventDefault();
          next();
        }
        break;
      case " ":
        if (inDeck && !onControl) {
          event.preventDefault(); /* on a focused button Space presses the button */
          next();
        }
        break;
      case "PageUp":
        if (inDeck) {
          event.preventDefault();
          prev();
        }
        break;
      case "Home":
        if (inDeck) {
          event.preventDefault();
          go(0);
        }
        break;
      case "End":
        if (inDeck) {
          event.preventDefault();
          go(total - 1);
        }
        break;
      case "f":
      case "F":
        if (inDeck) {
          event.preventDefault();
          toggleFull();
        }
        break;
      case "Escape":
        if (deck.classList.contains("is-pseudo-fullscreen")) {
          leaveLayer();
        }
        break;
      case "+":
      case "=":
        if (inDeck && canZoom) {
          event.preventDefault();
          setZoom(stepUp());
        }
        break;
      case "-":
        if (inDeck && canZoom) {
          event.preventDefault();
          setZoom(stepDown());
        }
        break;
      case "0":
        if (inDeck && canZoom) {
          event.preventDefault();
          setZoom(1);
        }
        break;
      default:
        break;
    }
  });

  /* ---- start: resume silently, show the hint for a few seconds ---- */
  var start = remembered();
  if (start > 0 && start < total) {
    go(start, false);
    if (toast) {
      toast.querySelector(".deck__toast-text").textContent = text("resume", "Where you left off: slide {number}").replace(
        "{number}",
        String(start + 1)
      );
      toast.hidden = false;
      window.setTimeout(function () {
        toast.hidden = true;
      }, 6000);
    }
  } else {
    go(0, false);
  }
  window.setTimeout(dropHint, 5000);
  label();
})();
