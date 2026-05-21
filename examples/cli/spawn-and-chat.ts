/**
 * Minimal CLI: spawn an osModa server, wait for it, then drop into an
 * interactive chat. Run with:
 *
 *   ANTHROPIC_KEY=sk-ant-… OSMODA_TOKEN=osk_… node --experimental-strip-types spawn-and-chat.ts
 *
 * If you already have an order, set OSMODA_ORDER_ID + OSMODA_TOKEN and it skips
 * the spawn step. To spawn fresh you need an x402 wallet (see docs).
 */
import { OsmodaClient } from "@osmoda/sdk";
import * as readline from "node:readline";

const osmoda = new OsmodaClient({ token: process.env.OSMODA_TOKEN });

async function main() {
  let orderId = process.env.OSMODA_ORDER_ID;
  let token = process.env.OSMODA_TOKEN;

  if (!orderId) {
    console.log("Spawning a starter server…");
    const res = await osmoda.spawnAndWait("starter", {
      runtime: "claude-code",
      credentials: process.env.ANTHROPIC_KEY
        ? [{ provider: "anthropic", type: "api_key", secret: process.env.ANTHROPIC_KEY }]
        : undefined,
      // wallet: yourX402Wallet,   // required to actually pay the spawn invoice
    });
    orderId = res.order_id;
    token = res.token;
    console.log(`Ready. order=${orderId}`);
  }

  const chat = osmoda.chat(orderId!, { token });
  chat.on("text", (d) => process.stdout.write(d));
  chat.on("tool", (t) => process.stdout.write(`\n  · ${t.name}${t.target ? " " + t.target : ""}\n`));
  chat.on("done", () => process.stdout.write("\n\n> "));
  chat.on("error", (e) => console.error("\n[error]", e.text));
  await chat.connect();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write("> ");
  rl.on("line", (line) => {
    if (line.trim() === "/exit") { chat.close(); rl.close(); return; }
    chat.send(line);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
