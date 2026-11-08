/**
 * Playwright test fixtures for Bluesky Navigator
 *
 * Provides:
 * - Browser context with Tampermonkey extension loaded via Firefox RDP
 * - Authenticated page ready for testing
 *
 * Note: Heavy setup (extension install, userscript, auth) is handled by auth.setup.ts
 */

import { test as base, firefox, BrowserContext, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import net from "net";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.dirname(__dirname);

// Load environment variables
dotenv.config({ path: path.join(TESTS_DIR, ".env") });

const TAMPERMONKEY_PATH = path.join(TESTS_DIR, "extensions", "tampermonkey");
const USER_DATA_DIR = path.join(TESTS_DIR, "user-data-firefox");

const DEBUGGER_PORT = 12345;

/**
 * Install Firefox extension via Remote Debugging Protocol
 * (Required each browser launch for temporary addons)
 */
async function installExtensionViaRDP(extensionPath: string): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = "";
    let step = 0;
    let addonsActor: string | null = null;

    const sendMessage = (msg: object) => {
      const json = JSON.stringify(msg);
      const packet = `${json.length}:${json}`;
      client.write(packet);
    };

    const parseMessages = (data: Buffer): object[] => {
      buffer += data.toString();
      const messages: object[] = [];

      while (buffer.length > 0) {
        const colonIndex = buffer.indexOf(":");
        if (colonIndex === -1) break;

        const length = parseInt(buffer.substring(0, colonIndex), 10);
        if (isNaN(length)) break;

        const messageStart = colonIndex + 1;
        const messageEnd = messageStart + length;

        if (buffer.length < messageEnd) break;

        const messageStr = buffer.substring(messageStart, messageEnd);
        buffer = buffer.substring(messageEnd);

        try {
          messages.push(JSON.parse(messageStr));
        } catch {
          // Skip unparseable messages
        }
      }

      return messages;
    };

    client.connect(DEBUGGER_PORT, "localhost", () => {});

    client.on("data", (data) => {
      const messages = parseMessages(data);

      for (const msg of messages) {
        const m = msg as Record<string, unknown>;
        if (step === 0) {
          sendMessage({ to: "root", type: "getRoot" });
          step = 1;
        } else if (step === 1 && m.addonsActor) {
          addonsActor = m.addonsActor as string;
          sendMessage({
            to: addonsActor,
            type: "installTemporaryAddon",
            addonPath: extensionPath,
          });
          step = 2;
        } else if (step === 2) {
          if (m.addon) {
            client.destroy();
            resolve(m.addon as { id: string });
          } else if (m.error) {
            client.destroy();
            reject(new Error(String(m.error)));
          }
        }
      }
    });

    client.on("error", reject);

    setTimeout(() => {
      if (step < 2) {
        client.destroy();
        reject(new Error("Timeout waiting for extension install"));
      }
    }, 10000);
  });
}

/**
 * Login to Bluesky (only if needed)
 */
async function login(page: Page): Promise<void> {
  const identifier = process.env.BSKY_IDENTIFIER;
  const password = process.env.BSKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error("Missing BSKY_IDENTIFIER or BSKY_APP_PASSWORD");
  }

  await page.waitForLoadState("networkidle");

  // Dismiss welcome modal if present
  try {
    const closeBtn = page.locator('button[aria-label="Close welcome modal"], button[aria-label="Close"]');
    if (await closeBtn.first().isVisible({ timeout: 1500 })) {
      await closeBtn.first().click();
      await page.waitForTimeout(300);
    }
  } catch {}

  const signInLocator = page.locator('a:has-text("Sign in"), button:has-text("Sign in")').first();
  await signInLocator.waitFor({ state: "visible", timeout: 10000 });
  await signInLocator.click();
  await page.fill('input[autocomplete="username"]', identifier);
  await page.click('button:has-text("Next")');
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Next")');
  await page.waitForSelector('[data-testid="homeScreenFeedTabs"]', { timeout: 30000 });
  console.log("Login successful");
}

// Define fixture types. The browser context is worker-scoped (launched once per
// worker); the page is test-scoped (fresh tab + navigation for every test).
type TestFixtures = {
  authenticatedPage: Page;
};

type WorkerFixtures = {
  sharedContext: BrowserContext;
};

