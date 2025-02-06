// StateManager.js

const DEFAULT_HISTORY_MAX = 5000

export class StateManager {
  constructor(key, defaultState = {}, config = {}) {
    this.key = key;
    this.config = config;
    if(!this.config) {
      debugger;
    }
    this.listeners = [];
    this.debounceTimeout = null;
    this.maxEntries = this.config.maxEntries || DEFAULT_HISTORY_MAX;
    this.state = {};
    this.isLocalStateDirty = false; // Tracks whether local state has changed
    this.localSaveTimeout = null; // Timer for local state save
    this.remoteSyncTimeout = null; // Timer for remote state sync
    this.handleBlockListResponse = this.handleBlockListResponse.bind(this);
    this.saveStateImmediately = this.saveStateImmediately.bind(this);
    window.addEventListener("beforeunload", () => this.saveStateImmediately());
  }

  static async create(key, defaultState = {}, config = {}) {
    const instance = new StateManager(key, defaultState, config);
    await instance.initializeState(defaultState);
    return instance;
  }

  async initializeState(defaultState) {
    this.state = await this.loadState(defaultState);
    this.ensureBlockState();
    this.updateBlockList();
  }

  ensureBlockState() {
    if (!this.state.blocks) {
      this.state.blocks = {
        all: { updated: null, handles: [] },
        recent: { updated: null, handles: [] },
      };
    }
  }

  setSyncStatus(status, title) {
    const overlay = $(".preferences-icon-overlay")
    if(!overlay) {
      console.log("no overlay")
      return
    }
    $(overlay).attr("title", `sync: ${status} ${title || ''}`)
    for (const s of ["ready", "pending", "success", "failure"]) {
      $(overlay).removeClass(`preferences-icon-overlay-sync-${s}`)
    }

    $(overlay).addClass(`preferences-icon-overlay-sync-${status}`)
    if (status == "success") {
      setTimeout( () => this.setSyncStatus("ready"), 3000);
    }
  }

