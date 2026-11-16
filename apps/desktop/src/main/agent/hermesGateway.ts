import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const PROTOCOL = "hermes-gateway-v1";
const TICKET_PREFIX = "hermes-gateway-ticket.";
const REQUEST_TIMEOUT_MS = 15_000;

export type HermesTaskRequest = {
  attach: () => Promise<string>;
  cwd: string;
  text: string;
  imagePath: string | undefined;
  desktop: boolean;
};

type GatewayCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type GatewayConnection = { call: GatewayCall; close: () => void };

export async function submitHermesTask(
  request: HermesTaskRequest,
  connect = connectHermesGateway
): Promise<string> {
  const bootstrap = await request.attach().catch(() => {
    throw new Error("Mauz could not connect to the local Hermes gateway. Check the Hermes installation.");
  });
  const gateway = await connect(bootstrap);
  const { call } = gateway;

  try {
    const approval = (await call("config.get", { key: "approvals.mode" })) as { value?: unknown } | null;
    if (approval?.value !== "smart") {
      throw new Error("Enable Smart approvals in the local Hermes profile before sending a task from Mauz.");
    }

    const source = request.desktop ? "gui" : "cli";
    const runtime = (await call("runtime.describe", {})) as {
      session_create?: { sources?: unknown; parameters?: unknown };
    } | null;
    const create = runtime?.session_create;
    if (
      !Array.isArray(create?.sources) ||
      !create.sources.includes(source) ||
      !Array.isArray(create.parameters) ||
      !create.parameters.includes("cwd")
    ) {
      throw new Error(
        "The Hermes gateway cannot create a compatible local session. Update Hermes and retry."
      );
    }

    const session = (await call("session.create", {
      request_id: randomUUID(),
      source,
      cwd: request.cwd
    })) as { session_id?: unknown; stored_session_id?: unknown } | null;
    const sessionId = session?.session_id;
    const storedId = session?.stored_session_id;
    if (
      typeof sessionId !== "string" ||
      !sessionId ||
      typeof storedId !== "string" ||
      !/^[\w-]+$/.test(storedId)
    ) {
      throw new Error("Hermes did not return a usable session ID.");
    }

    let attachments: Array<{ path: string; mime: string }> | undefined;
    if (request.imagePath !== undefined) {
      const bytes = await readFile(request.imagePath);
      const image = (await call("image.attach_bytes", {
        session_id: sessionId,
        filename: basename(request.imagePath),
        content_base64: bytes.toString("base64")
      })) as { attached?: unknown; path?: unknown; mime?: unknown } | null;
      if (image?.attached !== true || typeof image.path !== "string" || typeof image.mime !== "string") {
        throw new Error("Hermes could not attach the screenshot.");
      }
      attachments = [{ path: image.path, mime: image.mime }];
    }

    const receipt = (await call("prompt.submit", {
      session_id: sessionId,
      submission_id: randomUUID(),
      text: request.text,
      ...(request.desktop ? {} : { finite: true }),
      ...(attachments === undefined ? {} : { attachments })
    }).catch((error: unknown) => {
      if (error instanceof GatewayRefusal) throw error;
      throw unknownSubmission(storedId);
    })) as { admission_id?: unknown } | null;
    if (typeof receipt?.admission_id !== "string" || !receipt.admission_id) {
      throw unknownSubmission(storedId);
    }
    return storedId;
  } finally {
    gateway.close();
  }
}

function unknownSubmission(sessionId: string): Error {
  return new Error(
    `Mauz could not confirm whether Hermes accepted your task. Check Hermes session ${sessionId} before retrying.`
  );
}

class GatewayRefusal extends Error {}

async function connectHermesGateway(bootstrap: string): Promise<GatewayConnection> {
  const { url, protocols } = parseBootstrap(bootstrap);
  const socket = new WebSocket(url, protocols);
  try {
    await new Promise<void>((resolve, reject) => {
      const listeners = new AbortController();
      const fail = (): void => {
        clearTimeout(timeout);
        listeners.abort();
        reject(new Error("Mauz could not open the authenticated local Hermes gateway connection."));
      };
      const timeout = setTimeout(fail, REQUEST_TIMEOUT_MS);
      socket.addEventListener(
        "open",
        () => {
          if (socket.protocol !== PROTOCOL) {
            fail();
            return;
          }
          clearTimeout(timeout);
          listeners.abort();
          resolve();
        },
        { signal: listeners.signal }
      );
      socket.addEventListener("error", fail, { signal: listeners.signal });
      socket.addEventListener("close", fail, { signal: listeners.signal });
    });
  } catch (error) {
    socket.close();
    throw error;
  }

  let nextId = 0;
  return {
    call: (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const listeners = new AbortController();
        const fail = (): void => {
          clearTimeout(timeout);
          listeners.abort();
          reject(new Error(`The Hermes gateway stopped responding to ${method}.`));
        };
        const timeout = setTimeout(fail, REQUEST_TIMEOUT_MS);
        socket.addEventListener("close", fail, { signal: listeners.signal });
        socket.addEventListener("error", fail, { signal: listeners.signal });
        socket.addEventListener(
          "message",
          (event) => {
            if (typeof event.data !== "string") return;
            let response: { id?: unknown; result?: unknown; error?: { message?: unknown } } | null;
            try {
              response = JSON.parse(event.data) as typeof response;
            } catch {
              return;
            }
            if (response?.id !== id) return;
            clearTimeout(timeout);
            listeners.abort();
            if (response.error !== undefined) {
              const code = response.error?.message;
              const detail = typeof code === "string" && /^[\w -]{1,80}$/.test(code) ? ` (${code})` : "";
              reject(new GatewayRefusal(`Hermes refused ${method}${detail}.`));
              return;
            }
            resolve(response.result);
          },
          { signal: listeners.signal }
        );
        try {
          if (socket.readyState !== WebSocket.OPEN) {
            fail();
            return;
          }
          socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        } catch {
          fail();
        }
      }),
    close: () => socket.close()
  };
}

export function parseBootstrap(output: string): { url: string; protocols: string[] } {
  try {
    const data = JSON.parse(output) as {
      url?: unknown;
      protocol?: unknown;
      protocols?: unknown;
      ticket?: unknown;
    };
    const url = typeof data.url === "string" ? new URL(data.url) : undefined;
    if (
      url?.protocol === "ws:" &&
      ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port &&
      url.pathname === "/api/ws" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      data.protocol === PROTOCOL &&
      typeof data.ticket === "string" &&
      /^[A-Za-z0-9_-]+$/.test(data.ticket) &&
      Array.isArray(data.protocols) &&
      data.protocols.length === 2 &&
      data.protocols[0] === PROTOCOL &&
      data.protocols[1] === TICKET_PREFIX + data.ticket
    ) {
      return { url: url.href, protocols: [PROTOCOL, TICKET_PREFIX + data.ticket] };
    }
  } catch {
    // Bootstrap stdout includes a one-use credential. Keep it out of errors and logs.
  }
  throw new Error("Hermes did not return a supported local gateway endpoint.");
}
