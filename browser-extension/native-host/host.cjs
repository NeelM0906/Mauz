// Native messaging host for the Mauz browser extension. Chrome or Edge starts it when the
// extension connects; it relays messages between the extension (length-prefixed JSON on
// stdin/stdout) and the Mauz app (newline-delimited JSON on a local pipe or socket).
// Mauz writes the launcher that runs this file and sets MAUZ_BROWSER_PIPE and
// MAUZ_BROWSER_TOKEN. Both sides prove they know the token before anything is relayed, so a
// process that claims the pipe name first cannot read pages or feed Mauz fake ones.
"use strict";

const crypto = require("node:crypto");
const net = require("node:net");

const RECONNECT_DELAY_MS = 2000;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 64 * 1024;

const pipePath = process.env.MAUZ_BROWSER_PIPE;
const token = process.env.MAUZ_BROWSER_TOKEN;

if (!pipePath || !token) {
  process.exit(1);
}

let socket = null;
let hello = null;

function sign(role, nonce) {
  return crypto.createHmac("sha256", token).update(`${role}:${nonce}`).digest("hex");
}

function matches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function connectToMauz() {
  const next = net.createConnection(pipePath);
  const nonce = crypto.randomBytes(32).toString("hex");
  let authenticated = false;
  let buffer = "";

  next.setEncoding("utf8");
  next.on("connect", () => {
    next.write(`${JSON.stringify({ type: "challenge", nonce })}\n`);
  });
  next.on("data", (chunk) => {
    buffer += chunk;

    if (buffer.length > MAX_LINE_CHARS) {
      next.destroy();
      return;
    }

    let newline = buffer.indexOf("\n");

    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      let message;

      try {
        message = JSON.parse(line);
      } catch (_error) {
        continue;
      }

      if (message === null || typeof message !== "object") {
        continue;
      }

      if (authenticated) {
        sendToExtension(message);
        continue;
      }

      // Mauz must answer our challenge before it gets anything from the browser.
      if (
        message.type !== "proof" ||
        !matches(message.proof, sign("mauz", nonce)) ||
        typeof message.nonce !== "string"
      ) {
        next.destroy();
        return;
      }

      authenticated = true;
      socket = next;
      next.write(`${JSON.stringify({ type: "auth", proof: sign("host", message.nonce) })}\n`);

      if (hello !== null) {
        sendToMauz(hello);
      }
    }
  });
  next.on("error", () => {
    // "close" follows and schedules the reconnect.
  });
  next.on("close", () => {
    if (socket === next) {
      socket = null;
    }

    // Mauz is not running yet, restarted, or failed the handshake.
    setTimeout(connectToMauz, RECONNECT_DELAY_MS);
  });
}

function sendToMauz(message) {
  if (socket !== null) {
    socket.write(`${JSON.stringify(message)}\n`);
  }
}

function sendToExtension(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);

  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

let stdinBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);

  while (stdinBuffer.length >= 4) {
    const length = stdinBuffer.readUInt32LE(0);

    if (length > MAX_MESSAGE_BYTES) {
      process.exit(1);
    }

    if (stdinBuffer.length < 4 + length) {
      break;
    }

    const body = stdinBuffer.subarray(4, 4 + length).toString("utf8");
    stdinBuffer = stdinBuffer.subarray(4 + length);

    let message;

    try {
      message = JSON.parse(body);
    } catch (_error) {
      continue;
    }

    if (message !== null && typeof message === "object" && message.type === "hello") {
      hello = message;
    }

    sendToMauz(message);
  }
});

// The browser closes stdin when the extension disconnects or the browser quits.
process.stdin.on("end", () => process.exit(0));

connectToMauz();
