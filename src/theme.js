// theme.js
// Mirrors Bluesky's Light / Dim / Dark theme into html[data-bsky-nav-theme] so all of our CSS
// keys off one attribute we own. If Bluesky renames its classes, only this file changes.

export const THEME_ATTR = 'data-bsky-nav-theme';

const THEMES = ['light', 'dim', 'dark'];
const META_BACKGROUNDS = { '#ffffff': 'light', '#151d28': 'dim', '#000000': 'dark' };

// Parse rgb()/rgba()/#hex into { r, g, b, a }. Returns null if unparseable.
function parseColor(value) {
  if (!value) return null;
  const str = String(value).trim().toLowerCase();
  if (!str || str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }

  const fn = str.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a };
  }
  return null;
}

// Map a background color to a theme by luminance. Fully transparent colors give no signal.
function themeFromColor(value) {
  const c = parseColor(value);
  if (!c || c.a === 0) return null;
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  if (lum < 0.02) return 'dark';
  if (lum < 0.5) return 'dim';
  return 'light';
}

function themeFromHtmlClass(doc) {
  const list = doc.documentElement?.classList;
  if (!list) return null;
  for (const theme of THEMES) {
    if (list.contains(`theme--${theme}`)) return theme;
  }
  return null;
}

function themeFromMeta(doc) {
  const content = doc.querySelector?.('meta[name="theme-color"]')?.getAttribute('content');
  if (!content) return null;
  const exact = META_BACKGROUNDS[content.trim().toLowerCase()];
  return exact || themeFromColor(content);
}

function themeFromStorage() {
  try {
    const stored = window.localStorage.getItem('ALF_THEME');
    return THEMES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

// Walk up from the main element to the first background that isn't fully transparent.
function themeFromShellBackground(doc) {
  const view = doc.defaultView;
  if (!view || !doc.body) return null;
  let el = doc.querySelector('main[role="main"]') || doc.body;
  while (el && el.nodeType === 1) {
    const color = view.getComputedStyle(el).backgroundColor;
    const theme = themeFromColor(color);
    if (theme) return theme;
    el = el.parentElement;
  }
  return null;
}

export function detectBlueskyTheme(doc = document, lastKnown = null) {
  return (
    themeFromHtmlClass(doc) ||
    themeFromMeta(doc) ||
    themeFromStorage() ||
    themeFromShellBackground(doc) ||
    (THEMES.includes(lastKnown) ? lastKnown : 'light')
  );
}

export function startThemeWatcher(doc = document) {
  const root = doc.documentElement;

  const apply = () => {
    const theme = detectBlueskyTheme(doc, root.getAttribute(THEME_ATTR));
    if (root.getAttribute(THEME_ATTR) !== theme) root.setAttribute(THEME_ATTR, theme);
  };

  const MutationObserverCtor = doc.defaultView?.MutationObserver || window.MutationObserver;
  const metaObserver = new MutationObserverCtor(apply);
  let observedMeta = null;
  const bindMeta = () => {
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta === observedMeta) return;
    metaObserver.disconnect();
    observedMeta = meta;
    if (meta) metaObserver.observe(meta, { attributes: true, attributeFilter: ['content'] });
  };

  const rootObserver = new MutationObserverCtor(apply);
  rootObserver.observe(root, { attributes: true, attributeFilter: ['class'] });

  // The meta tag can be added or replaced after load
  const headObserver = new MutationObserverCtor(() => {
    bindMeta();
    apply();
  });
  if (doc.head) headObserver.observe(doc.head, { childList: true });

  bindMeta();
  apply();

  return () => {
    rootObserver.disconnect();
    headObserver.disconnect();
    metaObserver.disconnect();
  };
}

export function isDarkTheme() {
  const theme = document.documentElement.getAttribute(THEME_ATTR);
  return theme === 'dim' || theme === 'dark';
}

export function getThemeBackground() {
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--bsky-nav-bg')
    .trim();
  return value || '#FFFFFF';
}
