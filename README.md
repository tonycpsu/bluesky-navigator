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
- Display features:
    - visual indicator for post read/unread status
    - configurable override of main content width
    - optionally reverse sorting of feeds to browse them in chronological order
      (currently only works on "Following" feed)
    - optionally show only unread posts
    - optionally move position of like/reply/repost buttons
    - configurable formatting of post timestamps
- Additional functionality (`(*)` = requires AT protocol agent, see below):
    - automatic "unrolling" of threads (*)
    - show replies in a "sidecar" next to each post (*)   
    - dynamically filter posts by authors, keywords, etc. using configurable
      rules
    - optionally disable embedded video previews
    - sync read/unread state between multiple browsers via cloud service(s)
    - optionally disable built-in behavior of loading more items when scrolling
      (can still load more using toolbar button or keyboard shortcut)


Keyboard Shortcuts
------------------

 | key          | function                                           |
 | -------------|----------------------------------------------------|
 | j / ↑        | move to next item                                  |
 | k / ↓        | move to previous item                              |
 | J            | move to next unread item, or last item if all read |
 | gg           | move to first item                                 |
 | G            | move to last item                                  |
 | h            | go back to previous page                           | 
 | o / Enter    | open post (feed view) or embedded post (post view) |
 | O            | open embedded post (feed view)                     |
 | i            | open link in post                                  |
 | m            | view/play/pause media in post                      |
 | a            | open post author's profile                         |
 | r            | reply to post                                      |
 | l            | like post                                          |
 | p            | open repost menu                                   |
 | P            | repost                                             |
 | u            | load newer posts (feed view)                       |
 | U            | load older posts (feed view)                       |
 | .            | mark post read/unread                              |
 | .            | mark all visible posts read/unread                 |
 | :            | toggle between forward/reverse order (feed view)   |
 | "            | toggle show all or only unread posts (feed view)   |
 | /            | filter posts (feed view)                           |
 | Option+1...9 | activate rule N (Option+Shift-1...9 negates)       |
 | f            | follow author (profile view)                       |
 | F            | unfollow author (profile view)                     |
 | L            | add author to list (profile view)                  |
 | 1...9        | switch between feeds on home page                  |
 | Meta/Alt+h   | open home page                                     |
 | Meta/Alt+s   | open search page                                   |
 | Meta/Alt+n   | open notifications page                            |
 | Meta/Alt+m   | open messages page                                 |
 | Meta/Alt+f   | open feeds page                                    |
 | Meta/Alt+h   | open lists page                                    |
 | Meta/Alt+p   | open profile page                                  |
 | Meta/Alt+,   | open settings page                                 |
 | Meta/Alt+.   | open Bluesky Navigator config panel                |

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

if a search term is preceded by a `$` character, then matching will be performed
according to rules configured in the `Rules` section of the script configuration
panel. Here's an example configuration:

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
