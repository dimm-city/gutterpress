// Scripted driver for the Gutterpress desktop app (Electron + SvelteKit).
// Usage (from packages/desktop):
//   xvfb-run -a -s "-screen 0 1600x1000x24" node .claude/skills/run-desktop/driver.mjs <book-dir> <shots-dir> <<'EOF2'
//   <one command per line>
//   EOF2
// Commands: shot <name> | click <playwright-selector> | press <Key> | text
//   | size <w> <h> | wait <ms> | btns | eval <js expr> | fill <selector> <value>
// <book-dir> is opened via the welcome screen's path box ("" = stay on welcome).
import { _electron } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [book = "", shots = "shots"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const app = await _electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron"),
  args: ["--no-sandbox", "--disable-gpu", "out/main/main.js"],
  env: { ...process.env, HOME: process.env.GP_HOME ?? "/tmp/gphome" }, // isolated settings/recents
  timeout: 60000,
});
const p = await app.firstWindow();
p.setDefaultTimeout(5000);
await p.waitForTimeout(4000);
if (book) {
  await p.fill("input[placeholder^='Search your books']", book);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(8000); // preview paginates async; 74 pages takes a few s
}
for (const line of readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)) {
  const [cmd, ...rest] = line.split(" "), arg = rest.join(" ");
  try {
    if (cmd === "shot") { await p.waitForTimeout(1200); await p.screenshot({ path: `${shots}/${arg}.png` }); }
    else if (cmd === "click") await p.click(arg);
    else if (cmd === "fill") { const [s, ...v] = arg.split(" | "); await p.fill(s, v.join(" | ")); }
    else if (cmd === "press") await p.keyboard.press(arg);
    else if (cmd === "move") { const [x, y, steps] = arg.split(" ").map(Number); await p.mouse.move(x, y, { steps: steps || 1 }); }
    else if (cmd === "wait") await p.waitForTimeout(+arg);
    else if (cmd === "text") console.log(await p.evaluate(() => document.body.innerText));
    else if (cmd === "eval") console.log(await p.evaluate(arg));
    else if (cmd === "size") { const [w, h] = arg.split(" ").map(Number); await (await app.browserWindow(p)).evaluate((win, s) => win.setSize(...s), [w, h]); }
    else if (cmd === "btns") console.log(await p.evaluate(() => [...document.querySelectorAll("button,[role=tab],a,input,select,textarea")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName[0]}:${(e.innerText || e.getAttribute("aria-label") || e.title || e.placeholder || "").trim().slice(0, 30)}@${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; }).join("\n")));
    else console.log("unknown command:", line);
  } catch (e) { console.log(`FAIL ${line}: ${e.message.split("\n")[0]}`); }
}
await app.close();
