/**
 * Playwright test fixtures for Bluesky Navigator
 *
 * Provides:
 * - Browser context with Tampermonkey extension loaded via Firefox RDP
 * - Authenticated page ready for testing
 * - Helper functions for common operations
 */

import { test as base, firefox } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.dirname(__dirname);

// Load environment variables
dotenv.config({ path: path.join(TESTS_DIR, '.env') });

const TAMPERMONKEY_PATH = path.join(TESTS_DIR, 'extensions', 'tampermonkey');
const TAMPERMONKEY_XPI = path.join(TAMPERMONKEY_PATH, 'tampermonkey.xpi');
const USER_DATA_DIR = path.join(TESTS_DIR, 'user-data-firefox');
const USERSCRIPT_PATH = path.resolve(TESTS_DIR, '..', 'dist', 'bluesky-navigator.user.js');
const AUTH_STATE_PATH = path.join(TESTS_DIR, '.auth-state.json');

const DEBUGGER_PORT = 12345;

/**
 * Install Firefox extension via Remote Debugging Protocol
 */
async function installExtensionViaRDP(extensionPath) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = '';
    let step = 0;
    let addonsActor = null;

    const sendMessage = (msg) => {
      const json = JSON.stringify(msg);
      const packet = `${json.length}:${json}`;
      client.write(packet);
    };

    const parseMessages = (data) => {
      buffer += data.toString();
      const messages = [];

      while (buffer.length > 0) {
        const colonIndex = buffer.indexOf(':');
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
        } catch (e) {
          console.log('Failed to parse message:', messageStr);
        }
      }

      return messages;
    };

    client.connect(DEBUGGER_PORT, 'localhost', () => {
      console.log('Connected to Firefox debugger');
    });

    client.on('data', (data) => {
      const messages = parseMessages(data);

      for (const msg of messages) {
        if (step === 0) {
          // Initial connection, request root
          sendMessage({ to: 'root', type: 'getRoot' });
          step = 1;
        } else if (step === 1 && msg.addonsActor) {
          // Got root, now get addons actor
          addonsActor = msg.addonsActor;
          console.log('Got addons actor:', addonsActor);

          // Install the extension
          sendMessage({
            to: addonsActor,
            type: 'installTemporaryAddon',
            addonPath: extensionPath,
          });
          step = 2;
        } else if (step === 2) {
          // Check install result
          if (msg.addon) {
            console.log('Extension installed successfully:', msg.addon.id);
            client.destroy();
            resolve(msg.addon);
          } else if (msg.error) {
            console.log('Extension install error:', msg.error);
            client.destroy();
            reject(new Error(msg.error));
          }
        }
      }
    });

    client.on('error', (err) => {
      console.log('Socket error:', err.message);
      reject(err);
    });

    client.on('close', () => {
      console.log('Connection closed');
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (step < 2) {
        client.destroy();
        reject(new Error('Timeout waiting for extension install'));
      }
    }, 10000);
  });
}

/**
 * Find and click Install button on Tampermonkey page via RDP
 */
