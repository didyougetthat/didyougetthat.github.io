/* pen.js — the free pen over the questions of a practice test (PLAN.md §2c points 4–5: "as if working on paper"). It belongs to
   practice/templates/practice/test.html and works beside player.js through the page's markup only: no global is shared.
   Tools (the buttons of [data-part="tools"]; one is on at a time, aria-pressed): "Mark" (the default — a tap on an option chooses
   it, as the player does), "Pen" and "Highlighter" (drawing), "Eraser" (rubs out only the part it passes over, like a real
   eraser), "Line eraser" (a touch on a line removes the whole line), "Cross out" (a tap on an option strikes it through, or takes
   the strike away; it is the student's own reminder: it never chooses or clears an answer and is not counted), "Undo" (the last
   stroke, rub, sweep or cross-out of the question on the screen) and "Clear" (everything on that question). A stylus' eraser end
   rubs out whatever tool is on.
   Surfaces. A question has one surface per picture and ONE scratch paper. Each picture (figure.question__piece) carries two canvases,
   canvas.question__canvas[data-ink="highlighter"] (under) and [data-ink="pen"] (over), with data-width / data-height = the picture's
   own pixel size; the bitmap is made at that size the first time a stroke is drawn on it and is scaled with the picture by the
   stylesheet, so strokes kept in the picture's own coordinates scale with it. The scratch paper is the question body
   (div.question__body: the pictures and the blank strip under them) with two canvases over the whole of it,
   canvas.question__scratch[data-ink="highlighter" | "pen"]; its coordinates are thousandths of the body's width (so a stroke
   scales with the width, whatever is shown below the pictures), its bitmap is made at the body's size times the screen density
   (at most 2) the first time a stroke is drawn on it, and it is made again, with the strokes replayed, when the body changes size
   (the window, or the strip appearing or going away). Each option g.question__option carries a path.question__strike. Colours and
   the look are the stylesheet's: a canvas draws in the colour its element has (read from the page's colour tokens), and the
   highlighter's see-through look is the stylesheet's too.
   Routing. No picture canvas takes the pointer: while a drawing tool is on (the class is-drawing on the question, with is-pen /
   is-highlighter / is-eraser / is-line-eraser; touch-action: none comes from the stylesheet with it) the body's top scratch canvas
   (.question__scratch--ink) takes it and this script decides the surface. A pen or highlighter stroke that starts over a picture
   goes to that picture's canvas of the tool's ink (the canvas clips it at the picture's edge); one that starts anywhere else goes
   to the scratch paper's canvas of that ink. A stroke stays on the surface it started on. The pointer is captured on the scratch
   canvas. With "Mark" or "Cross out" on, nothing takes the pointer: the page scrolls and the option areas answer taps again.
   Erasers. A gesture runs from the pointer going down to it going up. The eraser adds the points it passes to an eraser stroke
   (24 CSS pixels wide) on every SIZED canvas of every surface it is over, within its radius of the surface's edge; a surface that
   is left and entered again gets a new eraser stroke, so nothing is cut across a gap. A canvas never drawn on has nothing to erase
   and is never made for an eraser. Eraser strokes are kept in order with the ink and painted with "destination-out", so Undo takes
   them away and the ink beneath is there again. The line eraser removes every ink stroke (never an eraser stroke) that has a dot or
   a piece of line within 10 CSS pixels plus half its width of the places the pointer passed; Undo puts them back where they were.
   Each gesture is ONE entry in the history, with the strokes and cross-outs.
   What the student drew is kept in this page's memory per question while the test runs (it is there again on coming back to the
   question) and is gone when the test ends, at "Solve again" and on reload: nothing is stored or sent anywhere. player.js tells
   the end and the new start with the events "test:finish" and "test:reset" on the section. The class has-scratch on the question
   says that its scratch paper holds ink (the stylesheet keeps the strip shown then). No inline code, no HTML built from text and
   no look written from script (the page policy): the script changes only classes, aria-pressed, hidden and the canvas bitmaps. */
