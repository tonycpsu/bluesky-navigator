// ConfigModal.js - Custom configuration modal with tabbed interface

import { announceToScreenReader, getAnimationDuration } from '../utils.js';
import constants from '../constants.js';

/**
 * Configuration schema organized by tabs
 */
const CONFIG_SCHEMA = {
  Display: {
    icon: '🖥️',
    fields: {
      postWidthDesktop: {
        label: 'Post width (px)',
        type: 'number',
        default: 600,
        min: 400,
        max: 1200,
        help: 'Maximum width of posts in the feed',
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
      scrollIndicatorPosition: {
        label: 'Scroll indicator',
        type: 'select',
        options: ['Top toolbar', 'Bottom status bar', 'Hidden'],
        default: 'Bottom status bar',
        help: 'Where to show the scroll progress indicator',
      },
    },
  },
  'Threads & Sidecar': {
    icon: '💬',
    fields: {
      showReplyContext: {
        label: 'Show reply context',
        type: 'checkbox',
        default: false,
        help: 'Show parent post even if previously read',
      },
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
        default: 'outline: var(--focus-ring-width, 2px) var(--focus-ring-color, #0066cc) solid !important;',
        help: 'CSS for the currently selected post',
      },
      selectionChildFocused: {
        label: 'Child focused',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) color-mix(in srgb, var(--focus-ring-color, #0066cc) 40%, transparent) solid !important;',
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
        default: 'outline: 1px var(--focus-ring-color, #0066cc) solid !important;',
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
    },
  },
};

// Hidden fields that need to be preserved but not shown in UI
const HIDDEN_FIELDS = {
  savedSearches: { default: '[]' },
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
          ${name === 'Rules' ? this.renderRulesPanel() : this.renderFields(schema.fields)}
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

    let inputHtml = '';

    switch (field.type) {
      case 'checkbox':
        inputHtml = `
          <div class="config-field-wrapper config-field-checkbox">
            <label class="config-field">
              <input type="checkbox" id="${id}" name="${key}" ${value ? 'checked' : ''}>
              <span class="config-checkbox-label">${field.label}</span>
              ${field.help ? `<span class="config-field-help">${field.help}</span>` : ''}
            </label>
            ${resetBtn}
          </div>
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

      // Match category header [name]
      const sectionMatch = line.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        currentCategory = { name: sectionMatch[1], rules: [] };
        categories.push(currentCategory);
        continue;
      }

      if (!currentCategory) continue;

      // Match explicit allow/deny rules
      const ruleMatch = line.match(/^(allow|deny)\s+(all|from|content)\s*"?([^"]*)"?$/i);
      if (ruleMatch) {
        const [, action, type, value] = ruleMatch;
        currentCategory.rules.push({
          action: action.toLowerCase(),
          type: type.toLowerCase(),
          value: value || ''
        });
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
      lines.push(`[${category.name}]`);

      for (const rule of category.rules) {
        if (rule.type === 'all') {
          lines.push(`${rule.action} all`);
        } else if (rule.action === 'deny') {
          // Always use explicit format for deny
          lines.push(`${rule.action} ${rule.type} ${rule.value}`);
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

    return `
      <div class="rules-panel">
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
      return `
        <div class="rules-category" data-category="${catIndex}">
          <div class="rules-category-header">
            <button type="button" class="rules-category-toggle ${isCollapsed ? 'collapsed' : ''}"
                    data-category="${catIndex}">
              <span class="rules-toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
            </button>
            <input type="text" class="rules-category-name" value="${this.escapeHtml(category.name)}"
                   data-category="${catIndex}">
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

    return rules.map((rule, ruleIndex) => `
      <div class="rules-row" data-category="${catIndex}" data-rule="${ruleIndex}">
        <select class="rules-action" data-category="${catIndex}" data-rule="${ruleIndex}">
          <option value="allow" ${rule.action === 'allow' ? 'selected' : ''}>Allow</option>
          <option value="deny" ${rule.action === 'deny' ? 'selected' : ''}>Deny</option>
        </select>
        <select class="rules-type" data-category="${catIndex}" data-rule="${ruleIndex}">
          <option value="from" ${rule.type === 'from' ? 'selected' : ''}>From (author)</option>
          <option value="content" ${rule.type === 'content' ? 'selected' : ''}>Content (text)</option>
          <option value="all" ${rule.type === 'all' ? 'selected' : ''}>All</option>
        </select>
        <input type="text" class="rules-value" value="${this.escapeHtml(rule.value)}"
               placeholder="${rule.type === 'from' ? '@handle or regex' : rule.type === 'content' ? 'keyword or regex' : ''}"
               ${rule.type === 'all' ? 'disabled' : ''}
               data-category="${catIndex}" data-rule="${ruleIndex}">
        <button type="button" class="rules-delete-rule" data-category="${catIndex}" data-rule="${ruleIndex}"
                title="Delete rule">🗑</button>
      </div>
    `).join('');
  }

  /**
   * Update raw textarea from parsed rules
   */
  syncVisualToRaw() {
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
  refreshVisualEditor() {
    const visualContainer = this.modalEl.querySelector('.rules-visual');
    if (visualContainer) {
      visualContainer.innerHTML = this.renderVisualEditor();
      this.attachRulesEventListeners();
    }
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

    // Category name change
    panel.querySelectorAll('.rules-category-name').forEach(input => {
      input.addEventListener('change', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        this.parsedRules[catIndex].name = e.target.value;
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

    // Add rule
    panel.querySelectorAll('.rules-add-rule').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catIndex = parseInt(e.target.dataset.category);
        this.parsedRules[catIndex].rules.push({ action: 'allow', type: 'content', value: '' });
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
  }

  save() {
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
}

// Export schema for config initialization
export { CONFIG_SCHEMA, HIDDEN_FIELDS };
