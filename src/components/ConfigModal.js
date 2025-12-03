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
      },
      postActionButtonPosition: {
        label: 'Action buttons',
        type: 'select',
        options: ['Bottom', 'Left'],
        default: 'Bottom',
      },
      postTimestampFormat: {
        label: 'Timestamp format',
        type: 'text',
        default: "'$age' '('yyyy-MM-dd hh:mmaaa')'",
        placeholder: 'date-fns format string',
      },
      postTimestampFormatMobile: {
        label: 'Timestamp (mobile)',
        type: 'text',
        default: "'$age'",
      },
      videoPreviewPlayback: {
        label: 'Video playback',
        type: 'select',
        options: ['Play all', 'Play selected', 'Pause all'],
        default: 'Play all',
      },
      videoDisableLoop: {
        label: 'Disable video loop',
        type: 'checkbox',
        default: false,
      },
      hideRightSidebar: {
        label: 'Hide right sidebar',
        type: 'checkbox',
        default: false,
      },
      hideLoadNewButton: {
        label: 'Hide "Load New" button',
        type: 'checkbox',
        default: false,
      },
      showPostCounts: {
        label: 'Show post counts',
        type: 'select',
        options: ['All', 'Selection', 'None'],
        default: 'All',
      },
      enableSmoothScrolling: {
        label: 'Smooth scrolling',
        type: 'checkbox',
        default: false,
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
      },
      sidecarReplySortOrder: {
        label: 'Sidecar sort order',
        type: 'select',
        options: ['Default', 'Oldest First', 'Newest First', 'Most Liked First', 'Most Reposted First'],
        default: 'Default',
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
      },
      focusRingWidth: {
        label: 'Focus ring width (px)',
        type: 'number',
        default: 2,
        min: 1,
        max: 5,
      },
      threadIndicatorWidth: {
        label: 'Thread indicator width (px)',
        type: 'number',
        default: 4,
        min: 1,
        max: 10,
      },
      threadIndicatorColor: {
        label: 'Thread indicator color',
        type: 'text',
        default: 'rgb(212, 219, 226)',
      },
      threadMargin: {
        label: 'Thread margin',
        type: 'text',
        default: '10px',
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
      },
      unreadPosts: {
        label: 'Unread posts',
        type: 'css',
        default: 'opacity: 100% !important;',
      },
      unreadPostsLightMode: {
        label: 'Unread (light)',
        type: 'css',
        default: 'background-color: white;',
      },
      unreadPostsDarkMode: {
        label: 'Unread (dark)',
        type: 'css',
        default: 'background-color: #202020;',
      },
      readPosts: {
        label: 'Read posts',
        type: 'css',
        default: 'opacity: 75% !important;',
      },
      readPostsLightMode: {
        label: 'Read (light)',
        type: 'css',
        default: 'background-color: #f0f0f0;',
      },
      readPostsDarkMode: {
        label: 'Read (dark)',
        type: 'css',
        default: 'background-color: black;',
      },
      selectionActive: {
        label: 'Selected post',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) var(--focus-ring-color, #0066cc) solid !important;',
      },
      selectionChildFocused: {
        label: 'Child focused',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) color-mix(in srgb, var(--focus-ring-color, #0066cc) 40%, transparent) solid !important;',
      },
      selectionInactive: {
        label: 'Unselected post',
        type: 'css',
        default: 'outline: var(--focus-ring-width, 2px) solid transparent;',
      },
      replySelectionActive: {
        label: 'Selected reply',
        type: 'css',
        default: 'outline: 1px var(--focus-ring-color, #0066cc) solid !important;',
      },
      replySelectionInactive: {
        label: 'Unselected reply',
        type: 'css',
        default: 'outline: 1px rgb(212, 219, 226) solid',
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
      },
      atprotoIdentifier: {
        label: 'Handle',
        type: 'text',
        default: '',
        placeholder: 'your.handle',
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
      },
      stateSyncConfig: {
        label: 'Sync config (JSON)',
        type: 'textarea',
        default: '',
        rows: 4,
      },
      stateSyncTimeout: {
        label: 'Sync timeout (ms)',
        type: 'number',
        default: 5000,
        min: 1000,
        max: 60000,
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
      },
      highContrastMode: {
        label: 'High contrast',
        type: 'checkbox',
        default: false,
      },
      enableSwipeGestures: {
        label: 'Swipe gestures (mobile)',
        type: 'checkbox',
        default: true,
      },
      markReadOnScroll: {
        label: 'Mark read on scroll',
        type: 'checkbox',
        default: false,
      },
      disableLoadMoreOnScroll: {
        label: 'Disable auto-load on scroll',
        type: 'checkbox',
        default: false,
      },
      savePostState: {
        label: 'Save post state',
        type: 'checkbox',
        default: false,
      },
      stateSaveTimeout: {
        label: 'State save timeout (ms)',
        type: 'number',
        default: 1000,
        min: 100,
        max: 10000,
      },
      historyMax: {
        label: 'History max size',
        type: 'number',
        default: constants.DEFAULT_HISTORY_MAX,
        min: 100,
        max: 100000,
      },
      showDebuggingInfo: {
        label: 'Debug mode',
        type: 'checkbox',
        default: false,
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
          ${this.renderFields(schema.fields)}
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
