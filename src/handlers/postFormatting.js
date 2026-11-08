// postFormatting.js - Post text formatting and facet processing utilities
/* global TextDecoder */

import constants from '../constants.js';
import { escapeHtml } from '../utils.js';

/**
 * Returns the URL string if it parses as an http(s) URL, otherwise null.
 * Used to block javascript:, data:, and other non-web schemes from hrefs.
 * @param {string} url - Candidate URL
 * @returns {string|null} The original URL string, or null if not http(s)
 */
export function safeHttpUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Converts a URL to an embeddable HTML format for supported platforms.
 * Non-http(s) URLs are rendered as escaped plain text.
 * @param {string} url - The URL to convert
 * @returns {string} HTML embed code or a simple link
 */
export function convertToEmbed(url) {
  const label = escapeHtml(url);
  const safeUrl = safeHttpUrl(url);
  if (!safeUrl) return label;
  const href = escapeHtml(safeUrl);

  // Match providers on the parsed hostname (exact or subdomain), not a substring of
  // the whole URL — otherwise e.g. netflix.com would match "x.com".
  const host = new URL(safeUrl).hostname.toLowerCase();
  const isHost = (...domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));

  try {
    let embedHtml = '';

    // YouTube Embed
    if (isHost('youtube.com', 'youtu.be')) {
      const videoId = safeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)?.[1];
      if (videoId) {
        embedHtml = `<iframe width="320" height="200" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
      }
    }

    // Twitter/X Embed
    else if (isHost('twitter.com', 'x.com')) {
      embedHtml = `<blockquote class="twitter-tweet"><a href="${href}"></a></blockquote>
                         <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`;
    }

    // TikTok Embed
    else if (isHost('tiktok.com')) {
      embedHtml = `<blockquote class="tiktok-embed" cite="${href}" data-video-id="${escapeHtml(safeUrl.split('/').pop())}" style="max-width: 605px; min-width: 325px;">
                            <a href="${href}">Watch on TikTok</a>
                         </blockquote>
                         <script async src="https://www.tiktok.com/embed.js"></script>`;
    }

    // Instagram Embed
    else if (isHost('instagram.com') && new URL(safeUrl).pathname.startsWith('/p/')) {
      embedHtml = `<blockquote class="instagram-media" data-instgrm-permalink="${href}" data-instgrm-version="13">
                            <a href="${href}">View on Instagram</a>
                         </blockquote>
                         <script async src="https://www.instagram.com/embed.js"></script>`;
    }

    // Default: Just return a linked URL if not recognized
    return embedHtml || `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  } catch (error) {
    console.error('Error generating embed:', error);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
}

/**
 * Formats post text by converting facets (mentions, links, hashtags) to HTML.
 *
 * All post-derived content is HTML-escaped: plain-text segments, facet display
 * text, and attribute values. Link facets are only rendered as links when they
 * use http(s); anything else is rendered as escaped text.
 *
 * AT Protocol facet indices are UTF-8 byte offsets, so the text is encoded to
 * bytes, sliced by facet ranges, and each slice decoded back to a string.
 * Facets are processed in byteStart order; overlapping or out-of-range facets
 * are skipped.
 *
 * @param {Object} post - The post record object
 * @param {string} post.text - The raw post text
 * @param {Array} [post.facets] - Array of facet objects with byte-based indices
 * @returns {string} Safe HTML with clickable mentions, links, and hashtags
 *
 * @example
 * const post = {
 *   text: "Hi @alice check this",
 *   facets: [
 *     { index: { byteStart: 3, byteEnd: 9 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:...' }] }
 *   ]
 * };
 * formatPostText(post);
 * // => 'Hi <a href="https://bsky.app/profile/did:plc:..." class="mention">@alice</a> check this'
 */
export function formatPostText(post) {
  const text = typeof post?.text === 'string' ? post.text : '';
  if (!Array.isArray(post?.facets) || post.facets.length === 0) return escapeHtml(text);

  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const decode = (from, to) => decoder.decode(bytes.subarray(from, to));

  const facets = post.facets
    .filter((facet) => {
      const start = facet?.index?.byteStart;
      const end = facet?.index?.byteEnd;
      return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start &&
        end <= bytes.length
      );
    })
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  let html = '';
  let cursor = 0;
  for (const facet of facets) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < cursor) continue; // overlaps previous facet

    html += escapeHtml(decode(cursor, byteStart));
    const facetText = decode(byteStart, byteEnd);
    html += formatFacet(facet.features, facetText) ?? escapeHtml(facetText);
    cursor = byteEnd;
  }
  html += escapeHtml(decode(cursor, bytes.length));

  return html;
}

