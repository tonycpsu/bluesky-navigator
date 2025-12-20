Bluesky Navigator
=================

Bluesky userscript that adds keyboard shortcuts, read post tracking, and more. 


Usage
-----

1. Install [TamperMonkey](https://en.wikipedia.org/wiki/Tampermonkey) on your
   favorite browser
2. Install [the script](https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/dist/bluesky-navigator.user.js)


Features
--------

- Navigation:
    - navigate between posts with Vim-like keyboard shortcuts (`j`/`k` for
      next/previous, `gg` / `G` to go to top/bottom of page)
    - keyboard shortcuts for post actions, e.g. like, reply, repost
    - keyboard shortcuts to switch between feeds
    - keyboard shortcuts to switch between home, search, notifications, chat, etc.
    - press `?` to view all keyboard shortcuts
- Display features:
    - visual indicator for post read/unread status
    - **Feed Map**: visual overview of all posts in feed showing read/unread status,
      engagement heatmap, content type icons, and more (see below)
    - configurable override of main content width
    - **compact layout** option to remove whitespace next to left navigation
    - optionally reverse sorting of feeds to browse them in chronological order
      (currently only works on "Following" feed)
    - optionally show only unread posts
    - optionally move position of like/reply/repost buttons
    - configurable formatting of post timestamps
    - optionally hide right sidebar
    - repost timestamps showing when content was reposted
- Additional functionality (`(*)` = requires AT protocol agent, see below):
    - **toast notifications**: popup alerts for new likes, reposts, replies,
      follows, quotes, and mentions (*)
    - automatic "unrolling" of threads (*)
    - show replies in a "sidecar" next to each post (*) - inline or fixed panel mode
    - **fixed sidecar panel**: persistent side panel with keyboard/hover navigation,
      reply count badge, and toggle button to reopen when closed
    - navigate within unrolled threads using j/k keys
    - full-screen post view with sidecar (`v`) and reader mode (`V`)
    - capture post screenshots to clipboard (`c`)
    - dynamically filter posts by authors, keywords, etc. using configurable
      rules (with visual rule builder UI)
    - **rule color coding**: highlight matching authors and content phrases with
      customizable category colors
    - **include rules**: rules can reference other rule categories for reuse
    - **Add/Remove from Rules**: quickly add authors to rules from profile hover
      cards or via `+` shortcut (supports numeric category selection with 1-9
      keys, Enter to confirm); remove authors with `-` shortcut (shows only
      categories containing the author, removes from backing list if applicable)
    - optionally disable embedded video previews
    - sync read/unread state between multiple browsers via cloud service(s)
    - optionally disable built-in behavior of loading more items when scrolling
      (can still load more using toolbar button or keyboard shortcut)
    - configurable scroll-to-focus and hover-to-focus behavior
- Mobile/Touch:
    - swipe gestures for navigation (configurable)
- Accessibility:
    - reduced motion support (follows system preference or can be forced)
    - high contrast mode option


Keyboard Shortcuts
------------------

Press `?` to show the keyboard shortcuts overlay at any time.

### Navigation

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | j / ↓        | move to next item                                  |
 | k / ↑        | move to previous item                              |
 | J            | move to next unread item, or last item if all read |
 | gg           | move to first item                                 |
 | G            | move to last item                                  |
 | h            | go back to previous page                           |
 | ← / →        | toggle focus between post and replies sidecar      |

### Post Actions

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | o / Enter    | open post (feed view) or embedded post (post view) |
 | O            | open embedded post (feed view)                     |
 | i            | open link in post                                  |
 | m            | view/play/pause media in post                      |
 | a            | show author hover card (press again to dismiss)    |
 | A            | open post author's profile                         |
 | r            | reply to post                                      |
 | +            | add post author to filter rules                    |
 | -            | remove post author from filter rules               |
 | l            | like/unlike post                                   |
 | p            | open repost menu                                   |
 | P            | repost immediately                                 |
 | s            | save/unsave post                                   |
 | S            | open share menu                                    |
 | c            | capture screenshot to clipboard                    |
 | v            | open full-screen post view with sidecar            |
 | V            | open reader mode (full thread)                     |
 | t            | toggle thread context panel                        |

### Feed Controls

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | /            | focus filter search box                            |
 | u            | load newer posts                                   |
 | U            | load older posts                                   |
 | ,            | refresh items                                      |
 | :            | toggle between forward/reverse order               |
 | "            | toggle show all or only unread posts               |
 | .            | mark post read/unread                              |
 | ;            | expand/collapse replies sidecar                    |

### Quick Filter Rules

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | Alt+1...9    | activate rule N                                    |
 | Alt+Shift+1-9| negate rule N                                      |
 | Alt+0        | clear filter                                       |

### Profile View

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | f            | follow author                                      |
 | F            | unfollow author                                    |
 | L            | add author to list                                 |

### Global Navigation

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | 1...9        | switch between feeds/tabs                          |
 | Alt+h        | open home page                                     |
 | Alt+s        | open search page                                   |
 | Alt+n        | open notifications page                            |
 | Alt+m        | open messages page                                 |
 | Alt+f        | open feeds page                                    |
 | Alt+l        | open lists page                                    |
 | Alt+p        | open profile page                                  |
 | Alt+,        | open settings page                                 |
 | Alt+.        | open Bluesky Navigator config panel                |
 | ?            | show keyboard shortcuts help                       |
 | Esc          | close overlay/modal                                |

Dynamic Post Filtering
----------------------

The text box at the right of the toolbar allows you to filter posts using search
terms.

A plain search string will be interpreted as a search of words/phrases in either
the author's handle, display name, or the content of their posts. Phrases can be
wrapped in quotes. Multiple words/phrases must all match.

If a search term is preceded by a `@` character, the matching will be confined
to the user's handle and display name. 

If a search term is preceded by a `%` character, the matching will be confined
to the content of the post.

If a search term is preceded by a `$` character, then matching will be performed
according to rules configured in the `Rules` section of the script configuration
panel. The Rules tab provides both a **Visual Editor** for creating rules with
dropdowns and a **Raw** text editor for direct editing. Here's an example
configuration:

``` ini
[music]
deny all
allow from @thecure.com
allow content "Pearl Jam"

[news]
@cnn.com
weather forecast

[favorites]
$music
$news
@friend.bsky.social
```

With this configuration, you can type `$music` to show posts from `@thecure.com`
or that contain the phrase `Pearl Jam`, or `$news` to match posts from
`@cnn.com` or that contain the phrase "weather forecast". The `$favorites`
category uses **include rules** (prefixed with `$`) to combine the music and
news categories plus an additional author. This matching is not case sensitive.

**Rule color coding**: When enabled, posts matching rules are visually
highlighted - author names get a colored background when matching `from` rules,
and matching phrases in post content are highlighted when matching `content`
rules. Each category can have its own custom color.

You can also quickly activate rules using `Alt+1` through `Alt+9` to apply rules
by their order, `Alt+Shift+1-9` to negate them, or `Alt+0` to clear the filter.

These searches can be combined, and any search can be negated by prefixing it
with `!`.

### List-Based Filtering

Filter posts based on Bluesky list membership:

```ini
[favorites &"My Favorites"]         # category backed by a list
allow from @special.bsky.social     # plus individual author rules

[vips]
allow from list "VIP List"          # show posts from list members
deny from list "Muted"              # hide posts from list members
&"Close Friends"                    # shorthand for: allow from list

[combined]
$favorites                          # include the favorites category
$vips                               # include other categories
```

**Backing Lists:**

Categories can be backed by a Bluesky list using the `&"List Name"` syntax in the
header. When backed by a list:
- List members are automatically included in the category filter
- Using `+` to add an author shows two buttons: "Add to List" and "Add to Rules"
- Using `-` to remove an author removes from the backing list (if present) or rules
- The visual editor shows a dropdown to select or change the backing list

**Syncing with Lists:**

The Rules tab includes sync buttons next to each category. Use these to:
- **Push to List**: Export all `@handle` rules to a Bluesky list
- **Pull from List**: Import list members as rules
- **Bidirectional**: Sync both directions (additive only)

Note: List-based filtering requires the AT Protocol agent to be configured.


Feed Map
--------

The Feed Map provides a visual overview of all loaded posts in your feed. It can
be positioned at the top toolbar or bottom status bar (or hidden).

**Features:**
- **Click navigation**: Click any segment to jump directly to that post
- **Hover tooltips**: Hover over segments to see a preview of the post content,
  author, timestamp, and engagement stats
- **Color themes**: Choose from Ocean, Campfire, Forest, or Monochrome themes
- **Scale**: Adjust the size from 50% to 400%

**Advanced mode** (enable in settings) adds:
- **Heatmap**: Color intensity based on engagement (likes, reposts, replies)
  with multiple calculation modes
- **Content icons**: Visual indicators for post type (post, reply, repost,
  thread) and media (image, video, embed)
- **Avatars**: Show user avatars in zoom segments (configurable scale)
- **Handles**: Show user handles with domain highlighting
- **Timestamps**: Show relative timestamps in zoom segments
- **Zoom window**: Shows a magnified view of posts around your current selection
  with smooth scroll animation
  - Enable/disable via checkbox, size adjustable via slider (3-20 posts)
  - **Zoom gestures**: Ctrl+wheel or pinch to change zoom window size
  - **Pan gestures**: Scroll wheel to pan through the feed
  - Visual indicators when reaching start/end of feed
- **Rule color coding**: Highlight handles matching author rules and timestamps
  matching content rules with customizable category colors


Fixed Sidecar Panel
-------------------

The sidecar (replies panel) can be displayed in two modes:

- **Inline**: Replies appear next to each post as you navigate (traditional mode)
- **Fixed**: A persistent panel on the right side of the screen

**Fixed panel features:**
- Stays visible as you navigate through posts
- Keyboard navigation within the panel (arrow keys when focused)
- Hover navigation support
- Reply count badge shows number of replies
- Toggle button to reopen when panel is closed
- Context indicator on minimized panel

Configure in Settings → Threads & Sidecar → Sidecar panel.


Toast Notifications
-------------------

Toast notifications provide real-time popup alerts when you receive new activity
on Bluesky. Requires the AT Protocol agent to be configured.

**Supported notification types:**
- Likes (including likes on your reposts)
- Reposts (including reposts of your reposts)
- Replies to your posts
- New followers
- Quote posts
- Mentions

**Features:**
- Configurable display duration (2-15 seconds)
- Position options: Top Right, Top Left, Bottom Right, Bottom Left
- Click any toast to go to the notifications page
- Close button to dismiss early
- Polls for new notifications every 30 seconds
- Test mode to verify toasts are working

**Configuration:**
Enable in Settings → Notifications. Test mode shows your most recent
notification on page load to verify the feature is working.


AT Protocol Agent (beta)
------------------------

To enable additional functionality, such as automatic unrolling of threads and
showing post replies inline, you can generate a Bluesky [app
password](https://bsky.app/settings/app-passwords) and enter it into the
script's configuration dialog in the AT Protocol Agent section. This means the
script has access to do anything with your account for as long as the app
password is active, so you'll have to either trust that it's not doing anything
malicious or leave this functionality disabled.

Remote State Sync (beta)
------------------------

By default, read/unread state is kept in browser local storage using the
[GM_setvalue
function](https://www.tampermonkey.net/documentation.php?locale=en#api:GM_setValue).
To support persisting this state and potentially syncing between multiple
browsers, you can set up a cloud service to store the state using the
instructions [here](doc/remote_state.md).
