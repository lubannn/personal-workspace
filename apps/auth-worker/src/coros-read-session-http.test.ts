import { expect, it, vi } from "vitest";
import { createCorosReadSession } from "./coros-read-client";

it("shares a real SDK HTTP session for recovery and HRV without another handshake or discovery", async () => {
  const methods: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)); methods.push(message.method);
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "1" } }
      : message.method === "tools/list"
        ? { tools: ["queryRecoveryStatus", "querySleepHrv"].map(name => ({ name, inputSchema: { type: "object", properties: {} } })) }
        : { content: [{ type: "text", text: message.params.name }] };
    return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "mcp-session-id": "synthetic-session" } });
  });
  const session = createCorosReadSession("https://mcpcn.coros.com/mcp", "synthetic-token", fetcher);
  try {
    await expect(session.read("queryRecoveryStatus", {})).resolves.toMatchObject({ payload: [{ text: "queryRecoveryStatus" }] });
    await expect(session.read("querySleepHrv", {})).resolves.toMatchObject({ payload: [{ text: "querySleepHrv" }] });
  } finally { await session.close(); }
  expect(methods).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list", "tools/call", "tools/call"]);
  const calls = fetcher.mock.calls.filter(([, init]) => String(init?.body).includes('"tools/call"'));
  expect(calls).toHaveLength(2);
  for (const [, init] of calls) expect(new Headers(init?.headers).get("mcp-session-id")).toBe("synthetic-session");
});
