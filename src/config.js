// config.js

import constants from './constants.js'

export const CONFIG_FIELDS = {
    'styleSection': {
        'section': [GM_config.create('Display Preferences'), 'Customize how items are displayed'],
        'type': 'hidden',
    },
    'posts': {
        'label': 'All Posts',
        'type': 'textarea',
        'default': 'padding 1px;'
    },
    'unreadPosts': {
        'label': 'Unread Posts',
        'type': 'textarea',
        'default': 'opacity: 100% !important;'
    },
    'unreadPostsLightMode': {
        'label': 'Unread Posts (Light Mode)',
        'type': 'textarea',
        'default': 'background-color: white;'
    },
    'unreadPostsDarkMode': {
        'label': 'Unread Posts (Dark Mode)',
        'type': 'textarea',
        'default': 'background-color: #202020;'
    },
    'readPosts': {
        'label': 'Read Posts',
        'type': 'textarea',
        'default': 'opacity: 75% !important;'
    },
    'readPostsLightMode': {
        'label': 'Read Posts (Light Mode)',
        'type': 'textarea',
        'default': 'background-color: #f0f0f0;'
    },
    'readPostsDarkMode': {
        'label': 'Read Posts (Dark Mode)',
        'type': 'textarea',
        'default': 'background-color: black;'
    },
    'selectionActive': {
        'label': 'Selected Post',
        'type': 'textarea',
        'default': 'border: 3px rgba(255, 0, 0, .3) solid !important;'
    },
    'selectionInactive': {
        'label': 'Unselected Post',
        'type': 'textarea',
        'default': 'border: 3px solid transparent;'
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
    'postTimestampFormat': {
        'label': 'Post timestamp format',
        'title': 'A format string specifying how post timestamps are displayed',
        'type': 'textarea',
        'default': "'$age' '('yyyy-MM-dd hh:mmaaa')'"
    },
    'videoPreviewPlayback': {
        'label': 'Video Preview Playback',
        'title': 'Control playback of video previews',
        'type': 'select',
        'options': ['Play all', 'Play selected', 'Pause all'],
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
