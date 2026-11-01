/* player.js — the practice-test player (PLAN.md §2c point 3, v1.7: one question per screen; §2b v1.6 before it). The whole
   test is in the page's own markup (practice/templates/practice/test.html): each question cut out of its page with an overlay
   of option areas and pen circles drawn by the server, the answer sheet with each row's right letter (data-answer), each
   solution behind a button, and the words the player writes (data-text-*, translated with the rest of the site; "{letter}",
   "{number}", "{count}" and "{time}" stand for values).
   One question is on the screen at a time (the hidden attribute on the others); the arrow buttons, the number strip, the left
   and right arrow keys and a tap on another row of the answer sheet move between them. An option is chosen by tapping it on the
   question or its letter on the answer sheet, and shows on both: its circle draws itself on the question and the sheet's letter
   is pressed.
   Two modes. "Like a real exam" (a timed test only): two countdowns — the whole test (it finishes the test at zero) and the
   current question (it starts again at every change of question; at zero it turns red and counts the overrun, "+0:20", and the
   student stays); a switch hides or shows the question's countdown; answers can be changed or cleared; nothing about right or
   wrong and no solution before the end. "Practice": no countdown, the time used shown small; an answer is final and is marked
   at once — a wrong one shows the right option circled in green — with the solution and its video behind their buttons.
   After the end: the result, then the review in the same one-question view (each answer, the right one, the time spent on that
   question, the solution and video buttons). The time of a question is the time it was on the screen while the test ran,
   summed over its visits. Every clock is worked out from the real time at every tick, so a background tab whose timers are
   slowed still shows, and stops at, the right time. The LGS net (correct − wrong ÷ 3) is computed in whole hundredths, never
   rounded from a float. Keys while the test runs: A–E or 1–5 answer the current question, the left and right arrows move (also
   in the review); the up and down arrows are left to the page, which may be taller than the screen.
   Nothing is stored or sent anywhere: a reload starts the test fresh. No inline code, no HTML built from text and no look
   written from script (the page policy): the player changes only the hidden attribute, classes, aria-* attributes, disabled
   and text, and puts a solution video's cover button back in place of its player when the question is left.
   Beside it pen.js (the free pen) works on the same markup; the player only tells it, with a plain event on the section, when
   the test has ended ("test:finish") and when the page was set back to its start ("test:reset"). */
