# Playwright Test Framework Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an end-to-end test framework using Playwright to test the Bluesky Navigator userscript with Tampermonkey in a real browser.

**Architecture:** Chromium with Tampermonkey extension loaded via persistent context. Authentication via environment variables. Tests wait for script initialization before running assertions.

**Tech Stack:** Playwright, Chromium, Tampermonkey, dotenv

---

## Directory Structure

```
tests/
├── playwright.config.js     # Playwright configuration
├── setup.js                 # First-time setup script
├── fixtures/
│   ├── extension.js         # Extension loading fixture
│   └── auth.js              # Bluesky auth fixture
├── e2e/
│   ├── navigation.spec.js   # j/k, gg/G keyboard tests
│   ├── feed-map.spec.js     # Feed map display/interaction
│   ├── shortcuts.spec.js    # All keyboard shortcuts
│   └── config-modal.spec.js # Settings panel tests
├── extensions/
│   └── tampermonkey/        # Downloaded Tampermonkey CRX
├── user-data/               # Persistent browser profile
├── .env                     # Credentials (gitignored)
└── .env.example             # Template for credentials
```

## Extension & Script Loading

**Tampermonkey Setup:**
- Download Tampermonkey CRX once during setup (stored in `tests/extensions/`)
- Create a persistent Tampermonkey profile directory with the userscript pre-installed
- The userscript is copied from `dist/bluesky-navigator.user.js` before each test run

**Browser Context:**
```javascript
// Playwright launches Chromium with:
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,  // Extensions require headed mode
  args: [
    `--disable-extensions-except=${tampermonkeyPath}`,
    `--load-extension=${tampermonkeyPath}`,
  ],
});
```

**Script Injection Strategy:**
- On first setup: Manually install script into Tampermonkey, save profile
- On test runs: Reuse profile, script auto-loads
- Alternative: Use Tampermonkey's file system access to auto-update script from `dist/`

**Wait for Script Ready:**
```javascript
// Tests wait for script initialization
await page.waitForSelector('#bsky-navigator-toolbar', { timeout: 10000 });
```

## Authentication Flow

**Environment Variables:**
```bash
# .env (gitignored)
BSKY_IDENTIFIER=yourhandle.bsky.social
BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

**Auth Fixture:**
```javascript
// fixtures/auth.js
async function loginToBluesky(page) {
  await page.goto('https://bsky.app');

  // Check if already logged in
  if (await page.locator('[data-testid="homeScreenFeedTabs"]').isVisible()) {
    return; // Already authenticated
  }

  // Perform login
  await page.click('text=Sign in');
  await page.fill('input[name="identifier"]', process.env.BSKY_IDENTIFIER);
  await page.fill('input[name="password"]', process.env.BSKY_APP_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for feed to load
  await page.waitForSelector('[data-testid="homeScreenFeedTabs"]');
}
```

**Session Persistence:**
- Chromium's persistent context saves cookies/localStorage
- After first login, subsequent test runs stay authenticated
- Tests can run faster without re-authenticating each time

## Test Cases

**Initial test suite covering core functionality:**

```javascript
// e2e/navigation.spec.js
- 'j key moves to next post'
- 'k key moves to previous post'
- 'gg moves to first post'
- 'G moves to last post'
- 'post gets marked as read when navigated past'

// e2e/feed-map.spec.js
- 'feed map renders with correct number of segments'
- 'clicking segment navigates to that post'
- 'current post is highlighted in feed map'
- 'zoom window shows around current position'

// e2e/shortcuts.spec.js
- '? key opens shortcuts overlay'
- 'Escape closes shortcuts overlay'
- 'l key toggles like on post'
- '+ key opens add to rules dropdown'

// e2e/config-modal.spec.js
- 'Alt+. opens config modal'
- 'settings changes persist after reload'
```

**Test Helpers:**
```javascript
// Wait for script + feed ready
async function waitForReady(page) {
  await page.waitForSelector('#bsky-navigator-toolbar');
  await page.waitForSelector('[data-testid="feedItem"]');
}
```

## Setup & Configuration

**Package.json additions:**
```json
{
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "test:setup": "node tests/setup.js"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "dotenv": "^16.3.0"
  }
}
```

**playwright.config.js:**
```javascript
export default {
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'https://bsky.app',
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: 'chromium', use: { channel: 'chromium' } }],
};
```

**Setup script (`tests/setup.js`):**
- Downloads Tampermonkey CRX if not present
- Creates browser profile directory
- Copies userscript to profile
- Provides instructions for first-time manual script installation

**Gitignore additions:**
```
tests/.env
tests/extensions/tampermonkey/
tests/user-data/
```
