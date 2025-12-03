// ConfigWrapper.js - Wrapper that provides GM_config-compatible API using GM_setValue/GM_getValue

import { ConfigModal, CONFIG_SCHEMA, HIDDEN_FIELDS } from './components/ConfigModal.js';

const STORAGE_KEY = 'bluesky_navigator_config';

/**
 * Config wrapper that mimics GM_config API but uses our custom ConfigModal
 */
export class ConfigWrapper {
  constructor(options = {}) {
    this.id = options.id || 'config';
    this.onSave = options.onSave || null;
    this.onInit = options.onInit || null;
    this.values = {};
    this.defaults = {};
    this.modal = null;

    // Build defaults from schema
    this.buildDefaults();

    // Load saved values
    this.load();

    // Initialize modal (deferred to allow config variable to be assigned first)
    this.modal = null;

    // Defer init callback to next tick so config variable is assigned
    setTimeout(() => {
      this.modal = new ConfigModal(this, (changes) => {
        if (this.onSave) {
          this.onSave(changes);
        }
      });

      if (this.onInit) {
        this.onInit();
      }
    }, 0);
  }

  /**
   * Build default values from CONFIG_SCHEMA
   */
  buildDefaults() {
    // From visible schema
    Object.entries(CONFIG_SCHEMA).forEach(([, tab]) => {
      Object.entries(tab.fields).forEach(([key, field]) => {
        this.defaults[key] = field.default;
      });
    });

    // From hidden fields
    Object.entries(HIDDEN_FIELDS).forEach(([key, field]) => {
      this.defaults[key] = field.default;
    });
  }

  /**
   * Load config from GM_getValue
   */
  load() {
    try {
      const stored = GM_getValue(STORAGE_KEY, '{}');
      const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
      this.values = { ...this.defaults, ...parsed };
    } catch (e) {
      console.error('Failed to load config:', e);
      this.values = { ...this.defaults };
    }
  }

  /**
   * Save config to GM_setValue
   */
  save() {
    try {
      GM_setValue(STORAGE_KEY, JSON.stringify(this.values));
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  }

  /**
   * Get a config value
   */
  get(key) {
    if (key in this.values) {
      return this.values[key];
    }
    if (key in this.defaults) {
      return this.defaults[key];
    }
    return undefined;
  }

  /**
   * Set a config value
   */
  set(key, value) {
    this.values[key] = value;
    this.save();
  }

  /**
   * Open the config modal
   */
  open() {
    if (this.modal) {
      this.modal.show();
    } else {
      // Modal not ready yet, create it now
      this.modal = new ConfigModal(this, (changes) => {
        if (this.onSave) {
          this.onSave(changes);
        }
      });
      this.modal.show();
    }
  }

  /**
   * Close the config modal
   */
  close() {
    if (this.modal) {
      this.modal.hide();
    }
  }

  /**
   * Reset all values to defaults
   */
  reset() {
    this.values = { ...this.defaults };
    this.save();
  }
}
