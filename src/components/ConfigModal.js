// ConfigModal.js - Custom configuration modal with tabbed interface

import { announceToScreenReader, getAnimationDuration } from '../utils.js';
import constants from '../constants.js';
import { state } from '../state.js';

/**
 * Configuration schema organized by tabs
 */
const CONFIG_SCHEMA = {
  Display: {
    icon: '🖥️',
    fields: {
      showLoadingIndicator: {
        label: 'Show loading indicator',
        type: 'checkbox',
        default: true,
        help: 'Show spinner while feed items are loading and sorting',
      },
      postWidthDesktop: {
        label: 'Post width (px)',
        type: 'number',
        default: 600,
        min: 400,
        max: 1200,
        help: 'Maximum width of posts in the feed',
      },
      postMaxHeight: {
        label: 'Collapse posts',
        type: 'select',
        options: ['Off', '25vh', '50vh', '75vh'],
        default: 'Off',
        help: 'Collapse unfocused posts to max height; expands when selected',
      },
      postActionButtonPosition: {
        label: 'Action buttons',
        type: 'select',
        options: ['Bottom', 'Left'],
        default: 'Bottom',
        help: 'Position of like/repost/reply buttons',
      },
      postTimestampFormat: {
        label: 'Timestamp format',
        type: 'text',
        default: "'$age' '('yyyy-MM-dd hh:mmaaa')'",
        placeholder: 'date-fns format string',
        help: 'Uses date-fns format; $age for relative time',
      },
      postTimestampFormatMobile: {
        label: 'Timestamp (mobile)',
        type: 'text',
        default: "'$age'",
        help: 'Timestamp format on mobile devices',
      },
      videoPreviewPlayback: {
        label: 'Video playback',
        type: 'select',
        options: ['Play all', 'Play selected', 'Pause all'],
        default: 'Play all',
        help: 'Control video autoplay behavior',
      },
      videoDisableLoop: {
        label: 'Disable video loop',
        type: 'checkbox',
        default: false,
        help: 'Stop videos from looping automatically',
      },
      hideRightSidebar: {
        label: 'Hide right sidebar',
        type: 'checkbox',
        default: false,
        help: 'Hide the trending/who to follow sidebar',
      },
      compactLayout: {
        label: 'Compact layout',
        type: 'checkbox',
        default: false,
        help: 'Remove whitespace next to the left navigation',
      },
      hideLoadNewButton: {
        label: 'Hide "Load New" button',
        type: 'checkbox',
        default: false,
        help: 'Hide the button that appears for new posts',
      },
      hideSuggestedFollows: {
        label: 'Hide "Suggested for you"',
        type: 'checkbox',
        default: false,
        help: 'Hide suggested profiles in feed',
      },
      showPostCounts: {
        label: 'Show post counts',
        type: 'select',
        options: ['All', 'Selection', 'None'],
        default: 'All',
        help: 'When to show read/unread post counts',
      },
      enableSmoothScrolling: {
        label: 'Smooth scrolling',
        type: 'checkbox',
        default: false,
        help: 'Animate scrolling when navigating posts',
      },
      enablePageKeys: {
        label: 'Page/Home/End navigation',
        type: 'checkbox',
        default: true,
        help: 'Use PgUp/PgDn/Home/End for post navigation',
      },
      scrollToFocus: {
        label: 'Scroll to focus',
        type: 'checkbox',
        default: true,
        help: 'Focus posts when scrolling through the feed',
      },
      hoverToFocus: {
        label: 'Hover to focus',
        type: 'checkbox',
        default: true,
        help: 'Focus posts when hovering with the mouse',
      },
      hoverToFocusSidecar: {
        label: 'Hover to focus (sidecar)',
        type: 'checkbox',
        default: true,
        help: 'Focus sidecar items when hovering with the mouse',
        showWhen: { hoverToFocus: true },
      },
      readerModeFontSize: {
        label: 'Reader mode font size (px)',
        type: 'number',
        default: 16,
        min: 10,
        max: 32,
        help: 'Font size for reader mode (V key)',
      },
    },
  },
  'Feed Map': {
    icon: '🗺️',
    fields: {
      feedMapPosition: {
        label: 'Position',
        type: 'select',
        options: ['Top toolbar', 'Bottom status bar', 'Hidden'],
        default: 'Bottom status bar',
        help: 'Where to show the feed map',
      },
      feedMapStyle: {
        label: 'Style',
        type: 'select',
        options: ['Basic', 'Advanced'],
        default: 'Basic',
        help: 'Basic: simple read/unread segments. Advanced: heatmap, icons, and zoom options',
      },
      feedMapScale: {
        label: 'Scale (%)',
        type: 'range',
        default: 100,
        min: 50,
        max: 400,
        step: 25,
        help: 'Scale the feed map size (50-400%)',
      },
      feedMapTheme: {
        label: 'Color theme',
        type: 'select',
        options: ['Ocean', 'Campfire', 'Forest', 'Monochrome'],
        default: 'Ocean',
        help: 'Color scheme for the feed map',
      },
      feedMapTooltip: {
        label: 'Tooltip delay',
        type: 'select',
        options: ['Instant', 'Delayed'],
        default: 'Instant',
        help: 'Show post preview on hover instantly or after a short delay',
      },
      feedMapHeatmap: {
        label: 'Heatmap mode',
        type: 'select',
        options: ['None', 'Engagement Rate', 'Raw Engagement', 'Weighted Engagement'],
        default: 'None',
        help: 'Color intensity based on post engagement metrics',
        showWhen: { feedMapStyle: 'Advanced' },
      },
      feedMapIcons: {
        label: 'Content icons',
        type: 'checkbox',
        default: true,
        help: 'Show icons for media, replies, and reposts in feed map',
        showWhen: { feedMapStyle: 'Advanced' },
      },
      feedMapAvatars: {
        label: 'Show avatars',
        type: 'checkbox',
        default: true,
        help: 'Show author avatars in zoom indicator segments',
        showWhen: { feedMapStyle: 'Advanced' },
      },
      feedMapAvatarScale: {
        label: 'Avatar scale',
        type: 'range',
        default: 100,
        min: 25,
        max: 200,
        step: 5,
        help: 'Avatar size as percentage (base 32px)',
        showWhen: { feedMapAvatars: true },
      },
      feedMapTimestamps: {
        label: 'Show timestamps',
        type: 'checkbox',
        default: true,
        help: 'Show relative timestamps in zoom indicator segments',
        showWhen: { feedMapStyle: 'Advanced' },
      },
      feedMapHandles: {
        label: 'Show handles',
        type: 'checkbox',
        default: true,
        help: 'Show user handles in zoom indicator segments',
        showWhen: { feedMapStyle: 'Advanced' },
      },
      feedMapZoomEnabled: {
        label: 'Enable zoom view',
        type: 'checkbox',
        default: false,
        help: 'Show zoomed view of posts around selection',
        showWhen: { feedMapStyle: 'Advanced' },
      },
      feedMapZoom: {
        label: 'Zoom window size',
        type: 'range',
        default: 5,
        min: 3,
        max: 20,
        step: 1,
        help: 'Number of posts to show in zoom view',
        showWhen: { feedMapStyle: 'Advanced', feedMapZoomEnabled: true },
      },
      feedMapAnimationSpeed: {
        label: 'Animation interval',
        type: 'range',
        default: 100,
        min: 0,
        max: 1000,
        step: 50,
        help: 'Zoom scroll animation duration (0=instant, 100=normal)',
        showWhen: { feedMapStyle: 'Advanced' },
      },
    },
  },
  Notifications: {
    icon: '🔔',
    fields: {
      toastNotifications: {
        label: 'Toast notifications',
        type: 'checkbox',
        default: true,
        help: 'Show popup notifications for new activity',
      },
      toastDuration: {
        label: 'Duration (seconds)',
        type: 'range',
        default: 4,
        min: 0,
        max: 10,
        step: 1,
        help: 'How long notifications stay visible',
        showWhen: { toastNotifications: true },
        // Slider positions map to: 1, 2, 3, 4, 5, 10, 15, 30, 60, 300, ∞
        rangeValues: [1, 2, 3, 4, 5, 10, 15, 30, 60, 300, Infinity],
        formatValue: (v) => {
          const values = [1, 2, 3, 4, 5, 10, 15, 30, 60, 300, Infinity];
          const actual = values[v] || 5;
          return actual === Infinity ? '∞' : actual;
        },
      },
      toastPosition: {
        label: 'Position',
        type: 'select',
        options: ['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left'],
        default: 'Top Right',
        help: 'Where to show toast notifications',
        showWhen: { toastNotifications: true },
      },
      toastTestMode: {
        label: 'Test mode',
        type: 'checkbox',
        default: false,
        help: 'Show most recent notification as new (for testing)',
        showWhen: { toastNotifications: true },
      },
    },
  },
  'Threads & Sidecar': {
    icon: '💬',
    fields: {
      unrollThreads: {
        label: 'Unroll threads',
        type: 'checkbox',
        default: false,
        help: 'Expand self-reply threads inline',
      },
      unrolledPostSelection: {
        label: 'Unrolled post selection',
        type: 'checkbox',
        default: false,
        help: 'Enable j/k navigation in unrolled threads',
      },
      showReplySidecar: {
        label: 'Show replies sidecar',
        type: 'checkbox',
        default: false,
        help: 'Show replies panel next to posts',
      },
      showReplySidecarMinimumWidth: {
        label: 'Sidecar min width (px)',
        type: 'number',
        default: 600,
        min: 400,
        max: 1200,
        help: 'Minimum viewport width to show sidecar',
      },
      sidecarWidthPercent: {
        label: 'Sidecar width (%)',
        type: 'number',
        default: 30,
        min: 20,
        max: 50,
        help: 'Sidecar width relative to post',
      },
      sidecarReplySortOrder: {
        label: 'Sidecar sort order',
        type: 'select',
        options: ['Default', 'Oldest First', 'Newest First', 'Most Liked First', 'Most Reposted First'],
        default: 'Default',
        help: 'How to sort replies in the sidecar',
      },
      fixedSidecar: {
        label: 'Sidecar panel style',
        type: 'select',
        options: ['Fixed', 'Inline'],
        default: 'Fixed',
        help: 'Fixed: separate panel. Inline: next to each post',
      },
      showReplyContext: {
        label: 'Show reply context',
        type: 'checkbox',
        default: false,
        help: 'Show parent post even if previously read',
      },
    },
  },
  Appearance: {
    icon: '🎨',
    collapsed: true,
    fields: {
      focusRingColor: {
        label: 'Focus ring color',
        type: 'color',
        default: '#0066cc',
        help: 'Color of selection outline',
      },
      focusRingWidth: {
        label: 'Focus ring width (px)',
        type: 'number',
        default: 2,
        min: 1,
        max: 5,
        help: 'Thickness of selection outline',
      },
      threadIndicatorWidth: {
        label: 'Thread indicator width (px)',
        type: 'number',
        default: 4,
        min: 1,
        max: 10,
        help: 'Width of the vertical thread line',
      },
      threadIndicatorColor: {
        label: 'Thread indicator color',
        type: 'text',
        default: 'rgb(212, 219, 226)',
        help: 'Color of the vertical thread line',
      },
      threadMargin: {
        label: 'Thread margin',
        type: 'text',
        default: '10px',
        help: 'Spacing between thread groups',
      },
    },
  },
  'CSS Styles': {
    icon: '✨',
    collapsed: true,
    fields: {
      posts: {
        label: 'All posts',
        type: 'css',
        default: 'padding: 1px;',
        help: 'CSS applied to all posts',
      },
      unreadPosts: {
        label: 'Unread posts',
        type: 'css',
        default: 'opacity: 100% !important;',
        help: 'CSS for posts not yet seen',
      },
      unreadPostsLightMode: {
        label: 'Unread (light)',
        type: 'css',
        default: 'background-color: white;',
        help: 'Unread posts in light mode',
      },
      unreadPostsDarkMode: {
        label: 'Unread (dark)',
        type: 'css',
        default: 'background-color: #202020;',
        help: 'Unread posts in dark mode',
      },
      readPosts: {
        label: 'Read posts',
        type: 'css',
        default: 'opacity: 75% !important;',
        help: 'CSS for previously seen posts',
      },
      readPostsLightMode: {
        label: 'Read (light)',
        type: 'css',
        default: 'background-color: #f0f0f0;',
        help: 'Read posts in light mode',
      },
      readPostsDarkMode: {
        label: 'Read (dark)',
        type: 'css',
        default: 'background-color: black;',
        help: 'Read posts in dark mode',
      },
      selectionActive: {
        label: 'Selected post',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) var(--focus-ring-color, #0066cc) solid !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--focus-ring-color, #0066cc) 15%, transparent);',
        help: 'CSS for the currently selected post',
      },
      selectionChildFocused: {
        label: 'Child focused',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) color-mix(in srgb, var(--focus-ring-color, #0066cc) 35%, transparent) solid !important;',
        help: 'Post style when reply is focused',
      },
      selectionInactive: {
        label: 'Unselected post',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) solid transparent;',
        help: 'CSS for non-selected posts',
      },
      replySelectionActive: {
        label: 'Selected reply',
        type: 'css',
        default: 'outline: 3px var(--focus-ring-color, #0066cc) solid !important; outline-offset: -1px;',
        help: 'CSS for selected reply in sidecar',
      },
      replySelectionInactive: {
        label: 'Unselected reply',
        type: 'css',
        default: 'outline: 1px rgb(212, 219, 226) solid',
        help: 'CSS for non-selected replies',
      },
    },
  },
  'AT Protocol': {
    icon: '🔑',
    fields: {
      atprotoService: {
        label: 'Service URL',
        type: 'text',
        default: 'https://bsky.social',
        help: 'AT Protocol service endpoint',
      },
      atprotoIdentifier: {
        label: 'Handle',
        type: 'text',
        default: '',
        placeholder: 'your.handle',
        help: 'Your Bluesky handle or DID',
      },
      atprotoPassword: {
        label: 'App Password',
        type: 'password',
        default: '',
        placeholder: 'xxxx-xxxx-xxxx-xxxx',
        help: 'Use an App Password, not your main password',
      },
    },
  },
  'State Sync': {
    icon: '☁️',
    collapsed: true,
    fields: {
      stateSyncEnabled: {
        label: 'Enable cloud sync',
        type: 'checkbox',
        default: false,
        help: 'Sync read state across devices',
      },
      stateSyncConfig: {
        label: 'Sync config (JSON)',
        type: 'textarea',
        default: '',
        rows: 4,
        help: 'Cloud sync provider configuration',
      },
      stateSyncTimeout: {
        label: 'Sync timeout (ms)',
        type: 'number',
        default: 5000,
        min: 1000,
        max: 60000,
        help: 'How long to wait for sync operations',
      },
    },
  },
  Rules: {
    icon: '📋',
    fields: {
      rulesConfig: {
        label: 'Filter rules',
        type: 'textarea',
        default: '',
        rows: 6,
        placeholder: 'Enter filter rules...',
        help: 'Content filtering rules by category',
      },
      ruleColorCoding: {
        label: 'Color-code rule matches',
        type: 'checkbox',
        default: false,
        help: 'Color handles/avatars in feed and feed map by author rules',
      },
      autoOrganizeRules: {
        label: 'Auto-organize rules',
        type: 'checkbox',
        default: false,
        help: 'Automatically sort rules by type (all→include→from→content) then value',
      },
    },
  },
  Timeouts: {
    icon: '⏱️',
    fields: {
      timeoutDefaultDuration: {
        label: 'Default timeout duration',
        type: 'select',
        options: ['1h', '6h', '12h', '1d', '3d', '7d', '14d', '30d'],
        default: '1d',
        help: 'Default duration when timing out an author (! hotkey)',
      },
    },
  },
  Advanced: {
    icon: '⚙️',
    collapsed: true,
    fields: {
      reducedMotion: {
        label: 'Reduced motion',
        type: 'select',
        options: ['System', 'Always', 'Never'],
        default: 'System',
        help: 'Control animation behavior',
      },
      highContrastMode: {
        label: 'High contrast',
        type: 'checkbox',
        default: false,
        help: 'Increase visual contrast for accessibility',
      },
      enableSwipeGestures: {
        label: 'Swipe gestures (mobile)',
        type: 'checkbox',
        default: true,
        help: 'Enable swipe actions on touch devices',
      },
      markReadOnScroll: {
        label: 'Mark read on scroll',
        type: 'checkbox',
        default: false,
        help: 'Mark posts as read when scrolled past',
      },
      disableLoadMoreOnScroll: {
        label: 'Disable auto-load on scroll',
        type: 'checkbox',
        default: false,
        help: 'Prevent loading more posts on scroll',
      },
      savePostState: {
        label: 'Save post state',
        type: 'checkbox',
        default: false,
        help: 'Persist read/unread state locally',
      },
      stateSaveTimeout: {
        label: 'State save timeout (ms)',
        type: 'number',
        default: 1000,
        min: 100,
        max: 10000,
        help: 'Delay before saving state changes',
      },
      historyMax: {
        label: 'History max size',
        type: 'number',
        default: constants.DEFAULT_HISTORY_MAX,
        min: 100,
        max: 100000,
        help: 'Maximum posts to track in history',
      },
      showDebuggingInfo: {
        label: 'Debug mode',
        type: 'checkbox',
        default: false,
        help: 'Show developer debugging information',
      },
      performanceLogging: {
        label: 'Performance logging',
        type: 'checkbox',
        default: false,
        help: 'Log performance metrics to console (helps diagnose slowdowns)',
      },
    },
  },
};

