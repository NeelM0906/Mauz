import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ChatConversationSchema,
  type ChatConversation,
  type ChatHistoryGroup,
  type ChatHistoryListResponse
} from "@mauzai/shared";

type StoredChatHistory = {
  version: 1;
  conversations: ChatConversation[];
};

export type SaveAskConversationInput = {
  question: string;
  answer: string;
  title: string;
};

const HISTORY_FILE_NAME = "mauz-chat-history.json";
const PREVIEW_MAX_CHARS = 120;

export class ChatHistoryService {
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  static fromUserDataDir(userDataDir: string): ChatHistoryService {
    return new ChatHistoryService(join(userDataDir, HISTORY_FILE_NAME));
  }

  async saveAskConversation(input: SaveAskConversationInput): Promise<ChatConversation> {
    const now = new Date().toISOString();
    const conversation: ChatConversation = {
      id: randomUUID(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: randomUUID(),
          role: "user",
          content: input.question,
          createdAt: now
        },
        {
          id: randomUUID(),
          role: "assistant",
          content: input.answer,
          createdAt: now
        }
      ]
    };
    const history = await this.readHistory();

    history.conversations.unshift(conversation);
    await this.writeHistory(history);

    return conversation;
  }

  async appendAskTurn(id: string, input: Omit<SaveAskConversationInput, "title">): Promise<ChatConversation> {
    const history = await this.readHistory();
    const conversation = history.conversations.find((candidate) => candidate.id === id);

    if (conversation === undefined) {
      throw new Error("Mauz could not find that chat.");
    }

    const now = new Date().toISOString();

    conversation.messages.push(
      {
        id: randomUUID(),
        role: "user",
        content: input.question,
        createdAt: now
      },
      {
        id: randomUUID(),
        role: "assistant",
        content: input.answer,
        createdAt: now
      }
    );
    conversation.updatedAt = now;
    await this.writeHistory(history);

    return conversation;
  }

  async list(): Promise<ChatHistoryListResponse> {
    const history = await this.readHistory();
    const groups = new Map<string, ChatHistoryGroup>();
    const sorted = [...history.conversations].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );

    for (const conversation of sorted) {
      const dateLabel = formatHistoryDate(conversation.createdAt);
      const group = groups.get(dateLabel) ?? {
        dateLabel,
        conversations: []
      };

      group.conversations.push({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        preview: getConversationPreview(conversation)
      });
      groups.set(dateLabel, group);
    }

    return {
      groups: [...groups.values()]
    };
  }

  async get(id: string): Promise<ChatConversation> {
    const history = await this.readHistory();
    const conversation = history.conversations.find((candidate) => candidate.id === id);

    if (conversation === undefined) {
      throw new Error("Mauz could not find that chat.");
    }

    return conversation;
  }

  async updateTitle(id: string, title: string): Promise<ChatConversation | null> {
    const history = await this.readHistory();
    const conversation = history.conversations.find((candidate) => candidate.id === id);

    if (conversation === undefined) {
      return null;
    }

    conversation.title = title;
    await this.writeHistory(history);

    return conversation;
  }

  private async readHistory(): Promise<StoredChatHistory> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      return parseStoredHistory(parsed);
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          version: 1,
          conversations: []
        };
      }

      throw error;
    }
  }

  private async writeHistory(history: StoredChatHistory): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });

    const tempPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;

    await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    await rename(tempPath, this.storagePath);
  }
}

export function formatHistoryDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit"
  }).format(new Date(isoDate));
}

function getConversationPreview(conversation: ChatConversation): string {
  const assistantMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const source = assistantMessage?.content ?? conversation.messages.at(-1)?.content ?? "";
  const preview = source.replace(/\s+/g, " ").trim();

  return preview.length <= PREVIEW_MAX_CHARS ? preview : `${preview.slice(0, PREVIEW_MAX_CHARS - 3)}...`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function parseStoredHistory(parsed: unknown): StoredChatHistory {
  if (Array.isArray(parsed)) {
    return {
      version: 1,
      conversations: ChatConversationSchema.array().parse(parsed)
    };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    parsed.version === 1 &&
    "conversations" in parsed
  ) {
    return {
      version: 1,
      conversations: ChatConversationSchema.array().parse(parsed.conversations)
    };
  }

  return {
    version: 1,
    conversations: []
  };
}
