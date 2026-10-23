// Drives the real UI in headless Edge over the DevTools protocol (Node 24: global fetch + WebSocket).
import { spawn } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [, , EDGE, OUT, BASE, PIN] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9333", `--user-data-dir=${path.join(OUT, "edge-e2e")}`, "--window-size=520,1000", "about:blank"], { stdio: "ignore" });
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, name), Buffer.from(data, "base64")); console.log("   screenshot", name); };
const go = async (url, wait = 2500) => { await send("Page.navigate", { url }); await sleep(wait); };
const waitFor = async (expr, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(250); } return false; };
const type = async (selector, text) => { await evalJs(`document.querySelector(${JSON.stringify(selector)}).focus()`); await send("Input.insertText", { text }); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find((t) => t.type === "page"); } catch {} if (!target) await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); } });
  await send("Page.enable"); await send("Runtime.enable");

  console.log("1. organizer opens presentation mode");
  await go(`${BASE}/organizer`, 1500);
  await evalJs(`sessionStorage.setItem("sm_pin", ${JSON.stringify(PIN)}); true`);
  const ev = await evalJs(`fetch("/api/events").then(r=>r.json()).then(d=>d.events.find(e=>e.name==="Vibeathon Round 1")?.id || d.events[0].id)`);
  await go(`${BASE}/organizer`, 2500); await shot("ui-organizer.png");
  await go(`${BASE}/present/${ev}`, 3500);
  const hasQr = await waitFor(`!!document.querySelector("svg path, svg rect")`);
  console.log("   QR rendered:", hasQr); await shot("ui-present.png");

  console.log("2. attendee opens the QR link");
  const claimUrl = await evalJs(`fetch("/api/events/${ev}/qr",{headers:{"x-organizer-pin":sessionStorage.getItem("sm_pin")}}).then(r=>r.json()).then(d=>d.claimUrl)`);
  await go(claimUrl.replace(/^https?:\/\/[^/]+/, BASE), 3000);
  console.log("   landed on:", (await evalJs("location.pathname + location.search")).slice(0, 40));

  console.log("3. email + 6-digit key");
  await waitFor(`!!document.querySelector('input[type=email], input[inputmode=email], input')`);
  await shot("ui-login.png");
  await type("input", `judge${Date.now() % 100000}@example.com`);
  await evalJs(`[...document.querySelectorAll("button")].find(b=>/join|connect/i.test(b.textContent)).click(); true`);
  await waitFor(`/\\b\\d{6}\\b/.test(document.body.innerText) && document.querySelectorAll("input").length >= 6`);
  const code = await evalJs(`document.body.innerText.match(/\\b(\\d{6})\\b/)[1]`);
  console.log("   demo key shown:", code);
  await shot("ui-otp.png");
  const boxes = await evalJs(`document.querySelectorAll("input").length`);
  for (let i = 0; i < 6; i++) { await evalJs(`document.querySelectorAll("input")[${boxes - 6 + i}].focus(); true`); await send("Input.insertText", { text: code[i] }); await sleep(80); }

  console.log("4. claim screen");
  const claimed = await waitFor(`location.pathname === "/claim" && /BADGE #\\d+/i.test(document.body.innerText)`, 15000);
  await sleep(1800);
  console.log("   badge revealed:", claimed, "| text:", (await evalJs(`(document.body.innerText.match(/BADGE #\\d+/i)||[""])[0]`)));
  await shot("ui-claim.png");

  console.log("5. badge wallet");
  await go(`${BASE}/wallet`, 3500);
  console.log("   wallet shows event:", await evalJs(`document.body.innerText.includes("Vibeathon Round 1")`));
  await shot("ui-wallet.png");
  console.log(claimed && hasQr ? "UI E2E PASSED" : "UI E2E FAILED");
} catch (e) {
  console.error("UI E2E ERROR", e);
} finally {
  ws?.close(); edge.kill();
}
