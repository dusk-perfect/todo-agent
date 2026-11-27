# 本地开发指南

## 启动

安装 Node.js 24.12 或更高版本（含 npm）。在终端执行以下命令。

```sh
git clone https://github.com/dusk-perfect/todo-agent.git
cd todo-agent
npm ci
npm run dev
```

浏览器打开 <http://127.0.0.1:3000>。前后端共用这个地址，修改服务端代码后服务会自动重启。修改聊天界面的 TSX 后，在另一个终端运行 `npm run build` 并刷新页面。若 3000 端口已占用，可以用 `PORT=3001 npm run dev` 指定其他端口（macOS / Linux）。

`npm run dev` 与 `npm start` 都会先执行一次前端构建（`predev` / `prestart`），所以刚克隆下来直接跑也不会出现白屏。`npm start` 跑的是构建好的产物，不带文件监听。

## 接入 DeepSeek

1. 在项目根目录将 `.env.example` 复制为 `.env`。
2. 在 `.env` 中填写 [DeepSeek 开放平台](https://platform.deepseek.com/) 的 API Key。可通过 `DEEPSEEK_MODEL` 更换模型。
3. 重启开发服务。在服务端使用 [server/model.ts](server/model.ts) 导出的 `getModelClient()` 获取客户端，使用 `model` 读取配置的模型名称。只有发起模型请求才会产生调用费用。

不配 Key 也能跑：默认全部走本地规则引擎，只有规则接不住的句子才会去找模型。

## 环境变量

| 变量                | 默认值              | 说明                                   |
| ------------------- | ------------------- | -------------------------------------- |
| `DEEPSEEK_API_KEY`  | 空                  | 留空则只走规则引擎                     |
| `DEEPSEEK_MODEL`    | `deepseek-flash`    | 使用的模型                             |
| `PORT`              | `3000`              | 服务端口                               |
| `DATA_DIR`          | `data`              | 数据根目录                             |
| `TASKS_FILE`        | `data/tasks.json`   | 单用户模式下任务文件的位置             |
| `CALENDAR_ICS_PATH` | `data/calendar.ics` | 日历文件；文件不存在时完全不做日历提醒 |

演示、联调或跑评测脚本时，把 `DATA_DIR` 指到临时目录，就不会写进真实清单：

```sh
PORT=3100 DATA_DIR=/tmp/todo-demo npm start
```

## 代码入口

| 文件                                                 | 用途                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| [src/App.tsx](src/App.tsx)                           | 聊天界面，发送当前页面的对话历史并显示回复 |
| [src/ReminderBar.tsx](src/ReminderBar.tsx)           | 顶部提醒条与浏览器通知授权                 |
| [server/index.ts](server/index.ts)                   | 接入智能体与任务存储，启动服务             |
| [server/agent.ts](server/agent.ts)                   | 智能体入口，接收消息数组，返回回复文本     |
| [server/agent/intent.ts](server/agent/intent.ts)     | 中文意图识别（规则引擎）                   |
| [server/agent/date.ts](server/agent/date.ts)         | 相对日期、时段与时刻解析                   |
| [server/agent/llm.ts](server/agent/llm.ts)           | 模型规划与提示词                           |
| [server/agent/followup.ts](server/agent/followup.ts) | 创建后的备注追问与日期追问                 |
| [server/agent/format.ts](server/agent/format.ts)     | 清单渲染与日期分组                         |
| [server/agent/calendar.ts](server/agent/calendar.ts) | iCalendar 日历解析                         |
| [server/model.ts](server/model.ts)                   | 服务端 DeepSeek 客户端与模型配置           |
| [server/tasks.ts](server/tasks.ts)                   | 任务 API 的输入校验和 HTTP 响应            |
| [server/app.ts](server/app.ts)                       | 接收对话历史，调用智能体并挂载任务 API     |
| [server/task-store.ts](server/task-store.ts)         | 读写本地 JSON 任务清单                     |
| [server/users.ts](server/users.ts)                   | 匿名身份与数据目录                         |
| [server/conversations.ts](server/conversations.ts)   | 对话记忆                                   |
| [server/reminders.ts](server/reminders.ts)           | 到期提醒的计算                             |
| [server/openapi.yaml](server/openapi.yaml)           | 请求和响应的完整定义                       |

## 手动验证接口

启动服务后，在另一个终端发送聊天消息。

```sh
curl -sS http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"帮我记一下买牛奶"}]}'
```

回复是这一轮的自然语言，例如「已记下「买牛奶」。……」并追问要不要加备注。后续请求可在 `messages` 中按顺序传入之前的用户消息和小明的回复，再追加最新的用户消息。

创建一条任务，然后检查列表。

```sh
curl -sS http://127.0.0.1:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"买牛奶"}'
curl -sS http://127.0.0.1:3000/api/tasks
```

提醒数据（已过期、今天、一小时内到点）：

```sh
curl -sS http://127.0.0.1:3000/api/reminders
```

取回某次会话的历史（`sessionId` 为会话 id）：

```sh
curl -sS http://127.0.0.1:3000/api/conversations/s-demo-session-1
```

## 数据落在哪

| 路径                                              | 内容                       |
| ------------------------------------------------- | -------------------------- |
| `data/tasks.json`                                 | 默认单用户的任务清单       |
| `data/users/<用户id>/tasks.json`                  | 该用户的任务清单           |
| `data/users/<用户id>/conversations/<会话id>.json` | 该次会话的最近 50 轮对话   |
| `data/calendar.ics`                               | 可选的日历文件（自行放入） |

浏览器首次打开会生成一个匿名身份，存在本地浏览器里；请求带上 `x-user-id` 就按该身份的清单处理，不带就落到默认单用户清单。对话同理，只有带 `x-session-id` 的请求才会落盘。任务和对话都是先写临时文件再改名，中途断电不会留下半截记录。

## 本地检查

```sh
npm test
npm run typecheck
npm run lint
npm run fmt:check
npm run build
```

测试使用独立的临时目录。要预览构建产物，先停止开发服务，再运行 `npm start` 并打开同一地址。
