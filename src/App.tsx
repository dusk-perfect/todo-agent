import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ChatMessage } from "../shared/chat.ts";
import { clearHistory, loadHistory, requestReply } from "./chat-client.ts";
import { ChatHistory } from "./ChatHistory.tsx";
import { startNewSession } from "./identity.ts";
import { ReminderBar } from "./ReminderBar.tsx";

function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  // 中文输入法会用 Enter 确认选词，部分浏览器此时只报告键码 229。
  const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
  return event.key === "Enter" && !event.shiftKey && !composing;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // 刷新后把最近几轮接回来；如果用户在恢复完成前已经开口，就不覆盖他
  useEffect(() => {
    void loadHistory().then((history) => {
      if (history.length === 0) return;
      setMessages((current) => (current.length > 0 ? current : history));
    });
  }, []);

  async function reset() {
    await clearHistory();
    startNewSession();
    setMessages([]);
    setError("");
    setConfirmingClear(false);
    requestAnimationFrame(() => input.current?.focus());
  }

  // 「清空对话」点一次变成「确认清空？」，4 秒没再点就复原，避免手滑丢记录
  useEffect(() => {
    if (!confirmingClear) return;
    const timer = window.setTimeout(() => setConfirmingClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const outgoing: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(outgoing);
    setDraft("");
    setPending(true);
    setError("");
    try {
      const answer = await requestReply(outgoing);
      setMessages([...outgoing, { role: "assistant", content: answer }]);
      // 这一轮可能建了、改了、完成了任务，提醒条立刻重算
      setRevision((value) => value + 1);
    } catch (cause) {
      setMessages(messages);
      setDraft(text);
      setError(cause instanceof Error ? `发送失败：${cause.message}` : "发送失败，请重试。");
    } finally {
      setPending(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  }

  return (
    <div className="app">
      <header>
        <img src="/logo.png" alt="" />
        <strong>TokeNow</strong>
        <span>小明智能体</span>
        <div className="header-actions">
          <button
            type="button"
            className={confirmingClear ? "ghost danger" : "ghost"}
            disabled={messages.length === 0 || pending}
            title="只清空对话记录，清单里的任务不受影响"
            onClick={() => {
              if (!confirmingClear) {
                setConfirmingClear(true);
                return;
              }
              void reset();
            }}
          >
            {confirmingClear ? "确认清空？" : "清空对话"}
          </button>
        </div>
      </header>
      <ReminderBar revision={revision} />
      <main>
        <ChatHistory messages={messages} pending={pending} onSelectPrompt={send} />
        <div className="compose">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              aria-label="消息"
              ref={input}
              placeholder="记一条待办，比如「买牛奶」"
              rows={2}
              value={draft}
              readOnly={pending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (isSendShortcut(event)) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button className="send" disabled={pending || !draft.trim()} aria-label="发送消息">
              ↑
            </button>
          </form>
          <small>Enter 发送 · Shift + Enter 换行</small>
        </div>
      </main>
    </div>
  );
}
