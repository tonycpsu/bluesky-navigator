// postFormatting.js - Post text formatting and facet processing utilities

import constants from '../constants.js';

/**
 * Converts a URL to an embeddable HTML format for supported platforms.
 * @param {string} url - The URL to convert
 * @returns {string} HTML embed code or a simple link
 */
export function convertToEmbed(url) {
  try {
    let embedHtml = '';

    // YouTube Embed
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)?.[1];
      if (videoId) {
        embedHtml = `<iframe width="320" height="200" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
      }
    }

    // Twitter/X Embed
    else if (url.includes('twitter.com') || url.includes('x.com')) {
      embedHtml = `<blockquote class="twitter-tweet"><a href="${url}"></a></blockquote>
                         <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`;
    }

    // TikTok Embed
    else if (url.includes('tiktok.com')) {
      embedHtml = `<blockquote class="tiktok-embed" cite="${url}" data-video-id="${url.split('/').pop()}" style="max-width: 605px; min-width: 325px;">
                            <a href="${url}">Watch on TikTok</a>
                         </blockquote>
                         <script async src="https://www.tiktok.com/embed.js"></script>`;
    }

    // Instagram Embed
    else if (url.includes('instagram.com/p/')) {
      embedHtml = `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="13">
                            <a href="${url}">View on Instagram</a>
                         </blockquote>
                         <script async src="https://www.instagram.com/embed.js"></script>`;
    }

    // Default: Just return a linked URL if not recognized
    return embedHtml || `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  } catch (error) {
    console.error('Error generating embed:', error);
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  }
}

/**
 * Formats post text by converting facets (mentions, links, hashtags) to HTML.
 *
 * AT Protocol uses UTF-8 byte offsets for facet indices, but JavaScript strings
 * use UTF-16 code units. This function builds a mapping between byte offsets
 * and character indices to correctly locate and replace facet text.
 *
 * @param {Object} post - The post record object
 * @param {string} post.text - The raw post text
 * @param {Array} [post.facets] - Array of facet objects with byte-based indices
 * @returns {string} HTML-formatted text with clickable mentions, links, and hashtags
 *
 * @example
 * // Input post with mention and link
 * const post = {
 *   text: "Hi @alice check this https://example.com",
 *   facets: [
 *     { index: { byteStart: 3, byteEnd: 9 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:...' }] }
 *   ]
 * };
 * const html = formatPostText(post);
 * // Returns: 'Hi <a href="https://bsky.app/profile/did:plc:..." class="mention">@alice</a> check this...'
 */
export function formatPostText(post) {
  let text = post.text;
  if (!post.facets) return text;

  // Build byte offset -> character index mapping
  // This is needed because facet indices are UTF-8 byte offsets
  const charOffsets = buildByteToCharMap(text);

  // Process facets in reverse order to preserve earlier indices
  const sortedFacets = [...post.facets].reverse();

  for (const facet of sortedFacets) {
    const { index, features } = facet;
    const start = charOffsets.findLast((c) => c.byteOffset <= index.byteStart)?.charIndex || 0;
    const end = charOffsets.findLast((c) => c.byteOffset <= index.byteEnd)?.charIndex || text.length;
    const originalText = text.slice(start, end);

    for (const feature of features) {
      const replacement = formatFacetFeature(feature, originalText);
      if (replacement) {
        text = text.slice(0, start) + replacement + text.slice(end + 1);
      }
    }
  }

  return text;
}

/**
 * Builds a mapping from UTF-8 byte offsets to JavaScript string character indices.
 * @private
 */
function buildByteToCharMap(text) {
  const charOffsets = [];
  const encoder = new TextEncoder();
  let byteOffset = 0;

  for (let charIndex = 0; charIndex < [...text].length; charIndex++) {
    const char = [...text][charIndex];
    charOffsets.push({ byteOffset, charIndex });
    byteOffset += encoder.encode(char).length;
  }

  return charOffsets;
}

/**
 * Converts a facet feature to its HTML representation.
 * @private
 */
function formatFacetFeature(feature, originalText) {
  switch (feature.$type) {
    case 'app.bsky.richtext.facet#mention':
      return `<a href="https://bsky.app/profile/${feature.did}" class="mention">${originalText}</a>`;

    case 'app.bsky.richtext.facet#link':
      return convertToEmbed(feature.uri);

    case 'app.bsky.richtext.facet#tag':
      return `<a href="https://bsky.app/search?q=%23${feature.tag}" class="hashtag">${originalText}</a>`;

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
    return {
      uri: ext.uri,
      title: ext.title || '',
      description: ext.description || '',
      thumb: ext.thumb || null,
      domain: ext.uri ? new URL(ext.uri).hostname : '',
    };
  }

  // External link with media: embed.media.external
  // Type is "app.bsky.embed.recordWithMedia#view"
  if (embed.media?.external) {
    const ext = embed.media.external;
    return {
      uri: ext.uri,
      title: ext.title || '',
      description: ext.description || '',
      thumb: ext.thumb || null,
      domain: ext.uri ? new URL(ext.uri).hostname : '',
    };
  }

  return null;
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
