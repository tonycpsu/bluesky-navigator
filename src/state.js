import { StateManager } from './StateManager.js';

const DEFAULT_STATE = {
  seen: {},
  lastUpdated: null,
  page: 'home',
  blocks: { all: [], recent: [] },
  feedSortReverse: false,
  feedHideRead: false,
};

let stateManager;

const target = {
  init(key, config, onSuccess) {
    StateManager.create(key, DEFAULT_STATE, config)
      .then((initializedStateManager) => {
        stateManager = initializedStateManager;
        onSuccess();
      })
      .catch((error) => {
        console.error('Failed to initialize StateManager:', error);
      });
  },
};

// Proxy to dynamically get values from `stateManager`
const state = new Proxy(target, {
  get(target, prop, receiver) {
    if (prop in target) {
      // If the property exists in target, return it
      return typeof target[prop] === 'function'
        ? target[prop].bind(receiver) // Ensure correct 'this' context
        : target[prop];
    } else if (prop == 'stateManager') {
      return stateManager;
    } else if (prop in stateManager.state) {
      return stateManager.state[prop];
    }
    console.warn(`State Warning: ${prop} is not defined`);
    return undefined;
  },
  set(target, prop, value) {
    stateManager.state[prop] = value;
    return true;
  },
});

export { state };
