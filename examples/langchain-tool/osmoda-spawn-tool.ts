/**
 * LangChain tool: let an autonomous agent spawn its OWN dedicated osModa worker
 * server and delegate a task to it (agent-to-agent / A2A).
 *
 *   npm install @osmoda/sdk @langchain/core zod
 *
 * Give this tool to any LangChain agent; when the agent calls it, the SDK
 * provisions a real server, waits for it, and returns the worker agent's reply.
 */
import { OsmodaClient } from "@osmoda/sdk";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Provide an x402 wallet so spawns can be paid autonomously (no human in loop).
const osmoda = new OsmodaClient({ /* wallet: yourX402Wallet */ });

export const osmodaSpawnTool = new DynamicStructuredTool({
  name: "spawn_osmoda_agent",
  description:
    "Provision a dedicated AI server (root-capable, 92 tools) and run a task on it. " +
    "Use for real infrastructure/dev/scraping work that needs a live machine. " +
    "Returns the worker agent's final reply.",
  schema: z.object({
    task: z.string().describe("The task for the worker agent to perform."),
    runtime: z.enum(["claude-code", "openclaw"]).optional(),
  }),
  async func({ task, runtime }) {
    const { order_id, token } = await osmoda.spawnAndWait("starter", {
      runtime: runtime ?? "claude-code",
      idempotencyKey: `lc-${Date.now()}`,
    });
    const reply = await osmoda.chat(order_id, { token }).ask(task);
    return JSON.stringify({ order_id, reply });
  },
});
