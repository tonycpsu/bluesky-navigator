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

// Define fixture types
type Fixtures = {
  sharedContext: BrowserContext;
  authenticatedPage: Page;
};

/**
 * Custom test fixture with extension-loaded browser context
 */
export const test = base.extend<Fixtures>({
  sharedContext: async ({}, use) => {
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
    await context.close();
  },

  authenticatedPage: async ({ sharedContext: context }, use) => {
    // Reuse existing page if available
    const existingPages = context.pages();
    const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();

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
  },
});

export { expect } from "@playwright/test";