  /**
   * Executes a query against the remote database.
   * @param {string} query - The query string to execute.
   * @param {string} successStatus - The status to set on successful execution (e.g., "success").
   * @returns {Promise<Object>} - Resolves with the parsed result of the query.
   */
  async executeRemoteQuery(query, successStatus = "success") {
    const { url, namespace = "bluesky_navigator", database = "state", username, password } = JSON.parse(this.config.stateSyncConfig);

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${url.replace(/\/$/, "")}/sql`,
        headers: {
          "Accept": "application/json",
          "Authorization": "Basic " + btoa(`${username}:${password}`)
        },
        data: `USE NS ${namespace} DB ${database}; ${query}`,
        onload: (response) => {
          try {
            if (response.status !== 200) {
              throw new Error(response.statusText);
            }
            const result = JSON.parse(response.responseText)[1]?.result[0];
            this.setSyncStatus(successStatus);
            resolve(result);
          } catch (error) {
            console.error("Error executing query:", error.message);
            this.setSyncStatus("failure", error.message);
            reject(error);
          }
        },
        onerror: (error) => {
          console.error("Network error executing query:", error.message);
          this.setSyncStatus("failure", error.message);
          reject(error);
        }
      });
    });
  }

  async getRemoteStateUpdated() {
    const sinceResult = await this.executeRemoteQuery(`SELECT lastUpdated FROM state:current;`)
    const lastUpdated = sinceResult["lastUpdated"]
    return sinceResult["lastUpdated"]
  }

  /**
   * Loads state from storage or initializes with the default state.
   */
  async loadState(defaultState) {
    try {
      const savedState = JSON.parse(GM_getValue(this.key, "{}"));

      if (this.config.stateSyncEnabled) {
        const remoteState = await this.loadRemoteState(this.state.lastUpdated);
        // console.dir(remoteState);
        return remoteState ? { ...defaultState, ...remoteState } :  { ...defaultState, ...savedState };
      } else {
        return { ...defaultState, ...savedState };
      }

    } catch (error) {
      console.error("Error loading state, using defaults:", error);
      return defaultState;
    }
  }

  async loadRemoteState(since) {
    // const query = `SELECT * FROM state:current;`;

    try {
      console.log("Loading remote state...");
      this.setSyncStatus("pending");
      const lastUpdated = await this.getRemoteStateUpdated()
      if (!since || !lastUpdated || new Date(since) < new Date(lastUpdated) ) {
        console.log(`Remote state is newer: ${since} < ${lastUpdated}`);
        const result = await this.executeRemoteQuery('SELECT * FROM state:current;');
        const stateObj = result || {};
        delete stateObj.id;
        console.log("Remote state loaded successfully.");
        return stateObj;
      } else {
        console.log(`Local state is newer: ${since} >= ${lastUpdated}`);
        return null;
      }
    } catch (error) {
      console.error("Failed to load remote state:", error);
      return {};
    }
  }


  /**
   * Updates the state and schedules a chained local and remote save.
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.state.lastUpdated = new Date().toISOString();
    this.isLocalStateDirty = true; // Mark local state as dirty
    this.scheduleLocalSave(); // Schedule local save
  }

  /**
   * Schedules a local state save after a 1-second delay.
   * Triggers remote sync only if local state is saved.
   */
  scheduleLocalSave() {
    clearTimeout(this.localSaveTimeout);
    this.localSaveTimeout = setTimeout(() => {
      const shouldSyncRemote = this.isLocalStateDirty; // Capture the current state of the flag
      this.saveLocalState().then(() => {
        if (shouldSyncRemote) { // Use the captured flag to decide if remote sync is needed
          this.scheduleRemoteSync();
        }
      });
    }, this.config.stateSaveTimeout); // Save local state after 1 second
  }

  /**
   * Saves the local state and resolves a promise.
   * @returns {Promise<void>}
   */
  async saveLocalState() {
    console.log("Saving local state...");
    this.cleanupState(); // Ensure state is pruned before saving
    GM_setValue(this.key, JSON.stringify(this.state));
    console.log("Local state saved.");
    this.isLocalStateDirty = false; // Reset dirty flag
    this.notifyListeners();
  }

  /**
   * Schedules a remote state synchronization after a longer delay.
   */
  scheduleRemoteSync() {
    if (!this.config.stateSyncEnabled) {
      console.log("sync disabled")
      return;
    }

    clearTimeout(this.remoteSyncTimeout);
    this.remoteSyncTimeout = setTimeout(() => {
      this.saveRemoteState(this.state.lastUpdated);
    }, this.config.stateSyncTimeout); // Default to 5 seconds delay
  }

  /**
   * Saves the remote state if needed.
   */
  async saveRemoteState(since) {
    const { url, namespace = "bluesky_navigator", database = "state", username, password } =
          JSON.parse(this.config.stateSyncConfig);

    try {
      const lastUpdated = await this.getRemoteStateUpdated();
      if (!since || !lastUpdated || new Date(since) < new Date(lastUpdated)) {
        console.log("Not saving because remote state is newer.");
        return;
      }

      console.log("Saving remote state...");
      this.setSyncStatus("pending");
      await this.executeRemoteQuery(
        `UPSERT state:current MERGE {${JSON.stringify(this.state).slice(1, -1)}, created_at: time::now()}`,
        "success"
      );
    } catch (error) {
      console.error("Failed to save remote state:", error);
    }
  }

  /**
   * Immediately saves both local and remote states.
   */
  saveStateImmediately(saveLocal = true, saveRemote = false) {
    if (saveLocal) {
      this.saveLocalState();
    }
    debugger;
    if (this.config.stateSyncEnabled && saveRemote) {
      this.saveRemoteState(this.state.lastUpdated);
    }
  }

  /**
   * Keeps only the most recent N entries in the state.
   */
  cleanupState() {
    if (this.state.seen) {
      this.state.seen = this.keepMostRecentValues(this.state.seen, this.maxEntries);
    }
  }

  /**
   * Utility to keep only the most recent N entries in an object.
   * Assumes values are ISO date strings for sorting.
   * @param {Object} obj - The object to prune.
   * @param {number} maxEntries - The maximum number of entries to retain.
   */
  keepMostRecentValues(obj, maxEntries) {
    const entries = Object.entries(obj);

    // Sort the entries by value (date) in descending order
    entries.sort(([, dateA], [, dateB]) => new Date(dateB) - new Date(dateA));

    // Keep only the most recent N entries
    return Object.fromEntries(entries.slice(0, maxEntries));
  }

  /**
   * Resets state to the default value.
   * @param {Object} defaultState - The default state object.
   */
  resetState(defaultState = {}) {
    this.state = defaultState;
  }

  /**
   * Registers a listener for state changes.
   * @param {function} callback - The listener function to invoke on state change.
   */
  addListener(callback) {
    if (typeof callback === "function") {
      this.listeners.push(callback);
    }
  }

  /**
   * Notifies all registered listeners of a state change.
   */
  notifyListeners() {
    this.listeners.forEach(callback => callback(this.state));
  }

  handleBlockListResponse(response, responseKey, stateKey) {
    // console.dir(responseKey, stateKey)
    var jsonResponse = $.parseJSON(response.response)
    // console.dir(jsonResponse.data)

    try {
      this.state.blocks[stateKey].handles = jsonResponse.data[responseKey].map(
        (entry) => entry.Handle
      )
      this.state.blocks[stateKey].updated = Date.now()
    } catch (error) {
      console.warn("couldn't fetch block list")
    }
  }

  updateBlockList() {
    // console.log("updateBlockList")
    const blockConfig = {
      all: {
        url: "https://api.clearsky.services/api/v1/anon/lists/fun-facts",
        responseKey: "blocked",
      },
      recent: {
        url: "https://api.clearsky.services/api/v1/anon/lists/funer-facts",
        responseKey: "blocked24",
      },
    }

    for (const [stateKey, cfg] of Object.entries(blockConfig) ) {
      // console.log(stateKey, cfg)
      if (
        this.state.blocks[stateKey].updated == null
          ||
          Date.now() + constants.CLEARSKY_LIST_REFRESH_INTERVAL > this.state.blocks[stateKey].updated
      ) {
        GM_xmlhttpRequest({
          method: "GET",
          url: cfg.url,
          headers: {
            Accept: "application/json",
          },
          onload: (response) => this.handleBlockListResponse(response, cfg.responseKey, stateKey),
        });
      }

    }
  }
}
