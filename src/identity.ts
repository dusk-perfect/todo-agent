// 匿名身份：第一次打开时生成，存在浏览器里；换设备或清缓存就等于换一个人。
// 服务端只认 id，不做登录，也不会把不同人的清单混在一起。

const USER_KEY = "todo-agent-user";
const SESSION_KEY = "todo-agent-session";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式下写不进去也不影响本次会话
  }
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 20);
  return `${prefix}${body}`;
}

export function userId(): string {
  const existing = read(USER_KEY);
  if (existing) return existing;
  const created = randomId("u");
  write(USER_KEY, created);
  return created;
}

export function sessionId(): string {
  const existing = read(SESSION_KEY);
  if (existing) return existing;
  return startNewSession();
}

// 清空对话时换一个新会话，旧记录留在磁盘上但不再被读
export function startNewSession(): string {
  const created = randomId("s");
  write(SESSION_KEY, created);
  return created;
}
