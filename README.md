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
- visual indicator for post read/unread status
- keyboard shortcuts for post actions, e.g. like, reply, repost
- keyboard shortcuts to switch between feeds
- keyboard shortcuts to switch between home, search, notifications, chat, etc.


Keyboard Shortcuts
------------------

 | key         | function                                           |
 | ------------|----------------------------------------------------|
 | j / ↑       | move to next item                                  |
 | k / ↓       | move to previous item                              |
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
 | f           | follow author (profile view)                       |
 | F           | unfollow author (profile view)                     |
