Bluesky Navigator
=================

Bluesky userscript that adds keyboard shortcuts, read post tracking, and more. 


Usage
-----

1. Install [TamperMonkey](https://en.wikipedia.org/wiki/Tampermonkey) on your
   favorite browser
2. Install [the script](https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/bluesky-navigator.user.js)


Features
--------

- navigate between posts with Vim-like keyboard shortcuts (`j`/`k` for
  next/previous, `gg` / `G` to go to top/bottom of page)
- keyboard shortcuts for post actions, e.g. like, reply, repost
- keyboard shortcuts to switch between feeds
- keyboard shortcuts to switch between home, search, notifications, chat, etc.
- optionally reverse sorting of feeds to browse them in chronological order 
- visual indicator for post read/unread status
- configurable formatting of post timestamps
- sync read/unread state between multiple browsers via cloud service(s)


Keyboard Shortcuts
------------------

 | key         | function                                           |
 | ------------|----------------------------------------------------|
 | j / ↑       | move to next item                                  |
 | k / ↓       | move to previous item                              |
 | J           | move to next unread item, or last item if all read |
 | gg          | move to first item                                 |
 | G           | move to last item                                  |
 | h           | go back to previous page                           | 
 | o / Enter   | open post (feed view) or embedded post (post view) |
 | O           | open embedded post (feed view)                     |
 | i           | open link in post                                  |
 | m           | open media in post                                 |
 | a           | open post author's profile                         |
 | r           | reply to post                                      |
 | l           | like post                                          |
 | p           | open repost menu                                   |
 | P           | repost                                             |
 | .           | mark post read/unread                              |
 | :           | toggle between forward/reverse order (feed view)   |
 | f           | follow author (profile view)                       |
 | F           | unfollow author (profile view)                     |
 | 1...9       | switch between feeds on home page                  |
 | Meta/Alt+h  | open home page                                     |
 | Meta/Alt+s  | open search page                                   |
 | Meta/Alt+n  | open notifications page                            |
 | Meta/Alt+m  | open messages page                                 |
 | Meta/Alt+f  | open feeds page                                    |
 | Meta/Alt+h  | open lists page                                    |
 | Meta/Alt+p  | open profile page                                  |
 | Meta/Alt+,  | open settings page                                 |
 | Meta/Alt+.  | open Bluesky Navigator config panel                |


Remote State Sync (beta)
------------------------

By default, read/unread state is kept in browser local storage using the
[GM_setvalue
function](https://www.tampermonkey.net/documentation.php?locale=en#api:GM_setValue).
To support persisting this state and potentially syncing between multiple
browsers, you can set up a cloud service to store the state using the
instructions [here](doc/remote_state.md).