/**
 * Custom test fixture with extension-loaded browser context
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  sharedContext: [
    async ({}, use) => {
      // Verify extension exists
      if (!fs.existsSync(path.join(TAMPERMONKEY_PATH, "manifest.json"))) {
        throw new Error("Tampermonkey extension not found. Run: npm run test:setup");
      }

      // Launch with persistent context (preserves userscript & auth from setup)
      const context = await firefox.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        args: ["-start-debugger-server", String(DEBUGGER_PORT)],
        viewport: { width: 1280, height: 720 },
        firefoxUserPrefs: {
          "devtools.debugger.remote-enabled": true,
          "devtools.debugger.prompt-connection": false,
          "xpinstall.signatures.required": false,
          "xpinstall.whitelist.required": false,
          "extensions.autoDisableScopes": 0,
          "extensions.enabledScopes": 15,
          "browser.shell.checkDefaultBrowser": false,
          "browser.startup.homepage_override.mstone": "ignore",
        },
      });

      // Install extension via RDP (required each launch for temp addon)
      try {
        await installExtensionViaRDP(TAMPERMONKEY_PATH);
      } catch (e) {
        // May already be installed or error is benign
        console.log("Extension install note:", (e as Error).message);
      }

      // Brief wait for extension to initialize
      await new Promise((r) => setTimeout(r, 1000));

      await use(context);
      await context.close().catch(() => {});
    },
    { scope: "worker" },
  ],

  authenticatedPage: async ({ sharedContext: context }, use) => {
    // The context is shared by every test in this worker. If Firefox crashed or
    // a previous test closed it, fail fast with a clear message instead of
    // hanging; Playwright then restarts the worker (and relaunches Firefox).
    let page: Page;
    let timer: NodeJS.Timeout | undefined;
    try {
      page = await Promise.race([
        context.newPage(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("newPage() timed out after 20s")), 20000);
        }),
      ]);
    } catch (e) {
      throw new Error(
        `Shared Firefox context is no longer usable (crashed, closed or wedged): ${(e as Error).message}`
      );
    } finally {
      clearTimeout(timer);
    }

    // Isolation: start every test in a brand-new tab (fresh sessionStorage,
    // history, focus, mouse position, no leftover modals/overlays) and close
    // any tabs or popups left over from the previous test or browser launch.
    for (const other of context.pages()) {
      if (other !== page) await other.close().catch(() => {});
    }

    await page.goto("https://bsky.app", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.evaluate(() => document.body.focus());

    // Quick check if login needed
    await page.waitForTimeout(500);

    const needsLogin = await page
      .locator('button:has-text("Sign in"), a:has-text("Sign in"), button:has-text("Create account")')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (needsLogin) {
      console.log("Session expired, re-authenticating...");
      await login(page);
    }

    // Wait for feed
    const feedSelector = '[data-testid^="feedItem-by-"]';
    await page.waitForSelector(feedSelector, { timeout: 15000 }).catch(() => {
      // Feed may be empty, continue
    });

    // Verify userscript is running (quick check)
    let scriptFound = false;
    for (let i = 0; i < 15; i++) {
      const hasElements = await page.evaluate(() => {
        return document.querySelector("#bsky-navigator-global-statusbar") !== null;
      });
      if (hasElements) {
        scriptFound = true;
        break;
      }
      await page.waitForTimeout(200);
    }

    if (!scriptFound) {
      const screenshotPath = path.join(TESTS_DIR, "test-results", "no-userscript.png");
      await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath });
      throw new Error("Userscript not running - statusbar not found");
    }

    await use(page);

    // Debug pause if enabled
    if (process.env.DEBUG_PAUSE === "true") {
      console.log("Pausing 30s for observation...");
      await page.waitForTimeout(30000).catch(() => {});
    }

    // Close this test's tab so its timers/observers stop. page.close() does NOT
    // run beforeunload, so the userscript's pending debounced state save is
    // discarded, matching the old per-test context.close() semantics (a
    // goto/reload would fire beforeunload -> saveStateImmediately() and persist
    // in-memory toggles like sort order or hide-read into the next test).
    // A blank placeholder tab keeps the window alive; the next test closes it.
    await context.newPage().catch(() => {});
    await page.close().catch(() => {});
  },
});

export { expect } from "@playwright/test";
