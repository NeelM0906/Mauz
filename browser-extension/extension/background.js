// Keeps a native messaging connection to Mauz and answers its snapshot requests with the
// active tab of the focused window. Nothing is read unless Mauz asks, which happens only when
// the user summons Mauz over this browser.
importScripts("page.js");

const HOST_NAME = "ai.mauz.browser";
const RETRY_ALARM = "mauz-reconnect";

let port = null;

function browserName() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const names = brands.map((brand) => brand.brand);

  for (const name of ["Microsoft Edge", "Brave", "Opera", "Vivaldi", "Google Chrome"]) {
    if (names.includes(name)) {
      return name;
    }
  }

  return "Chromium";
}

function connect() {
  if (port !== null) {
    return;
  }

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (_error) {
    port = null;
    return;
  }

  port.onMessage.addListener((message) => {
    void handleHostMessage(message);
  });
  port.onDisconnect.addListener(() => {
    // Mauz is not installed or has quit; the alarm tries again.
    void chrome.runtime.lastError;
    port = null;
  });
  port.postMessage({
    type: "hello",
    browser: browserName(),
    version: chrome.runtime.getManifest().version
  });
}

async function handleHostMessage(message) {
  if (message === null || typeof message !== "object" || message.type !== "snapshot") {
    return;
  }

  let result;

  try {
    result = await snapshot(Array.isArray(message.blockedSites) ? message.blockedSites : []);
  } catch (error) {
    result = { error: String(error && error.message ? error.message : error) };
  }

  if (port !== null) {
    port.postMessage({ type: "snapshot-result", id: message.id, result });
  }
}

async function snapshot(blockedSites) {
  // Each browser profile runs its own copy of the extension; Mauz uses the focused one.
  const lastFocused = await chrome.windows.getLastFocused().catch(() => undefined);
  const result = await snapshotActiveTab(blockedSites);

  return { ...result, focused: lastFocused !== undefined && lastFocused.focused === true };
}

async function snapshotActiveTab(blockedSites) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (tab === undefined || tab.id === undefined || typeof tab.url !== "string") {
    return { error: "no-tab" };
  }

  let url;

  try {
    url = new URL(tab.url);
  } catch (_error) {
    return { error: "unsupported-page" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "unsupported-page" };
  }

  // Blocked sites are refused here, so their content never leaves the browser.
  if (globalThis.MauzPage.isBlockedHost(url.hostname, blockedSites)) {
    return { blockedHost: url.hostname };
  }

  const response = await askTab(tab.id);
  const page = response && response.page ? response.page : {};

  return {
    page: {
      ...page,
      browser: browserName(),
      // Mauz rejects pages whose fields exceed its limits, so trim to them.
      url: tab.url.slice(0, 2000),
      title: page.title ?? globalThis.MauzPage.clean(tab.title, 500)
    }
  };
}

async function askTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "mauz:snapshot" });
  } catch (_error) {
    // Tabs opened before the extension was installed have no content script yet.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["page.js", "content.js"] });
    return chrome.tabs.sendMessage(tabId, { type: "mauz:snapshot" });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) {
    connect();
  }
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
connect();