async function clickInstallViaRDP() {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = '';
    let step = 0;
    let tabDescriptor = null;
    let targetActor = null;
    let consoleActor = null;

    const sendMessage = (msg) => {
      const json = JSON.stringify(msg);
      const packet = `${json.length}:${json}`;
      client.write(packet);
    };

    const parseMessages = (data) => {
      buffer += data.toString();
      const messages = [];

      while (buffer.length > 0) {
        const colonIndex = buffer.indexOf(':');
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
        } catch (e) {
          console.log('RDP parse error:', messageStr.substring(0, 100));
        }
      }

      return messages;
    };

    client.connect(DEBUGGER_PORT, 'localhost', () => {
      console.log('RDP: Connected for Install click');
    });

    client.on('data', (data) => {
      const messages = parseMessages(data);

      for (const msg of messages) {
        console.log('RDP step', step, ':', JSON.stringify(msg).substring(0, 300));

        if (step === 0) {
          // Initial connection, request root
          sendMessage({ to: 'root', type: 'getRoot' });
          step = 1;
        } else if (step === 1 && msg.from === 'root') {
          // Got root, list tabs
          console.log('RDP: Got root, listing targets');
          sendMessage({ to: 'root', type: 'listTabs' });
          step = 2;
        } else if (step === 2 && msg.tabs) {
          // Got tabs list
          console.log('RDP: Found', msg.tabs.length, 'tabs');
          for (const tab of msg.tabs) {
            console.log('RDP: Tab:', tab.url);
            if (tab.url && tab.url.includes('moz-extension://')) {
              console.log('RDP: Found extension tab!');
              tabDescriptor = tab.actor;
              break;
            }
          }

          if (tabDescriptor) {
            // Get the target from the tab descriptor
            console.log('RDP: Getting target from', tabDescriptor);
            sendMessage({ to: tabDescriptor, type: 'getTarget' });
            step = 3;
          } else {
            console.log('RDP: No extension tab found');
            client.destroy();
            resolve(false);
          }
        } else if (step === 3 && msg.frame) {
          // Got target from tabDescriptor
          targetActor = msg.frame.actor;
          consoleActor = msg.frame.consoleActor;
          console.log('RDP: Got target actor:', targetActor);
          console.log('RDP: Got console actor:', consoleActor);

          if (consoleActor) {
            // Execute click script via console
            // Look for Install, Reinstall, Upgrade, or Downgrade buttons
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
              type: 'evaluateJSAsync',
              text: script,
            });
            step = 4;
          } else {
            console.log('RDP: No console actor in response');
            client.destroy();
            resolve(false);
          }
        } else if (step === 4) {
          // evaluateJSAsync first returns resultID, then the actual result
          if (msg.resultID) {
            console.log('RDP: Got resultID, waiting for actual result...');
            step = 5; // Move to next step to watch for result or tab close
          }
        } else if (step === 5) {
          // Waiting for script result or tab close
          if (msg.result !== undefined || msg.exception) {
            if (msg.exception) {
              console.log('RDP: Script exception:', msg.exception);
              client.destroy();
              resolve(false);
            } else {
              const result = msg.result?.value || msg.result;
              console.log('RDP: Script result:', result);
              client.destroy();
              resolve(result === 'clicked');
            }
          } else if (msg.type === 'evaluationResult') {
            // Alternative format for evaluation result
            const result = msg.result?.value || msg.result;
            console.log('RDP: Evaluation result:', result);
            client.destroy();
            resolve(result === 'clicked');
          } else if (msg.type === 'descriptor-destroyed') {
            // Tab was destroyed - this means Install was clicked and page closed
            console.log('RDP: Tab closed after click - Install successful!');
            client.destroy();
            resolve(true);
          } else if (msg.type === 'forwardingCancelled') {
            // Connection to target cancelled - also indicates success
            console.log('RDP: Target connection cancelled - Install successful!');
            client.destroy();
            resolve(true);
          }
        }
      }
    });

    client.on('error', (err) => {
      console.log('RDP socket error:', err.message);
      reject(err);
    });

    client.on('close', () => {
      console.log('RDP: Connection closed');
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      if (step < 5) {
        console.log('RDP: Timeout at step', step);
        client.destroy();
        resolve(false);
      }
    }, 15000);
  });
}

/**
 * Install userscript into Tampermonkey via HTTP server
 */
