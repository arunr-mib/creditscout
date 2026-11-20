/**
 * record-demo.mjs --- records the silent README walkthrough of the analyst UI.
 *
 * READ-ONLY. This script only signs in, navigates, scrolls, hovers and opens
 * or closes on-page disclosure toggles. It must NEVER click a decision button
 * (Approve / Override / Hold for borrower documents), Investigate,
 * Re-run investigation, Run Covenant Tests, Re-run Qn, upload, onboarding,
 * reset, or anything else that writes data or starts a (billable) agent run.
 * A local `npm run dev` talks to the real cloud database and Azure agent.
 * It also never opens a casefile whose status is `investigating`: that screen
 * polls a Server Action that drives the agent.
 *
 * Playwright is NOT a dependency of this repo. Install it separately, outside
 * the repo, e.g.:
 *   mkdir /tmp/rec && cd /tmp/rec && npm i playwright && npx playwright install chromium
 *   cp docs/demo/record-demo.mjs /tmp/rec/ && BASE_URL=http://localhost:3000 node /tmp/rec/record-demo.mjs ./out
 * (ESM resolves `playwright` from the script's own directory, so run the copy.)
 *
 * Env:
 *   BASE_URL           default http://localhost:3000 (a running `npm run dev`)
 *   RESOLVE_CASEFILE   a concluded casefile with a Resolve recommendation
 *   ABSTAIN_CASEFILE   a concluded casefile where the guardrail forced abstain
 *   ACTIVE_CASEFILE    the live casefile awaiting a decision (shows the buttons)
 * The default ids are demo-run casefiles in the database on 2026-11-13; they
 * change if the data is re-seeded or an investigation is re-run. Check a
 * replacement's run_id is `demo` (not `eval-*`) before using it.
 *
 * Output: a 1280x800 .webm in the directory given as argv[2]; convert with
 * ffmpeg to the GIF/MP4 in docs/demo/.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "./demo-video";
// All three are `run_id = demo` casefiles. Never use an `eval-*` run's casefile:
// its review block can carry evaluation-harness notes that are not analyst work.
const RESOLVE = process.env.RESOLVE_CASEFILE ?? "4dcb0f05-3128-4336-b902-eeb8f2cf5b02"; // Coastal Marine, Resolve (superseded, read-only history)
const ABSTAIN = process.env.ABSTAIN_CASEFILE ?? "23cfbe86-1e83-44cb-82ae-b60089350793"; // Harbor Logistics, guardrail replaced "resolve" with abstain (history)
const ACTIVE = process.env.ACTIVE_CASEFILE ?? "fe1e1b1a-8983-4a88-b3c8-2f6fcd5a446a"; // Harbor Logistics, live, policy-directed escalate
const VIEWPORT = { width: 1280, height: 800 };

/** Hide the Next.js dev-mode indicator so it does not appear in the video. */
const HIDE_DEV_OVERLAY = `
  // React re-renders <head>, so a style tag alone does not stick: hide the host element directly.
  setInterval(() => {
    for (const el of document.querySelectorAll('nextjs-portal')) el.style.setProperty('display', 'none', 'important');
  }, 50);
`;

const pause = (page, ms) => page.waitForTimeout(ms);

/** Smoothly scroll the window by `dy` pixels over roughly `ms`. */
async function glide(page, dy, ms = 1200) {
  const steps = Math.max(1, Math.round(ms / 40));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), dy / steps);
    await page.waitForTimeout(40);
  }
}

/** Scroll `total` px in `chunk`-sized moves, holding still `hold` ms after each so it can be read. */
async function read(page, total, chunk = 420, hold = 1800) {
  for (let done = 0; done < total; done += chunk) {
    await glide(page, Math.min(chunk, total - done), 600);
    await page.waitForTimeout(hold);
  }
}

/** Smoothly bring an element near the top of the viewport. */
async function glideTo(page, locator, offset = 90, ms = 800) {
  const box = await locator.boundingBox();
  if (box) await glide(page, box.y - offset, ms);
}

