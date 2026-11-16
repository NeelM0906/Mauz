import { createHash, randomUUID } from "node:crypto";
import {
  EMPTY_SCREEN_BLOCK,
  formatScreenBlock,
  getContextImage,
  type AiProviderId,
  type AskSessionRequest,
  type AskSessionView,
  type MauzDesktopContext
} from "@mauzai/shared";
import {
  answerAskSession,
  MAUZ_SYSTEM_PROMPT,
  resolveAskProvider,
  type AskExchange,
  type AskImage,
  type AskPrompt
} from "@mauzai/api/server";
import type { AskActivation } from "../context/ContextCollector";

const RESUME_MS = 5 * 60_000;
const MAX_TURNS = 40;
const MAX_HISTORY = 12;
const MAX_PROMPT_BYTES = 48 * 1024;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ANSWER_CHARS = 40_000;
const DEFAULT_QUESTION = "What is this, and what should I know about it?";

type Source = NonNullable<AskSessionView["source"]> & {
  text?: string;
  textWithImage?: string;
  fingerprint: string;
  image?: AskImage;
};
type StoredImage = { id: string; image: AskImage; fingerprint: string };
type Turn = AskSessionView["turns"][number] & { evidence?: string; phase?: "final_answer" };
type Attachments = Pick<AskSessionRequest, "sourceId" | "includeScreenshot" | "earlierImageId">;
type Pending = NonNullable<AskSessionView["pending"]> & {
  controller: AbortController;
  attachments: Attachments;
};
type Session = {
  id: string;
  activation: AskActivation | null;
  expiresAt: number | null;
  provider?: AiProviderId;
  turns: Turn[];
  source: Source | null;
  lastSource: string | null;
  images: StoredImage[];
  pending: Pending | null;
  failure: AskSessionView["failure"];
  notice: string | null;
  requests: Set<string>;
};

type AskSessionsOptions = {
  onChange: (session: AskSessionView | null) => void;
  now?: () => number;
  resolveProvider?: typeof resolveAskProvider;
  answer?: typeof answerAskSession;
};

