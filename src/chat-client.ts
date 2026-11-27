import type { ChatMessage } from "../shared/chat.ts";
import { sessionId, userId } from "./identity.ts";

function identityHeaders(): Record<string, string> {
  return { "x-user-id": userId(), "x-session-id": sessionId() };
}

export async function requestReply(messages: ChatMessage[]): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...identityHeaders() },
    body: JSON.stringify({ messages }),
  });
  const body: unknown = await response.json();
  if (typeof body === "object" && body !== null) {
    if (response.ok && "reply" in body && typeof body.reply === "string") return body.reply;
    if ("error" in body && typeof body.error === "string") throw new Error(body.error);
  }
  throw new Error("服务暂时不可用。");
}

// 刷新后把最近几轮捞回来，接着聊
export async function loadHistory(): Promise<ChatMessage[]> {
  try {
    const response = await fetch(`/api/conversations/${sessionId()}`, {
      headers: { "x-user-id": userId() },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("messages" in body)) return [];
    const messages = (body as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return [];
    return messages.filter(
      (item): item is ChatMessage =>
        typeof item === "object" &&
        item !== null &&
        ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant") &&
        typeof (item as ChatMessage).content === "string",
    );
  } catch {
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await fetch(`/api/conversations/${sessionId()}`, {
      method: "DELETE",
      headers: { "x-user-id": userId() },
    });
  } catch {
    // 清空失败不阻塞界面
  }
}

export interface ReminderTask {
  id: string;
  title: string;
  dueAt?: string;
  dueTime?: string;
}

export interface Reminders {
  overdue: ReminderTask[];
  today: ReminderTask[];
  soon: ReminderTask[];
}

const EMPTY: Reminders = { overdue: [], today: [], soon: [] };

export async function loadReminders(): Promise<Reminders> {
  try {
    const response = await fetch("/api/reminders", { headers: { "x-user-id": userId() } });
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as Partial<Reminders>;
    return {
      overdue: Array.isArray(body.overdue) ? body.overdue : [],
      today: Array.isArray(body.today) ? body.today : [],
      soon: Array.isArray(body.soon) ? body.soon : [],
    };
  } catch {
    return EMPTY;
  }
}