(function () {
  "use strict";

  var section = document.getElementById("test");
  if (!section) {
    return;
  }

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function listOf(list) {
    return Array.prototype.slice.call(list);
  }

  function letterOf(el) {
    return (el.getAttribute("data-letter") || "").toUpperCase();
  }

  function part(name, within) {
    return (within || section).querySelector('[data-part="' + name + '"]');
  }

  /* the question screens and the number strip, by question number */
  var questionByNumber = Object.create(null);
  each(section.querySelectorAll(".question"), function (el) {
    questionByNumber[el.getAttribute("data-number") || ""] = el;
  });
  var stripByNumber = Object.create(null);
  each(section.querySelectorAll('[data-action="go"]'), function (el) {
    stripByNumber[el.getAttribute("data-number") || ""] = el;
  });

  /* one record per row of the answer sheet; "chosen" is the letter given ("" = blank), "locked" = a practice answer */
  var rows = [];
  each(section.querySelectorAll(".sheet__row"), function (el) {
    var number = el.getAttribute("data-number") || "";
    var question = questionByNumber[number] || null;
    var mark = part("mark", el);
    var strip = stripByNumber[number] || null;
    var solutionButton = question ? question.querySelector('[data-action="solution"]') : null;
    var video = question ? part("video", question) : null;
    rows.push({
      el: el,
      number: number,
      answer: (el.getAttribute("data-answer") || "").toUpperCase(),
      options: listOf(el.querySelectorAll(".sheet__option")),
      mark: mark,
      live: mark ? mark.getAttribute("aria-live") : null,
      question: question,
      circles: question ? listOf(question.querySelectorAll(".question__option")) : [],
      after: question ? part("after", question) : null,
      result: question ? part("result", question) : null,
      spent: question ? part("spent", question) : null,
      solution: question ? part("solution", question) : null,
      solutionButton: solutionButton,
      solutionLabel: solutionButton ? solutionButton.textContent : "",
      video: video,
      videoHome: video ? video.parentNode : null,
      strip: strip,
      stripState: strip ? part("state", strip) : null,
      chosen: "",
      locked: false,
      spentMs: 0
    });
  });
  if (!rows.length) {
    return;
  }

  var startScreen = part("start");
  var work = part("work");
  var bar = part("bar");
  var timer = part("timer");
  var timerLabel = part("timer-label");
  var questionClock = part("question-clock");
  var questionTimer = part("question-timer");
  var clockSwitch = section.querySelector('[data-action="question-clock"]');
  var answeredCount = part("answered");
  var confirmBox = part("confirm");
  var blankCount = part("blank-count");
  var end = part("end");
  var timeUpNote = part("time-up"); /* the page may carry its own; otherwise one is made the first time the time runs out */
  var strip = part("strip");
  var questionsArea = part("questions");
  var position = part("position");
  var announcer = part("announce");
  var prevButton = section.querySelector('[data-action="prev"]');
  var nextButton = section.querySelector('[data-action="next"]');
  var sheet = document.getElementById("test-sheet");
  var sheetButton = section.querySelector('[data-action="sheet"]');

  /* the words and numbers as the page first showed them: "Solve again" puts them back */
  var counters = ["timer", "timer-label", "question-timer", "answered", "blank-count", "correct", "wrong", "blank", "net",
    "time-used", "position", "announce"].map(function (name) {
    var el = part(name);
    return { el: el, text: el ? el.textContent : "" };
  });
  var timerName = timer ? timer.getAttribute("aria-label") : null;
  var switchLabel = clockSwitch ? clockSwitch.textContent : "";

  var minutes = parseInt(section.getAttribute("data-minutes"), 10);
  var timed = section.getAttribute("data-timed") === "true" && minutes > 0;
  var questionSeconds = Math.max(0, parseInt(section.getAttribute("data-question-seconds"), 10) || 0);
  var showNet = section.getAttribute("data-net") === "true";
  var decimalSign = section.getAttribute("data-decimal") === "," ? "," : ".";

  var state = "ready"; /* "ready" (the start screen), "running", "ended" (the result and the review) */
  var mode = "practice";
  var limit = 0; /* seconds of the whole test's countdown; 0 = the clock counts up */
  var startedAt = 0;
  var enteredAt = 0; /* when the current question came on the screen (while the test runs) */
  var ticker = null;
  var current = 0;
  var questionClockHidden = false;

  function setText(el, value) {
    if (el) {
      el.textContent = value;
    }
  }

  function setHidden(el, hidden) {
    if (el) {
      el.hidden = hidden;
    }
  }

  /* a plain event on the section for the scripts beside this one (pen.js); nobody listening = nothing happens */
  function tell(name) {
    if (typeof CustomEvent === "function" && typeof section.dispatchEvent === "function") {
      section.dispatchEvent(new CustomEvent("test:" + name));
    }
  }

  function words(name, values) {
    var value = section.getAttribute("data-text-" + name) || "";
    if (values) {
      Object.keys(values).forEach(function (key) {
        value = value.split("{" + key + "}").join(values[key]);
      });
    }
    return value;
  }

  function optionFor(row, letter) {
    for (var i = 0; i < row.options.length; i += 1) {
      if (letterOf(row.options[i]) === letter) {
        return row.options[i];
      }
    }
    return null;
  }

  function rowWhere(key, el) {
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i][key] === el) {
        return rows[i];
      }
    }
    return null;
  }

  /* ---- the clocks: m:ss, worked out from the real time ---- */
  function clockText(seconds) {
    var whole = Math.max(0, Math.floor(seconds));
    var rest = whole % 60;
    return Math.floor(whole / 60) + ":" + (rest < 10 ? "0" : "") + rest;
  }

  function elapsedMs() {
    return Math.max(0, Date.now() - startedAt);
  }

  function timeIsUp() {
    return limit > 0 && elapsedMs() >= limit * 1000;
  }

  function questionClockOn() {
    return mode === "exam" && questionSeconds > 0 && questionTimer !== null;
  }

  /* the question's countdown: from the ideal seconds down to 0:00, then red with the time over it ("+0:20") */
  function showQuestionClock() {
    if (state !== "running" || !questionClockOn()) {
      return;
    }
    var left = questionSeconds * 1000 - Math.max(0, Date.now() - enteredAt);
    var over = left <= 0;
    if (questionClock) {
      questionClock.classList.toggle("is-over", over);
    }
    setText(questionTimer, over ? "+" + clockText(Math.floor(-left / 1000)) : clockText(Math.ceil(left / 1000)));
  }

  function showClock() {
    var ms = elapsedMs();
    if (limit > 0) {
      /* time left rounds up and time used rounds down, so the two always add up to the full time */
      setText(timer, clockText(Math.ceil((limit * 1000 - Math.min(ms, limit * 1000)) / 1000)));
    } else {
      setText(timer, clockText(Math.floor(ms / 1000)));
    }
    showQuestionClock();
  }

  function stopClock() {
    if (ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
  }

  function tick() {
    if (state !== "running") {
      return;
    }
    if (timeIsUp()) {
      finish(true);
      return;
    }
    showClock();
  }

  /* the time the current question has been on the screen goes to its account, up to "until" — never past the end of the
     test's countdown, so the questions' times add up to the time used */
  function account(until) {
    if (limit > 0) {
      until = Math.min(until, startedAt + limit * 1000);
    }
    var row = rows[current];
    if (row && until > enteredAt) {
      row.spentMs += until - enteredAt;
    }
    enteredAt = Math.max(enteredAt, until);
  }

  /* ---- counting ---- */
  function tally() {
    var counts = { answered: 0, right: 0, wrong: 0, blank: 0 };
    rows.forEach(function (row) {
      if (!row.chosen) {
        counts.blank += 1;
      } else {
        counts.answered += 1;
        if (row.chosen === row.answer) {
          counts.right += 1;
        } else {
          counts.wrong += 1;
        }
      }
    });
    return counts;
  }

  function showCount() {
    var counts = tally();
    setText(answeredCount, String(counts.answered));
    setText(blankCount, String(counts.blank));
  }

  /* The LGS net = correct − wrong ÷ 3 (the MEB guide: no lower bound, so it can be negative), with exactly two decimals, in
     whole hundredths: 100 × (3 × correct − wrong) ÷ 3 is an integer plus 0, 1/3 or 2/3, so rounding it never meets a tie and
     is exact for negative values too. Written from integers only, with the true minus sign; zero is never "−0,00". */
  function netText(right, wrong) {
    var hundredths = Math.round((100 * (3 * right - wrong)) / 3);
    var size = Math.abs(hundredths);
    var rest = size % 100;
    return (hundredths < 0 ? "\u2212" : "") + Math.floor(size / 100) + decimalSign + (rest < 10 ? "0" : "") + rest;
  }

  /* ---- one question ---- */
  var RESULTS = ["is-right", "is-wrong", "is-blank"];

  function dropClasses(el, names) {
    if (el) {
      names.forEach(function (name) {
        el.classList.remove(name);
      });
    }
  }

  /* the number strip: answered (and, once marked, right / wrong / blank) for the eye and in words for screen readers */
  function showStrip(row, result) {
    if (!row.strip) {
      return;
    }
    dropClasses(row.strip, RESULTS);
    row.strip.classList.toggle("is-answered", row.chosen !== "");
    if (result) {
      row.strip.classList.add("is-" + result);
    }
    var said = result ? words(result === "right" ? "correct" : result) : row.chosen ? words("answered") : "";
    setText(row.stripState, said ? ", " + said : "");
  }

  /* the chosen option on both: the sheet's letter pressed, the circle on the question drawn (is-chosen) */
  function press(row) {
    row.options.forEach(function (button) {
      button.setAttribute("aria-pressed", row.chosen && letterOf(button) === row.chosen ? "true" : "false");
    });
    row.circles.forEach(function (circle) {
      circle.classList.toggle("is-chosen", row.chosen !== "" && letterOf(circle) === row.chosen);
    });
    showStrip(row, "");
  }

  /* a result: a sign for the eye and the words (on the sheet the words are for screen readers only, on the question for all) */
  function writeResult(target, row, result, spokenOnly) {
    if (!target) {
      return;
    }
    var said = [words(result === "right" ? "correct" : result)];
    if (result === "wrong") {
      said.push(words("chosen", { letter: row.chosen }));
    }
    if (result !== "right") {
      said.push(words("right", { letter: row.answer }));
    }
    said = said.filter(function (value) {
      return value !== "";
    });
    target.textContent = "";
    var sign = document.createElement("span");
    sign.setAttribute("aria-hidden", "true");
    sign.textContent = result === "right" ? "\u2713" : result === "wrong" ? "\u2717" : "\u2013";
    target.appendChild(sign);
    if (said.length) {
      var spoken = document.createElement("span");
      if (spokenOnly) {
        spoken.classList.add("visually-hidden");
      }
      spoken.textContent = " " + said.join(". ");
      target.appendChild(spoken);
    }
  }

  /* right / wrong / blank on the sheet, the question and the strip: the right option in green on both, a wrong choice's circle
     red, the result under the question with the solution and video buttons; the question can no longer be answered */
  function reveal(row) {
    var result = !row.chosen ? "blank" : row.chosen === row.answer ? "right" : "wrong";
    [row.el, row.question].forEach(function (el) {
      dropClasses(el, RESULTS);
      if (el) {
        el.classList.add("is-" + result);
      }
    });
    if (row.question) {
      row.question.classList.add("is-locked");
    }
    row.options.forEach(function (button) {
      button.classList.toggle("is-answer", letterOf(button) === row.answer);
      button.disabled = true;
    });
    row.circles.forEach(function (circle) {
      var letter = letterOf(circle);
      circle.classList.toggle("is-answer", letter === row.answer);
      circle.classList.toggle("is-wrong", letter === row.chosen && letter !== row.answer);
    });
    writeResult(row.mark, row, result, true);
    writeResult(row.result, row, result, false);
    showStrip(row, result);
    setHidden(row.after, false);
  }

  /* a solution video that was started is put back to its cover button (it stops; nothing plays on a hidden question) */
  function unloadVideo(row) {
    if (!row || !row.video || !row.videoHome || row.video.parentNode === row.videoHome) {
      return;
    }
    var frame = null;
    each(listOf(row.videoHome.children), function (child) {
      if (frame === null && child.tagName === "IFRAME") {
        frame = child;
      }
    });
    if (frame) {
      row.videoHome.replaceChild(row.video, frame);
    }
  }

  function toggleSolution(row) {
    if (!row || !row.solution || !row.solutionButton || !(row.locked || state === "ended")) {
      return; /* never before the question is marked */
    }
    var show = row.solution.hidden;
    row.solution.hidden = !show;
    row.solutionButton.setAttribute("aria-expanded", show ? "true" : "false");
    setText(row.solutionButton, show ? words("solution-hide") || row.solutionLabel : row.solutionLabel);
  }

  /* ---- the current question (the keys act on it; only it is on the screen) ---- */
  function focusRow(row, quiet) {
    var target = null;
    row.options.forEach(function (button) {
      if (!button.disabled && (target === null || (row.chosen && letterOf(button) === row.chosen))) {
        target = button;
      }
    });
    if (target) {
      target.focus(quiet ? { preventScroll: true } : undefined);
    }
  }

  function bringIntoView() {
    if (!questionsArea || typeof questionsArea.getBoundingClientRect !== "function" ||
        typeof questionsArea.scrollIntoView !== "function") {
      return;
    }
    if (questionsArea.getBoundingClientRect().top < 0) {
      questionsArea.scrollIntoView({ block: "start" }); /* the question's top was above the screen */
    }
  }

  /* how: { focus, quiet, announce, scroll } */
  function show(index, how) {
    how = how || {};
    var next = Math.max(0, Math.min(rows.length - 1, index));
    if (next !== current) {
      if (state === "running") {
        account(Date.now()); /* the question's countdown starts again from here */
      }
      unloadVideo(rows[current]);
    }
    current = next;
    rows.forEach(function (row, i) {
      row.el.classList.toggle("is-current", i === current);
      setHidden(row.question, i !== current);
      if (row.strip) {
        if (i === current) {
          row.strip.setAttribute("aria-current", "true");
        } else {
          row.strip.removeAttribute("aria-current");
        }
      }
    });
    if (prevButton) {
      prevButton.setAttribute("aria-disabled", current === 0 ? "true" : "false");
    }
    if (nextButton) {
      nextButton.setAttribute("aria-disabled", current === rows.length - 1 ? "true" : "false");
    }
    var where = words("position", { number: rows[current].number, count: String(rows.length) });
    setText(position, where);
    if (how.announce) {
      setText(announcer, where);
    }
    showQuestionClock();
    if (how.scroll) {
      bringIntoView();
    }
    if (how.focus) {
      focusRow(rows[current], how.quiet);
    }
  }

  /* a move asked for by the student (the arrows, the strip, the arrow keys): after the deadline it finishes the test instead */
  function goTo(index, how) {
    if (state === "running" && timeIsUp()) {
      finish(true);
      return;
    }
    if (state === "running" || state === "ended") {
      show(index, how);
    }
  }

  /* ---- the steps of a test ---- */
  function begin(chosenMode) {
    if (state !== "ready") {
      return;
    }
    mode = chosenMode === "exam" ? "exam" : "practice";
    limit = mode === "exam" && timed ? minutes * 60 : 0;
    state = "running";
    section.classList.add("is-running"); /* the stylesheet's hooks while the test runs */
    section.classList.add("is-" + mode);
    if (mode === "practice" && words("time-used")) {
      setText(timerLabel, words("time-used"));
      if (timer) {
        timer.setAttribute("aria-label", words("time-used"));
      }
    }
    setHidden(questionClock, !questionClockOn());
    setHidden(clockSwitch, !questionClockOn());
    startedAt = Date.now();
    enteredAt = startedAt;
    setHidden(startScreen, true);
    setHidden(work, false);
    setHidden(bar, false);
    show(0, { focus: true, quiet: true });
    showClock();
    showCount();
    ticker = window.setInterval(tick, 1000);
  }

  /* an option tapped on the question or on the sheet, or its key: the screen goes to that question; practice locks the answer
     at once and marks it; the exam mode picks, changes or clears */
  function pick(row, letter) {
    if (state !== "running") {
      return;
    }
    if (timeIsUp()) {
      finish(true); /* the time ran out before this answer: it does not count */
      return;
    }
    var index = rows.indexOf(row);
    if (index !== current) {
      show(index, { scroll: true });
    }
    if (row.locked || !letter || !optionFor(row, letter)) {
      return;
    }
    if (mode === "practice") {
      row.chosen = letter;
      row.locked = true;
      press(row);
      reveal(row);
    } else {
      row.chosen = row.chosen === letter ? "" : letter;
      press(row);
    }
    showCount();
  }

  function askToFinish() {
    if (state !== "running") {
      return;
    }
    if (timeIsUp()) {
      finish(true);
      return;
    }
    var blanks = tally().blank;
    if (blanks > 0) {
      setText(blankCount, String(blanks));
      setHidden(confirmBox, false);
      var yes = section.querySelector('[data-action="finish-now"]');
      if (yes) {
        yes.focus();
      }
      return;
    }
    finish(false);
  }

  function showTimeUp(timeUp) {
    if (timeUp && !timeUpNote && end) {
      timeUpNote = document.createElement("p");
      timeUpNote.classList.add("test__time-up");
      var heading = end.querySelector("h2");
      if (heading && heading.parentNode) {
        heading.parentNode.insertBefore(timeUpNote, heading.nextSibling);
      } else {
        end.appendChild(timeUpNote);
      }
    }
    if (timeUpNote) {
      if (timeUp) {
        timeUpNote.textContent = words("time-up");
      }
      timeUpNote.hidden = !timeUp;
    }
  }

  function finish(timeUp) {
    if (state !== "running") {
      return;
    }
    account(Date.now()); /* the last question's time (a late tick in a background tab adds nothing past the deadline) */
    state = "ended";
    section.classList.remove("is-running");
    section.classList.add("is-finished"); /* the stylesheet's hook from the end until "Solve again" */
    stopClock();
    var usedSeconds = Math.floor(elapsedMs() / 1000);
    if (limit > 0) {
      usedSeconds = timeUp ? limit : Math.min(limit, usedSeconds);
    }
    showClock();
    setHidden(bar, true);
    setHidden(confirmBox, true);
    rows.forEach(function (row) {
      if (row.mark) {
        row.mark.setAttribute("aria-live", "off"); /* the result is read once from the end screen, not row by row */
      }
      reveal(row);
      setText(row.spent, words("spent", { time: clockText(Math.floor(row.spentMs / 1000)) }));
      setHidden(row.spent, false);
    });
    var counts = tally();
    setText(part("correct"), String(counts.right));
    setText(part("wrong"), String(counts.wrong));
    setText(part("blank"), String(counts.blank));
    if (showNet) {
      setText(part("net"), netText(counts.right, counts.wrong));
    }
    setText(part("time-used"), clockText(usedSeconds));
    showTimeUp(timeUp);
    show(0); /* the review starts at the first question */
    if (end) {
      end.hidden = false;
      end.focus();
    }
    tell("finish");
  }

  function setSheet(isOpen) {
    if (sheet) {
      sheet.classList.toggle("is-open", isOpen);
    }
    if (sheetButton) {
      sheetButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
  }

  /* after the end: the review (the number strip, the question, the answer sheet) comes into view */
  function review() {
    if (state !== "ended") {
      return;
    }
    setSheet(true);
    var target = strip || questionsArea || sheet;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
    }
    var row = rows[current];
    if (row.strip) {
      row.strip.focus({ preventScroll: true });
    } else if (sheet) {
      sheet.focus({ preventScroll: true }); /* takes the focus only where the sheet is focusable (tabindex) */
    }
  }

  /* back to the start screen, as the page first loaded */
  function reset() {
    stopClock();
    state = "ready";
    ["is-running", "is-finished", "is-exam", "is-practice"].forEach(function (name) {
      section.classList.remove(name);
    });
    mode = "practice";
    limit = 0;
    startedAt = 0;
    enteredAt = 0;
    questionClockHidden = false;
    rows.forEach(function (row, i) {
      row.chosen = "";
      row.locked = false;
      row.spentMs = 0;
      dropClasses(row.el, RESULTS.concat(["is-current"]));
      dropClasses(row.question, RESULTS.concat(["is-locked"]));
      row.options.forEach(function (button) {
        button.setAttribute("aria-pressed", "false");
        button.classList.remove("is-answer");
        button.disabled = false;
      });
      row.circles.forEach(function (circle) {
        dropClasses(circle, ["is-chosen", "is-answer", "is-wrong"]);
      });
      if (row.strip) {
        dropClasses(row.strip, RESULTS.concat(["is-answered"]));
        row.strip.removeAttribute("aria-current");
      }
      setText(row.stripState, "");
      if (row.mark) {
        row.mark.textContent = "";
        if (row.live === null) {
          row.mark.removeAttribute("aria-live");
        } else {
          row.mark.setAttribute("aria-live", row.live);
        }
      }
      setText(row.result, "");
      setText(row.spent, "");
      setHidden(row.spent, true);
      setHidden(row.after, true);
      setHidden(row.solution, true);
      if (row.solutionButton) {
        row.solutionButton.setAttribute("aria-expanded", "false");
        setText(row.solutionButton, row.solutionLabel);
      }
      unloadVideo(row);
      setHidden(row.question, i !== 0);
    });
    current = 0;
    if (prevButton) {
      prevButton.removeAttribute("aria-disabled");
    }
    if (nextButton) {
      nextButton.removeAttribute("aria-disabled");
    }
    counters.forEach(function (counter) {
      setText(counter.el, counter.text);
    });
    if (timer) {
      if (timerName === null) {
        timer.removeAttribute("aria-label");
      } else {
        timer.setAttribute("aria-label", timerName);
      }
    }
    if (questionClock) {
      questionClock.classList.remove("is-over");
    }
    setHidden(questionClock, true);
    if (clockSwitch) {
      setText(clockSwitch, switchLabel);
      clockSwitch.hidden = true;
    }
    if (timeUpNote) {
      timeUpNote.hidden = true;
    }
    setHidden(end, true);
    setHidden(confirmBox, true);
    setHidden(bar, true);
    setHidden(work, true); /* shown without scripting only; the start screen leads in */
    setHidden(startScreen, false);
    setSheet(false);
    tell("reset");
  }

  /* the switch: the question's countdown hidden or shown (it keeps counting either way) */
  function toggleQuestionClock() {
    if (state !== "running" || !questionClockOn()) {
      return;
    }
    questionClockHidden = !questionClockHidden;
    setHidden(questionClock, questionClockHidden);
    setText(clockSwitch, questionClockHidden ? words("clock-show") || switchLabel : switchLabel);
  }

  /* ---- buttons and options (one listener for all) ---- */
  section.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) {
      return;
    }
    var option = target.closest(".sheet__option");
    if (option && section.contains(option)) {
      var sheetRow = rowWhere("el", option.closest(".sheet__row"));
      if (sheetRow) {
        pick(sheetRow, letterOf(option));
      }
      return;
    }
    var circle = target.closest(".question__option");
    if (circle && section.contains(circle)) {
      var questionRow = rowWhere("question", circle.closest(".question"));
      if (questionRow) {
        pick(questionRow, letterOf(circle));
      }
      return;
    }
    var button = target.closest("[data-action]");
    if (!button || !section.contains(button)) {
      return;
    }
    var action = button.getAttribute("data-action");
    if (action === "start") {
      begin(button.getAttribute("data-mode"));
    } else if (action === "finish") {
      askToFinish();
    } else if (action === "finish-now") {
      finish(timeIsUp());
    } else if (action === "finish-cancel") {
      setHidden(confirmBox, true);
      if (state === "running") {
        focusRow(rows[current]);
      }
    } else if (action === "review") {
      review();
    } else if (action === "restart") {
      reset();
      var first = section.querySelector('[data-action="start"]');
      if (first) {
        first.focus();
      }
    } else if (action === "sheet") {
      setSheet(!(sheet && sheet.classList.contains("is-open")));
    } else if (action === "prev" || action === "next") {
      goTo(current + (action === "next" ? 1 : -1), { announce: true, scroll: true });
    } else if (action === "go") {
      var row = rowWhere("number", button.getAttribute("data-number") || "");
      if (row) {
        goTo(rows.indexOf(row), { announce: true, scroll: true });
      }
    } else if (action === "question-clock") {
      toggleQuestionClock();
    } else if (action === "solution") {
      toggleSolution(rowWhere("solutionButton", button));
    }
  });

  /* ---- keys: A–E or 1–5 answer the current question (like a tap) while the test runs; the left and right arrows move, also
     in the review ---- */
  document.addEventListener("keydown", function (event) {
    if ((state !== "running" && state !== "ended") || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    var target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ""))) {
      return;
    }
    var key = event.key || "";
    if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault();
      goTo(current + (key === "ArrowRight" ? 1 : -1), { announce: true, scroll: true, focus: state === "running" });
      return;
    }
    if (state !== "running" || event.repeat) {
      return; /* a held key would clear and pick again and again */
    }
    var row = rows[current];
    var button = null;
    if (/^[1-5]$/.test(key)) {
      button = row.options[parseInt(key, 10) - 1] || null;
    } else if (/^[a-eA-E]$/.test(key)) {
      button = optionFor(row, key.toUpperCase());
    }
    if (button) {
      pick(row, letterOf(button));
      if (state === "running") {
        focusRow(rows[current]);
      }
    }
  });

  reset();
})();
