/* podcast.js — the site's own sound player (PLAN.md §2d, v1.14; his conditions, PROJECT_LOG ENTRY 039): one horizontal row in a thin
   frame: play / pause, −10 and +10 seconds, the time, the bar, the total, the speed. Every sound on a page gets one, and one plays at a
   time. The address stays the page's (library/audio.py); this script asks for no data until the play button, and a place chosen
   before that is simply kept until the first bytes have come. The place and the speed are remembered on this device, per sound, and the
   place comes back without a word; no network request of its own; no inline code and no style written from script (strict page
   policy): the bar's fill is a <progress> under the slider, and the play and pause icons are switched by a class on the button, which is
   read by the stylesheet (his report, LOG ENTRY 040: an SVG's own `hidden` property changes nothing on screen). Its words come from the page
   (data-text-*), so they are translated with the rest of the site. The phone's lock screen gets its buttons through the Media Session.
   Until this script has put the class is-ready on the box, the browser's own player stands there instead, so a page without scripts
   still plays. */
(function () {
  "use strict";

  var SPEEDS = [1, 1.25, 1.5, 2, 0.75];
  var STEP = 10; /* seconds of one −10 or +10 press */
  var SAVE_EVERY = 5; /* seconds of sound between two notes of the place */
  var RESTART_NEAR_END = 5; /* a place remembered this near the end starts over */
  var players = [];

  function read(name) {
    try {
      return window.localStorage.getItem(name);
    } catch (e) {
      return null; /* private window or blocked storage: no resume, nothing else changes */
    }
  }

  function write(name, value) {
    try {
      window.localStorage.setItem(name, String(value));
    } catch (e) {
      /* private window or blocked storage: no resume, nothing else changes */
    }
  }

  function clock(seconds) {
    var whole = Math.max(0, Math.round(seconds));
    var minutes = Math.floor(whole / 60);
    var rest = whole % 60;
    var hours = Math.floor(minutes / 60);
    var two = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return hours ? hours + ":" + two(minutes % 60) + ":" + two(rest) : minutes + ":" + two(rest);
  }

  /* the phone's lock screen and the keyboard's media keys act on the sound played last */
  function tellSession(player) {
    var media = window.navigator.mediaSession;
    if (!media) {
      return;
    }
    try {
      if (typeof window.MediaMetadata === "function") {
        media.metadata = new window.MediaMetadata({ title: player.title, artist: player.artist });
      }
      media.setActionHandler("play", player.play);
      media.setActionHandler("pause", player.pause);
      media.setActionHandler("seekbackward", function () {
        player.jump(-STEP);
      });
      media.setActionHandler("seekforward", function () {
        player.jump(STEP);
      });
      media.setActionHandler("seekto", function (details) {
        if (details && typeof details.seekTime === "number") {
          player.go(details.seekTime);
        }
      });
    } catch (e) {
      /* an older browser that does not know one of these: the page's own buttons still work */
    }
  }

  function setUp(box) {
    var audio = box.querySelector("audio");
    var toggle = box.querySelector('[data-action="toggle"]');
    var back = box.querySelector('[data-action="back"]');
    var forward = box.querySelector('[data-action="forward"]');
    var speedButton = box.querySelector('[data-action="speed"]');
    var seek = box.querySelector('[data-part="seek"]');
    var fill = box.querySelector('[data-part="fill"]');
    var time = box.querySelector('[data-part="time"]');
    var total = box.querySelector('[data-part="total"]');
    var message = box.querySelector('[data-part="message"]');
    if (!audio || !toggle || !back || !forward || !speedButton || !seek || !fill || !time || !total) {
      return; /* an older page: the browser's own player stays */
    }
    var key = box.getAttribute("data-podcast") || "sound";
    var placeKey = "dyg-podcast-" + key;
    var speedKey = "dyg-podcast-speed-" + key;
    var declared = Number(box.getAttribute("data-seconds")) || 0;
    var labels = (box.getAttribute("data-text-speeds") || "").split("|");
    var place = 0; /* the place shown, in seconds */
    var pending = null; /* a place asked for before the first bytes have come: the browser cannot go there yet */
    var dragging = false;
    var lastSaved = 0;
    var speedIndex = 0;

    function text(name) {
      return box.getAttribute("data-text-" + name) || "";
    }

    function length() {
      var known = audio.duration;
      return isFinite(known) && known > 0 ? known : declared;
    }

    function paint() {
      var whole = Math.round(length());
      seek.max = whole;
      fill.max = whole;
      time.textContent = clock(place);
      total.textContent = clock(length());
      if (!dragging) {
        seek.value = Math.round(place);
      }
      fill.value = Math.round(place);
      seek.setAttribute("aria-valuetext", text("place").replace("{place}", clock(place)).replace("{total}", clock(length())));
    }

    function remember() {
      write(placeKey, Math.floor(place));
      lastSaved = place;
    }

    function tellPosition() {
      var media = window.navigator.mediaSession;
      if (!media || typeof media.setPositionState !== "function" || !(length() > 0)) {
        return;
      }
      try {
        media.setPositionState({ duration: length(), playbackRate: SPEEDS[speedIndex], position: Math.min(place, length()) });
      } catch (e) {
        /* a value the browser would not take: only the lock screen's bar is behind for a moment */
      }
    }

    function go(seconds) {
      place = Math.min(Math.max(seconds, 0), length());
      if (audio.readyState >= 1) {
        audio.currentTime = place;
        pending = null;
      } else {
        pending = place;
      }
      paint();
      remember();
      tellPosition();
    }

    function showMessage(on) {
      if (message) {
        message.textContent = on ? text("error") : "";
        message.hidden = !on;
      }
    }

    function applySpeed() {
      var speed = SPEEDS[speedIndex];
      var label = labels[speedIndex] || speed + "×";
      audio.defaultPlaybackRate = speed; /* a sound's first load sets the rate back to this one */
      audio.playbackRate = speed;
      speedButton.textContent = label;
      speedButton.setAttribute("aria-label", text("speed").replace("{speed}", label));
    }

    function start() {
      showMessage(false);
      if (audio.error) {
        pending = place; /* it failed before (the connection, say): a new try, from the same place */
        audio.load();
      }
      var started = audio.play();
      if (started && typeof started.catch === "function") {
        started.catch(function () {
          /* a pause pressed at once, or a failure the error event below reports */
        });
      }
    }

    var player = {
      audio: audio,
      title: box.getAttribute("data-title") || "",
      artist: box.getAttribute("data-artist") || "",
      play: start,
      pause: function () {
        audio.pause();
      },
      go: go,
      jump: function (by) {
        go(place + by);
      },
    };

    function showPlaying(on) {
      toggle.classList.toggle("is-playing", on);
      toggle.setAttribute("aria-label", text(on ? "pause" : "play"));
    }

    audio.addEventListener("play", function () {
      players.forEach(function (other) {
        if (other !== player && !other.audio.paused) {
          other.audio.pause();
        }
      });
      showPlaying(true);
      tellSession(player);
    });

    audio.addEventListener("pause", function () {
      showPlaying(false);
      remember();
    });

    audio.addEventListener("ended", function () {
      showPlaying(false);
      place = 0;
      pending = null;
      remember();
      paint();
    });

    audio.addEventListener("loadedmetadata", function () {
      if (pending !== null) {
        audio.currentTime = Math.min(pending, length());
        pending = null;
      }
      applySpeed();
      paint();
      tellPosition();
    });

    audio.addEventListener("timeupdate", function () {
      if (dragging || pending !== null) {
        return;
      }
      place = audio.currentTime;
      paint();
      if (Math.abs(place - lastSaved) >= SAVE_EVERY) {
        remember();
        tellPosition();
      }
    });

    audio.addEventListener("error", function () {
      showPlaying(false);
      showMessage(true);
    });

    toggle.addEventListener("click", function () {
      if (audio.paused) {
        start();
      } else {
        audio.pause();
      }
    });
    back.addEventListener("click", function () {
      player.jump(-STEP);
    });
    forward.addEventListener("click", function () {
      player.jump(STEP);
    });
    speedButton.addEventListener("click", function () {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      applySpeed();
      write(speedKey, SPEEDS[speedIndex]);
      tellPosition();
    });

    /* while the thumb is held the numbers follow it and the sound goes on; the jump comes when it is let go */
    seek.addEventListener("input", function () {
      dragging = true;
      place = Number(seek.value);
      paint();
    });
    seek.addEventListener("change", function () {
      dragging = false;
      go(Number(seek.value));
    });
    seek.addEventListener("pointercancel", function () {
      dragging = false;
    });

    var savedSpeed = SPEEDS.indexOf(Number(read(speedKey)));
    speedIndex = savedSpeed > 0 ? savedSpeed : 0;
    var saved = Number(read(placeKey));
    if (saved > 0 && saved < declared - RESTART_NEAR_END) {
      place = saved;
      pending = saved;
      lastSaved = saved;
    }
    applySpeed();
    paint();
    players.push(player);
    box.classList.add("is-ready");
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-podcast]"), setUp);
})();