// Hidden fields that need to be preserved but not shown in UI
const HIDDEN_FIELDS = {
  savedSearches: { default: '[]' },
  rulesetColors: { default: '{}' }, // Maps category name to color index
};

let instance = null;

export class ConfigModal {
  constructor(config, onSave = null) {
    if (instance) {
      instance.config = config;
      instance.onSave = onSave;
      return instance;
    }

    this.config = config;
    this.onSave = onSave;
    this.isVisible = false;
    this.modalEl = null;
    this.activeTab = 'Display';
    this.pendingChanges = {};
    this.collapsedSections = {};
    this.rulesSubTab = 'visual'; // 'visual' or 'raw'
    this.parsedRules = []; // Parsed rule categories for visual editor
    this.collapsedCategories = {}; // Track collapsed state of rule categories
    this.cachedListNames = []; // Cached Bluesky list names for dropdown

    instance = this;
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    if (this.isVisible) return;

    this.previousActiveElement = document.activeElement;
    this.isVisible = true;
    this.pendingChanges = {};
    this.prefillRule = null; // Clear any pre-fill data
    this._listNamesFetched = false; // Reset so we fetch fresh list names

    // Initialize collapsed state from schema
    Object.entries(CONFIG_SCHEMA).forEach(([tab, schema]) => {
      if (schema.collapsed) {
        this.collapsedSections[tab] = true;
      }
    });

    this.modalEl = this.createModal();
    document.body.appendChild(this.modalEl);

    const firstInput = this.modalEl.querySelector('.config-modal-close');
    if (firstInput) firstInput.focus();

    announceToScreenReader('Configuration dialog opened. Press Escape to close.');

    this.escapeHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);

