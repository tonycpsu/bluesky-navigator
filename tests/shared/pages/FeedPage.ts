import { Page, Locator } from "@playwright/test";

/**
 * FeedPage - Page object for Bluesky feed interactions
 *
 * Handles post navigation, selection, and feed-related operations.
 * Works with the Bluesky Navigator userscript.
 */
export class FeedPage {
  readonly page: Page;

  // Common selectors as locators
  readonly feedItems: Locator;
  readonly selectedPost: Locator;
  readonly readPosts: Locator;
  readonly statusbar: Locator;
  readonly toolbar: Locator;

  constructor(page: Page) {
    this.page = page;

    // Initialize locators
    this.feedItems = page.locator('[data-testid^="feedItem-by-"]');
    this.selectedPost = page.locator(".item-selection-active");
    this.readPosts = page.locator(".item-read");
    this.statusbar = page.locator("#bsky-navigator-global-statusbar");
    this.toolbar = page.locator("#bsky-navigator-toolbar");
  }

  /**
   * Wait for the userscript to be fully loaded and ready
   */
  async waitForReady(): Promise<void> {
    // Wait for statusbar (userscript indicator)
    await this.page.waitForSelector("#bsky-navigator-global-statusbar", {
      timeout: 10000,
      state: "attached",
    });

    // Wait for feed items to load
    await this.page.waitForSelector('[data-testid^="feedItem-by-"]', {
      timeout: 10000,
    });

    // Wait for feed to have the data attributes applied (userscript processed items)
    await this.page.waitForSelector('[data-bsky-navigator-item-index]', {
      timeout: 10000,
    });

    // Initialize selection if not already set
    let hasSelection = await this.page.locator(".item-selection-active").count();
    if (hasSelection === 0) {
      // Try Home key first (more reliable)
      await this.pressKey("Home");
      await this.page.waitForSelector(".item-selection-active", { timeout: 2000 }).catch(() => {});

      hasSelection = await this.page.locator(".item-selection-active").count();
      if (hasSelection === 0) {
        // Fall back to gg (vim-style)
        await this.pressKey("g");
        await this.pressKey("g");
        await this.page.waitForSelector(".item-selection-active", { timeout: 2000 }).catch(() => {});
      }

      hasSelection = await this.page.locator(".item-selection-active").count();
      if (hasSelection === 0) {
        // Last resort: try j to select first item
        await this.pressKey("j");
      }
    }

    // Wait for selection to be visible (with timeout)
    await this.page.waitForSelector(".item-selection-active", { timeout: 5000 });
  }

  /**
   * Get the currently selected post element
   */
  async getCurrentPost() {
    return this.page.locator(".item-selection-active").first();
  }

  /**
   * Get the current selection index from the data attribute
   */
  async getCurrentIndex(): Promise<number | null> {
    // Wait for selection element to exist
    await this.page.waitForSelector(".item-selection-active", { timeout: 2000 }).catch(() => {});

    const index = await this.page.evaluate(() => {
      const elements = document.querySelectorAll(".item-selection-active");
      if (elements.length === 0) return null;
      const current = elements[0] as HTMLElement;
      current.scrollIntoView({ block: "center" });
      return current.getAttribute("data-bsky-navigator-item-index");
    });

    return index !== null ? parseInt(index, 10) : null;
  }

  /**
   * Get all feed posts
   */
  async getAllPosts() {
    return this.page.locator('[data-testid^="feedItem-by-"]');
  }

  /**
   * Get the count of visible posts
   */
  async getPostCount(): Promise<number> {
    return await this.page.locator('[data-testid^="feedItem-by-"]').count();
  }