export class AskSessions {
  private session: Session | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: AskSessionsOptions) {
    this.now = options.now ?? Date.now;
  }

  get active(): boolean {
    return this.session !== null && this.session.expiresAt === null;
  }

  get activeTarget(): AskActivation | undefined {
    return this.active ? (this.session?.activation ?? undefined) : undefined;
  }

  matches(activation: AskActivation | null): boolean {
    this.expire();
    return (
      activation?.blocked === false &&
      activation.identity !== undefined &&
      this.session?.activation?.identity === activation.identity
    );
  }

  open(activation: AskActivation | null, capture?: MauzDesktopContext): AskSessionView {
    if (!this.matches(activation) || this.session === null) {
      return this.replace(
        activation,
        capture === undefined ? null : readSource(capture, true),
        captureNotice(capture)
      );
    }
    const session = this.session;
    this.clearTimer();
    session.expiresAt = null;
    if (capture !== undefined) {
      const source = readSource(capture, session.turns.length === 0);
      session.source = source !== null && source.fingerprint !== session.lastSource ? source : null;
      session.notice = captureNotice(capture);
    }
    return this.view(session);
  }

  current(): AskSessionView | null {
    return this.session === null ? null : this.view(this.session);
  }

  unavailable(): AskSessionView {
    const session = this.session;
    if (session === null) throw new Error("This chat has ended.");
    session.source = null;
    session.notice = "Point at the source again to attach it. You can still ask about the conversation.";
    return this.view(session);
  }

  newChat(sessionId: string): AskSessionView {
    const session = this.requireActive(sessionId);
    const source = session.source === null ? null : { ...session.source, useImage: session.source.hasImage };
    return this.replace(session.activation, source, session.notice);
  }

  suspend(): void {
    if (this.session === null || !this.active) return;
    this.session.expiresAt = this.now() + RESUME_MS;
    this.timer = setTimeout(() => this.expire(), RESUME_MS);
    this.timer.unref?.();
  }

  close(): void {
    const previous = this.session;
    this.clearTimer();
    this.session = null;
    previous?.pending?.controller.abort();
    if (previous !== null) this.options.onChange(null);
  }

  stop(sessionId: string): void {
    const session = this.requireActive(sessionId);
    const pending = session.pending;
    if (pending === null) return;
    session.pending = null;
    session.failure = { ...pending.attachments, question: pending.question, message: "Answer stopped." };
    pending.controller.abort();
    this.publish(session);
  }

  async submit(request: AskSessionRequest, onText: (text: string) => void): Promise<void> {
    const session = this.requireActive(request.sessionId);
    if (session.pending !== null || session.requests.has(request.requestId)) return;
    const source = request.sourceId === undefined ? null : session.source;
    if (request.sourceId !== undefined && source?.id !== request.sourceId) {
      throw new Error("That source is no longer available. Point at it again or send without it.");
    }
    const earlier = session.images.find(({ id }) => id === request.earlierImageId);
    if (request.earlierImageId !== undefined && earlier === undefined) {
      throw new Error("That screenshot is no longer available. Point at it again.");
    }
    const includeScreenshot = request.includeScreenshot ?? source?.useImage ?? false;
    if (includeScreenshot && source?.image === undefined) {
      throw new Error("That screenshot is unavailable. Point at the source again or send without it.");
    }
    const question =
      request.question || (session.turns.length === 0 && source !== null ? DEFAULT_QUESTION : "");
    if (question.length === 0) return;

    const image = includeScreenshot ? source?.image : undefined;
    const images: AskImage[] = [];
    if (earlier !== undefined)
      images.push({ ...earlier.image, label: "Earlier screenshot from the conversation" });
    if (image !== undefined) images.push({ ...image, label: `Current screenshot: ${image.label}` });
    const prompt = buildPrompt(
      session.turns,
      question,
      includeScreenshot ? source?.textWithImage : source?.text,
      images
    );
    const attachments: Attachments = {
      ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId, includeScreenshot }),
      ...(request.earlierImageId === undefined ? {} : { earlierImageId: request.earlierImageId })
    };
    const pending: Pending = {
      attachments,
      id: request.requestId,
      question,
      partial: "",
      controller: new AbortController()
    };
    session.requests.add(request.requestId);
    session.pending = pending;
    session.failure = null;
    this.publish(session);

    try {
      const answer = this.options.answer ?? answerAskSession;
      const provider = await (this.options.resolveProvider ?? resolveAskProvider)(session.provider);
      if (!this.isPending(session, pending)) return;
      session.provider = provider.id;
      const result = await answer(provider, prompt, {
        signal: pending.controller.signal,
        onText: (text) => {
          if (!this.isPending(session, pending)) return;
          pending.partial = text.slice(0, MAX_ANSWER_CHARS);
          onText(pending.partial);
        }
      });
      const response = result.text.trim().slice(0, MAX_ANSWER_CHARS);
      if (!this.isPending(session, pending)) return;
      if (!response) throw new Error("The provider returned an empty answer.");

      const imageId = image === undefined ? undefined : rememberImage(session, image);
      session.turns.push({
        id: request.requestId,
        question,
        answer: response,
        ...(result.phase === undefined ? {} : { phase: result.phase }),
        ...(source === null ? {} : { sourceLabel: image === undefined ? source.label : "Screenshot" }),
        ...(source?.text === undefined ? {} : { evidence: source.text }),
        ...(imageId === undefined ? {} : { imageId })
      });
      session.turns = session.turns.slice(-MAX_TURNS);
      if (source !== null) {
        session.lastSource = source.fingerprint;
        if (session.source?.id === source.id) session.source = null;
      }
    } catch (error) {
      if (!this.isPending(session, pending)) return;
      session.failure = {
        ...attachments,
        question,
        message: error instanceof Error ? error.message : "Ask failed. Try again."
      };
    } finally {
      if (this.isPending(session, pending)) {
        session.pending = null;
        this.publish(session);
      }
    }
  }

  private replace(
    activation: AskActivation | null,
    source: Source | null,
    notice: string | null
  ): AskSessionView {
    const previous = this.session;
    this.clearTimer();
    const session: Session = {
      id: randomUUID(),
      activation,
      expiresAt: null,
      turns: [],
      source,
      lastSource: null,
      images: [],
      pending: null,
      failure: null,
      notice,
      requests: new Set()
    };
    this.session = session;
    previous?.pending?.controller.abort();
    return this.view(session);
  }

  private requireActive(id: string): Session {
    this.expire();
    if (!this.active || this.session?.id !== id) throw new Error("This chat is no longer open.");
    return this.session;
  }

  private isPending(session: Session, pending: Pending): boolean {
    this.expire();
    return this.session === session && session.pending === pending;
  }

  private expire(): void {
    const deadline = this.session?.expiresAt;
    if (deadline !== null && deadline !== undefined && this.now() >= deadline) this.close();
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private publish(session: Session): void {
    this.options.onChange(this.view(session));
  }

  private view(session: Session): AskSessionView {
    const { id, source, notice, pending, failure } = session;
    return {
      id,
      turns: session.turns.map(({ id, question, answer, sourceLabel, imageId }) => ({
        id,
        question,
        answer,
        ...(sourceLabel === undefined ? {} : { sourceLabel }),
        ...(imageId === undefined
          ? {}
          : { imageId: session.images.some((image) => image.id === imageId) ? imageId : undefined })
      })),
      source:
        source === null
          ? null
          : { id: source.id, label: source.label, hasImage: source.hasImage, useImage: source.useImage },
      notice,
      pending:
        pending === null ? null : { id: pending.id, question: pending.question, partial: pending.partial },
      failure
    };
  }
}

