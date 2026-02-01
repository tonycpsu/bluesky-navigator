/**
 * Playwright test fixtures for Bluesky Navigator
 *
 * Provides:
 * - Browser context with Tampermonkey extension loaded via Firefox RDP
 * - Authenticated page ready for testing
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
const TAMPERMONKEY_XPI = path.join(TAMPERMONKEY_PATH, "tampermonkey.xpi");
const USER_DATA_DIR = path.join(TESTS_DIR, "user-data-firefox");
const USERSCRIPT_PATH = path.resolve(TESTS_DIR, "..", "dist", "bluesky-navigator.user.js");
const AUTH_STATE_PATH = path.join(TESTS_DIR, ".auth-state.json");

const DEBUGGER_PORT = 12345;

/**
 * Install Firefox extension via Remote Debugging Protocol
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
          console.log("Failed to parse message:", messageStr);
        }
      }

      return messages;
    };

    client.connect(DEBUGGER_PORT, "localhost", () => {
      console.log("Connected to Firefox debugger");
    });

    client.on("data", (data) => {
      const messages = parseMessages(data);

      for (const msg of messages) {
        const m = msg as Record<string, unknown>;
        if (step === 0) {
          sendMessage({ to: "root", type: "getRoot" });
          step = 1;
        } else if (step === 1 && m.addonsActor) {
          addonsActor = m.addonsActor as string;
          console.log("Got addons actor:", addonsActor);

          sendMessage({
            to: addonsActor,
            type: "installTemporaryAddon",
            addonPath: extensionPath,
          });
          step = 2;
        } else if (step === 2) {
          if (m.addon) {
            console.log("Extension installed successfully:", (m.addon as { id: string }).id);
            client.destroy();
            resolve(m.addon as { id: string });
          } else if (m.error) {
            console.log("Extension install error:", m.error);
            client.destroy();
            reject(new Error(String(m.error)));
          }
        }
      }
    });

    client.on("error", (err) => {
      console.log("Socket error:", err.message);
      reject(err);
    });

    client.on("close", () => {
      console.log("Connection closed");
    });

    setTimeout(() => {
      if (step < 2) {
        client.destroy();
        reject(new Error("Timeout waiting for extension install"));
      }
    }, 10000);
  });
}

/**
 * Find and click Install button on Tampermonkey page via RDP
 */
async function clickInstallViaRDP(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = "";
    let step = 0;
    let tabDescriptor: string | null = null;
    let consoleActor: string | null = null;

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
          console.log("RDP parse error:", messageStr.substring(0, 100));
        }
      }

      return messages;
    };

    client.connect(DEBUGGER_PORT, "localhost", () => {
      console.log("RDP: Connected for Install click");
    });

    client.on("data", (data) => {
      const messages = parseMessages(data);

      for (const msg of messages) {
        const m = msg as Record<string, unknown>;
        console.log("RDP step", step, ":", JSON.stringify(msg).substring(0, 300));

        if (step === 0) {
          sendMessage({ to: "root", type: "getRoot" });
          step = 1;
        } else if (step === 1 && m.from === "root") {
          console.log("RDP: Got root, listing targets");
          sendMessage({ to: "root", type: "listTabs" });
          step = 2;
        } else if (step === 2 && m.tabs) {
          const tabs = m.tabs as Array<{ url?: string; actor?: string }>;
          console.log("RDP: Found", tabs.length, "tabs");
          for (const tab of tabs) {
            console.log("RDP: Tab:", tab.url);
            if (tab.url && tab.url.includes("moz-extension://")) {
              console.log("RDP: Found extension tab!");
              tabDescriptor = tab.actor || null;
              break;
            }
          }

          if (tabDescriptor) {
            console.log("RDP: Getting target from", tabDescriptor);
            sendMessage({ to: tabDescriptor, type: "getTarget" });
            step = 3;
          } else {
            console.log("RDP: No extension tab found");
            client.destroy();
            resolve(false);
          }
        } else if (step === 3 && m.frame) {
          const frame = m.frame as { actor?: string; consoleActor?: string };
          consoleActor = frame.consoleActor || null;
          console.log("RDP: Got console actor:", consoleActor);

          if (consoleActor) {
            const script = `
              (function() {
                const selectors = [
                  'input[value="Install"]',
                  'input[value="Reinstall"]',
                  'input[value="Upgrade"]',
                  'input[value="Downgrade"]',
                  'input[value="Update"]'
                ];
                for (const sel of selectors) {
                  const btn = document.querySelector(sel);
                  if (btn) {
                    btn.click();
                    return 'clicked';
                  }
                }
                return 'not found: ' + document.body.innerHTML.substring(0, 200);
              })()
            `;
            sendMessage({
              to: consoleActor,
              type: "evaluateJSAsync",
              text: script,
            });
            step = 4;
          } else {
            console.log("RDP: No console actor in response");
            client.destroy();
            resolve(false);
          }
        } else if (step === 4) {
          if (m.resultID) {
            console.log("RDP: Got resultID, waiting for actual result...");
            step = 5;
          }
        } else if (step === 5) {
          if (m.result !== undefined || m.exception) {
            if (m.exception) {
              console.log("RDP: Script exception:", m.exception);
              client.destroy();
              resolve(false);
            } else {
              const result = (m.result as { value?: string })?.value || m.result;
              console.log("RDP: Script result:", result);
              client.destroy();
              resolve(result === "clicked");
            }
          } else if (m.type === "evaluationResult") {
            const result = (m.result as { value?: string })?.value || m.result;
            console.log("RDP: Evaluation result:", result);
            client.destroy();
            resolve(result === "clicked");
          } else if (m.type === "descriptor-destroyed" || m.type === "forwardingCancelled") {
            console.log("RDP: Tab closed after click - Install successful!");
            client.destroy();
            resolve(true);
          }
        }
      }
    });

    client.on("error", (err) => {
      console.log("RDP socket error:", err.message);
      reject(err);
    });

    client.on("close", () => {
      console.log("RDP: Connection closed");
    });

    setTimeout(() => {
      if (step < 5) {
        console.log("RDP: Timeout at step", step);
        client.destroy();
        resolve(false);
      }
    }, 15000);
  });
}

