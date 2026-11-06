/* viewer.js — only the material pages load this. The cover button ([data-embed]) holds the address of the Drive preview or of the
   privacy-mode YouTube player; the frame is made only when the student taps it, so nothing reaches Google or YouTube before that.
   No cookie, no storage, no network request of its own, no inline handler, no HTML built from text. An address that does not
   start with one of the two allowed prefixes is ignored (the page policy would block the frame anyway). */
(function () {
  "use strict";

  var ALLOWED = ["https://drive.google.com/file/d/", "https://www.youtube-nocookie.com/embed/"];

  function allowed(address) {
    for (var i = 0; i < ALLOWED.length; i += 1) {
      if (address.indexOf(ALLOWED[i]) === 0) {
        return true;
      }
    }
    return false;
  }

  function shapeOf(address, button) {
    var declared = button.getAttribute("data-embed-shape");
    if (declared === "video" || declared === "document") {
      return declared;
    }
    return address.indexOf("https://www.youtube-nocookie.com/") === 0 ? "video" : "document";
  }

  function showFrame(button) {
    var address = button.getAttribute("data-embed") || "";
    if (!allowed(address)) {
      return;
    }
    var frame = document.createElement("iframe");
    frame.setAttribute("src", address);
    frame.setAttribute("title", button.getAttribute("data-embed-title") || "");
    frame.setAttribute("allow", "fullscreen; picture-in-picture; encrypted-media");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("class", "embed-frame embed-frame--" + shapeOf(address, button));
    button.parentNode.replaceChild(frame, button);
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) {
      return;
    }
    var button = target.closest("[data-embed]");
    if (button) {
      showFrame(button);
    }
  });
})();
