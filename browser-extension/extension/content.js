// Answers Mauz's snapshot request for this tab. Mauz is summoned by shaking the mouse over the
// page, so the last mouse position here is where the user pointed.
(function () {
  "use strict";

  if (window.__mauzContentLoaded) {
    return;
  }

  window.__mauzContentLoaded = true;

  const documentId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
  let lastPointer = null;
  let screenPoint = null;

  window.addEventListener(
    "mousemove",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
      screenPoint = { x: event.screenX, y: event.screenY, time: Date.now() };
    },
    { passive: true, capture: true }
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message === null || typeof message !== "object" || message.type !== "mauz:snapshot") {
      return false;
    }

    try {
      sendResponse({ page: globalThis.MauzPage.snapshot(document, lastPointer), documentId, screenPoint });
    } catch (error) {
      sendResponse({ error: String(error && error.message ? error.message : error) });
    }

    return false;
  });
})();