async function installUserscript(browser, context) {
  console.log('Installing userscript into Tampermonkey...');

  const userscriptContent = fs.readFileSync(USERSCRIPT_PATH, 'utf-8');
  console.log(`Read userscript: ${userscriptContent.length} chars`);

  // Start HTTP server
  const http = await import('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/bluesky-navigator.user.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Content-Disposition': 'inline',
      });
      res.end(userscriptContent);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Started local server on port ${port}`);

  const page = await context.newPage();

  // First navigate to a regular page to let Tampermonkey initialize
  console.log('Loading initial page to initialize Tampermonkey...');
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const userscriptUrl = `http://127.0.0.1:${port}/bluesky-navigator.user.js`;
  console.log(`Navigating to: ${userscriptUrl}`);

  // Navigate - Tampermonkey should intercept and open install page
  try {
    await page.goto(userscriptUrl, { timeout: 30000, waitUntil: 'commit' });
    console.log(`Page navigated to: ${page.url()}`);
  } catch (e) {
    console.log(`Navigation result: ${e.message}`);
    console.log(`Page URL after nav attempt: ${page.url()}`);
  }

  // Wait for Tampermonkey to open its install page
  console.log('Waiting for Tampermonkey install page to open...');
  await new Promise(r => setTimeout(r, 3000));

  // Use RDP to find and click the Install button
  console.log('Using RDP to click Install button...');
  let installed = false;

  for (let attempt = 0; attempt < 10; attempt++) {
    console.log(`RDP attempt ${attempt + 1}...`);
    try {
      installed = await clickInstallViaRDP();
      if (installed) {
        console.log('Install button clicked via RDP!');
        break;
      }
    } catch (e) {
      console.log(`RDP attempt failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Wait for install to complete
  console.log('Waiting for install to complete...');
  await new Promise(r => setTimeout(r, 3000));

  server.close();

  if (installed) {
    console.log('Userscript installed successfully!');
  } else {
    console.log('Failed to install userscript via RDP');
  }

  // Close the example.com page
  await page.close().catch(() => {});

  return installed;
}

/**
 * Custom test fixture with extension-loaded browser context
 */
export const test = base.extend({
  sharedContext: async ({}, use) => {
    // Verify extension exists
    if (!fs.existsSync(TAMPERMONKEY_XPI) && !fs.existsSync(path.join(TAMPERMONKEY_PATH, 'manifest.json'))) {
      throw new Error('Tampermonkey extension not found. Run: npm run test:setup');
    }

    // Use directory path for RDP install (it works with directories)
    const extensionPath = TAMPERMONKEY_PATH;
    console.log(`Extension path: ${extensionPath}`);

    // Use persistent context to keep extension and userscript across runs
    // Note: headless: false is required - extensions don't work in headless mode
    console.log('Launching Firefox with persistent profile...');
    const context = await firefox.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: ['-start-debugger-server', String(DEBUGGER_PORT)],
      viewport: { width: 1280, height: 720 },
      firefoxUserPrefs: {
        'devtools.debugger.remote-enabled': true,
        'devtools.debugger.prompt-connection': false,
        'xpinstall.signatures.required': false,
        'xpinstall.whitelist.required': false,
        'extensions.autoDisableScopes': 0,
        'extensions.enabledScopes': 15,
        // Suppress extension welcome/first-run pages
        'extensions.webextensions.ExtensionStorageIDB.migrated.firefox@tampermonkey.net': true,
        'extensions.ui.dictionary.hidden': true,
        'extensions.ui.locale.hidden': true,
        'extensions.ui.sitepermission.hidden': true,
        'browser.shell.checkDefaultBrowser': false,
        'browser.startup.homepage_override.mstone': 'ignore',
        'browser.tabs.warnOnClose': false,
        'browser.tabs.warnOnCloseOtherTabs': false,
        'toolkit.telemetry.reportingpolicy.firstRun': false,
      },
    });

    // Always install extension via RDP (Firefox doesn't auto-load from profile/extensions)
    // RDP installation is temporary and lasts only for this session
    console.log('Installing extension via RDP...');
    try {
      await installExtensionViaRDP(extensionPath);
      console.log('Extension installed for current session');
    } catch (e) {
      console.log('Extension install error (may already be installed):', e.message);
    }

    // Wait for extension to initialize
    console.log('Waiting for extension to initialize...');
    await new Promise(r => setTimeout(r, 2000));

    // Check if userscript is already installed by looking for the script file marker
    // This avoids opening a page just to check
    const userscriptMarker = path.join(USER_DATA_DIR, '.userscript-installed');
    const userscriptInstalled = fs.existsSync(userscriptMarker);

    if (userscriptInstalled) {
      console.log('Userscript already installed (marker found), skipping');
    } else {
      console.log('Userscript not found, installing...');
      await installUserscript(context.browser(), context);
      // Create marker file
      fs.writeFileSync(userscriptMarker, new Date().toISOString());
    }

    await use(context);
    await context.close();
  },

  authenticatedPage: async ({ sharedContext: context }, use) => {
    // Reuse existing page if available (Firefox opens about:blank on startup)
    const existingPages = context.pages();
    const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();
    console.log('Navigating to bsky.app...');
    await page.goto('https://bsky.app', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Transfer focus from URL bar to page content
    await page.evaluate(() => document.body.focus());

    // Check if logged in
    const hasSignInButton = await page
      .locator('button:has-text("Sign in"), a:has-text("Sign in")')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasSignInButton) {
      await login(page);
      // Save auth state for future runs
      try {
        await context.storageState({ path: AUTH_STATE_PATH });
        console.log('Auth state saved for future runs');
      } catch (e) {
        console.log('Could not save auth state:', e.message);
      }
    } else {
      console.log('Already logged in (session restored)');
    }

    // Wait for feed
    console.log('Waiting for feed...');
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
      console.log('Feed loaded');
    }

    // Wait for userscript - poll for element existence since waitForSelector can be unreliable
    console.log('Waiting for userscript...');
    let scriptFound = false;

    // Poll for userscript elements
    for (let i = 0; i < 30; i++) {
      const hasElements = await page.evaluate(() => {
        return document.querySelector('#bsky-navigator-global-statusbar') !== null ||
               document.querySelector('.bsky-navigator-global-statusbar') !== null ||
               document.querySelectorAll('[class*="bsky-navigator"]').length > 0;
      });

      if (hasElements) {
        scriptFound = true;
        console.log('Userscript running!');
        break;
      }

      await page.waitForTimeout(500);
    }

    if (!scriptFound) {
      const screenshotPath = path.join(TESTS_DIR, 'test-results', 'no-toolbar.png');
      await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false });
      throw new Error('Userscript not running - no bsky-navigator elements found');
    }

    await use(page);

    // Pause after test to observe results (set DEBUG_PAUSE=true to enable)
    if (process.env.DEBUG_PAUSE === 'true') {
      console.log('Test complete. Pausing 30 seconds for observation...');
      await page.waitForTimeout(30000).catch(() => {});
    }
  },
});

async function login(page) {
  const identifier = process.env.BSKY_IDENTIFIER;
  const password = process.env.BSKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error('Missing BSKY_IDENTIFIER or BSKY_APP_PASSWORD');
  }

  await page.waitForLoadState('networkidle');

  // Dismiss welcome modal
  try {
    const closeBtn = page.locator('button[aria-label="Close welcome modal"]');
    if (await closeBtn.isVisible({ timeout: 3000 })) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {}

  await page.locator('text=Sign in').first().click();
  await page.fill('input[autocomplete="username"]', identifier);
  await page.click('button:has-text("Next")');
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Next")');
  await page.waitForSelector('[data-testid="homeScreenFeedTabs"]', { timeout: 30000 });
  console.log('Login successful');
}

export async function waitForScriptReady(page) {
  // Wait for userscript elements (they may be hidden, so use state: 'attached')
  await page.waitForSelector('#bsky-navigator-global-statusbar', { timeout: 10000, state: 'attached' });
  await page.waitForSelector('[data-testid^="feedItem-by-"]', { timeout: 10000 });
  // Allow time for feed to stabilize and all posts to render
  await page.waitForTimeout(1500);

  // Check if a post is already marked as current
  const hasCurrent = await page.locator('.item-selection-active').count();

  if (hasCurrent === 0) {
    // Focus the page body to ensure keyboard events are received
    await page.evaluate(() => document.body.focus());

    // Press gg to go to first post and initialize selection
    await page.keyboard.press('g');
    await page.waitForTimeout(200);
    await page.keyboard.press('g');
    await page.waitForTimeout(1000);

    // If still no selection, try pressing j
    const afterGG = await page.locator('.item-selection-active').count();
    if (afterGG === 0) {
      await page.keyboard.press('j');
      await page.waitForTimeout(500);
    }
  }

  // Wait for a current post to be selected
  await page.waitForSelector('.item-selection-active', { timeout: 10000 });
}

export async function getCurrentPost(page) {
  return page.locator('.item-selection-active');
}

export async function getAllPosts(page) {
  return page.locator('[data-testid^="feedItem-by-"]');
}

export async function pressKey(page, key, options = {}) {
  // Pause before first keypress if DEBUG_PAUSE is enabled
  if (process.env.DEBUG_PAUSE === 'true' && !page._debugPauseComplete) {
    console.log('Pausing 10 seconds before first keypress...');
    await page.waitForTimeout(10000);
    page._debugPauseComplete = true;
  }

  // Blur any text inputs to ensure keyboard goes to the page
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    document.body.focus();
  });

  // Dispatch keyboard event directly to document for userscript compatibility
  // Playwright's keyboard API doesn't always work with userscript event listeners
  await page.evaluate((keySpec) => {
    // Parse key specification (e.g., "Shift+/", "Alt+.", "j", "ArrowDown")
    const parts = keySpec.split('+');
    const actualKey = parts[parts.length - 1];
    const shiftKey = parts.includes('Shift');
    const altKey = parts.includes('Alt');
    const ctrlKey = parts.includes('Control') || parts.includes('Ctrl');
    const metaKey = parts.includes('Meta') || parts.includes('Cmd');

    // Map special key names to key and code
    let key = actualKey;
    let code = actualKey;

    // Special keys mapping
    const specialKeys = {
      'Escape': { key: 'Escape', code: 'Escape' },
      'Enter': { key: 'Enter', code: 'Enter' },
      'Tab': { key: 'Tab', code: 'Tab' },
      'Backspace': { key: 'Backspace', code: 'Backspace' },
      'Delete': { key: 'Delete', code: 'Delete' },
      'Home': { key: 'Home', code: 'Home' },
      'End': { key: 'End', code: 'End' },
      'PageUp': { key: 'PageUp', code: 'PageUp' },
      'PageDown': { key: 'PageDown', code: 'PageDown' },
      'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp' },
      'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown' },
      'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft' },
      'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight' },
    };

    if (specialKeys[actualKey]) {
      key = specialKeys[actualKey].key;
      code = specialKeys[actualKey].code;
    } else if (actualKey === '/' && shiftKey) {
      key = '?';
      code = 'Slash';
    } else if (actualKey === ';' && shiftKey) {
      key = ':';
      code = 'Semicolon';
    } else if (actualKey === '=' && shiftKey) {
      key = '+';
      code = 'Equal';
    } else if (actualKey === '.') {
      code = 'Period';
    } else if (actualKey === '/') {
      code = 'Slash';
    } else if (actualKey === '-') {
      code = 'Minus';
    } else if (actualKey.length === 1) {
      code = `Key${actualKey.toUpperCase()}`;
    }

    // Get keyCode for legacy support
    let keyCode = 0;
    if (key.length === 1) {
      keyCode = key.toUpperCase().charCodeAt(0);
    } else {
      const keyCodes = {
        'Escape': 27, 'Enter': 13, 'Tab': 9, 'Backspace': 8, 'Delete': 46,
        'Home': 36, 'End': 35, 'PageUp': 33, 'PageDown': 34,
        'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39,
      };
      keyCode = keyCodes[key] || 0;
    }

    const eventInit = {
      key: key,
      code: code,
      keyCode: keyCode,
      which: keyCode,
      shiftKey: shiftKey,
      altKey: altKey,
      ctrlKey: ctrlKey,
      metaKey: metaKey,
      bubbles: true,
      cancelable: true,
    };

    // Dispatch both keydown and keyup for proper event handling
    document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }, key);

  if (options.waitForUpdate !== false) {
    await page.waitForTimeout(300);
  }
}

export async function isShortcutsOverlayVisible(page) {
  return page.locator('.shortcut-overlay').isVisible();
}

export async function isConfigModalVisible(page) {
  return page.locator('.config-modal').isVisible();
}

export async function getFeedMapSegments(page) {
  return page.locator('.feed-map-segment');
}

export { expect } from '@playwright/test';