function readSource(context: MauzDesktopContext, first: boolean): Source | null {
  if (context.captureBlocked !== undefined) return null;
  const selected = context.selectedText ?? context.pointer?.selectedText ?? context.pointer?.page?.selection;
  const page = context.pointer?.page;
  const element = page?.element;
  const visual = !selected && (element?.tag === "img" || element?.tag === "canvas" || element?.tag === "svg");
  const image = getContextImage(context);
  const hasText = Boolean(
    selected ||
    element?.text ||
    page?.around ||
    context.pointer?.target?.element.text ||
    context.pointer?.ocrText
  );
  const screenBlock = formatScreenBlock(context);
  const text = screenBlock === EMPTY_SCREEN_BLOCK ? undefined : screenBlock;
  if (image === undefined && text === undefined) return null;
  const useImage = image !== undefined && (first || visual || !hasText);
  const fingerprint = digest(
    JSON.stringify([text, selected, element, visual || !hasText ? image?.payload.base64 : undefined])
  );
  return {
    id: randomUUID(),
    fingerprint,
    ...(text === undefined ? {} : { text }),
    label: selected ? "Selected text" : useImage ? "Screenshot" : page ? "Pointed page" : "Screen context",
    hasImage: image !== undefined,
    useImage,
    ...(image === undefined
      ? {}
      : {
          textWithImage: formatScreenBlock(context, `attached: ${image.label}`),
          image: { mimeType: image.payload.mimeType, base64: image.payload.base64, label: image.label }
        })
  };
}

function captureNotice(context?: MauzDesktopContext): string | null {
  if (context?.captureBlocked !== undefined) return "Screen capture is blocked for this source.";
  return context?.screenshotError?.message ?? null;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rememberImage(session: Session, image: AskImage): string {
  const fingerprint = digest(image.base64);
  const prior = session.images.find((item) => item.fingerprint === fingerprint);
  const entry = prior ?? { id: randomUUID(), image, fingerprint };
  session.images = [...session.images.filter(({ id }) => id !== entry.id), entry].slice(-MAX_IMAGES);
  while (session.images.reduce((bytes, item) => bytes + item.image.base64.length, 0) > MAX_IMAGE_BYTES) {
    session.images.shift();
  }
  return entry.id;
}

function buildPrompt(
  turns: Turn[],
  question: string,
  screenText: string | undefined,
  images: AskImage[]
): AskPrompt {
  const labels = images.map((image, index) => `Image ${index + 1}: ${image.label}`);
  const userText = [question, screenText, ...labels].filter(Boolean).join("\n\n");
  const history: AskExchange[] = turns.slice(-MAX_HISTORY).map((turn) => ({
    userText:
      turn.evidence === undefined
        ? turn.question
        : `${turn.question}\n\nHistorical screen evidence:\n${turn.evidence}`,
    answer: turn.answer,
    ...(turn.phase === undefined ? {} : { phase: turn.phase })
  }));
  const tooLarge = (): boolean =>
    Buffer.byteLength(JSON.stringify([MAUZ_SYSTEM_PROMPT, userText, history])) > MAX_PROMPT_BYTES;
  for (let index = 0; index < history.length && tooLarge(); index++) {
    history[index]!.userText = turns[turns.length - history.length + index]!.question;
  }
  while (history.length > 0 && tooLarge()) history.shift();
  return { systemPrompt: MAUZ_SYSTEM_PROMPT, userText, images, history };
}