/** Click an on-page disclosure toggle, refusing anything that could write. */
const FORBIDDEN = /approve|override|hold for|investigat|re-run|run covenant|record decision|upload|submit|reset|delete/i;
async function toggle(page, scope, text) {
  const btn = scope.locator("button").filter({ hasText: text }).first();
  const label = (await btn.innerText()).trim();
  if (FORBIDDEN.test(label)) throw new Error(`refusing to click "${label}"`);
  await btn.hover();
  await pause(page, 350);
  await btn.click();
  return btn;
}

async function openCasefile(page, id) {
  await page.goto(`${BASE}/casefiles/${id}`);
  await page.waitForLoadState("networkidle");
  // Never stay on a live investigation: its poller drives the agent.
  if ((await page.locator("main").innerText()).match(/Investigation in progress|investigating/i)) {
    throw new Error(`casefile ${id} is mid-investigation; aborting`);
  }
}

const browser = await chromium.launch();

// --- warm-up (not recorded): compile every route once so the video has no dev-compile waits
{
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { timeout: 180_000 });
  await p.locator("button", { hasText: "Demo access" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180_000 });
  for (const id of [RESOLVE, ABSTAIN, ACTIVE]) await openCasefile(p, id);
  await ctx.close();
}

// --- the recording
const ctx = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: OUT, size: VIEWPORT } });
await ctx.addInitScript(HIDE_DEV_OVERLAY);
const page = await ctx.newPage();

// (1) sign-in screen
await page.goto(`${BASE}/login`);
await page.waitForLoadState("networkidle");
await pause(page, 2500);
const demo = page.locator("button", { hasText: "Demo access" });
await demo.hover();
await pause(page, 800);
await demo.click(); // fills the displayed demo credential and signs in
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
await page.waitForLoadState("networkidle");

// (2) the risk-sorted Credit Analysis Queue
await pause(page, 3000);
for (const name of ["Coastal Marine", "Harbor Logistics", "Northgate Foods"]) {
  await page.locator("tbody tr", { hasText: name }).locator("td").first().hover();
  await pause(page, 1100);
}
await pause(page, 1200);

// (3) a concluded investigation with a Resolve recommendation
await openCasefile(page, RESOLVE);
const main = page.locator("main");
await pause(page, 3000);
await toggle(page, main, /^Read the agent/);
await pause(page, 6000);
const findings = page.locator('section[aria-label="Investigation findings"]');
await glideTo(page, findings, 80);
await pause(page, 1500);
await toggle(page, findings, /^View recalculation/);
await pause(page, 900);
await glideTo(page, findings.locator("li").last(), 90);
await pause(page, 5000); // the calculation, with its calc_id
await toggle(page, findings, /^View citations/);
await pause(page, 800);
await glideTo(page, findings.getByText("Hide citations").first(), 90, 900);
await pause(page, 2500);
await read(page, 650, 330, 1600); // read through the cited clauses
await pause(page, 1500);
await toggle(page, findings, /^Agent activity/);
await pause(page, 800);
await glideTo(page, findings.getByText("Investigation activity").first(), 90, 1000);
await pause(page, 2000);
await read(page, 1300, 440, 2000); // the trace: searches, calc, specialist delegation, recalculation
await pause(page, 2000);

// (4) a case where the guardrail replaced the agent's answer
await openCasefile(page, ABSTAIN);
await pause(page, 2500);
await toggle(page, page.locator("main"), /^Read the agent/);
await pause(page, 6500);

// (5) the live case awaiting a decision: end on the decision buttons (never clicked)
await openCasefile(page, ACTIVE);
await pause(page, 2500);
const decide = page.locator('section[aria-label="Review the recommendation"]');
await glideTo(page, decide, 260);
await pause(page, 5500);

await ctx.close(); // flushes the video
await browser.close();
console.log(`video written to ${OUT}`);
