// configMigrations.js - One-time migrations of stored settings

export const STYLE_DEFAULTS_VERSION = 1;

const RING = 'var(--focus-ring-width, 2px) var(--focus-ring-color, #0066cc)';
const CHILD = (pct) =>
  `outline: var(--focus-ring-width, 2px) color-mix(in srgb, var(--focus-ring-color, #0066cc) ${pct}%, transparent) solid !important;`;

// Every value ever shipped as a default for these keys. A stored value equal to one of
// these (after normalization) was never customized, so the new default can replace it.
export const SUPERSEDED_DEFAULTS = {
  selectionActive: [
    'border: 3px rgba(128, 0, 0, .6) solid !important;',
    'border: 3px rgba(255, 0, 0, .3) solid !important;',
    'border: 3px rgba(255, 0, 0, .3) solid;',
    'border: 3px rgba(255, 0, 0, .6) solid !important;',
    'outline: 3px rgba(255, 0, 0, .6) solid !important;',
    `outline: ${RING} solid !important;`,
    `outline: ${RING} solid !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--focus-ring-color, #0066cc) 15%, transparent);`,
  ],
  selectionChildFocused: [
    'border: 3px rgba(128, 0, 0, .2) solid !important;',
    'outline: 3px rgba(128, 0, 0, .2) solid !important;',
    CHILD(40),
    CHILD(35),
  ],
  selectionInactive: [
    'border: 3px solid transparent;',
    'outline: 3px solid transparent;',
    'outline: var(--focus-ring-width, 2px) solid transparent;',
  ],
  replySelectionActive: [
    'border: 1px rgba(255, 0, 0, .6) solid !important;',
    'outline: 1px rgba(255, 0, 0, .8) solid !important;',
    'outline: 1px var(--focus-ring-color, #0066cc) solid !important;',
    'outline: 3px var(--focus-ring-color, #0066cc) solid !important; outline-offset: -1px;',
  ],
  replySelectionInactive: [
    'border: 1px rgb(212, 219, 226) solid !important;',
    'outline: 1px rgb(212, 219, 226) solid',
  ],
  // The earliest releases bundled opacity and background color in one default
  unreadPosts: ['opacity: 100%; background-color: white;'],
  readPosts: ['opacity: 75%; background-color: #f0f0f0;'],
  unreadPostsLightMode: ['background-color: white;'],
  unreadPostsDarkMode: ['background-color: #202020;'],
  readPostsLightMode: ['background-color: #f0f0f0;'],
  readPostsDarkMode: ['background-color: black;'],
  focusRingColor: ['#0066cc'],
  threadIndicatorColor: ['rgb(212, 219, 226)'],
};

/**
 * Normalize a CSS value for comparison: lowercase, collapse whitespace, drop spaces
 * around : ; , ( ), strip trailing semicolons.
 */
export function normalizeCssValue(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ ?([:;,()]) ?/g, '$1')
    .replace(/;+$/, '')
    .trim();
}

const NORMALIZED_SUPERSEDED = Object.fromEntries(
  Object.entries(SUPERSEDED_DEFAULTS).map(([key, list]) => [
    key,
    new Set(list.map(normalizeCssValue)),
  ])
);

/**
 * Drop stored values that equal a previously shipped default so the new default applies.
 * Runs once (tracked by _styleDefaultsVersion). Removed pairs are kept in
 * _styleDefaultsBackup. Returns `stored` itself when nothing needs to happen.
 */
export function migrateSupersededDefaults(stored) {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return stored;
  }
  if (stored._styleDefaultsVersion >= STYLE_DEFAULTS_VERSION) {
    return stored;
  }
  const migrated = { ...stored };
  const removed = {};
  for (const [key, superseded] of Object.entries(NORMALIZED_SUPERSEDED)) {
    if (
      Object.prototype.hasOwnProperty.call(stored, key) &&
      superseded.has(normalizeCssValue(stored[key]))
    ) {
      removed[key] = stored[key];
      delete migrated[key];
    }
  }
  if (Object.keys(removed).length > 0) {
    migrated._styleDefaultsBackup = { ...(stored._styleDefaultsBackup || {}), ...removed };
  }
  migrated._styleDefaultsVersion = STYLE_DEFAULTS_VERSION;
  return migrated;
}
