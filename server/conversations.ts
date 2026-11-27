import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChatMessage } from "../shared/chat.ts";
import { DEFAULT_USER } from "./users.ts";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const DEFAULT_LIMIT = 100; // 50 轮

export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return SESSION_ID_RE.test(value) ? value : null;
}

export interface ConversationStore {
  /** 用客户端手上的历史覆盖保存（只留最近 limit 条），不会重复记账 */
  save(userId: string, sessionId: string, messages: ChatMessage[]): void;
  recent(userId: string, sessionId: string, limit?: number): ChatMessage[];
  clear(userId: string, sessionId: string): void;
}

export function createConversationStore(root = "data", limit = DEFAULT_LIMIT): ConversationStore {
  function filePath(userId: string, sessionId: string): string {
    const base = userId === DEFAULT_USER ? root : join(root, "users", userId);
    return join(base, "conversations", `${sessionId}.json`);
  }

  function read(userId: string, sessionId: string): ChatMessage[] {
    const filename = filePath(userId, sessionId);
    if (!existsSync(filename)) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(filename, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is ChatMessage =>
          typeof item === "object" &&
          item !== null &&
          ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant") &&
          typeof (item as ChatMessage).content === "string",
      );
    } catch {
      // 文件损坏时按空会话处理，不阻塞对话
      return [];
    }
  }

  // 与任务存储一样：先写临时文件再改名，中途断电不会留下半截记录
  function write(userId: string, sessionId: string, messages: ChatMessage[]) {
    const filename = filePath(userId, sessionId);
    mkdirSync(dirname(filename), { recursive: true });
    const temporary = `${filename}.tmp`;
    writeFileSync(temporary, JSON.stringify(messages.slice(-limit), null, 2) + "\n");
    renameSync(temporary, filename);
  }

  return {
    save(userId, sessionId, messages) {
      write(userId, sessionId, messages);
    },

    recent(userId, sessionId, count = limit) {
      return read(userId, sessionId).slice(-count);
    },

    clear(userId, sessionId) {
      write(userId, sessionId, []);
    },
  };
}
