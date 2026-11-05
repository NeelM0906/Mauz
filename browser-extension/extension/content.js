// Answers Mauz's snapshot request for this tab. Mauz is summoned by shaking the mouse over the
// page, so the last mouse position here is where the user pointed.
(function () {
  "use strict";

  if (window.__mauzContentLoaded) {
    return;
  }

  window.__mauzContentLoaded = true;

  let lastPointer = null;

  window.addEventListener(
    "mousemove",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    },
    { passive: true, capture: true }
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message === null || typeof message !== "object" || message.type !== "mauz:snapshot") {
      return false;
    }

    try {
      sendResponse({ page: globalThis.MauzPage.snapshot(document, lastPointer) });
    } catch (error) {
      sendResponse({ error: String(error && error.message ? error.message : error) });
    }

    return false;
  });
})();
