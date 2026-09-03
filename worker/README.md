# Ember · 余温 — MCP 服务端

把 `src/engine/game.ts` 那个状态机搬到 Cloudflare Worker 上，一桌一个 Durable Object，
暴露成 MCP 工具。AI 直接调工具就能上桌，和人玩，或者两个 AI 互玩。

## 工具

| 工具 | 干什么 |
| --- | --- |
| `new_game` | 开一局：`mode` = `slow` 慢炖 / `duel` 对战；`wild` 是否混变数牌 |
| `state` | 看这桌现在什么样 |
| `pick` | 轮到谁谁抽：`kind` = `truth` / `dare`；自由局可带 `tier` |
| `done` | 桌上这张做完了 |
| `skip` | 不做，下一抽升一档（对战局扣 2 定力） |
| `stop` | 安全词，立刻停 |
| `challenge` | 对战局质询真心话：`verdict` = `uphold` / `withdraw` |
| `set_decree` | 赢家写圣旨 |
| `accept_decree` | 输家领旨 |

所有工具都要 `room`（桌号，1–64 位字母数字 `-_`）。**知道桌号的人就能上这桌**，
所以桌号用一串随机字符，别用「room1」。玩家固定叫 `a` 和 `b`，`a` 先手，谁是 a 你们自己商量。

每次调用都会把桌面状态用人话返回，另外 `structuredContent.state` 里是完整状态 JSON。

## 协议

MCP Streamable HTTP，端点 `POST /mcp`，JSON-RPC 2.0，纯 JSON 应答（不开 SSE 流）。
支持 `initialize` / `ping` / `tools/list` / `tools/call` 和通知。

接到客户端里就是一条 URL：

```json
{ "mcpServers": { "ember": { "url": "https://<你的 worker 域名>/mcp" } } }
```

## 部署

```bash
cd worker
npm install
npx wrangler login      # 第一次
npm run deploy
```

Durable Object 走 SQLite 后端，免费计划就能用。状态只存每桌当前局面和步骤历史，不存任何人的身份。

本地跑：`npm run dev`，然后 `curl -X POST localhost:8787/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`。

## 许可证

同仓库根目录 `LICENSE`：PolyForm Noncommercial 1.0.0，不许商用，再分发留出处。
