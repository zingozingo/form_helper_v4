class EventBus {
  constructor(config = {}) {
    this.events = new Map();
    this.moduleRegistry = new Map();
    this.listenerMetadata = new Map();
    this.eventHistory = [];
    this.config = {
      debugMode: config.debugMode || false,
      maxHistorySize: config.maxHistorySize || 1000,
      enforceModuleRegistration: config.enforceModuleRegistration !== false,
      logPrefix: config.logPrefix || '[EventBus]',
      errorIsolation: config.errorIsolation !== false,
      performanceTracking: config.performanceTracking || false
    };
    this.stats = {
      totalEventsEmitted: 0,
      totalListenersInvoked: 0,
      errorsCaught: 0,
      moduleViolations: 0
    };
    this._setupDebugMode();
  }

  registerModule(moduleId, moduleInfo = {}) {
    if (this.moduleRegistry.has(moduleId)) {
      this._logWarn(`Module ${moduleId} is already registered`);
      return false;
    }

    const moduleData = {
      id: moduleId,
      name: moduleInfo.name || moduleId,
      version: moduleInfo.version || '1.0.0',
      registeredAt: new Date().toISOString(),
      allowedEvents: moduleInfo.allowedEvents || [],
      deniedEvents: moduleInfo.deniedEvents || [],
      metadata: moduleInfo.metadata || {}
    };

    this.moduleRegistry.set(moduleId, moduleData);
    this._logDebug(`Module registered: ${moduleId}`, moduleData);
    return true;
  }

  unregisterModule(moduleId) {
    if (!this.moduleRegistry.has(moduleId)) {
      this._logWarn(`Module ${moduleId} not found for unregistration`);
      return false;
    }

    const removedListeners = this._removeModuleListeners(moduleId);
    this.moduleRegistry.delete(moduleId);
    this._logDebug(`Module unregistered: ${moduleId}, removed ${removedListeners} listeners`);
    return true;
  }

  on(eventName, handler, options = {}) {
    const moduleId = options.moduleId || this._getCallerModuleId();
    
    if (this.config.enforceModuleRegistration && !this.moduleRegistry.has(moduleId)) {
      this._logError(`Unregistered module ${moduleId} attempted to add listener for ${eventName}`);
      this.stats.moduleViolations++;
      throw new Error(`Module ${moduleId} must be registered before adding listeners`);
    }

    if (!this._isEventAllowed(moduleId, eventName, 'listen')) {
      this._logError(`Module ${moduleId} is not allowed to listen to ${eventName}`);
      this.stats.moduleViolations++;
      throw new Error(`Module ${moduleId} cannot listen to ${eventName}`);
    }

    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }

    const wrappedHandler = this._wrapHandler(handler, eventName, moduleId, options);
    const listenerId = this._generateListenerId();
    
    const listenerInfo = {
      id: listenerId,
      eventName,
      handler: wrappedHandler,
      originalHandler: handler,
      moduleId,
      addedAt: new Date().toISOString(),
      invokeCount: 0,
      lastInvokedAt: null,
      options: {
        once: options.once || false,
        priority: options.priority || 0,
        filter: options.filter || null,
        timeout: options.timeout || null
      }
    };

    this.events.get(eventName).add(wrappedHandler);
    this.listenerMetadata.set(listenerId, listenerInfo);
    
    this._logDebug(`Listener added: ${eventName} by ${moduleId}`, { listenerId, options });
    
    return listenerId;
  }

  once(eventName, handler, options = {}) {
    return this.on(eventName, handler, { ...options, once: true });
  }

  off(eventNameOrId, handler = null) {
    if (this._isListenerId(eventNameOrId)) {
      return this._removeListenerById(eventNameOrId);
    }

    const eventName = eventNameOrId;
    if (!this.events.has(eventName)) {
      this._logWarn(`No listeners found for event: ${eventName}`);
      return false;
    }

    if (handler) {
      const listeners = this.events.get(eventName);
      const listenerInfo = this._findListenerInfo(eventName, handler);
      
      if (listenerInfo) {
        listeners.delete(listenerInfo.handler);
        this.listenerMetadata.delete(listenerInfo.id);
        this._logDebug(`Listener removed: ${eventName}`, { listenerId: listenerInfo.id });
        
        if (listeners.size === 0) {
          this.events.delete(eventName);
        }
        return true;
      }
    } else {
      const count = this.events.get(eventName).size;
      this._removeEventListeners(eventName);
      this._logDebug(`All listeners removed for event: ${eventName}`, { count });
      return true;
    }

    return false;
  }

  emit(eventName, data = null, options = {}) {
    const moduleId = options.moduleId || this._getCallerModuleId();
    const emitTime = performance.now();
    
    if (this.config.enforceModuleRegistration && !this.moduleRegistry.has(moduleId)) {
      this._logError(`Unregistered module ${moduleId} attempted to emit ${eventName}`);
      this.stats.moduleViolations++;
      throw new Error(`Module ${moduleId} must be registered before emitting events`);
    }

    if (!this._isEventAllowed(moduleId, eventName, 'emit')) {
      this._logError(`Module ${moduleId} is not allowed to emit ${eventName}`);
      this.stats.moduleViolations++;
      throw new Error(`Module ${moduleId} cannot emit ${eventName}`);
    }

    this.stats.totalEventsEmitted++;
    
    const eventRecord = {
      id: this._generateEventId(),
      eventName,
      emittedBy: moduleId,
      data: this._cloneData(data),
      timestamp: new Date().toISOString(),
      listenersInvoked: 0,
      errors: []
    };

    this._addToHistory(eventRecord);
    this._logDebug(`Event emitted: ${eventName} by ${moduleId}`, { eventId: eventRecord.id, data });

    if (!this.events.has(eventName)) {
      this._logDebug(`No listeners for event: ${eventName}`);
      return eventRecord.id;
    }

    const listeners = Array.from(this.events.get(eventName));
    const sortedListeners = this._sortListenersByPriority(listeners);
    
    for (const wrappedHandler of sortedListeners) {
      const listenerInfo = this._getListenerInfoByHandler(wrappedHandler);
      if (!listenerInfo) continue;

      try {
        if (listenerInfo.options.filter && !listenerInfo.options.filter(data)) {
          this._logDebug(`Listener ${listenerInfo.id} filtered out for ${eventName}`);
          continue;
        }

        this.stats.totalListenersInvoked++;
        eventRecord.listenersInvoked++;
        listenerInfo.invokeCount++;
        listenerInfo.lastInvokedAt = new Date().toISOString();

        if (listenerInfo.options.timeout) {
          this._invokeWithTimeout(wrappedHandler, data, listenerInfo.options.timeout);
        } else {
          wrappedHandler(data);
        }

        if (listenerInfo.options.once) {
          this.off(listenerInfo.id);
        }

      } catch (error) {
        this.stats.errorsCaught++;
        eventRecord.errors.push({
          listenerId: listenerInfo.id,
          moduleId: listenerInfo.moduleId,
          error: error.message,
          stack: error.stack
        });

        if (this.config.errorIsolation) {
          this._logError(`Error in listener ${listenerInfo.id} for ${eventName}:`, error);
        } else {
          throw error;
        }
      }
    }

    if (this.config.performanceTracking) {
      const duration = performance.now() - emitTime;
      this._logDebug(`Event ${eventName} completed in ${duration.toFixed(2)}ms`);
    }

    return eventRecord.id;
  }

  getModuleInfo(moduleId) {
    return this.moduleRegistry.get(moduleId) || null;
  }

  getEventListeners(eventName) {
    if (!this.events.has(eventName)) {
      return [];
    }

    const listeners = [];
    for (const [id, info] of this.listenerMetadata) {
      if (info.eventName === eventName) {
        listeners.push({
          id: info.id,
          moduleId: info.moduleId,
          priority: info.options.priority,
          invokeCount: info.invokeCount,
          addedAt: info.addedAt,
          lastInvokedAt: info.lastInvokedAt
        });
      }
    }

    return listeners;
  }

  getModuleListeners(moduleId) {
    const listeners = [];
    for (const [id, info] of this.listenerMetadata) {
      if (info.moduleId === moduleId) {
        listeners.push({
          id: info.id,
          eventName: info.eventName,
          priority: info.options.priority,
          invokeCount: info.invokeCount,
          addedAt: info.addedAt
        });
      }
    }
    return listeners;
  }

  getAllEvents() {
    return Array.from(this.events.keys());
  }

  getStats() {
    return {
      ...this.stats,
      totalModules: this.moduleRegistry.size,
      totalEvents: this.events.size,
      totalListeners: this.listenerMetadata.size,
      eventHistory: this.eventHistory.length
    };
  }

  getEventHistory(limit = 100) {
    return this.eventHistory.slice(-limit);
  }

  clearEventHistory() {
    const count = this.eventHistory.length;
    this.eventHistory = [];
    this._logDebug(`Event history cleared`, { count });
  }

  destroy() {
    this._logDebug('Destroying EventBus instance');
    
    for (const eventName of this.events.keys()) {
      this._removeEventListeners(eventName);
    }
    
    this.moduleRegistry.clear();
    this.listenerMetadata.clear();
    this.eventHistory = [];
    
    this._logDebug('EventBus instance destroyed');
  }

  _wrapHandler(handler, eventName, moduleId, options) {
    return (data) => {
      this._logDebug(`Invoking listener for ${eventName} from ${moduleId}`);
      
      try {
        const result = handler(data);
        
        if (result instanceof Promise) {
          result.catch(error => {
            this._logError(`Async error in listener for ${eventName} from ${moduleId}:`, error);
            if (!this.config.errorIsolation) {
              throw error;
            }
          });
        }
        
        return result;
      } catch (error) {
        throw error;
      }
    };
  }

  _invokeWithTimeout(handler, data, timeout) {
    const timeoutId = setTimeout(() => {
      this._logWarn(`Listener timed out after ${timeout}ms`);
    }, timeout);

    try {
      const result = handler(data);
      
      if (result instanceof Promise) {
        result.finally(() => clearTimeout(timeoutId));
      } else {
        clearTimeout(timeoutId);
      }
      
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  _isEventAllowed(moduleId, eventName, action) {
    const module = this.moduleRegistry.get(moduleId);
    if (!module) return true;

    if (module.deniedEvents.length > 0) {
      if (this._matchesPattern(eventName, module.deniedEvents)) {
        return false;
      }
    }

    if (module.allowedEvents.length > 0) {
      return this._matchesPattern(eventName, module.allowedEvents);
    }

    return true;
  }

  _matchesPattern(eventName, patterns) {
    return patterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(eventName);
      }
      return pattern === eventName;
    });
  }

  _getCallerModuleId() {
    const stack = new Error().stack;
    const callerLine = stack.split('\n')[3];
    const match = callerLine.match(/at\s+(?:.*?\s+\()?(.+?):\d+:\d+/);
    
    if (match) {
      const filePath = match[1];
      const fileName = filePath.split('/').pop().replace('.js', '');
      return fileName;
    }
    
    return 'unknown';
  }

  _sortListenersByPriority(listeners) {
    const listenersWithInfo = listeners.map(handler => ({
      handler,
      info: this._getListenerInfoByHandler(handler)
    }));

    return listenersWithInfo
      .sort((a, b) => (b.info?.options.priority || 0) - (a.info?.options.priority || 0))
      .map(item => item.handler);
  }

  _getListenerInfoByHandler(handler) {
    for (const [id, info] of this.listenerMetadata) {
      if (info.handler === handler) {
        return info;
      }
    }
    return null;
  }

  _findListenerInfo(eventName, originalHandler) {
    for (const [id, info] of this.listenerMetadata) {
      if (info.eventName === eventName && info.originalHandler === originalHandler) {
        return info;
      }
    }
    return null;
  }

  _removeListenerById(listenerId) {
    const listenerInfo = this.listenerMetadata.get(listenerId);
    if (!listenerInfo) {
      this._logWarn(`Listener ${listenerId} not found`);
      return false;
    }

    const listeners = this.events.get(listenerInfo.eventName);
    if (listeners) {
      listeners.delete(listenerInfo.handler);
      if (listeners.size === 0) {
        this.events.delete(listenerInfo.eventName);
      }
    }

    this.listenerMetadata.delete(listenerId);
    this._logDebug(`Listener removed by ID: ${listenerId}`);
    return true;
  }

  _removeEventListeners(eventName) {
    const listeners = this.events.get(eventName);
    if (!listeners) return;

    for (const [id, info] of this.listenerMetadata) {
      if (info.eventName === eventName) {
        this.listenerMetadata.delete(id);
      }
    }

    this.events.delete(eventName);
  }

  _removeModuleListeners(moduleId) {
    let count = 0;
    const listenersToRemove = [];

    for (const [id, info] of this.listenerMetadata) {
      if (info.moduleId === moduleId) {
        listenersToRemove.push(id);
      }
    }

    for (const listenerId of listenersToRemove) {
      if (this._removeListenerById(listenerId)) {
        count++;
      }
    }

    return count;
  }

  _isListenerId(value) {
    return typeof value === 'string' && value.startsWith('listener_');
  }

  _generateListenerId() {
    return `listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateEventId() {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _cloneData(data) {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object') return data;
    
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (error) {
      this._logWarn('Failed to clone event data, using original', error);
      return data;
    }
  }

  _addToHistory(eventRecord) {
    this.eventHistory.push(eventRecord);
    
    if (this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  _setupDebugMode() {
    if (!this.config.debugMode) return;

    const debugInterval = setInterval(() => {
      const stats = this.getStats();
      console.log(`${this.config.logPrefix} Stats:`, stats);
    }, 30000);

    if (typeof window !== 'undefined') {
      window.__eventBusDebug = {
        instance: this,
        getStats: () => this.getStats(),
        getHistory: (limit) => this.getEventHistory(limit),
        getListeners: (eventName) => this.getEventListeners(eventName),
        getModules: () => Array.from(this.moduleRegistry.values()),
        clearHistory: () => this.clearEventHistory()
      };
    }
  }

  _logDebug(message, data = null) {
    if (!this.config.debugMode) return;
    
    const timestamp = new Date().toISOString();
    const logMessage = `${this.config.logPrefix} [DEBUG] ${timestamp} - ${message}`;
    
    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  _logWarn(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `${this.config.logPrefix} [WARN] ${timestamp} - ${message}`;
    
    if (data) {
      console.warn(logMessage, data);
    } else {
      console.warn(logMessage);
    }
  }

  _logError(message, error = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `${this.config.logPrefix} [ERROR] ${timestamp} - ${message}`;
    
    if (error) {
      console.error(logMessage, error);
    } else {
      console.error(logMessage);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventBus;
} else if (typeof window !== 'undefined') {
  window.EventBus = EventBus;
}