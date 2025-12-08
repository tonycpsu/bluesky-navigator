// ConfigWrapper.js - Config management using GM_setValue/GM_getValue with custom modal UI

import { ConfigModal, CONFIG_SCHEMA, HIDDEN_FIELDS } from './components/ConfigModal.js';

const STORAGE_KEY = 'bluesky_navigator_config';
const OLD_GM_CONFIG_KEY = 'GM_config'; // Legacy key for migration from old versions

/**
 * Config wrapper that manages settings storage and provides ConfigModal UI
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

    // Migrate from legacy storage if needed
    this.migrateFromLegacyStorage();

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
   * Migrate settings from legacy storage format
   * Old versions stored values under 'GM_config' key
   * Migration only runs once - tracked via _migrationComplete flag
   */
  migrateFromLegacyStorage() {
    try {
      // Check if migration was already completed
      const existingNew = GM_getValue(STORAGE_KEY, null);
      let newValues = {};
      if (existingNew !== null) {
        newValues = typeof existingNew === 'string' ? JSON.parse(existingNew) : existingNew;
        // If migration was already done, skip
        if (newValues._migrationComplete) {
          return;
        }
      }

      // Check for legacy config data
      const oldData = GM_getValue(OLD_GM_CONFIG_KEY, null);
      if (oldData === null) {
        // No old config found, mark migration as complete anyway
        newValues._migrationComplete = true;
        GM_setValue(STORAGE_KEY, JSON.stringify(newValues));
        return;
      }

      // Parse old data
      let oldValues;
      if (typeof oldData === 'string') {
        oldValues = JSON.parse(oldData);
      } else if (typeof oldData === 'object') {
        oldValues = oldData;
      } else {
        console.warn('[ConfigWrapper] Old config data is in unexpected format:', typeof oldData);
        newValues._migrationComplete = true;
        GM_setValue(STORAGE_KEY, JSON.stringify(newValues));
        return;
      }

      // Validate we have actual settings
      if (!oldValues || Object.keys(oldValues).length === 0) {
        newValues._migrationComplete = true;
        GM_setValue(STORAGE_KEY, JSON.stringify(newValues));
        return;
      }

      // Merge old values into new (old values take precedence for migration)
      const merged = { ...newValues, ...oldValues, _migrationComplete: true };
      GM_setValue(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.error('[ConfigWrapper] Failed to migrate old config:', e);
    }
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

  /**
   * Clear new config storage for testing migration (call from console)
   * Usage: config.clearNewConfig() then refresh
   */
  clearNewConfig() {
    GM_setValue(STORAGE_KEY, null);
  }

  /**
   * Debug: show what's in storage
   * Usage: config.debugStorage()
   */
  debugStorage() {
    const oldData = GM_getValue(OLD_GM_CONFIG_KEY, null);
    const newData = GM_getValue(STORAGE_KEY, null);
    return { legacy: oldData, current: newData };
  }

  /**
   * Force migration from legacy storage (can be called manually from console)
   * Usage: config.forceMigrateLegacy()
   */
  forceMigrateLegacy() {
    try {
      const oldData = GM_getValue(OLD_GM_CONFIG_KEY, null);
      if (oldData === null) {
        return false;
      }

      let oldValues;
      if (typeof oldData === 'string') {
        oldValues = JSON.parse(oldData);
      } else if (typeof oldData === 'object') {
        oldValues = oldData;
      } else {
        return false;
      }

      if (!oldValues || Object.keys(oldValues).length === 0) {
        return false;
      }

      // Merge old values into current values and mark migration complete
      this.values = { ...this.values, ...oldValues, _migrationComplete: true };
      this.save();

      return true;
    } catch (e) {
      console.error('[ConfigWrapper] Failed to force migrate:', e);
      return false;
    }
  }

  /**
   * Reset migration flag to allow re-migration (call from console)
   * Usage: config.resetMigrationFlag() then refresh
   */
  resetMigrationFlag() {
    delete this.values._migrationComplete;
    this.save();
  }
}