  /**
   * Press a keyboard key and wait for update
   */
  async pressKey(key: string): Promise<void> {
    // Ensure focus is on page body
    await this.page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        (document.activeElement as HTMLElement).blur();
      }
      document.body.focus();
    });

    // For special navigation keys, use Playwright's native keyboard API
    // which works better with Firefox
    const nativeKeys = ["Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape", "Enter"];
    if (nativeKeys.includes(key)) {
      await this.page.keyboard.press(key);
      return;
    }

    // For Alt+ modifier combinations, always use page.evaluate() dispatch
    // This is required for Firefox compatibility with userscript event listeners
    // (Playwright's native keyboard.press() doesn't reach capture-phase listeners on document)

    // Dispatch keyboard event via page.evaluate for userscript compatibility
    await this.page.evaluate((keySpec: string) => {
      const parts = keySpec.split("+");
      const actualKey = parts[parts.length - 1];
      const shiftKey = parts.includes("Shift");
      const altKey = parts.includes("Alt");
      const ctrlKey = parts.includes("Control") || parts.includes("Ctrl");
      const metaKey = parts.includes("Meta") || parts.includes("Cmd");

      let key = actualKey;
      let code = actualKey;

      const specialKeys: Record<string, { key: string; code: string }> = {
        Escape: { key: "Escape", code: "Escape" },
        Enter: { key: "Enter", code: "Enter" },
        Home: { key: "Home", code: "Home" },
        End: { key: "End", code: "End" },
        PageUp: { key: "PageUp", code: "PageUp" },
        PageDown: { key: "PageDown", code: "PageDown" },
        ArrowUp: { key: "ArrowUp", code: "ArrowUp" },
        ArrowDown: { key: "ArrowDown", code: "ArrowDown" },
        ".": { key: ".", code: "Period" },
        ",": { key: ",", code: "Comma" },
        "/": { key: "/", code: "Slash" },
        "+": { key: "+", code: "Equal" },
        "-": { key: "-", code: "Minus" },
        ":": { key: ":", code: "Semicolon" },
      };

      if (specialKeys[actualKey]) {
        key = specialKeys[actualKey].key;
        code = specialKeys[actualKey].code;
      } else if (actualKey === "/" && shiftKey) {
        key = "?";
        code = "Slash";
      } else if (actualKey === "+" || (actualKey === "=" && shiftKey)) {
        key = "+";
        code = "Equal";
      } else if (actualKey === ":" || (actualKey === ";" && shiftKey)) {
        key = ":";
        code = "Semicolon";
      } else if (actualKey.length === 1) {
        code = `Key${actualKey.toUpperCase()}`;
      }

      let keyCode = 0;
      // Handle special character key codes
      const charKeyCodes: Record<string, number> = {
        ".": 190, "/": 191, "+": 187, "-": 189, "=": 187,
        ";": 186, ":": 186, "'": 222, ",": 188,
      };
      if (charKeyCodes[key]) {
        keyCode = charKeyCodes[key];
      } else if (key.length === 1) {
        keyCode = key.toUpperCase().charCodeAt(0);
      } else {
        const keyCodes: Record<string, number> = {
          Escape: 27, Enter: 13, Home: 36, End: 35,
          PageUp: 33, PageDown: 34, ArrowUp: 38, ArrowDown: 40,
        };
        keyCode = keyCodes[key] || 0;
      }

      const eventInit = {
        key, code, keyCode, which: keyCode,
        shiftKey, altKey, ctrlKey, metaKey,
        bubbles: true, cancelable: true,
      };

      document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      document.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    }, key);

    // Small settling time for event to be processed
    await this.page.waitForTimeout(100);
  }

  /**
   * Navigate to the first post (Home key)
   */
  async goToFirstPost(): Promise<void> {
    const initialIndex = await this.getCurrentIndex();
    await this.pressKey("Home");
    await this.waitForIndexChange(initialIndex);
  }

  /**
   * Navigate to the last loaded post
   */
  async goToLastPost(): Promise<void> {
    const initialIndex = await this.getCurrentIndex();
    await this.pressKey("End");
    await this.waitForIndexChange(initialIndex);
  }

  /**
   * Move to the next post
   */
  async nextPost(): Promise<void> {
    await this.pressKey("j");
  }

  /**
   * Move to the previous post
   */
  async previousPost(): Promise<void> {
    await this.pressKey("k");
  }

  /**
   * Check if any posts are marked as read
   */
  async hasReadPosts(): Promise<boolean> {
    return await this.page.evaluate(() => {
      return document.querySelectorAll(".item-read").length > 0;
    });
  }

  /**
   * Wait for the selection index to change from the given value
   */
  async waitForIndexChange(previousIndex: number | null, timeout = 5000): Promise<number | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const currentIndex = await this.page.evaluate(() => {
        const el = document.querySelector(".item-selection-active");
        if (!el) return null;
        const idx = el.getAttribute("data-bsky-navigator-item-index");
        return idx !== null ? parseInt(idx, 10) : null;
      });
      if (currentIndex !== null && currentIndex !== previousIndex) {
        return currentIndex;
      }
      await this.page.waitForTimeout(50);
    }
    // Return current index even if unchanged (timeout)
    return this.getCurrentIndex();
  }
}