(function () {
  "use strict";

  var section = document.getElementById("test");
  var tools = section ? section.querySelector('[data-part="tools"]') : null;
  if (!section || !tools) {
    return;
  }

  var LINE_WIDTH = { pen: 2.5, highlighter: 16 }; /* on the screen, in CSS pixels; stored in the surface's own units */
  var ERASER_SIZE = 24; /* the width of a rub, in CSS pixels (a radius of 12) */
  var LINE_REACH = 10; /* how far from the pointer the line eraser takes a line, in CSS pixels (plus half the line's width) */
  var PAPER_UNITS = 1000; /* the scratch paper's width in its own units */
  var MAX_STROKES = 300; /* per canvas; eraser strokes count */
  var MAX_POINTS = 4000; /* per stroke */
  var TOOL_NAMES = ["mark", "pen", "highlighter", "eraser", "line-eraser", "strike"];
  var DRAWING_TOOLS = ["pen", "highlighter", "eraser", "line-eraser"];

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function listOf(list) {
    return Array.prototype.slice.call(list);
  }

  function tenth(value) {
    return Math.round(value * 10) / 10;
  }

  function drawingTool(name) {
    return DRAWING_TOOLS.indexOf(name) >= 0;
  }

  /* the tool buttons by tool name */
  var toolButtons = Object.create(null);
  each(tools.querySelectorAll("[data-tool]"), function (button) {
    toolButtons[button.getAttribute("data-tool") || ""] = button;
  });

  /* one record per question: its surfaces (the pictures, then the scratch paper), each with its canvases and the strokes drawn on
     each canvas; its option areas; and its history (the gestures and cross-outs in the order they were made, which "Undo" takes
     back from the end). A stroke is { size, points: [[x, y, pressure], …] } in the surface's units, or { erase: true, size, points }
     for a piece of rubbing. */
  function makeCanvas(el, scratch) {
    return {
      el: el,
      ink: el.getAttribute("data-ink") === "highlighter" ? "highlighter" : "pen",
      scratch: scratch,
      strokes: [],
      sized: false,
      context: null
    };
  }

  var questions = [];
  each(section.querySelectorAll(".question"), function (el) {
    var question = {
      el: el,
      body: el.querySelector(".question__body"),
      surfaces: [],
      scratch: null,
      canvases: [],
      options: listOf(el.querySelectorAll(".question__option")),
      history: []
    };
    function addSurface(surface) {
      if (surface.canvases.length) {
        question.surfaces.push(surface);
        surface.canvases.forEach(function (canvas) {
          question.canvases.push(canvas);
        });
      }
    }
    each(el.querySelectorAll(".question__piece"), function (figure) {
      var picture = { scratch: false, canvases: [] };
      each(figure.querySelectorAll(".question__canvas"), function (canvasEl) {
        picture.canvases.push(makeCanvas(canvasEl, false));
      });
      addSurface(picture);
    });
    if (question.body) {
      var paper = { scratch: true, canvases: [] };
      each(question.body.querySelectorAll(".question__scratch"), function (canvasEl) {
        paper.canvases.push(makeCanvas(canvasEl, true));
      });
      if (paper.canvases.length) {
        question.scratch = paper;
        addSurface(paper);
      }
    }
    questions.push(question);
  });

  var tool = "mark";
  /* the gesture being made: { id (the pointer), kind ("stroke" | "rub" | "sweep"), question, element (the pointer capture),
     entry, remembered, moved } plus, for a stroke, { canvas, stroke, scale }; for a rub, { tracks }; for a sweep, { last } */
  var drawing = null;

  function running() {
    return section.classList.contains("is-running");
  }

  function questionHolding(el) {
    for (var i = 0; i < questions.length; i += 1) {
      if (questions[i].el.contains(el)) {
        return questions[i];
      }
    }
    return null;
  }

  /* the question whose scratch paper has this canvas element as its pen canvas (the one that takes the pointer) */
  function questionOfPaper(el) {
    for (var i = 0; i < questions.length; i += 1) {
      var paper = questions[i].scratch;
      if (paper && paper.canvases.some(function (canvas) { return canvas.el === el && canvas.ink === "pen"; })) {
        return questions[i];
      }
    }
    return null;
  }

  /* the question on the screen: the one the player has not hidden */
  function currentQuestion() {
    for (var i = 0; i < questions.length; i += 1) {
      if (!questions[i].el.hidden) {
        return questions[i];
      }
    }
    return null;
  }

  /* ---- the surfaces: where they are, coordinates, sizes ---- */
  /* the box of a surface on the screen (both its canvases lie exactly over it), or null while it is not shown */
  function rectOf(surface) {
    var rect = surface.canvases[0].el.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function reaches(rect, x, y, margin) {
    return x >= rect.left - margin && x <= rect.left + rect.width + margin && y >= rect.top - margin && y <= rect.top + rect.height + margin;
  }

  /* the bitmap a canvas gets: a picture's own pixel size; the scratch paper's size on the screen times the screen density */
  function bitmapSize(canvas, rect) {
    if (canvas.scratch) {
      var density = Math.min(window.devicePixelRatio || 1, 2);
      return { width: Math.max(1, Math.round(rect.width * density)), height: Math.max(1, Math.round(rect.height * density)) };
    }
    var width = parseInt(canvas.el.getAttribute("data-width"), 10);
    var height = parseInt(canvas.el.getAttribute("data-height"), 10);
    if (width > 0 && height > 0) {
      return { width: width, height: height };
    }
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  /* a pointer position in the surface's own units (a picture's pixels; thousandths of the body's width on the scratch paper) and
     how many of them one screen pixel is */
  function locate(canvas, clientX, clientY) {
    var rect = canvas.el.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
      return null;
    }
    var size = bitmapSize(canvas, rect);
    var across = canvas.scratch ? PAPER_UNITS / rect.width : size.width / rect.width;
    var down = canvas.scratch ? across : size.height / rect.height;
    return {
      x: tenth((clientX - rect.left) * across),
      y: tenth((clientY - rect.top) * down),
      scale: Math.min(8, Math.max(0.5, across)),
      size: size
    };
  }

  /* how many bitmap pixels one unit of the canvas's own coordinates is */
  function unitOf(canvas) {
    return canvas.scratch ? canvas.el.width / PAPER_UNITS : 1;
  }

  function contextOf(canvas) {
    if (!canvas.context && typeof canvas.el.getContext === "function") {
      canvas.context = canvas.el.getContext("2d") || null;
    }
    return canvas.context;
  }

  function makeBitmap(canvas, size) {
    canvas.el.width = size.width;
    canvas.el.height = size.height;
    canvas.sized = true;
  }

  function release(canvas) {
    if (canvas.sized) {
      canvas.el.width = 1; /* a small bitmap again: this also wipes it */
      canvas.el.height = 1;
      canvas.sized = false;
    }
  }

  /* the ink is the colour the stylesheet gives the canvas element (so it follows the theme) */
  function inkColour(canvas) {
    if (typeof window.getComputedStyle === "function") {
      var colour = window.getComputedStyle(canvas.el).color;
      if (colour) {
        return colour;
      }
    }
    return "currentColor";
  }

  /* a fresh bitmap has the default drawing state: the unit the canvas is drawn in, the pen's shape and the ink colour */
  function prepare(canvas, context) {
    var unit = unitOf(canvas);
    var colour = inkColour(canvas);
    context.setTransform(unit, 0, 0, unit, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = colour;
    context.fillStyle = colour;
  }

  /* point 0 is a dot; every later point adds the piece of line from the one before it (its width follows the pressure) */
  function paint(context, stroke, index) {
    var point = stroke.points[index];
    context.beginPath();
    if (index === 0) {
      context.arc(point[0], point[1], (stroke.size * point[2]) / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    var before = stroke.points[index - 1];
    context.lineWidth = (stroke.size * (before[2] + point[2])) / 2;
    context.moveTo(before[0], before[1]);
    context.lineTo(point[0], point[1]);
    context.stroke();
  }

  /* ink is laid over what is there; rubbing takes the ink away where it passes (the colour does not matter, only that it is solid) */
  function paintPart(context, stroke, index) {
    if (stroke.erase) {
      context.globalCompositeOperation = "destination-out";
      paint(context, stroke, index);
      context.globalCompositeOperation = "source-over";
    } else {
      paint(context, stroke, index);
    }
  }

  function paintLive(canvas, stroke, index) {
    var context = contextOf(canvas);
    if (context) {
      paintPart(context, stroke, index);
    }
  }

  /* the canvas drawn again from its strokes, in order (a canvas with none is released) */
  function redraw(canvas) {
    if (!canvas.strokes.length) {
      release(canvas);
      return;
    }
    if (!canvas.sized) {
      var rect = canvas.el.getBoundingClientRect();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
        return;
      }
      makeBitmap(canvas, bitmapSize(canvas, rect));
    }
    var context = contextOf(canvas);
    if (!context) {
      return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0); /* the whole bitmap, whatever unit it is drawn in */
    context.clearRect(0, 0, canvas.el.width, canvas.el.height);
    prepare(canvas, context);
    canvas.strokes.forEach(function (stroke) {
      for (var i = 0; i < stroke.points.length; i += 1) {
        paintPart(context, stroke, i);
      }
    });
  }

  /* the scratch paper's bitmap follows the body: when the body's size on the screen has changed (the window, the strip shown or
     taken away) a canvas that has a bitmap gets a new one and its strokes are drawn again. A canvas never drawn on stays small. */
  function fitScratch(question) {
    if (!question.scratch) {
      return;
    }
    question.scratch.canvases.forEach(function (canvas) {
      if (!canvas.sized) {
        return;
      }
      var rect = canvas.el.getBoundingClientRect();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
        return; /* not shown now (another question is): it is looked at again when it is */
      }
      var size = bitmapSize(canvas, rect);
      if (size.width !== canvas.el.width || size.height !== canvas.el.height) {
        makeBitmap(canvas, size);
        redraw(canvas);
      }
    });
  }

  /* after anything that changes what the question holds: has-scratch says whether the scratch paper holds ink (the strip under
     the pictures stays shown then), and the paper's bitmap is checked against the body, which that may have moved */
  function refresh(question) {
    var ink = false;
    if (question.scratch) {
      ink = question.scratch.canvases.some(function (canvas) {
        return canvas.strokes.some(function (stroke) {
          return !stroke.erase;
        });
      });
    }
    question.el.classList.toggle("has-scratch", ink);
    fitScratch(question);
  }

  /* ---- gestures ---- */
  function pressureOf(event, ink) {
    var pressure = event.pressure;
    if (ink !== "pen" || event.pointerType !== "pen" || !(pressure > 0)) {
      return 1;
    }
    return Math.round((0.7 + 0.6 * Math.min(1, pressure)) * 100) / 100; /* 0.7 … 1.3 times the width */
  }

  function capture(target, id) {
    if (typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(id);
      } catch (error) {
        /* the pointer is gone already: the gesture goes on without the capture */
      }
    }
  }

  /* the history entry of a gesture is made when the gesture first changes something (a gesture that changes nothing leaves none) */
  function remember(gesture) {
    if (!gesture.remembered) {
      gesture.remembered = true;
      gesture.question.history.push(gesture.entry);
    }
    return gesture.entry;
  }

  /* ---- pen and highlighter ---- */
  function startStroke(event, target, question, canvas) {
    if (canvas.strokes.length >= MAX_STROKES) {
      return;
    }
    var where = locate(canvas, event.clientX, event.clientY);
    if (!where) {
      return;
    }
    if (!canvas.sized) {
      makeBitmap(canvas, where.size);
      if (canvas.strokes.length) {
        redraw(canvas); /* strokes that were kept without a bitmap (a remake that could not be done then) */
      }
    }
    var context = contextOf(canvas);
    if (!context) {
      return;
    }
    var stroke = { size: tenth(LINE_WIDTH[canvas.ink] * where.scale), points: [[where.x, where.y, pressureOf(event, canvas.ink)]] };
    canvas.strokes.push(stroke);
    question.history.push({ canvas: canvas, stroke: stroke });
    prepare(canvas, context);
    paint(context, stroke, 0);
    drawing = { id: event.pointerId, kind: "stroke", question: question, canvas: canvas, stroke: stroke, scale: where.scale, element: target };
    capture(target, event.pointerId);
    event.preventDefault();
    refresh(question);
  }

  function extendStroke(event) {
    var canvas = drawing.canvas;
    var stroke = drawing.stroke;
    var where = locate(canvas, event.clientX, event.clientY);
    if (!where || stroke.points.length >= MAX_POINTS) {
      return;
    }
    var last = stroke.points[stroke.points.length - 1];
    var reach = 0.5 * drawing.scale; /* half a screen pixel: a smaller move adds nothing */
    var dx = where.x - last[0];
    var dy = where.y - last[1];
    if (dx * dx + dy * dy < reach * reach) {
      return;
    }
    stroke.points.push([where.x, where.y, pressureOf(event, canvas.ink)]);
    var context = contextOf(canvas);
    if (context) {
      paint(context, stroke, stroke.points.length - 1);
    }
    event.preventDefault();
  }

  function takeOut(question, canvas, stroke) {
    var at = canvas.strokes.indexOf(stroke);
    if (at >= 0) {
      canvas.strokes.splice(at, 1);
    }
    question.history = question.history.filter(function (entry) {
      return entry.stroke !== stroke;
    });
    redraw(canvas);
    refresh(question);
  }

  /* ---- the eraser (a rub: only the part passed over) ---- */
  function trackOf(gesture, canvas) {
    for (var i = 0; i < gesture.tracks.length; i += 1) {
      if (gesture.tracks[i].canvas === canvas) {
        return gesture.tracks[i];
      }
    }
    var track = { canvas: canvas, stroke: null }; /* the eraser stroke being made on this canvas, null while the pointer is away */
    gesture.tracks.push(track);
    return track;
  }

  function rubPoint(gesture, clientX, clientY) {
    gesture.question.surfaces.forEach(function (surface) {
      var rect = rectOf(surface);
      var over = !!rect && reaches(rect, clientX, clientY, ERASER_SIZE / 2);
      surface.canvases.forEach(function (canvas) {
        if (!canvas.sized) {
          return; /* nothing was ever drawn here: nothing to rub out, and no bitmap is made for it */
        }
        var track = trackOf(gesture, canvas);
        var where = over ? locate(canvas, clientX, clientY) : null;
        if (!where) {
          track.stroke = null;
          return;
        }
        var stroke = track.stroke;
        if (!stroke) {
          if (canvas.strokes.length >= MAX_STROKES) {
            return;
          }
          stroke = { erase: true, size: tenth(ERASER_SIZE * where.scale), points: [[where.x, where.y, 1]] };
          canvas.strokes.push(stroke);
          remember(gesture).erase.push({ canvas: canvas, stroke: stroke });
          track.stroke = stroke;
          paintLive(canvas, stroke, 0);
          return;
        }
        if (stroke.points.length >= MAX_POINTS) {
          return;
        }
        var last = stroke.points[stroke.points.length - 1];
        var reach = 0.5 * where.scale;
        var dx = where.x - last[0];
        var dy = where.y - last[1];
        if (dx * dx + dy * dy < reach * reach) {
          return;
        }
        stroke.points.push([where.x, where.y, 1]);
        paintLive(canvas, stroke, stroke.points.length - 1);
      });
    });
  }

  function startRub(event, target, question) {
    drawing = { id: event.pointerId, kind: "rub", question: question, element: target, entry: { erase: [] }, remembered: false, moved: false, tracks: [] };
    rubPoint(drawing, event.clientX, event.clientY);
    capture(target, event.pointerId);
    event.preventDefault();
  }

  function continueRub(event) {
    drawing.moved = true;
    rubPoint(drawing, event.clientX, event.clientY);
  }

  /* ---- the line eraser (a sweep: whole strokes) ---- */
  function boxOf(stroke) {
    var count = stroke.points.length;
    if (!stroke.box || stroke.box[4] !== count) {
      var box = [Infinity, Infinity, -Infinity, -Infinity, count];
      stroke.points.forEach(function (point) {
        box[0] = Math.min(box[0], point[0]);
        box[1] = Math.min(box[1], point[1]);
        box[2] = Math.max(box[2], point[0]);
        box[3] = Math.max(box[3], point[1]);
      });
      stroke.box = box;
    }
    return stroke.box;
  }

  /* the squared distance from a position to the piece of line between two points (the same point: a dot) */
  function distanceSquared(x, y, from, to) {
    var dx = to[0] - from[0];
    var dy = to[1] - from[1];
    var length = dx * dx + dy * dy;
    var along = length > 0 ? Math.max(0, Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / length)) : 0;
    var px = from[0] + along * dx - x;
    var py = from[1] + along * dy - y;
    return px * px + py * py;
  }

  /* does any dot or piece of line of the stroke lie within `range` of the position? */
  function touches(stroke, x, y, range) {
    var box = boxOf(stroke);
    if (x < box[0] - range || x > box[2] + range || y < box[1] - range || y > box[3] + range) {
      return false;
    }
    var limit = range * range;
    var points = stroke.points;
    for (var i = 0; i < points.length; i += 1) {
      if (distanceSquared(x, y, points[i > 0 ? i - 1 : 0], points[i]) <= limit) {
        return true;
      }
    }
    return false;
  }

  function sweepPoint(gesture, clientX, clientY) {
    var changed = false;
    gesture.question.surfaces.forEach(function (surface) {
      var rect = rectOf(surface);
      if (!rect || !reaches(rect, clientX, clientY, LINE_REACH)) {
        return;
      }
      surface.canvases.forEach(function (canvas) {
        if (!canvas.sized) {
          return;
        }
        var where = locate(canvas, clientX, clientY);
        if (!where) {
          return;
        }
        var reach = LINE_REACH * where.scale;
        var hits = canvas.strokes.filter(function (stroke) {
          return !stroke.erase && touches(stroke, where.x, where.y, reach + stroke.size / 2);
        });
        if (!hits.length) {
          return;
        }
        var entry = remember(gesture);
        hits.forEach(function (stroke) {
          var index = canvas.strokes.indexOf(stroke);
          canvas.strokes.splice(index, 1);
          entry.removed.push({ canvas: canvas, stroke: stroke, index: index });
        });
        redraw(canvas);
        changed = true;
      });
    });
    if (changed) {
      refresh(gesture.question);
    }
  }

  function startSweep(event, target, question) {
    drawing = {
      id: event.pointerId, kind: "sweep", question: question, element: target, entry: { removed: [] }, remembered: false, moved: false,
      last: { x: event.clientX, y: event.clientY }
    };
    sweepPoint(drawing, event.clientX, event.clientY);
    capture(target, event.pointerId);
    event.preventDefault();
  }

  /* a quick flick leaves gaps between the positions the browser reports: the way between them is looked at every few pixels */
  function continueSweep(event) {
    var from = drawing.last;
    var dx = event.clientX - from.x;
    var dy = event.clientY - from.y;
    var steps = Math.min(60, Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 6)));
    drawing.moved = true;
    for (var i = 1; i <= steps; i += 1) {
      sweepPoint(drawing, from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    }
    drawing.last = { x: event.clientX, y: event.clientY };
  }

  /* ---- ending a gesture, taking one back ---- */
  /* what a history entry did is undone: a stroke is taken out; the rubbing of a gesture is taken away; the strokes a sweep removed
     are put back where they were, the last removed first */
  function revert(question, entry) {
    var touched = [];
    function mark(canvas) {
      if (touched.indexOf(canvas) < 0) {
        touched.push(canvas);
      }
    }
    if (entry.strike) {
      entry.strike.classList.remove("is-struck");
      return;
    }
    if (entry.erase) {
      entry.erase.forEach(function (item) {
        var at = item.canvas.strokes.indexOf(item.stroke);
        if (at >= 0) {
          item.canvas.strokes.splice(at, 1);
        }
        mark(item.canvas);
      });
    } else if (entry.removed) {
      for (var i = entry.removed.length - 1; i >= 0; i -= 1) {
        var item = entry.removed[i];
        item.canvas.strokes.splice(item.index, 0, item.stroke);
        mark(item.canvas);
      }
    } else {
      takeOut(question, entry.canvas, entry.stroke);
      return;
    }
    touched.forEach(function (canvas) {
      redraw(canvas);
    });
    refresh(question);
  }

  /* the gesture is over: the pointer was lifted, the capture was lost, or the browser took the touch for itself (a cancelled
     gesture that went nowhere — a dot, one touch of an eraser — is given up) */
  function endStroke(event, cancelled) {
    if (!drawing || (event && event.pointerId !== drawing.id)) {
      return;
    }
    var done = drawing;
    drawing = null;
    if (typeof done.element.releasePointerCapture === "function") {
      try {
        done.element.releasePointerCapture(done.id);
      } catch (error) {
        /* already released */
      }
    }
    if (!cancelled) {
      return;
    }
    if (done.kind === "stroke") {
      if (done.stroke.points.length < 2) {
        takeOut(done.question, done.canvas, done.stroke);
      }
    } else if (!done.moved && done.remembered) {
      var at = done.question.history.lastIndexOf(done.entry);
      if (at >= 0) {
        done.question.history.splice(at, 1);
      }
      revert(done.question, done.entry);
    }
  }

  /* ---- cross-outs, undo, clear ---- */
  function toggleStrike(option) {
    var question = questionHolding(option);
    var on = !option.classList.contains("is-struck");
    option.classList.toggle("is-struck", on);
    if (!question) {
      return;
    }
    if (on) {
      question.history.push({ strike: option });
    } else {
      question.history = question.history.filter(function (entry) {
        return entry.strike !== option;
      });
    }
  }

  function undo() {
    endStroke(null, false);
    var question = currentQuestion();
    var entry = question ? question.history.pop() : null;
    if (entry) {
      revert(question, entry);
    }
  }

  function wipe(question) {
    question.canvases.forEach(function (canvas) {
      canvas.strokes = [];
      release(canvas);
    });
    question.options.forEach(function (option) {
      option.classList.remove("is-struck");
    });
    question.history = [];
    refresh(question);
  }

  function clearQuestion() {
    endStroke(null, false);
    var question = currentQuestion();
    if (question) {
      wipe(question);
    }
  }

  /* ---- the tools ---- */
  function showTool() {
    TOOL_NAMES.forEach(function (name) {
      if (toolButtons[name]) {
        toolButtons[name].setAttribute("aria-pressed", name === tool ? "true" : "false");
      }
    });
    questions.forEach(function (question) {
      question.el.classList.toggle("is-pen", tool === "pen");
      question.el.classList.toggle("is-highlighter", tool === "highlighter");
      question.el.classList.toggle("is-eraser", tool === "eraser");
      question.el.classList.toggle("is-line-eraser", tool === "line-eraser");
      question.el.classList.toggle("is-striking", tool === "strike");
      question.el.classList.toggle("is-drawing", drawingTool(tool));
      fitScratch(question); /* the strip under the pictures shows and hides with these classes: the body changes size */
    });
  }

  function chooseTool(name) {
    if (TOOL_NAMES.indexOf(name) < 0) {
      return;
    }
    endStroke(null, false);
    tool = name;
    showTool();
  }

  /* the test ended or starts again: every drawing and cross-out is gone and the default tool is on */
  function startOver() {
    endStroke(null, false);
    questions.forEach(wipe);
    tool = "mark";
    showTool();
  }

  /* ---- events ---- */
  /* before the player sees a click (the capture phase): the tool buttons, and — with "Cross out" on — a tap on an option area,
     which strikes it out and goes no further, so the player does not choose it */
  section.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest || !running()) {
      return;
    }
    var button = target.closest("[data-tool],[data-pen]");
    if (button && tools.contains(button)) {
      var chosen = button.getAttribute("data-tool");
      var action = button.getAttribute("data-pen");
      if (chosen) {
        chooseTool(chosen);
      } else if (action === "undo") {
        undo();
      } else if (action === "clear") {
        clearQuestion();
      }
      return;
    }
    if (tool === "strike") {
      var option = target.closest(".question__option");
      if (option && section.contains(option)) {
        toggleStrike(option);
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }, true);

  /* the surface a pen or highlighter stroke goes to: the picture the pointer is over, else the scratch paper */
  function surfaceFor(question, clientX, clientY) {
    for (var i = 0; i < question.surfaces.length; i += 1) {
      var surface = question.surfaces[i];
      if (!surface.scratch) {
        var rect = rectOf(surface);
        if (rect && reaches(rect, clientX, clientY, 0)) {
          return surface;
        }
      }
    }
    return question.scratch;
  }

  section.addEventListener("pointerdown", function (event) {
    var target = event.target;
    if (!running() || drawing || !drawingTool(tool) || !target || !target.closest) {
      return;
    }
    /* a stylus' eraser end rubs out, whatever tool is on; the other buttons (the right one of a mouse, the barrel button of a
       stylus) draw nothing */
    var stylusEraser = event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);
    if (event.button > 0 && !stylusEraser) {
      return;
    }
    var paperEl = target.closest(".question__scratch--ink"); /* the only canvas that takes the pointer */
    var question = paperEl ? questionOfPaper(paperEl) : null;
    if (!question) {
      return;
    }
    fitScratch(question);
    if (stylusEraser || tool === "eraser") {
      startRub(event, paperEl, question);
    } else if (tool === "line-eraser") {
      startSweep(event, paperEl, question);
    } else {
      var surface = surfaceFor(question, event.clientX, event.clientY);
      var canvas = null;
      if (surface) {
        surface.canvases.forEach(function (candidate) {
          if (candidate.ink === tool) {
            canvas = candidate;
          }
        });
      }
      if (canvas) {
        startStroke(event, paperEl, question, canvas);
      }
    }
  });

  section.addEventListener("pointermove", function (event) {
    if (!drawing || event.pointerId !== drawing.id) {
      return;
    }
    if (event.pointerType === "mouse" && event.buttons === 0) {
      endStroke(event, false); /* the button was let go where no event reached us */
      return;
    }
    if (drawing.kind === "stroke") {
      extendStroke(event);
    } else if (drawing.kind === "rub") {
      continueRub(event);
    } else {
      continueSweep(event);
    }
  });

  section.addEventListener("pointerup", function (event) {
    endStroke(event, false);
  });
  section.addEventListener("pointercancel", function (event) {
    endStroke(event, true);
  });
  section.addEventListener("lostpointercapture", function (event) {
    endStroke(event, false);
  });

  /* a long press must not open a menu in the middle of a gesture */
  section.addEventListener("contextmenu", function (event) {
    var target = event.target;
    if (drawingTool(tool) && target && target.closest && target.closest(".question__scratch--ink")) {
      event.preventDefault();
    }
  });

  section.addEventListener("test:finish", startOver);
  section.addEventListener("test:reset", startOver);

  /* the scratch paper follows its body: the browser's own watcher of sizes where there is one, else the window's resize */
  if (typeof window.ResizeObserver === "function") {
    var watcher = new window.ResizeObserver(function (entries) {
      each(entries, function (entry) {
        questions.forEach(function (question) {
          if (question.body && question.body === entry.target) {
            fitScratch(question);
          }
        });
      });
    });
    questions.forEach(function (question) {
      if (question.body) {
        watcher.observe(question.body);
      }
    });
  } else if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", function () {
      questions.forEach(function (question) {
        fitScratch(question);
      });
    });
  }

  tools.hidden = false; /* the tools exist only when this script runs; the stylesheet shows them while the test runs */
  showTool();
})();
