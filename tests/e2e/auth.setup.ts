/**
 * Playwright setup test - runs once before all other tests
 *
 * Handles:
 * - Firefox launch with debugger
 * - Tampermonkey extension installation via RDP
 * - Userscript installation
 * - Bluesky authentication
 * - Verifies everything is working
 */

import { test as setup, firefox } from "@playwright/test";
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
const USERSCRIPT_PATH = path.resolve(TESTS_DIR, "..", "dist", "bluesky-navigator.user.js");
const USERSCRIPT_MARKER = path.join(USER_DATA_DIR, ".userscript-installed");

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
          // Skip unparseable
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
        reject(new Error("Timeout"));
      }
    }, 10000);
  });
}

/**
 * Click Install button on Tampermonkey page via RDP
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
          // Skip
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
        } else if (step === 1 && m.from === "root") {
          sendMessage({ to: "root", type: "listTabs" });
          step = 2;
        } else if (step === 2 && m.tabs) {
          const tabs = m.tabs as Array<{ url?: string; actor?: string }>;
          for (const tab of tabs) {
            if (tab.url && tab.url.includes("moz-extension://")) {
              tabDescriptor = tab.actor || null;
              break;
            }
          }

          if (tabDescriptor) {
            sendMessage({ to: tabDescriptor, type: "getTarget" });
            step = 3;
          } else {
            client.destroy();
            resolve(false);
          }
        } else if (step === 3 && m.frame) {
          const frame = m.frame as { consoleActor?: string };
          consoleActor = frame.consoleActor || null;

          if (consoleActor) {
            const script = `
              (function() {
                const selectors = [
                  'input[value="Install"]',
                  'input[value="Reinstall"]',
                  'input[value="Upgrade"]',
                  'input[value="Downgrade"]'
                ];
                for (const sel of selectors) {
                  const btn = document.querySelector(sel);
                  if (btn) { btn.click(); return 'clicked'; }
                }
                return 'not found';
              })()
            `;
            sendMessage({ to: consoleActor, type: "evaluateJSAsync", text: script });
            step = 4;
          } else {
            client.destroy();
            resolve(false);
          }
        } else if (step === 4 && m.resultID) {
          step = 5;
        } else if (step === 5) {
          if (m.result !== undefined || m.exception || m.type === "descriptor-destroyed") {
            const result = (m.result as { value?: string })?.value;
            client.destroy();
            resolve(result === "clicked" || m.type === "descriptor-destroyed");
          }
        }
      }
    });

    client.on("error", reject);
    setTimeout(() => { client.destroy(); resolve(false); }, 15000);
  });
}

/**
 * Install userscript into Tampermonkey
 */
async function installUserscript(context: Awaited<ReturnType<typeof firefox.launchPersistentContext>>): Promise<boolean> {
  const userscriptContent = fs.readFileSync(USERSCRIPT_PATH, "utf-8");

  const http = await import("http");
  const server = http.createServer((req, res) => {
    if (req.url === "/bluesky-navigator.user.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(userscriptContent);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const page = await context.newPage();
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  try {
    await page.goto(`http://127.0.0.1:${port}/bluesky-navigator.user.js`, { timeout: 30000, waitUntil: "commit" });
  } catch {
    // Navigation intercepted by Tampermonkey
  }

  await page.waitForTimeout(2000);

  let installed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      installed = await clickInstallViaRDP();
      if (installed) break;
    } catch {
      // Retry
    }
    await page.waitForTimeout(1500);
  }

  await page.waitForTimeout(1500);
  server.close();
  await page.close().catch(() => {});

  return installed;
}

/**
 * Login to Bluesky
 */
async function login(page: Awaited<ReturnType<typeof firefox.launchPersistentContext>>["pages"] extends () => infer R ? R extends Array<infer P> ? P : never : never): Promise<void> {
  const identifier = process.env.BSKY_IDENTIFIER;
  const password = process.env.BSKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error("Missing BSKY_IDENTIFIER or BSKY_APP_PASSWORD");
  }

  await page.waitForLoadState("networkidle");

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
}

// Setup test - runs once before all other tests
setup("setup extension and authentication", async ({}) => {
  console.log("[Setup] Starting one-time test setup...");

  // Ensure user data directory exists
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  const userscriptInstalled = fs.existsSync(USERSCRIPT_MARKER);

  // Launch Firefox
  console.log("[Setup] Launching Firefox...");
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
    },
  });

  // Install extension
  console.log("[Setup] Installing Tampermonkey...");
  try {
    await installExtensionViaRDP(TAMPERMONKEY_PATH);
    console.log("[Setup] Extension installed");
  } catch (e) {
    console.log("[Setup] Extension note:", (e as Error).message);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Install userscript if needed
  if (!userscriptInstalled) {
    console.log("[Setup] Installing userscript...");
    const installed = await installUserscript(context);
    if (installed) {
      fs.writeFileSync(USERSCRIPT_MARKER, new Date().toISOString());
      console.log("[Setup] Userscript installed");
    }
  } else {
    console.log("[Setup] Userscript already installed");
  }

  // Login if needed
  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://bsky.app", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);

  const needsLogin = await page
    .locator('button:has-text("Sign in"), a:has-text("Sign in")')
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (needsLogin) {
    console.log("[Setup] Logging in...");
    await login(page);
    console.log("[Setup] Login complete");
  } else {
    console.log("[Setup] Already logged in");
  }

  // Verify userscript
  console.log("[Setup] Verifying userscript...");
  let found = false;
  for (let i = 0; i < 20; i++) {
    const hasStatusbar = await page.evaluate(() =>
      document.querySelector("#bsky-navigator-global-statusbar") !== null
    );
    if (hasStatusbar) {
      found = true;
      break;
    }
    await page.waitForTimeout(300);
  }

  if (!found) {
    throw new Error("Userscript not running after setup");
  }

  console.log("[Setup] Setup complete!");
  await context.close();
});
