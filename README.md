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
    - configurable override of main content width
    - optionally reverse sorting of feeds to browse them in chronological order
      (currently only works on "Following" feed)
    - optionally show only unread posts
    - optionally move position of like/reply/repost buttons
    - configurable formatting of post timestamps
    - optionally hide right sidebar
- Additional functionality (`(*)` = requires AT protocol agent, see below):
    - automatic "unrolling" of threads (*)
    - show replies in a "sidecar" next to each post (*)
    - full-screen post view with sidecar (`v`) and reader mode (`V`)
    - capture post screenshots to clipboard (`c`)
    - dynamically filter posts by authors, keywords, etc. using configurable
      rules (with visual rule builder UI)
    - optionally disable embedded video previews
    - sync read/unread state between multiple browsers via cloud service(s)
    - optionally disable built-in behavior of loading more items when scrolling
      (can still load more using toolbar button or keyboard shortcut)


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
 | a            | open post author's profile                         |
 | r            | reply to post                                      |
 | l            | like/unlike post                                   |
 | p            | open repost menu                                   |
 | P            | repost immediately                                 |
 | c            | capture screenshot to clipboard                    |
 | v            | open full-screen post view with sidecar            |
 | V            | open reader mode (full thread)                     |

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
 | A            | mark all visible posts as read                     |
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
```

With this configuration, you can type `$music` to show posts from `@thecure.com`
or that contain the phrase `Pearl Jam`, or `$news` to match posts from
`@cnn.com` or that contain the phrase "weather forecast". This matching is not
case sensitive.

You can also quickly activate rules using `Alt+1` through `Alt+9` to apply rules
by their order, `Alt+Shift+1-9` to negate them, or `Alt+0` to clear the filter.

These searches can be combined, and any search can be negated by prefixing it
with `!`.


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