/**
 * Converts a facet's features to HTML, using the first recognized feature.
 * Returns null if no feature is recognized.
 * @private
 */
function formatFacet(features, facetText) {
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    const replacement = formatFacetFeature(feature, facetText);
    if (replacement !== null) return replacement;
  }
  return null;
}

/**
 * Converts a facet feature to its HTML representation.
 * @private
 */
function formatFacetFeature(feature, facetText) {
  switch (feature?.$type) {
    case 'app.bsky.richtext.facet#mention':
      return `<a href="https://bsky.app/profile/${escapeHtml(feature.did)}" class="mention">${escapeHtml(facetText)}</a>`;

    case 'app.bsky.richtext.facet#link':
      // Non-http(s) links (e.g. javascript:) are rendered as plain text
      return safeHttpUrl(feature.uri) ? convertToEmbed(feature.uri) : escapeHtml(facetText);

    case 'app.bsky.richtext.facet#tag':
      return `<a href="https://bsky.app/search?q=%23${escapeHtml(encodeURIComponent(feature.tag ?? ''))}" class="hashtag">${escapeHtml(facetText)}</a>`;

    default:
      return null;
  }
}

/**
 * Generates a Bluesky URL for a post.
 * @param {Object} post - The post object
 * @returns {string} The post URL
 */
export function urlForPost(post) {
  return `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').slice(-1)[0]}`;
}

/**
 * Extracts quoted post data from an embed.
 * @param {Object} embed - The post embed object
 * @returns {Object|null} Quoted post data or null
 */
export function extractQuotedPost(embed) {
  if (!embed) return null;

  // Direct quote post: embed.record contains the quoted post
  // Type is "app.bsky.embed.record#view"
  if (embed.record && embed.record.author) {
    const record = embed.record;
    return {
      avatar: record.author?.avatar,
      displayName: record.author?.displayName || record.author?.handle,
      handle: record.author?.handle,
      text: record.value?.text || '',
      images: record.embeds?.[0]?.images || null,
    };
  }

  // Quote post with media: embed.record.record contains the quoted post
  // Type is "app.bsky.embed.recordWithMedia#view"
  if (embed.record?.record?.author) {
    const record = embed.record.record;
    return {
      avatar: record.author?.avatar,
      displayName: record.author?.displayName || record.author?.handle,
      handle: record.author?.handle,
      text: record.value?.text || '',
      images: record.embeds?.[0]?.images || null,
    };
  }

  return null;
}

/**
 * Extracts external link data from an embed.
 * @param {Object} embed - The post embed object
 * @returns {Object|null} External link data or null
 */
export function extractExternalLink(embed) {
  if (!embed) return null;

  // Direct external link: embed.external
  // Type is "app.bsky.embed.external#view"
  if (embed.external) {
    const ext = embed.external;
    return externalLinkData(ext);
  }

  // External link with media: embed.media.external
  // Type is "app.bsky.embed.recordWithMedia#view"
  if (embed.media?.external) {
    const ext = embed.media.external;
    return externalLinkData(ext);
  }

  return null;
}

/**
 * Normalizes an external embed for the sidecar template. Non-http(s) URIs are
 * dropped so they can't end up in an href.
 * @private
 */
function externalLinkData(ext) {
  const uri = safeHttpUrl(ext.uri);
  return {
    uri: uri || '',
    title: ext.title || '',
    description: ext.description || '',
    thumb: ext.thumb || null,
    domain: uri ? new URL(uri).hostname : '',
  };
}

/**
 * Formats a post object for display in sidecars/templates.
 * @param {Object} post - The raw post object from AT Protocol
 * @returns {Object} Formatted post data for templates
 */
export function formatPost(post) {
  const formatter = Intl.NumberFormat('en', { notation: 'compact' });

  return {
    postId: post.cid,
    postUrl: urlForPost(post),
    avatar: post.author.avatar,
    displayName: post.author.displayName || post.author.handle,
    handle: post.author.handle,
    content: formatPostText(post.record),
    embed: post.embed,
    quotedPost: extractQuotedPost(post.embed),
    externalLink: extractExternalLink(post.embed),
    timestamp: new Date(post.record.createdAt).toLocaleString(),
    replySvg: constants.SIDECAR_SVG_REPLY,
    replyCount: formatter.format(post.replyCount),
    repostSvg: constants.SIDECAR_SVG_REPOST[post.viewer.repost ? 1 : 0],
    repostCount: formatter.format(post.repostCount),
    likeSvg: constants.SIDECAR_SVG_LIKE[post.viewer.like ? 1 : 0],
    likeCount: formatter.format(post.likeCount),
  };
}