    // Fetch list names and refresh visual editor (async)
    this.refreshVisualEditor();
  }

  /**
   * Open the modal directly to Rules tab with a pre-filled rule for an author
   * @param {string} handle - The author handle (with or without @)
   * @param {string} categoryName - Optional category name (defaults to 'favorites')
   */
  showWithRule(handle, categoryName = 'favorites') {
    // Ensure handle starts with @
    const normalizedHandle = handle.startsWith('@') ? handle : `@${handle}`;

    // Store pre-fill data for when visual editor renders
    this.prefillRule = {
      handle: normalizedHandle,
      categoryName: categoryName
    };

    // Set active tab to Rules before showing
    this.activeTab = 'Rules';
    this.rulesSubTab = 'visual';

    this.show();

    // After modal is created, add the pre-filled rule
    if (this.prefillRule) {
      this.addPrefillRule();
    }
  }

  /**
   * Add the pre-filled rule to the visual editor
   */
  addPrefillRule() {
    if (!this.prefillRule) return;

    const { handle, categoryName } = this.prefillRule;

    // Find or create the category
    let categoryIndex = this.parsedRules.findIndex(c => c.name === categoryName);
    if (categoryIndex === -1) {
      // Create new category
      this.parsedRules.push({ name: categoryName, rules: [] });
      categoryIndex = this.parsedRules.length - 1;
    }

    // Check if rule already exists
    const category = this.parsedRules[categoryIndex];
    const ruleExists = category.rules.some(r =>
      r.type === 'from' && r.value.toLowerCase() === handle.toLowerCase()
    );

    if (!ruleExists) {
      // Clear unsaved flag from existing rules in this category
      this.clearUnsavedFlags(categoryIndex);
      // Add the new rule marked as unsaved
      category.rules.push({ action: 'allow', type: 'from', value: handle, _unsaved: true });

      // Sync to raw textarea
      this.syncVisualToRaw();

      // Refresh visual editor to show the new rule
      this.refreshVisualEditor();
    }

    // Expand the category if collapsed
    this.collapsedCategories[categoryIndex] = false;

    // Clear prefill data
    this.prefillRule = null;
  }

  hide() {
    if (!this.isVisible || !this.modalEl) return;

    const animDuration = getAnimationDuration(200, this.config);
    this.modalEl.classList.add('config-modal-hiding');

    setTimeout(() => {
      if (this.modalEl?.parentNode) {
        this.modalEl.parentNode.removeChild(this.modalEl);
      }
      this.modalEl = null;
      this.isVisible = false;
      this._listNamesFetched = false; // Reset so next open fetches fresh list names

      if (this.previousActiveElement) {
        this.previousActiveElement.focus();
      }
    }, animDuration);

    document.removeEventListener('keydown', this.escapeHandler, true);
    announceToScreenReader('Configuration dialog closed.');
  }

  createModal() {
    const modal = document.createElement('div');
    modal.className = 'config-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'config-modal-title');

    modal.innerHTML = `
      <div class="config-modal-backdrop"></div>
      <div class="config-modal-content">
        <div class="config-modal-header">
          <h2 id="config-modal-title">Settings</h2>
          <button class="config-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="config-modal-body">
          <nav class="config-modal-tabs" role="tablist">
            ${this.renderTabs()}
          </nav>
          <div class="config-modal-panels">
            ${this.renderPanels()}
          </div>
        </div>
        <div class="config-modal-footer">
          <button class="config-btn config-btn-secondary" id="config-reset">Reset to Defaults</button>
          <div class="config-footer-right">
            <button class="config-btn config-btn-secondary" id="config-cancel">Cancel</button>
            <button class="config-btn config-btn-primary" id="config-save">Save</button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    modal.querySelector('.config-modal-backdrop').addEventListener('click', () => this.hide());
    modal.querySelector('.config-modal-close').addEventListener('click', () => this.hide());
    modal.querySelector('#config-cancel').addEventListener('click', () => this.hide());
    modal.querySelector('#config-save').addEventListener('click', () => this.save());
    modal.querySelector('#config-reset').addEventListener('click', () => this.resetToDefaults());

    // Tab switching - use currentTarget to always get the button, not child spans
    modal.querySelectorAll('.config-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const tabButton = e.currentTarget;
        this.switchTab(tabButton.dataset.tab);
      });
    });

    // Input change handlers
    modal.querySelectorAll('input, select, textarea').forEach((input) => {
      input.addEventListener('change', (e) => this.handleInputChange(e));
      input.addEventListener('input', (e) => {
        if (e.target.type === 'range') this.handleInputChange(e);
      });
    });

    // Reset button handlers
    modal.querySelectorAll('.config-field-reset').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.resetField(btn.dataset.key);
      });
    });

    // Rules panel event listeners (pass modal since this.modalEl not yet assigned)
    this.attachRulesEventListeners(modal);

    return modal;
  }

  getFieldSchema(key) {
    for (const [, schema] of Object.entries(CONFIG_SCHEMA)) {
      if (schema.fields[key]) {
        return schema.fields[key];
      }
    }
    return null;
  }

  resetField(key) {
    const field = this.getFieldSchema(key);
    if (!field) return;

    const defaultValue = field.default;
    const id = `config-${key}`;
    const input = this.modalEl.querySelector(`#${id}`);

    if (!input) return;

    // Update the input value
    if (field.type === 'checkbox') {
      input.checked = Boolean(defaultValue);
    } else if (field.type === 'color') {
      input.value = defaultValue;
      const textInput = this.modalEl.querySelector(`#${id}-text`);
      if (textInput) textInput.value = defaultValue;
    } else if (field.type === 'range') {
      input.value = defaultValue;
      const valueDisplay = input.parentElement?.querySelector('.config-range-value');
      if (valueDisplay) {
        const displayValue = field.formatValue ? field.formatValue(defaultValue) : defaultValue;
        valueDisplay.textContent = displayValue;
      }
    } else {
      input.value = defaultValue;
    }

    // Track as pending change
    this.pendingChanges[key] = defaultValue;

    // Hide the reset button
    const wrapper = input.closest('.config-field-wrapper');
    const resetBtn = wrapper?.querySelector('.config-field-reset');
    if (resetBtn) {
      resetBtn.classList.add('hidden');
    }

    announceToScreenReader(`${field.label} reset to default.`);
  }

  renderTabs() {
    return Object.entries(CONFIG_SCHEMA)
      .map(
        ([name, schema]) => `
        <button class="config-tab ${name === this.activeTab ? 'active' : ''}"
                role="tab"
                data-tab="${name}"
                aria-selected="${name === this.activeTab}">
          <span class="config-tab-icon">${schema.icon}</span>
          <span class="config-tab-label">${name}</span>
        </button>
      `
      )
      .join('');
  }

  renderPanels() {
    return Object.entries(CONFIG_SCHEMA)
      .map(
        ([name, schema]) => `
        <div class="config-panel ${name === this.activeTab ? 'active' : ''}"
             role="tabpanel"
             data-panel="${name}">
          ${name === 'Rules' ? this.renderRulesPanel() : name === 'Timeouts' ? this.renderTimeoutsPanel() : this.renderFields(schema.fields)}
        </div>
      `
      )
      .join('');
  }

  renderFields(fields) {
    return Object.entries(fields)
      .map(([key, field]) => this.renderField(key, field))
      .join('');
  }

  renderField(key, field) {
    const value = this.config.get(key) ?? field.default ?? '';
    const id = `config-${key}`;
    const isModified = this.isFieldModified(key, field, value);
    const resetBtn = `<button type="button" class="config-field-reset ${isModified ? '' : 'hidden'}"
                              data-key="${key}" data-default="${this.escapeHtml(String(field.default))}"
                              title="Reset to default">↺</button>`;

    // Check showWhen condition
    let showWhenAttrs = '';
    let isHidden = false;
    if (field.showWhen) {
      const [depKey, depValue] = Object.entries(field.showWhen)[0];
      const currentDepValue = this.config.get(depKey) ?? CONFIG_SCHEMA[this.activeTab]?.fields[depKey]?.default;
      isHidden = currentDepValue !== depValue;
      showWhenAttrs = `data-show-when-key="${depKey}" data-show-when-value="${depValue}"`;
    }

    let inputHtml = '';

    switch (field.type) {
      case 'checkbox':
        inputHtml = `
          <label class="config-field-checkbox"${field.help ? ` data-help="${this.escapeHtml(field.help)}"` : ''}>
            <span class="config-checkbox-label">${field.label}</span>
            <input type="checkbox" id="${id}" name="${key}" ${value ? 'checked' : ''}>
          </label>
        `;
        break;

      case 'select':
        inputHtml = `
          <div class="config-field-wrapper">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <select id="${id}" name="${key}">
                ${field.options.map((opt) => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
              </select>
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
        `;
        break;

      case 'number':
        inputHtml = `
          <div class="config-field-wrapper">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <input type="number" id="${id}" name="${key}" value="${value}"
                     ${field.min !== undefined ? `min="${field.min}"` : ''}
                     ${field.max !== undefined ? `max="${field.max}"` : ''}>
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
        `;
        break;

      case 'range': {
        const displayValue = field.formatValue ? field.formatValue(value) : value;
        inputHtml = `
          <div class="config-field-wrapper">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <div class="config-range-input">
                <input type="range" id="${id}" name="${key}" value="${value}"
                       ${field.min !== undefined ? `min="${field.min}"` : ''}
                       ${field.max !== undefined ? `max="${field.max}"` : ''}
                       ${field.step !== undefined ? `step="${field.step}"` : ''}>
                <span class="config-range-value">${displayValue}</span>
              </div>
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
        `;
        break;
      }

      case 'color':
        inputHtml = `
          <div class="config-field-wrapper">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <div class="config-color-input">
                <input type="color" id="${id}" name="${key}" value="${value}">
                <input type="text" id="${id}-text" value="${value}" class="config-color-text">
              </div>
            </label>
            ${resetBtn}
          </div>
        `;
        break;

      case 'password':
        inputHtml = `
          <div class="config-field-wrapper">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <input type="password" id="${id}" name="${key}" value="${value}"
                     placeholder="${field.placeholder || ''}">
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
        `;
        break;

      case 'textarea':
      case 'css':
        inputHtml = `
          <div class="config-field-wrapper config-field-textarea">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <textarea id="${id}" name="${key}" rows="${field.rows || 2}"
                        placeholder="${field.placeholder || ''}">${this.escapeHtml(value)}</textarea>
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
        `;
        break;

      default: // text
        inputHtml = `
          <div class="config-field-wrapper">
            <label class="config-field">
              <span class="config-field-label">${field.label}</span>
              <input type="text" id="${id}" name="${key}" value="${this.escapeHtml(value)}"
                     placeholder="${field.placeholder || ''}">
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
        `;
    }

    // Wrap with showWhen container if needed
    if (showWhenAttrs) {
      return `<div class="config-field-conditional ${isHidden ? 'hidden' : ''}" ${showWhenAttrs}>${inputHtml}</div>`;
    }

    return inputHtml;
  }

  isFieldModified(key, field, value) {
    const defaultVal = field.default;
    // Handle checkbox boolean comparison
    if (field.type === 'checkbox') {
      return Boolean(value) !== Boolean(defaultVal);
    }
    // Handle number comparison
    if (field.type === 'number') {
      return Number(value) !== Number(defaultVal);
    }
    // String comparison
    return String(value) !== String(defaultVal);
  }

  // ==================== Rule Builder Methods ====================

  /**
   * Parse raw rules text into structured format for visual editor
   */
  parseRules(text) {
    if (!text) return [];

    const lines = text.split('\n');
    const categories = [];
    let currentCategory = null;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;

      // Match category header [name] or [name -> List Name] or [name → List Name]
      const sectionMatch = line.match(/^\[([^\]]+?)(?:\s*(?:->|→)\s*(.*?))?\]$/);
      if (sectionMatch) {
        currentCategory = {
          name: sectionMatch[1].trim(),
          backingList: sectionMatch[2]?.trim() || null,
          rules: []
        };
        categories.push(currentCategory);
        continue;
      }

      if (!currentCategory) continue;

      // Match explicit allow/deny rules (including include and list types)
      const ruleMatch = line.match(/^(allow|deny)\s+(all|from|content|include|list)\s*"?([^"]*)"?$/i);
      if (ruleMatch) {
        const [, action, type, value] = ruleMatch;
        currentCategory.rules.push({
          action: action.toLowerCase(),
          type: type.toLowerCase(),
          value: value || ''
        });
        continue;
      }

      // Shortcut: $category = allow include category
      if (line.startsWith('$')) {
        currentCategory.rules.push({ action: 'allow', type: 'include', value: line.substring(1) });
        continue;
      }

      // Shortcut: &listname or &"list name" = allow list listname
      if (line.startsWith('&')) {
        const listMatch = line.match(/^&"?([^"]+)"?$/);
        if (listMatch) {
          currentCategory.rules.push({ action: 'allow', type: 'list', value: listMatch[1] });
        }
        continue;
      }

      // Shortcut: @handle = allow from @handle
      if (line.startsWith('@')) {
        currentCategory.rules.push({ action: 'allow', type: 'from', value: line });
        continue;
      }

      // Shortcut: keyword = allow content keyword
      currentCategory.rules.push({ action: 'allow', type: 'content', value: line });
    }

    return categories;
  }

  /**
   * Serialize structured rules back to text format
   */
  serializeRules(categories) {
    const lines = [];

    for (const category of categories) {
      if (lines.length > 0) lines.push(''); // Blank line between categories
      // Include backing list in header if present
      if (category.backingList) {
        lines.push(`[${category.name} -> ${category.backingList}]`);
      } else {
        lines.push(`[${category.name}]`);
      }

      for (const rule of category.rules) {
        if (rule.type === 'all') {
          lines.push(`${rule.action} all`);
        } else if (rule.action === 'deny') {
          // Always use explicit format for deny
          lines.push(`${rule.action} ${rule.type} ${rule.value}`);
        } else if (rule.type === 'include' && rule.action === 'allow') {
          // Shortcut for allow include category
          lines.push(`$${rule.value}`);
        } else if (rule.type === 'list' && rule.action === 'allow') {
          // Shortcut for allow list - use quotes if name contains spaces
          if (rule.value.includes(' ')) {
            lines.push(`&"${rule.value}"`);
          } else {
            lines.push(`&${rule.value}`);
          }
        } else if (rule.type === 'from' && rule.value.startsWith('@')) {
          // Shortcut for allow from @handle
          lines.push(rule.value);
        } else if (rule.type === 'content') {
          // Shortcut for allow content
          lines.push(rule.value);
        } else {
          // Explicit format for other cases
          lines.push(`${rule.action} ${rule.type} ${rule.value}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Render the Rules panel with sub-tabs
   */
  renderRulesPanel() {
    const rulesConfig = this.config.get('rulesConfig') ?? '';
    this.parsedRules = this.parseRules(rulesConfig);

    const ruleColorCoding = this.config.get('ruleColorCoding') ?? false;
    const autoOrganizeRules = this.config.get('autoOrganizeRules') ?? false;

    return `
      <div class="rules-panel">
        <div class="rules-options rules-options-top">
          <label class="config-checkbox-label">
            <input type="checkbox" name="ruleColorCoding" ${ruleColorCoding ? 'checked' : ''}>
            <span>Color-code rule matches</span>
            <span class="config-field-help">Color handles/avatars in feed and feed map by author rules</span>
          </label>
          <label class="config-checkbox-label">
            <input type="checkbox" name="autoOrganizeRules" ${autoOrganizeRules ? 'checked' : ''}>
            <span>Auto-organize rules</span>
            <span class="config-field-help">Automatically sort rules by type then value</span>
          </label>
        </div>
        <div class="rules-subtabs">
          <button class="rules-subtab ${this.rulesSubTab === 'visual' ? 'active' : ''}"
                  data-subtab="visual">Visual</button>
          <button class="rules-subtab ${this.rulesSubTab === 'raw' ? 'active' : ''}"
                  data-subtab="raw">Raw</button>
        </div>
        <div class="rules-content">
          <div class="rules-visual ${this.rulesSubTab === 'visual' ? 'active' : ''}">
            ${this.renderVisualEditor()}
          </div>
          <div class="rules-raw ${this.rulesSubTab === 'raw' ? 'active' : ''}">
            <textarea id="config-rulesConfig" name="rulesConfig" rows="12"
                      placeholder="Enter filter rules...">${this.escapeHtml(rulesConfig)}</textarea>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the Timeouts panel
   */
  renderTimeoutsPanel() {
    const defaultDuration = this.config.get('timeoutDefaultDuration') || '1d';
    const timeouts = state.timeouts || {};
    const activeTimeouts = Object.entries(timeouts)
      .filter(([, expiresAt]) => Date.now() < expiresAt)
      .sort((a, b) => a[1] - b[1]); // Sort by expiration time

    return `
      <div class="timeouts-panel">
        <div class="config-field">
          <label class="config-field-label">Default timeout duration</label>
          <select id="config-timeoutDefaultDuration" name="timeoutDefaultDuration" class="config-field-input">
            ${['1h', '6h', '12h', '1d', '3d', '7d', '14d', '30d'].map(d => `
              <option value="${d}" ${d === defaultDuration ? 'selected' : ''}>${this.formatDurationLabel(d)}</option>
            `).join('')}
          </select>
          <span class="config-field-help">Default duration when timing out an author (! hotkey)</span>
        </div>

        <div class="timeouts-active-section">
          <h3 class="timeouts-section-title">Active Timeouts</h3>
          ${activeTimeouts.length === 0 ? `
            <div class="timeouts-empty">
              No active timeouts. Press <kbd>!</kbd> on a post to timeout an author.
            </div>
          ` : `
            <div class="timeouts-list">
              ${activeTimeouts.map(([handle, expiresAt]) => `
                <div class="timeout-item" data-handle="${this.escapeHtml(handle)}">
                  <span class="timeout-handle">@${this.escapeHtml(handle)}</span>
                  <span class="timeout-expires">expires in ${this.formatTimeRemaining(expiresAt - Date.now())}</span>
                  <button type="button" class="timeout-clear-btn" data-handle="${this.escapeHtml(handle)}"
                          title="Remove timeout">✕</button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="timeout-clear-all-btn">Clear All Timeouts</button>
          `}
        </div>
      </div>
    `;
  }

  /**
   * Format duration string for display
   */
  formatDurationLabel(duration) {
    const labels = {
      '1h': '1 hour',
      '6h': '6 hours',
      '12h': '12 hours',
      '1d': '1 day',
      '3d': '3 days',
      '7d': '7 days',
      '14d': '14 days',
      '30d': '30 days',
    };
    return labels[duration] || duration;
  }

  /**
   * Format remaining time for display
   */
  formatTimeRemaining(ms) {
    if (ms <= 0) return 'expired';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    if (days > 0) {
      return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days} day${days > 1 ? 's' : ''}`;
    }
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    const minutes = Math.floor(ms / (1000 * 60));
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  /**
   * Refresh the Timeouts panel
   */
  refreshTimeoutsPanel() {
    const panel = this.modalEl.querySelector('[data-panel="Timeouts"]');
    if (panel) {
      panel.innerHTML = this.renderTimeoutsPanel();
      this.attachTimeoutsEventListeners();
    }
  }

  /**
   * Attach event listeners for the Timeouts panel
   */
  attachTimeoutsEventListeners() {
    const panel = this.modalEl.querySelector('.timeouts-panel');
    if (!panel) return;

    // Duration select change
    const durationSelect = panel.querySelector('#config-timeoutDefaultDuration');
    if (durationSelect) {
      durationSelect.addEventListener('change', (e) => {
        this.handleInputChange(e);
      });
    }

    // Individual timeout clear buttons
    panel.querySelectorAll('.timeout-clear-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const handle = e.target.dataset.handle;
        this.clearTimeout(handle);
      });
    });

    // Clear all button
    const clearAllBtn = panel.querySelector('.timeout-clear-all-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (confirm('Clear all active timeouts?')) {
          this.clearAllTimeouts();
        }
      });
    }
  }

  /**
   * Clear a single timeout
   */
  clearTimeout(handle) {
    // Create new timeouts object without this handle
    const { [handle]: _removed, ...remainingTimeouts } = state.timeouts || {};

    // Use updateState for proper state persistence
    state.stateManager.updateState({ timeouts: remainingTimeouts });
    state.stateManager.saveStateImmediately();
    this.refreshTimeoutsPanel();

    // Dispatch event to notify handlers to refresh filter
    window.dispatchEvent(new CustomEvent('bsky-nav-timeout-cleared', { detail: { handle } }));
  }

  /**
   * Clear all timeouts
   */
  clearAllTimeouts() {
    // Use updateState for proper state persistence
    state.stateManager.updateState({ timeouts: {} });
    state.stateManager.saveStateImmediately();
    this.refreshTimeoutsPanel();

    // Dispatch event to notify handlers to refresh filter
    window.dispatchEvent(new CustomEvent('bsky-nav-timeout-cleared', { detail: { all: true } }));
  }

  /**
   * Render the visual rule editor
   */
  renderVisualEditor() {
    if (this.parsedRules.length === 0) {
      return `
        <div class="rules-empty">
          No filter rules defined. Click "Add Category" to create one.
        </div>
        <button type="button" class="rules-add-category">+ Add Category</button>
      `;
    }

    const categoriesHtml = this.parsedRules.map((category, catIndex) => {
      const isCollapsed = this.collapsedCategories[catIndex];
      const colorIndex = this.getColorIndexForCategory(category.name);
      const color = constants.FILTER_LIST_COLORS[colorIndex];
      return `
        <div class="rules-category" draggable="true" data-category="${catIndex}">
          <div class="rules-category-header">
            <span class="rules-category-drag-handle" title="Drag to reorder">⋮⋮</span>
            <button type="button" class="rules-category-toggle ${isCollapsed ? 'collapsed' : ''}"
                    data-category="${catIndex}">
              <span class="rules-toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
            </button>
            <div class="rules-color-picker" data-category="${catIndex}">
              <button type="button" class="rules-color-swatch" style="background-color: ${color}"
                      title="Click to change color" data-category="${catIndex}"></button>
              <div class="rules-color-dropdown">
                ${constants.FILTER_LIST_COLORS.map((c, i) => `
                  <button type="button" class="rules-color-option ${i === colorIndex ? 'selected' : ''}"
                          style="background-color: ${c}" data-color-index="${i}" data-category="${catIndex}"></button>
                `).join('')}
              </div>
            </div>
            <input type="text" class="rules-category-name" value="${this.escapeHtml(category.name)}"
                   data-category="${catIndex}">
            <select class="rules-backing-list" data-category="${catIndex}"
                    title="Backing list (authors in list are automatically matched)"
                    ${!this.hasApiAccess() ? 'disabled' : ''}>
              <option value="">No backing list</option>
              ${(this.cachedListNames || []).map(name => `
                <option value="${this.escapeHtml(name)}"
                        ${category.backingList === name ? 'selected' : ''}>
                  ${this.escapeHtml(name)}
                </option>
              `).join('')}
              ${category.backingList && !(this.cachedListNames || []).includes(category.backingList) ? `
                <option value="${this.escapeHtml(category.backingList)}" selected>
                  ${this.escapeHtml(category.backingList)}
                </option>
              ` : ''}
            </select>
            <button type="button" class="rules-sync-btn" data-category="${this.escapeHtml(category.name)}"
                    title="Sync with Bluesky list" ${!this.hasApiAccess() ? 'disabled' : ''}>
              ⟳
            </button>
            <button type="button" class="rules-category-organize" data-category="${catIndex}"
                    title="Sort rules in this category">⇅</button>
            <button type="button" class="rules-category-delete" data-category="${catIndex}"
                    title="Delete category">🗑</button>
          </div>
          <div class="rules-category-body ${isCollapsed ? 'collapsed' : ''}">
            ${this.renderRuleRows(category.rules, catIndex)}
            <button type="button" class="rules-add-rule" data-category="${catIndex}">+ Add Rule</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      ${categoriesHtml}
      <button type="button" class="rules-add-category">+ Add Category</button>
    `;
  }

  /**
   * Render rule rows for a category
   */
  renderRuleRows(rules, catIndex) {
    if (rules.length === 0) {
      return `<div class="rules-empty-category">No rules in this category.</div>`;
    }

    // Get category names for include dropdown (excluding current category)
    const currentCategoryName = this.parsedRules[catIndex]?.name;
    const otherCategories = this.parsedRules
      .map(c => c.name)
      .filter(name => name !== currentCategoryName);

    return rules.map((rule, ruleIndex) => {
      // Build the value input or dropdown based on type
      let valueHtml;
      if (rule.type === 'include') {
        valueHtml = `
          <select class="rules-value rules-include-select" data-category="${catIndex}" data-rule="${ruleIndex}">
            <option value="">Select category...</option>
            ${otherCategories.map(name => `
              <option value="${this.escapeHtml(name)}" ${rule.value === name ? 'selected' : ''}>${this.escapeHtml(name)}</option>
            `).join('')}
          </select>
        `;
      } else if (rule.type === 'list') {
        // Dropdown for list selection
        // Include current value even if not in cached list (in case fetch failed)
        const listNames = this.cachedListNames || [];
        const hasCurrentValue = rule.value && !listNames.includes(rule.value);
        const currentValueOption = hasCurrentValue
          ? `<option value="${this.escapeHtml(rule.value)}" selected>${this.escapeHtml(rule.value)}</option>`
          : '';
        const listOptions = listNames.map(name => `
          <option value="${this.escapeHtml(name)}" ${rule.value === name ? 'selected' : ''}>${this.escapeHtml(name)}</option>
        `).join('');
        valueHtml = `
          <select class="rules-value rules-list-select" data-category="${catIndex}" data-rule="${ruleIndex}">
            <option value="">Select list...</option>
            ${currentValueOption}
            ${listOptions}
          </select>
        `;
      } else if (rule.type === 'all') {
        valueHtml = `<input type="text" class="rules-value" value="" disabled data-category="${catIndex}" data-rule="${ruleIndex}">`;
      } else {
        valueHtml = `
          <input type="text" class="rules-value" value="${this.escapeHtml(rule.value)}"
                 placeholder="${rule.type === 'from' ? '@handle or regex' : 'keyword or regex'}"
                 data-category="${catIndex}" data-rule="${ruleIndex}">
        `;
      }

      const unsavedClass = rule._unsaved ? ' rules-row-unsaved' : '';
      const saveButton = rule._unsaved ? `
        <button type="button" class="rules-save-rule" data-category="${catIndex}" data-rule="${ruleIndex}"
                title="Save this rule">💾</button>
      ` : '';

      return `
        <div class="rules-row${unsavedClass}" draggable="true" data-category="${catIndex}" data-rule="${ruleIndex}">
          <span class="rules-drag-handle" title="Drag to reorder">⋮⋮</span>
          <select class="rules-action" data-category="${catIndex}" data-rule="${ruleIndex}">
            <option value="allow" ${rule.action === 'allow' ? 'selected' : ''}>Allow</option>
            <option value="deny" ${rule.action === 'deny' ? 'selected' : ''}>Deny</option>
          </select>
          <select class="rules-type" data-category="${catIndex}" data-rule="${ruleIndex}">
            <option value="from" ${rule.type === 'from' ? 'selected' : ''}>From (author)</option>
            <option value="content" ${rule.type === 'content' ? 'selected' : ''}>Content (text)</option>
            <option value="include" ${rule.type === 'include' ? 'selected' : ''}>Include (category)</option>
            <option value="list" ${rule.type === 'list' ? 'selected' : ''}>List (&name)</option>
            <option value="all" ${rule.type === 'all' ? 'selected' : ''}>All</option>
          </select>
          ${valueHtml}
          ${saveButton}
          <button type="button" class="rules-delete-rule" data-category="${catIndex}" data-rule="${ruleIndex}"
                  title="Delete rule">🗑</button>
        </div>
      `;
    }).join('');
  }

  /**
   * Update raw textarea from parsed rules
   * @param {boolean} skipAutoOrganize - Skip auto-organize (used when manually organizing)
   */
  syncVisualToRaw(skipAutoOrganize = false) {
    // Auto-organize if enabled
    if (!skipAutoOrganize && this.config.get('autoOrganizeRules')) {
      this.organizeAllRules();
    }

    const rawText = this.serializeRules(this.parsedRules);
    const textarea = this.modalEl.querySelector('#config-rulesConfig');
    if (textarea) {
      textarea.value = rawText;
    }
    this.pendingChanges['rulesConfig'] = rawText;
  }

  /**
   * Re-render just the visual editor content
   */
  async refreshVisualEditor() {
    // Prevent concurrent refreshes
    if (this._refreshPending) {
      this._refreshQueued = true;
      return;
    }
    this._refreshPending = true;

    try {
      // Fetch list names on first refresh of this modal session
      if (!this._listNamesFetched) {
        this._listNamesFetched = true;
        await this.updateCachedListNames(true); // Force refresh to get latest
      }

      const visualContainer = this.modalEl.querySelector('.rules-visual');
      if (visualContainer) {
        visualContainer.innerHTML = this.renderVisualEditor();
        this.attachRulesEventListeners();
      }
    } finally {
      this._refreshPending = false;
      // Process queued refresh if any
      if (this._refreshQueued) {
        this._refreshQueued = false;
        // Use setTimeout to yield to event loop
        setTimeout(() => this.refreshVisualEditor(), 0);
      }
    }
  }

  /**
   * Update cached list names from API
   */
  async updateCachedListNames(forceRefresh = false) {
    const listCache = unsafeWindow.blueskyNavigatorState?.listCache;
    if (listCache) {
      try {
        this.cachedListNames = await listCache.getListNames(forceRefresh);
      } catch (e) {
        console.warn('Failed to fetch list names:', e);
      }
    }
  }

  /**
   * Force refresh of cached list names (call after creating/deleting lists)
   */
  async refreshListNames() {
    this.cachedListNames = null;
    await this.updateCachedListNames();
  }

  /**
   * Get the color index for a category (custom or default based on name hash)
   * @param {string} categoryName - The category name
   * @returns {number} The color index
   */
  getColorIndexForCategory(categoryName) {
    try {
      const rulesetColors = JSON.parse(this.config.get('rulesetColors') || '{}');
      if (categoryName in rulesetColors) {
        return rulesetColors[categoryName] % constants.FILTER_LIST_COLORS.length;
      }
    } catch (e) {
      // Invalid JSON, use default
    }
    // Hash the category name for a stable default color regardless of position
    let hash = 0;
    for (let i = 0; i < categoryName.length; i++) {
      hash = ((hash << 5) - hash) + categoryName.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % constants.FILTER_LIST_COLORS.length;
  }

  /**
   * Set the color index for a category
   * @param {string} categoryName - The category name
   * @param {number} colorIndex - The color index
   */
  setColorForCategory(categoryName, colorIndex) {
    try {
      const rulesetColors = JSON.parse(this.config.get('rulesetColors') || '{}');
      rulesetColors[categoryName] = colorIndex;
      this.config.set('rulesetColors', JSON.stringify(rulesetColors));
      this.pendingChanges['rulesetColors'] = JSON.stringify(rulesetColors);
    } catch (e) {
      // Invalid JSON, create new
      const rulesetColors = { [categoryName]: colorIndex };
      this.config.set('rulesetColors', JSON.stringify(rulesetColors));
      this.pendingChanges['rulesetColors'] = JSON.stringify(rulesetColors);
    }
  }

  /**
   * Organize rules in a category by type and value.
   * Type order: all, include, list, from, content
   * Within same type, sort by value alphabetically.
   * This sorting is safe because rules of different types don't overlap.
   * Unsaved rules are kept at the bottom (not sorted) until saved.
   * @param {number} catIndex - The category index
   */
  organizeRulesInCategory(catIndex) {
    const category = this.parsedRules[catIndex];
    if (!category || !category.rules) return;

    // Separate saved and unsaved rules
    const savedRules = category.rules.filter(r => !r._unsaved);
    const unsavedRules = category.rules.filter(r => r._unsaved);

    const typeOrder = { all: 0, include: 1, list: 2, from: 3, content: 4 };

    // Only sort saved rules
    savedRules.sort((a, b) => {
      // First sort by type
      const typeA = typeOrder[a.type] ?? 99;
      const typeB = typeOrder[b.type] ?? 99;
      if (typeA !== typeB) return typeA - typeB;

      // Then by action (deny before allow for same type/value)
      if (a.action !== b.action) {
        return a.action === 'deny' ? -1 : 1;
      }

      // Then by value alphabetically
      return (a.value || '').localeCompare(b.value || '', undefined, { sensitivity: 'base' });
    });

    // Combine: sorted saved rules first, then unsaved rules at the bottom
    category.rules = [...savedRules, ...unsavedRules];
  }

  /**
   * Organize all categories' rules
   */
  organizeAllRules() {
    for (let i = 0; i < this.parsedRules.length; i++) {
      this.organizeRulesInCategory(i);
    }
  }

  /**
   * Clear unsaved flags from rules in a category (or all categories if catIndex is null)
   * @param {number|null} catIndex - Category index, or null for all categories
   */
  clearUnsavedFlags(catIndex = null) {
    const categories = catIndex !== null
      ? [this.parsedRules[catIndex]]
      : this.parsedRules;

    for (const category of categories) {
      if (category && category.rules) {
        for (const rule of category.rules) {
          delete rule._unsaved;
        }
      }
    }
  }

  /**
   * Clear all unsaved flags (called on save)
   */
  clearAllUnsavedFlags() {
    this.clearUnsavedFlags(null);
  }

  /**
   * Attach event listeners for the rules panel
   */
  attachRulesEventListeners(modal = null) {
    const container = modal || this.modalEl;
    if (!container) return;

    const panel = container.querySelector('.rules-panel');
    if (!panel) return;

    // Sub-tab switching
    panel.querySelectorAll('.rules-subtab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.rulesSubTab = e.target.dataset.subtab;

        // If switching to visual, re-parse from raw
        if (this.rulesSubTab === 'visual') {
          const textarea = this.modalEl.querySelector('#config-rulesConfig');
          if (textarea) {
            this.parsedRules = this.parseRules(textarea.value);
          }
        }

        // Update sub-tab UI
        panel.querySelectorAll('.rules-subtab').forEach(t =>
          t.classList.toggle('active', t.dataset.subtab === this.rulesSubTab));
        panel.querySelector('.rules-visual').classList.toggle('active', this.rulesSubTab === 'visual');
        panel.querySelector('.rules-raw').classList.toggle('active', this.rulesSubTab === 'raw');

        if (this.rulesSubTab === 'visual') {
          this.refreshVisualEditor();
        }
      });
    });

    // Category toggle (collapse/expand)
    panel.querySelectorAll('.rules-category-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.currentTarget.dataset.category);
        this.collapsedCategories[catIndex] = !this.collapsedCategories[catIndex];
        this.refreshVisualEditor();
      });
    });

    // Color swatch click (toggle dropdown)
    panel.querySelectorAll('.rules-color-swatch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const picker = e.target.closest('.rules-color-picker');
        const dropdown = picker.querySelector('.rules-color-dropdown');
        // Close other dropdowns
        panel.querySelectorAll('.rules-color-dropdown.open').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
      });
    });

    // Color option click
    panel.querySelectorAll('.rules-color-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const colorIndex = parseInt(e.target.dataset.colorIndex);
        const categoryName = this.parsedRules[catIndex].name;
        this.setColorForCategory(categoryName, colorIndex);
        this.refreshVisualEditor();
      });
    });

    // Close color dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.rules-color-picker')) {
        panel.querySelectorAll('.rules-color-dropdown.open').forEach(d => d.classList.remove('open'));
      }
    }, { once: true });

    // Category name change
    panel.querySelectorAll('.rules-category-name').forEach(input => {
      input.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        this.parsedRules[catIndex].name = e.target.value;
        this.syncVisualToRaw();
      });
    });

    // Backing list selection
    panel.querySelectorAll('.rules-backing-list').forEach(select => {
      select.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const listName = e.target.value || null;
        this.parsedRules[catIndex].backingList = listName;
        this.syncVisualToRaw();
      });
    });

    // Category delete
    panel.querySelectorAll('.rules-category-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        if (confirm(`Delete category "${this.parsedRules[catIndex].name}" and all its rules?`)) {
          this.parsedRules.splice(catIndex, 1);
          this.syncVisualToRaw();
          this.refreshVisualEditor();
        }
      });
    });

    // Add category
    panel.querySelectorAll('.rules-add-category').forEach(btn => {
      btn.addEventListener('click', () => {
        this.parsedRules.push({ name: 'new-category', rules: [] });
        this.syncVisualToRaw();
        this.refreshVisualEditor();
      });
    });

    // Sync button click - show sync menu
    panel.querySelectorAll('.rules-sync-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const category = btn.dataset.category;
        this.showSyncMenu(btn, category);
      });
    });

    // Organize rules in category
    panel.querySelectorAll('.rules-category-organize').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        this.organizeRulesInCategory(catIndex);
        this.syncVisualToRaw();
        this.refreshVisualEditor();
      });
    });

    // Category drag and drop
    let draggedCategory = null;
    let draggedCategoryIndex = null;

    panel.querySelectorAll('.rules-category').forEach(category => {
      category.addEventListener('dragstart', (e) => {
        // Only start drag if the handle was clicked
        if (!e.target.classList.contains('rules-category') &&
            !e.target.closest('.rules-category-drag-handle')) {
          e.preventDefault();
          return;
        }
        draggedCategory = category;
        draggedCategoryIndex = parseInt(category.dataset.category);
        category.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'category');
      });

      category.addEventListener('dragend', () => {
        if (draggedCategory) {
          draggedCategory.classList.remove('dragging');
        }
        panel.querySelectorAll('.rules-category').forEach(c => c.classList.remove('drag-over'));
        draggedCategory = null;
        draggedCategoryIndex = null;
      });

      category.addEventListener('dragover', (e) => {
        // Only handle category drags, not rule drags
        if (e.dataTransfer.types.includes('text/plain') && draggedCategory) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (category !== draggedCategory) {
            category.classList.add('drag-over');
          }
        }
      });

      category.addEventListener('dragleave', () => {
        category.classList.remove('drag-over');
      });

      category.addEventListener('drop', (e) => {
        // Only handle category drops
        if (!draggedCategory) return;

        e.preventDefault();
        category.classList.remove('drag-over');

        const targetCategoryIndex = parseInt(category.dataset.category);
        if (targetCategoryIndex === draggedCategoryIndex) return;

        // Reorder categories
        const [movedCategory] = this.parsedRules.splice(draggedCategoryIndex, 1);
        this.parsedRules.splice(targetCategoryIndex, 0, movedCategory);

        this.syncVisualToRaw();
        this.refreshVisualEditor();
      });
    });

    // Add rule
    panel.querySelectorAll('.rules-add-rule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        // Clear unsaved flag from existing rules in this category
        this.clearUnsavedFlags(catIndex);
        // Add new rule marked as unsaved
        this.parsedRules[catIndex].rules.push({ action: 'allow', type: 'content', value: '', _unsaved: true });
        this.syncVisualToRaw();
        this.refreshVisualEditor();
      });
    });

    // Rule action change
    panel.querySelectorAll('.rules-action').forEach(select => {
      select.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const ruleIndex = parseInt(e.target.dataset.rule);
        this.parsedRules[catIndex].rules[ruleIndex].action = e.target.value;
        this.syncVisualToRaw();
      });
    });

    // Rule type change
    panel.querySelectorAll('.rules-type').forEach(select => {
      select.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const ruleIndex = parseInt(e.target.dataset.rule);
        const rule = this.parsedRules[catIndex].rules[ruleIndex];
        rule.type = e.target.value;
        if (rule.type === 'all') {
          rule.value = '';
        }
        this.syncVisualToRaw();
        this.refreshVisualEditor(); // Refresh to update input disabled state
      });
    });

    // Rule value change
    panel.querySelectorAll('.rules-value').forEach(input => {
      input.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const ruleIndex = parseInt(e.target.dataset.rule);
        this.parsedRules[catIndex].rules[ruleIndex].value = e.target.value;
        this.syncVisualToRaw();
      });
    });

    // Delete rule
    panel.querySelectorAll('.rules-delete-rule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const ruleIndex = parseInt(e.target.dataset.rule);
        this.parsedRules[catIndex].rules.splice(ruleIndex, 1);
        this.syncVisualToRaw();
        this.refreshVisualEditor();
      });
    });

    // Save individual rule (marks as saved and re-organizes)
    panel.querySelectorAll('.rules-save-rule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const ruleIndex = parseInt(e.target.dataset.rule);
        // Remove unsaved flag from this rule
        delete this.parsedRules[catIndex].rules[ruleIndex]._unsaved;
        // Re-organize if enabled
        if (this.config.get('autoOrganizeRules')) {
          this.organizeRulesInCategory(catIndex);
        }
        this.syncVisualToRaw(true); // Skip auto-organize since we just did it
        this.refreshVisualEditor();
      });
    });

    // List dropdown change
    panel.querySelectorAll('.rules-list-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        const ruleIndex = parseInt(e.target.dataset.rule);
        this.parsedRules[catIndex].rules[ruleIndex].value = e.target.value;
        this.syncVisualToRaw();
      });
    });

    // Drag and drop for rule reordering
    let draggedRow = null;
    let draggedCatIndex = null;
    let draggedRuleIndex = null;

    panel.querySelectorAll('.rules-row').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        draggedRow = row;
        draggedCatIndex = parseInt(row.dataset.category);
        draggedRuleIndex = parseInt(row.dataset.rule);
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ''); // Required for Firefox
      });

      row.addEventListener('dragend', () => {
        if (draggedRow) {
          draggedRow.classList.remove('dragging');
        }
        panel.querySelectorAll('.rules-row').forEach(r => r.classList.remove('drag-over'));
        draggedRow = null;
        draggedCatIndex = null;
        draggedRuleIndex = null;
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetCatIndex = parseInt(row.dataset.category);
        // Only allow drop within same category
        if (targetCatIndex === draggedCatIndex && row !== draggedRow) {
          row.classList.add('drag-over');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');

        const targetCatIndex = parseInt(row.dataset.category);
        const targetRuleIndex = parseInt(row.dataset.rule);

        // Only allow reorder within same category
        if (targetCatIndex !== draggedCatIndex || targetRuleIndex === draggedRuleIndex) {
          return;
        }

        // Reorder the rules array
        const rules = this.parsedRules[draggedCatIndex].rules;
        const [movedRule] = rules.splice(draggedRuleIndex, 1);
        rules.splice(targetRuleIndex, 0, movedRule);

        this.syncVisualToRaw();
        this.refreshVisualEditor();
      });
    });

    // Raw textarea change
    const textarea = panel.querySelector('#config-rulesConfig');
    if (textarea) {
      textarea.addEventListener('change', (e) => {
        this.pendingChanges['rulesConfig'] = e.target.value;
      });
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;

    this.modalEl.querySelectorAll('.config-tab').forEach((tab) => {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive);
    });

    this.modalEl.querySelectorAll('.config-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
    });

    // Attach event listeners for special panels
    if (tabName === 'Timeouts') {
      this.attachTimeoutsEventListeners();
    }
  }

  handleInputChange(e) {
    const { name, type, value, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    this.pendingChanges[name] = newValue;

    // Sync color inputs
    if (e.target.type === 'color') {
      const textInput = this.modalEl.querySelector(`#${e.target.id}-text`);
      if (textInput) textInput.value = value;
    }

    // Update range value display
    if (e.target.type === 'range') {
      const valueDisplay = e.target.parentElement.querySelector('.config-range-value');
      if (valueDisplay) {
        const field = this.getFieldSchema(name);
        const displayValue = field?.formatValue ? field.formatValue(value) : value;
        valueDisplay.textContent = displayValue;
      }
    }

    // Dynamic preview for feed map settings
    if (name.startsWith('feedMap')) {
      this.updateFeedMapPreview(name, newValue);
    }

    // Show/hide reset button based on whether value differs from default
    const field = this.getFieldSchema(name);
    if (field) {
      const wrapper = e.target.closest('.config-field-wrapper');
      const resetBtn = wrapper?.querySelector('.config-field-reset');
      if (resetBtn) {
        const isModified = this.isFieldModified(name, field, newValue);
        resetBtn.classList.toggle('hidden', !isModified);
      }
    }

    // Update conditional field visibility
    this.updateConditionalFields(name, newValue);
  }

  updateConditionalFields(changedKey, newValue) {
    if (!this.modalEl) return;

    // Find all fields that depend on the changed key
    const conditionalFields = this.modalEl.querySelectorAll(`[data-show-when-key="${changedKey}"]`);
    conditionalFields.forEach((field) => {
      const requiredValue = field.dataset.showWhenValue;
      // Convert newValue to string for comparison (dataset values are always strings)
      const shouldShow = String(newValue) === requiredValue;
      field.classList.toggle('hidden', !shouldShow);
    });
  }

  save() {
    // Clear unsaved flags from rules and re-organize if enabled
    this.clearAllUnsavedFlags();
    if (this.config.get('autoOrganizeRules')) {
      this.organizeAllRules();
      this.syncVisualToRaw(true); // Skip auto-organize since we just did it
    }

    // Apply all pending changes
    Object.entries(this.pendingChanges).forEach(([key, value]) => {
      this.config.set(key, value);
    });

    // Trigger save callback
    if (this.onSave) {
      this.onSave(this.pendingChanges);
    }

    this.hide();
    announceToScreenReader('Settings saved.');
  }

  resetToDefaults() {
    if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
      return;
    }

    // Reset all fields to defaults
    Object.entries(CONFIG_SCHEMA).forEach(([, schema]) => {
      Object.entries(schema.fields).forEach(([key, field]) => {
        this.config.set(key, field.default);
        this.pendingChanges[key] = field.default;
      });
    });

    // Re-render panels to show reset values
    const panelsContainer = this.modalEl.querySelector('.config-modal-panels');
    panelsContainer.innerHTML = this.renderPanels();

    // Re-attach input handlers
    this.modalEl.querySelectorAll('input, select, textarea').forEach((input) => {
      input.addEventListener('change', (e) => this.handleInputChange(e));
    });

    announceToScreenReader('Settings reset to defaults.');
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  /**
   * Checks if AT Protocol API is available
   */
  hasApiAccess() {
    return !!(unsafeWindow.blueskyNavigatorState?.listCache?.api);
  }

  /**
   * Shows the sync options menu
   */
  showSyncMenu(anchorEl, category) {
    // Remove any existing menu
    this.modalEl.querySelectorAll('.rules-sync-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'rules-sync-menu';
    menu.innerHTML = `
      <button class="sync-menu-item" data-action="push">Push to List...</button>
      <button class="sync-menu-item" data-action="pull">Pull from List...</button>
      <button class="sync-menu-item" data-action="bidirectional">Bidirectional Sync...</button>
      <hr class="sync-menu-divider">
      <button class="sync-menu-item" data-action="dedupe">Remove Duplicates...</button>
    `;

    // Position near button
    const rect = anchorEl.getBoundingClientRect();
    const modalBody = this.modalEl.querySelector('.config-modal-body');
    const modalRect = modalBody.getBoundingClientRect();

    menu.style.position = 'absolute';
    menu.style.top = `${rect.bottom - modalRect.top + 5}px`;
    menu.style.left = `${rect.left - modalRect.left}px`;

    menu.querySelectorAll('.sync-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        menu.remove();
        if (item.dataset.action === 'dedupe') {
          this.showDedupeDialog(category);
        } else {
          this.showSyncDialog(category, item.dataset.action);
        }
      });
    });

    // Close on click outside
    const closeHandler = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    modalBody.appendChild(menu);
  }

  /**
   * Shows the sync dialog for a category
   */
  async showSyncDialog(category, action) {
    const listCache = unsafeWindow.blueskyNavigatorState?.listCache;
    if (!listCache) {
      alert('AT Protocol agent not configured. Please set up your app password in settings.');
      return;
    }

    // Get available lists
    const listNames = await listCache.getListNames();

    // Get handles from this category's rules
    const categoryIndex = this.parsedRules.findIndex(c => c.name === category);
    const categoryRules = categoryIndex >= 0 ? this.parsedRules[categoryIndex].rules : [];
    const handles = categoryRules
      .filter(r => r.type === 'from' && r.value.startsWith('@'))
      .map(r => r.value.replace(/^@/, ''));

    const dialog = document.createElement('div');
    dialog.className = 'sync-dialog-overlay';

    if (action === 'push') {
      dialog.innerHTML = this.renderPushDialog(category, listNames, handles);
    } else if (action === 'pull') {
      dialog.innerHTML = this.renderPullDialog(category, listNames);
    } else {
      dialog.innerHTML = this.renderBidirectionalDialog(category, listNames, handles);
    }

    this.setupSyncDialogEvents(dialog, category, action, listCache);
    document.body.appendChild(dialog);
  }

  /**
   * Render push dialog
   */
  renderPushDialog(category, listNames, handles) {
    const listOptions = listNames.map(name =>
      `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`
    ).join('');

    return `
      <div class="sync-dialog">
        <div class="sync-dialog-header">
          <h3>Push "${this.escapeHtml(category)}" to Bluesky List</h3>
          <button class="sync-dialog-close">&times;</button>
        </div>
        <div class="sync-dialog-body">
          <div class="sync-option">
            <label>
              <input type="radio" name="listChoice" value="new" checked>
              Create new list:
            </label>
            <input type="text" class="sync-new-list-name" placeholder="List name">
          </div>
          <div class="sync-option">
            <label>
              <input type="radio" name="listChoice" value="existing">
              Existing list:
            </label>
            <select class="sync-existing-list">
              <option value="">Select a list...</option>
              ${listOptions}
            </select>
          </div>
          <div class="sync-preview">
            <strong>${handles.length}</strong> handles will be synced
          </div>
        </div>
        <div class="sync-dialog-footer">
          <button class="sync-cancel">Cancel</button>
          <button class="sync-confirm" data-action="push">Push to List</button>
        </div>
      </div>
    `;
  }

  /**
   * Render pull dialog
   */
  renderPullDialog(category, listNames) {
    const listOptions = listNames.map(name =>
      `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`
    ).join('');

    return `
      <div class="sync-dialog">
        <div class="sync-dialog-header">
          <h3>Pull from Bluesky List to "${this.escapeHtml(category)}"</h3>
          <button class="sync-dialog-close">&times;</button>
        </div>
        <div class="sync-dialog-body">
          <div class="sync-option">
            <label>Select source list:</label>
            <select class="sync-existing-list">
              <option value="">Select a list...</option>
              ${listOptions}
            </select>
          </div>
          <div class="sync-option">
            <label>
              <input type="radio" name="ruleAction" value="allow" checked> Add as: allow from @handle
            </label>
            <label>
              <input type="radio" name="ruleAction" value="deny"> Add as: deny from @handle
            </label>
          </div>
          <div class="sync-preview"></div>
        </div>
        <div class="sync-dialog-footer">
          <button class="sync-cancel">Cancel</button>
          <button class="sync-confirm" data-action="pull">Import Handles</button>
        </div>
      </div>
    `;
  }

  /**
   * Render bidirectional dialog (combines push and pull)
   */
  renderBidirectionalDialog(category, listNames, handles) {
    const listOptions = listNames.map(name =>
      `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`
    ).join('');

    return `
      <div class="sync-dialog">
        <div class="sync-dialog-header">
          <h3>Bidirectional Sync: "${this.escapeHtml(category)}"</h3>
          <button class="sync-dialog-close">&times;</button>
        </div>
        <div class="sync-dialog-body">
          <div class="sync-option">
            <label>
              <input type="radio" name="listChoice" value="new" checked>
              Create new list:
            </label>
            <input type="text" class="sync-new-list-name" placeholder="List name">
          </div>
          <div class="sync-option">
            <label>
              <input type="radio" name="listChoice" value="existing">
              Existing list:
            </label>
            <select class="sync-existing-list">
              <option value="">Select a list...</option>
              ${listOptions}
            </select>
          </div>
          <div class="sync-preview">
            <strong>${handles.length}</strong> handles will be pushed to list
          </div>
          <div class="sync-option">
            <label>Rule action for pulled handles:</label>
            <label>
              <input type="radio" name="ruleAction" value="allow" checked> Add as: allow from @handle
            </label>
            <label>
              <input type="radio" name="ruleAction" value="deny"> Add as: deny from @handle
            </label>
          </div>
        </div>
        <div class="sync-dialog-footer">
          <button class="sync-cancel">Cancel</button>
          <button class="sync-confirm" data-action="bidirectional">Sync Both Ways</button>
        </div>
      </div>
    `;
  }

  /**
   * Setup event listeners for sync dialog
   */
  setupSyncDialogEvents(dialog, category, action, listCache) {
    // Close button
    dialog.querySelector('.sync-dialog-close').addEventListener('click', () => dialog.remove());
    dialog.querySelector('.sync-cancel').addEventListener('click', () => dialog.remove());

    // Click outside to close
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    // Preview updates for pull
    if (action === 'pull' || action === 'bidirectional') {
      const select = dialog.querySelector('.sync-existing-list');
      select.addEventListener('change', async () => {
        const listName = select.value;
        if (!listName) return;

        const members = await listCache.getMembers(listName);
        const categoryIndex = this.parsedRules.findIndex(c => c.name === category);
        const existingHandles = new Set(
          (categoryIndex >= 0 ? this.parsedRules[categoryIndex].rules : [])
            .filter(r => r.type === 'from')
            .map(r => r.value.replace(/^@/, '').toLowerCase())
        );

        const newHandles = members ? [...members.keys()].filter(h => !existingHandles.has(h)) : [];
        dialog.querySelector('.sync-preview').innerHTML =
          `<strong>${newHandles.length}</strong> new handles will be added`;
      });
    }

    // Confirm button
    dialog.querySelector('.sync-confirm').addEventListener('click', async () => {
      await this.executeSyncAction(dialog, category, action, listCache);
    });
  }

  /**
   * Execute sync action (placeholder - actual logic in Task 9/10)
   */
  async executeSyncAction(dialog, category, action, listCache) {
    const confirmBtn = dialog.querySelector('.sync-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Syncing...';

    try {
      if (action === 'push') {
        await this.executePushSync(dialog, category, listCache);
      } else if (action === 'pull') {
        await this.executePullSync(dialog, category, listCache);
      } else {
        await this.executePushSync(dialog, category, listCache);
        await this.executePullSync(dialog, category, listCache);
      }

      dialog.remove();
      this.showSyncSuccess('Sync completed successfully');
    } catch (error) {
      console.error('Sync failed:', error);
      confirmBtn.disabled = false;
      confirmBtn.textContent = action === 'push' ? 'Push to List' : action === 'pull' ? 'Import Handles' : 'Sync Both Ways';
      alert(`Sync failed: ${error.message}`);
    }
  }

  /**
   * Execute push sync - pushes handles from category rules to a Bluesky list
   */
  async executePushSync(dialog, category, listCache) {
    const api = listCache.api;
    const isNewList = dialog.querySelector('input[name="listChoice"][value="new"]').checked;

    let listUri;
    let listName;

    let existingDids = new Set();

    if (isNewList) {
      listName = dialog.querySelector('.sync-new-list-name').value.trim();
      if (!listName) throw new Error('Please enter a list name');
      listUri = await api.createList(listName);
      // Store list name on dialog for bidirectional sync
      dialog.dataset.createdListName = listName;
      dialog.dataset.createdListUri = listUri;
      // Invalidate cache so the new list appears
      listCache.invalidate();
      // Also clear local cached list names so dropdown refreshes
      this.cachedListNames = null;
      // New list is empty, no need to fetch members
    } else {
      listName = dialog.querySelector('.sync-existing-list').value;
      if (!listName) throw new Error('Please select a list');
      listUri = await listCache.getListUri(listName);
      if (!listUri) throw new Error(`List "${listName}" not found. Try refreshing the page.`);
      // Get existing list members for existing lists
      const existingMembers = await api.getListMembers(listUri);
      existingDids = new Set(existingMembers.map(m => m.did));
    }

    // Get handles from rules
    const categoryIndex = this.parsedRules.findIndex(c => c.name === category);
    const categoryRules = categoryIndex >= 0 ? this.parsedRules[categoryIndex].rules : [];
    const handles = categoryRules
      .filter(r => r.type === 'from' && r.value.startsWith('@'))
      .map(r => r.value.replace(/^@/, ''));

    // Get progress element for updates
    const progressEl = dialog.querySelector('.sync-progress');
    const updateProgress = (current, total, status) => {
      if (progressEl) {
        progressEl.textContent = `${status} (${current}/${total})`;
      }
    };

    // Add each handle to list if not already present
    let added = 0;
    let processed = 0;
    const total = handles.length;

    for (const handle of handles) {
      processed++;
      updateProgress(processed, total, `Resolving ${handle}...`);

      // Rate limit: delay every 5 handles to prevent API throttling
      if (processed % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const did = await api.resolveHandleToDid(handle);
      if (did && !existingDids.has(did)) {
        updateProgress(processed, total, `Adding ${handle}...`);
        await api.addToList(listUri, did);
        added++;
      }
    }

    // Invalidate cache
    listCache.invalidate(listName);
  }

  /**
   * Execute pull sync - imports list members as rules
   */
  async executePullSync(dialog, category, listCache) {
    // For bidirectional sync with newly created list, use the stored name
    let listName = dialog.dataset.createdListName || dialog.querySelector('.sync-existing-list').value;
    if (!listName) throw new Error('Please select a list');

    const ruleAction = dialog.querySelector('input[name="ruleAction"]:checked')?.value || 'allow';

    // Get list members
    const members = await listCache.getMembers(listName);
    if (!members || members.size === 0) {
      throw new Error('List is empty or could not be fetched');
    }

    // Get existing handles in category using findIndex pattern
    let categoryIndex = this.parsedRules.findIndex(c => c.name === category);
    const categoryRules = categoryIndex >= 0 ? this.parsedRules[categoryIndex].rules : [];
    const existingHandles = new Set(
      categoryRules
        .filter(r => r.type === 'from')
        .map(r => {
          let handle = r.value.replace(/^@/, '').toLowerCase();
          // Add .bsky.social suffix for short handles without a domain
          if (!handle.includes('.')) {
            handle = `${handle}.bsky.social`;
          }
          return handle;
        })
    );

    // Add new handles to rules
    let added = 0;
    for (const handle of members.keys()) {
      if (!existingHandles.has(handle.toLowerCase())) {
        // Create category if it doesn't exist
        if (categoryIndex === -1) {
          this.parsedRules.push({ name: category, rules: [] });
          categoryIndex = this.parsedRules.length - 1;
        }

        // Now always push to the correct category
        this.parsedRules[categoryIndex].rules.push({
          action: ruleAction,
          type: 'from',
          value: `@${handle}`,
        });
        added++;
      }
    }

    // Update UI and save immediately (both local config and remote state)
    this.syncVisualToRaw();
    const newRulesConfig = this.pendingChanges['rulesConfig'];
    this.config.set('rulesConfig', newRulesConfig);
    // Also update state.rulesConfig so remote sync doesn't overwrite on reload
    if (unsafeWindow.blueskyNavigatorState) {
      unsafeWindow.blueskyNavigatorState.rulesConfig = newRulesConfig;
    }
    this.refreshVisualEditor();
  }

  /**
   * Show sync success toast
   */
  showSyncSuccess(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'sync-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('sync-toast-hiding');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Show deduplication dialog for a category
   */
  async showDedupeDialog(category) {
    const listCache = unsafeWindow.blueskyNavigatorState?.listCache;
    if (!listCache) {
      alert('AT Protocol agent not configured. Please set up your app password in settings.');
      return;
    }

    // Find duplicate handles
    const duplicates = await this.findDuplicateHandles(category, listCache);

    const dialog = document.createElement('div');
    dialog.className = 'sync-dialog-overlay';
    dialog.innerHTML = this.renderDedupeDialog(category, duplicates);

    // Setup events
    dialog.querySelector('.sync-dialog-close').addEventListener('click', () => dialog.remove());
    dialog.querySelector('.sync-cancel').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    const confirmBtn = dialog.querySelector('.sync-confirm');
    if (duplicates.length === 0) {
      confirmBtn.disabled = true;
    } else {
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Removing...';
        try {
          await this.executeDeduplication(category, duplicates);
          dialog.remove();
          this.showSyncSuccess(`Removed ${duplicates.length} duplicate rule(s)`);
        } catch (error) {
          console.error('Deduplication failed:', error);
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Remove Duplicates';
          alert(`Deduplication failed: ${error.message}`);
        }
      });
    }

    document.body.appendChild(dialog);
  }

  /**
   * Find handles in a category that are duplicated in list rules
   * @param {string} category - Category name
   * @param {object} listCache - ListCache instance
   * @returns {Promise<Array>} Array of {handle, listName, action, ruleIndex}
   */
  async findDuplicateHandles(category, listCache) {
    const categoryIndex = this.parsedRules.findIndex(c => c.name === category);
    if (categoryIndex < 0) return [];

    const categoryRules = this.parsedRules[categoryIndex].rules;
    const duplicates = [];

    // Find all list rules in this category and collect their members
    const listMembers = new Map(); // Map<listName, {members: Set<handle>, action: string}>

    for (const rule of categoryRules) {
      if (rule.type === 'list') {
        const listName = rule.value;
        const members = await listCache.getMembers(listName);
        if (members && members.size > 0) {
          listMembers.set(listName, {
            members: new Set(members.keys()), // keys are already lowercase
            action: rule.action
          });
        }
      }
    }

    // If no list rules, no duplicates possible
    if (listMembers.size === 0) return [];

    // Check each @handle rule against list members
    categoryRules.forEach((rule, ruleIndex) => {
      if (rule.type === 'from' && rule.value.startsWith('@')) {
        let handle = rule.value.replace(/^@/, '').toLowerCase();
        // Add .bsky.social suffix for short handles without a domain
        if (!handle.includes('.')) {
          handle = `${handle}.bsky.social`;
        }

        // Check if this handle is in any list with matching action
        for (const [listName, listInfo] of listMembers) {
          if (listInfo.members.has(handle) && listInfo.action === rule.action) {
            duplicates.push({
              handle: rule.value,
              listName,
              action: rule.action,
              ruleIndex
            });
            break; // Only report first matching list
          }
        }
      }
    });

    return duplicates;
  }

  /**
   * Render deduplication dialog
   */
  renderDedupeDialog(category, duplicates) {
    let content;
    if (duplicates.length === 0) {
      content = `
        <p>No duplicate handles found in "${this.escapeHtml(category)}".</p>
        <p class="sync-dialog-hint">Duplicates are @handle rules where the handle is already included in a list rule with the same action (allow/deny).</p>
      `;
    } else {
      const duplicatesList = duplicates.map(d => `
        <div class="dedupe-item">
          <span class="dedupe-handle">${this.escapeHtml(d.handle)}</span>
          <span class="dedupe-info">→ in list "${this.escapeHtml(d.listName)}" (${d.action})</span>
        </div>
      `).join('');

      content = `
        <p>Found <strong>${duplicates.length}</strong> handle rule(s) that are already covered by list rules:</p>
        <div class="dedupe-list">${duplicatesList}</div>
        <p class="sync-dialog-hint">These individual @handle rules can be removed since they're already included in the referenced lists.</p>
      `;
    }

    return `
      <div class="sync-dialog">
        <div class="sync-dialog-header">
          <h3>Remove Duplicates: "${this.escapeHtml(category)}"</h3>
          <button class="sync-dialog-close">&times;</button>
        </div>
        <div class="sync-dialog-body">
          ${content}
        </div>
        <div class="sync-dialog-footer">
          <button class="sync-cancel">Cancel</button>
          <button class="sync-confirm" data-action="dedupe">${duplicates.length > 0 ? 'Remove Duplicates' : 'OK'}</button>
        </div>
      </div>
    `;
  }

  /**
   * Execute deduplication - remove duplicate handle rules
   */
  async executeDeduplication(category, duplicates) {
    const categoryIndex = this.parsedRules.findIndex(c => c.name === category);
    if (categoryIndex < 0) return;

    // Sort by ruleIndex descending so we can remove from end first
    const sortedDuplicates = [...duplicates].sort((a, b) => b.ruleIndex - a.ruleIndex);

    // Remove each duplicate rule
    for (const dup of sortedDuplicates) {
      this.parsedRules[categoryIndex].rules.splice(dup.ruleIndex, 1);
    }

    // Update UI and save immediately (both local config and remote state)
    this.syncVisualToRaw();
    const newRulesConfig = this.pendingChanges['rulesConfig'];
    this.config.set('rulesConfig', newRulesConfig);
    // Also update state.rulesConfig so remote sync doesn't overwrite on reload
    if (unsafeWindow.blueskyNavigatorState) {
      unsafeWindow.blueskyNavigatorState.rulesConfig = newRulesConfig;
    }
    this.refreshVisualEditor();
  }

  /**
   * Update feed map preview dynamically when settings change
   */
  updateFeedMapPreview(name, value) {
    const wrapper = document.querySelector('.feed-map-wrapper');
    const container = document.querySelector('.feed-map-container');
    const target = wrapper || container;

    switch (name) {
      case 'feedMapScale': {
        const scaleValue = parseInt(value, 10) / 100;
        if (target) {
          // Set CSS variable - heights are calculated in CSS using calc()
          target.style.setProperty('--indicator-scale', scaleValue);
        }
        break;
      }

      case 'feedMapStyle': {
        // Toggle class on wrapper - CSS handles visibility of zoom elements
        const wrapper = document.querySelector('.feed-map-wrapper');
        if (wrapper) {
          wrapper.classList.remove('feed-map-basic', 'feed-map-advanced');
          wrapper.classList.add(value === 'Advanced' ? 'feed-map-advanced' : 'feed-map-basic');
        }
        // Dispatch event for handler to update indicator
        document.dispatchEvent(new CustomEvent('feedMapSettingChanged', {
          detail: { setting: name, value }
        }));
        break;
      }

      case 'feedMapTheme': {
        // Toggle theme class on wrapper
        const wrapper = document.querySelector('.feed-map-wrapper');
        if (wrapper) {
          // Remove all theme classes
          wrapper.classList.remove('feed-map-theme-ocean', 'feed-map-theme-campfire',
            'feed-map-theme-forest', 'feed-map-theme-monochrome');
          wrapper.classList.add(`feed-map-theme-${value.toLowerCase()}`);
        }
        // Dispatch event for handler to update indicator
        document.dispatchEvent(new CustomEvent('feedMapSettingChanged', {
          detail: { setting: name, value }
        }));
        break;
      }

      case 'feedMapHeatmap':
      case 'feedMapZoom':
        // Dispatch event for handler to update indicator
        document.dispatchEvent(new CustomEvent('feedMapSettingChanged', {
          detail: { setting: name, value }
        }));
        break;

      case 'feedMapIcons':
      case 'feedMapAvatars':
      case 'feedMapAvatarScale':
      case 'feedMapTimestamps':
      case 'feedMapHandles':
      case 'ruleColorCoding':
        // Dispatch event for handler to update indicator
        document.dispatchEvent(new CustomEvent('feedMapSettingChanged', {
          detail: { setting: name, value }
        }));
        break;

      case 'feedMapPosition':
        // Move indicator to new position dynamically
        document.dispatchEvent(new CustomEvent('feedMapSettingChanged', {
          detail: { setting: name, value }
        }));
        break;
    }
  }
}

// Export schema for config initialization
export { CONFIG_SCHEMA, HIDDEN_FIELDS };