/**
 * Install userscript into Tampermonkey via HTTP server
 */
async function installUserscript(context: BrowserContext): Promise<boolean> {
  console.log("Installing userscript into Tampermonkey...");

  const userscriptContent = fs.readFileSync(USERSCRIPT_PATH, "utf-8");
  console.log(`Read userscript: ${userscriptContent.length} chars`);

  // Start HTTP server
  const http = await import("http");
  const server = http.createServer((req, res) => {
    if (req.url === "/bluesky-navigator.user.js") {
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Content-Disposition": "inline",
      });
      res.end(userscriptContent);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  console.log(`Started local server on port ${port}`);

  const page = await context.newPage();

  // First navigate to a regular page to let Tampermonkey initialize
  console.log("Loading initial page to initialize Tampermonkey...");
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2000));

  const userscriptUrl = `http://127.0.0.1:${port}/bluesky-navigator.user.js`;
  console.log(`Navigating to: ${userscriptUrl}`);

  // Navigate - Tampermonkey should intercept and open install page
  try {
    await page.goto(userscriptUrl, { timeout: 30000, waitUntil: "commit" });
    console.log(`Page navigated to: ${page.url()}`);
  } catch (e) {
    console.log(`Navigation result: ${(e as Error).message}`);
    console.log(`Page URL after nav attempt: ${page.url()}`);
  }

  // Wait for Tampermonkey to open its install page
  console.log("Waiting for Tampermonkey install page to open...");
  await new Promise((r) => setTimeout(r, 3000));

  // Use RDP to find and click the Install button
  console.log("Using RDP to click Install button...");
  let installed = false;

  for (let attempt = 0; attempt < 10; attempt++) {
    console.log(`RDP attempt ${attempt + 1}...`);
    try {
      installed = await clickInstallViaRDP();
      if (installed) {
        console.log("Install button clicked via RDP!");
        break;
      }
    } catch (e) {
      console.log(`RDP attempt failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Wait for install to complete
  console.log("Waiting for install to complete...");
  await new Promise((r) => setTimeout(r, 3000));

  server.close();

  if (installed) {
    console.log("Userscript installed successfully!");
  } else {
    console.log("Failed to install userscript via RDP");
  }

  // Close the example.com page
  await page.close().catch(() => {});

  return installed;
}

/**
 * Login to Bluesky
 */
async function login(page: Page): Promise<void> {
  const identifier = process.env.BSKY_IDENTIFIER;
  const password = process.env.BSKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error("Missing BSKY_IDENTIFIER or BSKY_APP_PASSWORD");
  }

  await page.waitForLoadState("networkidle");

  // Dismiss welcome modal if present (various formats)
  try {
    // Try close button first
    const closeBtn = page.locator('button[aria-label="Close welcome modal"], button[aria-label="Close"]');
    if (await closeBtn.first().isVisible({ timeout: 2000 })) {
      await closeBtn.first().click();
      await page.waitForTimeout(500);
    }
  } catch {}

  // Look for sign in link/button in multiple locations
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
    if (!fs.existsSync(TAMPERMONKEY_XPI) && !fs.existsSync(path.join(TAMPERMONKEY_PATH, "manifest.json"))) {
      throw new Error("Tampermonkey extension not found. Run: npm run test:setup");
    }

    const extensionPath = TAMPERMONKEY_PATH;
    console.log(`Extension path: ${extensionPath}`);

    // Use persistent context to keep extension and userscript across runs
    console.log("Launching Firefox with persistent profile...");
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
        "extensions.webextensions.ExtensionStorageIDB.migrated.firefox@tampermonkey.net": true,
        "extensions.ui.dictionary.hidden": true,
        "extensions.ui.locale.hidden": true,
        "extensions.ui.sitepermission.hidden": true,
        "browser.shell.checkDefaultBrowser": false,
        "browser.startup.homepage_override.mstone": "ignore",
        "browser.tabs.warnOnClose": false,
        "browser.tabs.warnOnCloseOtherTabs": false,
        "toolkit.telemetry.reportingpolicy.firstRun": false,
      },
    });

    // Install extension via RDP
    console.log("Installing extension via RDP...");
    try {
      await installExtensionViaRDP(extensionPath);
      console.log("Extension installed for current session");
    } catch (e) {
      console.log("Extension install error (may already be installed):", (e as Error).message);
    }

    // Wait for extension to initialize
    console.log("Waiting for extension to initialize...");
    await new Promise((r) => setTimeout(r, 2000));

    // Check if userscript is already installed
    const userscriptMarker = path.join(USER_DATA_DIR, ".userscript-installed");
    const userscriptInstalled = fs.existsSync(userscriptMarker);

    if (userscriptInstalled) {
      console.log("Userscript already installed (marker found), skipping");
    } else {
      console.log("Userscript not found, installing...");
      await installUserscript(context);
      fs.writeFileSync(userscriptMarker, new Date().toISOString());
    }

    await use(context);
    await context.close();
  },

  authenticatedPage: async ({ sharedContext: context }, use) => {
    // Reuse existing page if available
    const existingPages = context.pages();
    const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();
    console.log("Navigating to bsky.app...");
    await page.goto("https://bsky.app", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Transfer focus from URL bar to page content
    await page.evaluate(() => document.body.focus());

    // Check if logged in - look for various login prompts
    // Wait a moment for page to settle
    await page.waitForTimeout(1000);

    // Check for welcome modal or sign in prompt
    const hasSignInButton = await page
      .locator('button:has-text("Sign in"), a:has-text("Sign in"), button:has-text("Create account")')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Also check if there's a modal blocking the page
    const hasWelcomeModal = await page
      .locator('div[role="dialog"]:has-text("Sign in"), div[role="dialog"]:has-text("Create account")')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (hasSignInButton || hasWelcomeModal) {
      console.log("Sign in required (found:", hasSignInButton ? "sign-in button" : "", hasWelcomeModal ? "welcome modal" : "", ")");
      await login(page);
      try {
        await context.storageState({ path: AUTH_STATE_PATH });
        console.log("Auth state saved for future runs");
      } catch (e) {
        console.log("Could not save auth state:", (e as Error).message);
      }
    } else {
      console.log("Already logged in (session restored)");
    }

    // Wait for feed
    console.log("Waiting for feed...");
    const feedSelectors = [
      '[data-testid^="feedItem-by-"]',
      '[data-testid^="feedItem"]',
      'div[tabindex="0"][role="link"]',
    ];

    let foundSelector = null;
    for (const selector of feedSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        foundSelector = selector;
        break;
      }
    }

    if (foundSelector) {
      await page.waitForSelector(foundSelector, { timeout: 30000 });
      console.log("Feed loaded");
    }

    // Wait for userscript
    console.log("Waiting for userscript...");
    let scriptFound = false;

    for (let i = 0; i < 30; i++) {
      const hasElements = await page.evaluate(() => {
        return (
          document.querySelector("#bsky-navigator-global-statusbar") !== null ||
          document.querySelector(".bsky-navigator-global-statusbar") !== null ||
          document.querySelectorAll('[class*="bsky-navigator"]').length > 0
        );
      });

      if (hasElements) {
        scriptFound = true;
        console.log("Userscript running!");
        break;
      }

      await page.waitForTimeout(500);
    }

    if (!scriptFound) {
      const screenshotPath = path.join(TESTS_DIR, "test-results", "no-toolbar.png");
      await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false });
      throw new Error("Userscript not running - no bsky-navigator elements found");
    }

    await use(page);

    // Pause after test to observe results (set DEBUG_PAUSE=true to enable)
    if (process.env.DEBUG_PAUSE === "true") {
      console.log("Test complete. Pausing 30 seconds for observation...");
      await page.waitForTimeout(30000).catch(() => {});
    }
  },
});

export { expect } from "@playwright/test";
