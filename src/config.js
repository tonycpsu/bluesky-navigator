// config.js

import constants from './constants.js'

export const CONFIG_FIELDS = {
    'displaySection': {
        'section': [GM_config.create('Display Preferences'), 'Customize how items are displayed'],
        'type': 'hidden',
    },
    'postWidthDesktop': {
        'label': 'Maximum width of posts in pixels when in desktop mode',
        'type': 'integer',
        'default': '600'
    },
    'postActionButtonPosition': {
        'label': 'Post action button position',
        'title': 'Where to position reply, repost, like, etc. buttons',
        'type': 'select',
        'options': ['Bottom', 'Left'],
        'default': "Bottom"
    },
    'postTimestampFormat': {
        'label': 'Post timestamp format',
        'title': 'A format string specifying how post timestamps are displayed',
        'type': 'textarea',
        'default': "'$age' '('yyyy-MM-dd hh:mmaaa')'"
    },
    'postTimestampFormatMobile': {
        'label': 'Post timestamp format (mobile)',
        'title': 'A format string specifying how post timestamps are displayed on small screens',
        'type': 'textarea',
        'default': "'$age'"
    },
    'videoPreviewPlayback': {
        'label': 'Video Preview Playback',
        'title': 'Control playback of video previews',
        'type': 'select',
        'options': ['Play all', 'Play selected', 'Pause all'],
    },
    'showReplyContext':  {
        'label': 'Show Reply Context',
        'title': 'If checked, the post being replied to will be shown even if it was previously marked as read.',
        'type': 'checkbox',
        'default': false
    },
    'unrollThreads':  {
        'label': 'Unroll Threads',
        'title': 'If checked, threads with one or more replies from the original author will be "unrolled" into the first post.',
        'type': 'checkbox',
        'default': false
    },
    'showReplySidecar':  {
        'label': 'Show Replies Sidecar',
        'title': 'If checked, replies to the selected post (and, where applicable, the post being replied to) will be displayed in a sidecar next to each post (requires atproto settings below).',
        'type': 'checkbox',
        'default': false
    },
    'showReplySidecarMinimumWidth':  {
        'label': 'Show Replies Sidecar Minimum Width',
        'title': 'Set a minimum post width in pixels for showing the reply sidecar',
        'type': 'int',
        'default': 600
    },
    'hideRightSidebar':  {
        'label': 'Hide Right Sidebar',
        'title': 'If checked, the right sidebar with the search box, following/trending displays, etc. will be hidden (useful when overriding max width above).',
        'type': 'checkbox',
        'default': false
    },
    'hideLoadNewButton':  {
        'label': 'Hide Load New Button',
        'title': 'If checked, the floating button to load new items will be hidden.',
        'type': 'checkbox',
        'default': false
    },
    'showPostCounts':  {
        'label': 'Show Post Counts',
        'title': 'Specify whether post counts are displayed in all, selected, or no posts.',
        'type': 'select',
        'options': ['All', 'Selection', 'None'],
        'default': "All"
    },
    'enableSmoothScrolling':  {
        'label': 'Enable Smooth Scrolling',
        'title': 'If checked, scrolling using keyboard navigation will be smooth 🛥️ 🎷',
        'type': 'checkbox',
        'default': false
    },
    'posts': {
        'label': 'CSS Style: All Posts',
        'type': 'textarea',
        'default': 'padding 1px;'
    },
    'unreadPosts': {
        'label': 'CSS Style: Unread Posts',
        'type': 'textarea',
        'default': 'opacity: 100% !important;'
    },
    'unreadPostsLightMode': {
        'label': 'CSS Style: Unread Posts (Light Mode)',
        'type': 'textarea',
        'default': 'background-color: white;'
    },
    'unreadPostsDarkMode': {
        'label': 'CSS Style: Unread Posts (Dark Mode)',
        'type': 'textarea',
        'default': 'background-color: #202020;'
    },
    'readPosts': {
        'label': 'CSS Style: Read Posts',
        'type': 'textarea',
        'default': 'opacity: 75% !important;'
    },
    'readPostsLightMode': {
        'label': 'CSS Style: Read Posts (Light Mode)',
        'type': 'textarea',
        'default': 'background-color: #f0f0f0;'
    },
    'readPostsDarkMode': {
        'label': 'CSS Style: Read Posts (Dark Mode)',
        'type': 'textarea',
        'default': 'background-color: black;'
    },
    'selectionActive': {
        'label': 'CSS Style: Selected Post',
        'type': 'textarea',
        'default': 'border: 3px rgba(255, 0, 0, .6) solid !important;'
    },
    'selectionChildFocused': {
        'label': 'CSS Style: Selected Child Post Focused',
        'type': 'textarea',
        'default': 'border: 3px rgba(128, 0, 0, .2) solid !important;'
    },
    'selectionInactive': {
        'label': 'CSS Style: Unselected Post',
        'type': 'textarea',
        'default': 'border: 3px solid transparent;'
    },
    'replySelectionActive': {
        'label': 'CSS Style: Selected Reply',
        'type': 'textarea',
        'default': 'border: 1px rgba(255, 0, 0, .6) solid !important;'
    },
    'replySelectionInactive': {
        'label': 'CSS Style: Unselected Replies',
        'type': 'textarea',
        'default': 'border: 1px rgb(212, 219, 226) solid !important;'
    },
    'threadIndicatorWidth': {
        'label': 'Thread Indicator Width in pixels',
        'type': 'integer',
        'default': '4'
    },
    'threadIndicatorColor': {
        'label': 'Thread Indicator Color',
        'type': 'textarea',
        'default': 'rgb(212, 219, 226)'
    },
    'threadMargin': {
        'label': 'Thread Margin',
        'type': 'textarea',
        'default': '10px'
    },
    'atprotoSection': {
        'section': [GM_config.create('AT Protocol Agent'), 'Enables additional functionality'],
        'type': 'hidden',
    },
    'atprotoService': {
        'label': 'Service',
        'title': 'AT Protocol Service',
        'type': 'textarea',
        'default': 'https://bsky.social'
    },
    'atprotoIdentifier': {
        'label': 'Identifier (Handle)',
        'title': 'AT Protocol Identifier (Handle)',
        'type': 'textarea'
    },
    'atprotoPassword': {
        'label': 'Password',
        'title': 'AT Protocol Password',
        'type': 'textarea'
    },
    'stateSyncSection': {
        'section': [GM_config.create('State Sync'), 'Sync state between different browsers via cloud storage -- see <a href="https://github.com/tonycpsu/bluesky-navigator/blob/main/doc/remote_state.md" target="_blank">here</a> for details.'],
        'type': 'hidden',
    },
    'stateSyncEnabled':  {
        'label': 'Enable State Sync',
        'title': 'If checked, synchronize state to/from the cloud',
        'type': 'checkbox',
        'default': false
    },
    'stateSyncConfig': {
        'label': 'State Sync Configuration (JSON)',
        'title': 'JSON object containing state information',
        'type': 'textarea',
    },
    'stateSyncTimeout': {
        'label': 'State Sync Timeout',
        'title': 'Number of milliseconds of idle time before syncing state',
        'type': 'int',
        'default': 5000
    },
    'rulesSection': {
        'section': [GM_config.create('Rules'), 'Post Rules'],
        'type': 'hidden',
    },
    'rulesConfig': {
        'label': 'Filters Configuration',
        'type': 'textarea',
    },
    'miscellaneousSection': {
        'section': [GM_config.create('Miscellaneous'), 'Other settings'],
        'type': 'hidden',
    },
    'markReadOnScroll':  {
        'label': 'Mark Read on Scroll',
        'title': 'If checked, items will be marked read while scrolling',
        'type': 'checkbox',
        'default': false
    },
    'disableLoadMoreOnScroll':  {
        'label': 'Disable Load More on Scroll',
        'title': 'If checked, the default behavior of loading more items when scrolling will be disabled. You can still press "U" to load more manually.',
        'type': 'checkbox',
        'default': false
    },
    'savePostState':  {
        'label': 'Save Post State',
        'title': 'If checked, read/unread state is kept for post items in addition to feed items',
        'type': 'checkbox',
        'default': false
    },
    'stateSaveTimeout': {
        'label': 'State Save Timeout',
        'title': 'Number of milliseconds of idle time before saving state locally',
        'type': 'int',
        'default': 1000
    },
    'historyMax': {
        'label': 'History Max Size',
        'title': 'Maximum number of posts to remember for saving read state',
        'type': 'int',
        'default': constants.DEFAULT_HISTORY_MAX
    },
    'showDebuggingInfo':  {
        'label': 'Enable Debugging',
        'title': 'If checked, some debugging info will be shown in posts',
        'type': 'checkbox',
        'default': false
    },

}
