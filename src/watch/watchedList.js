// Pure view model and markup for the Watched tab's list. No DOM access; WatchedTab.js
// mounts the markup and wires the clicks.

import { escapeHtml } from '../utils.js';
import { relativeTime, replyUrl, NEEDS_LOGIN_MESSAGE } from './watchCopy.js';

export const WATCHED_EMPTY_MESSAGE =
  'No watched threads. Press w on a post, or click its bell, to watch it for new replies.';

const SAFE_PATH_BASE = 'https://bsky.app';
// eslint-disable-next-line no-control-regex
const SAFE_PATH_RE = /^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/;

/**
 * An in-app path for a link, or '#' for anything that isn't one (watch records can arrive
 * through remote sync, so never trust them to hold a safe URL).
 * @param {string} path
 * @returns {string}
 */
export function safeAppPath(path) {
  // One leading slash, no slash or backslash right after it, and no backslash, whitespace
  // or control characters anywhere: URL parsing treats a backslash as / and drops tabs
  if (typeof path !== 'string' || !SAFE_PATH_RE.test(path)) return '#';
  try {
    return new URL(path, SAFE_PATH_BASE).origin === SAFE_PATH_BASE ? path : '#';
  } catch {
    return '#';
  }
}

/**
 * Build the Watched tab's entries from watches already in list order.
 * @param {object[]} watches WatchRecord[] (e.g. from `watchService.getWatches()`)
 * @param {number} nowMs
 * @returns {object[]} one view model per watch, raw (unescaped) text
 */
export function buildWatchedEntries(watches, nowMs) {
  return watches.map((record) => ({
    postId: record.postId,
    href: safeAppPath(record.url),
    author: record.authorHandle ? `@${record.authorHandle}` : record.authorDid || '',
    snippet: record.snippet || '',
    watchedLabel: `Watched ${relativeTime(record.watchedAt, nowMs)}`,
    unavailable: Boolean(record.unavailable),
    replies: (record.unseen || []).map((reply) => ({
      href: safeAppPath(replyUrl(reply)),
      name: reply.authorName || reply.authorHandle || '',
      handle: reply.authorHandle ? `@${reply.authorHandle}` : '',
      text: reply.text || '',
      time: relativeTime(reply.indexedAt, nowMs),
    })),
  }));
}

function replyHtml(reply) {
  return `
      <li class="bsky-nav-watched-reply">
        <a class="bsky-nav-watched-reply-link" href="${escapeHtml(reply.href)}">
          <span class="bsky-nav-watched-reply-head">
            <span class="bsky-nav-watched-reply-name">${escapeHtml(reply.name)}</span>
            <span class="bsky-nav-watched-reply-handle">${escapeHtml(reply.handle)}</span>
            <span class="bsky-nav-watched-reply-time">${escapeHtml(reply.time)}</span>
          </span>
          <span class="bsky-nav-watched-reply-text">${escapeHtml(reply.text)}</span>
        </a>
      </li>`;
}

function entryHtml(entry) {
  const hasUnseen = entry.replies.length > 0;
  const classes = ['bsky-nav-watched-entry'];
  if (hasUnseen) classes.push('bsky-nav-watched-entry-unseen');
  if (entry.unavailable) classes.push('bsky-nav-watched-entry-unavailable');
  const unavailable = entry.unavailable
    ? '<span class="bsky-nav-watched-unavailable">Post unavailable</span>'
    : '';
  const replies = hasUnseen
    ? `<ul class="bsky-nav-watched-replies">${entry.replies.map(replyHtml).join('')}</ul>`
    : '';
  const markSeen = hasUnseen
    ? '<button type="button" class="bsky-nav-watched-btn" data-watched-action="mark-seen">Mark seen</button>'
    : '';
  return `
  <li class="${classes.join(' ')}" data-post-id="${escapeHtml(entry.postId)}">
    <a class="bsky-nav-watched-entry-link" href="${escapeHtml(entry.href)}">
      <span class="bsky-nav-watched-author">${escapeHtml(entry.author)}</span>
      <span class="bsky-nav-watched-snippet">${escapeHtml(entry.snippet)}</span>
    </a>
    <div class="bsky-nav-watched-meta">
      <span class="bsky-nav-watched-since">${escapeHtml(entry.watchedLabel)}</span>
      ${unavailable}
    </div>
    ${replies}
    <div class="bsky-nav-watched-actions">
      ${markSeen}
      <button type="button" class="bsky-nav-watched-btn" data-watched-action="unwatch">Stop watching</button>
    </div>
  </li>`;
}

/**
 * The Watched tab panel's inner markup. All text is escaped here.
 * @param {{entries: object[], hasApi: boolean}} options entries from buildWatchedEntries
 * @returns {string}
 */
export function watchedPanelHtml({ entries, hasApi }) {
  const notice = hasApi
    ? ''
    : `<p class="bsky-nav-watched-notice">${escapeHtml(NEEDS_LOGIN_MESSAGE)}</p>`;
  if (entries.length === 0) {
    return `${notice}<p class="bsky-nav-watched-empty">${escapeHtml(WATCHED_EMPTY_MESSAGE)}</p>`;
  }
  return `${notice}<ul class="bsky-nav-watched-list">${entries.map(entryHtml).join('')}</ul>`;
}
