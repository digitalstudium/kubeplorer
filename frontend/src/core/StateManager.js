export class StateManager {
  constructor() {
    this.state = {
      selectedCluster: null,
      selectedNamespace: null,
      selectedApiResource: null
    };
    this.listeners = new Map();
  }

  setState(key, value) {
    this.state[key] = value;
    this.notifyListeners(key, value);
  }

  getState(key) {
    return this.state[key];
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(callback);
  }

  notifyListeners(key, value) {
    const callbacks = this.listeners.get(key) || [];
    callbacks.forEach(callback => {
      try {
        callback(value);
      } catch (error) {
        console.error(`Error in state listener for ${key}:`, error);
      }
    });
  }
}
