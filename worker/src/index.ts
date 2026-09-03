// Cloudflare Worker：POST /mcp 是 MCP 端点（Streamable HTTP，JSON 应答）；
// 一桌一个 Durable Object，桌号从工具参数里的 room 取。
import { DurableObject } from 'cloudflare:workers'
import { handleRpc, parseRpc, roomOf, type JsonRpcRequest, type JsonRpcResponse, type TableStore } from './mcp.ts'
import type { GameState } from '../../src/engine/game.ts'

export interface Env {
  TABLE: DurableObjectNamespace<Table>
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export class Table extends DurableObject<Env> {
  private store: TableStore = {
    load: async () => (await this.ctx.storage.get<GameState>('state')) ?? null,
    save: async (state) => {
      if (state) await this.ctx.storage.put('state', state)
      else await this.ctx.storage.delete('state')
    },
  }

  // RPC 参数走 JSON 字符串：JSON-RPC 里有 unknown 字段，直接传对象会被 Workers 的可序列化类型推成 never。
  async rpc(reqJson: string): Promise<string> {
    const req = JSON.parse(reqJson) as JsonRpcRequest
    const res: JsonRpcResponse | null = await handleRpc(req, this.store)
    return JSON.stringify(res ? [res] : [])
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Ember · 余温 MCP server. POST JSON-RPC to /mcp. https://github.com/chaodeng060-source/ember-cards', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    if (url.pathname !== '/mcp') return json({ error: 'not found' }, 404)
    if (request.method === 'GET') return json({ error: 'SSE stream not offered; use POST' }, 405)
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
    }
    const reqs = parseRpc(body)
    if (!reqs) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400)

    const responses: unknown[] = []
    for (const r of reqs) {
      if (r.method === 'tools/call') {
        const room = roomOf(r.params)
        if (!room) {
          const res = await handleRpc(r, null)
          if (res) responses.push(res)
          continue
        }
        const stub = env.TABLE.get(env.TABLE.idFromName(room))
        responses.push(...(JSON.parse(await stub.rpc(JSON.stringify(r))) as JsonRpcResponse[]))
      } else {
        const res = await handleRpc(r, null)
        if (res) responses.push(res)
      }
    }
    if (responses.length === 0) return new Response(null, { status: 202 })
    return json(Array.isArray(body) ? responses : responses[0])
  },
}
