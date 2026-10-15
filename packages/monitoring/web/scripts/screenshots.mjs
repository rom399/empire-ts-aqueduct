// Opens the dashboard in headless Chromium and saves screenshots plus any console errors.
// Usage: node scripts/screenshots.mjs [url] [outDir]
import { chromium } from "playwright-core";
import fs from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:8012/admin/";
const out = process.argv[3] ?? "screenshots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/1-overview.png` });

const row = page.locator("table.grid tbody tr").first();
if (await row.count()) {
    await row.click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}/2-backend-selected.png` });
}

await page.getByRole("button", { name: /^Live events/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/3-events.png` });

fs.writeFileSync(`${out}/console.txt`, problems.join("\n"));
console.log(problems.length ? problems.join("\n") : "no console errors or warnings");
await browser.close();
