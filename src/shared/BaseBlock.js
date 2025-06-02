class BaseBlock {
  constructor(moduleId, eventBus, config = {}) {
    if (!moduleId) {
      throw new Error('Module ID is required for BaseBlock initialization');
    }
    
    if (!eventBus) {
      throw new Error('EventBus instance is required for BaseBlock initialization');
    }

    this._moduleId = moduleId;
    this._eventBus = eventBus;
    this._config = this._mergeConfig(config);
    this._listeners = new Map();
    this._state = 'uninitialized';
    this._health = {
      status: 'healthy',
      lastError: null,
      errorCount: 0,
      startTime: null,
      uptime: 0,
      eventStats: {
        emitted: 0,
        received: 0,
        errors: 0
      }
    };
    this._stateHistory = [];
    this._performanceMetrics = {
      initTime: null,
      eventProcessingTimes: [],
      averageProcessingTime: 0
    };
    this._debugMode = this._config.debugMode || false;
    this._maxStateHistory = this._config.maxStateHistory || 100;
    
    this._enforceNoCoupling();
    this._registerModule();
  }

  async start() {
    try {
      this._setState('starting');
      this._health.startTime = Date.now();
      this._performanceMetrics.initTime = Date.now();
      
      this._logDebug('Starting module');
      
      this._setupCoreListeners();
      
      await this._onStart();
      
      this._setState('running');
      this._logInfo('Module started successfully');
      
      this.emit('module:started', {
        moduleId: this._moduleId,
        config: this._config,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      this._handleError('Failed to start module', error);
      this._setState('error');
      throw error;
    }
  }

  async stop() {
    try {
      this._setState('stopping');
      this._logDebug('Stopping module');
      
      await this._onStop();
      
      this._cleanupListeners();
      
      this._setState('stopped');
      this._logInfo('Module stopped successfully');
      
      this.emit('module:stopped', {
        moduleId: this._moduleId,
        uptime: this._health.uptime,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      this._handleError('Failed to stop module', error);
      this._setState('error');
      throw error;
    }
  }

  async restart() {
    this._logInfo('Restarting module');
    await this.stop();
    await this.start();
  }

  destroy() {
    try {
      this._logDebug('Destroying module');
      
      if (this._state === 'running') {
        this.stop();
      }
      
      this._cleanupListeners();
      this._eventBus.unregisterModule(this._moduleId);
      
      this._onDestroy();
      
      this._setState('destroyed');
      this._logInfo('Module destroyed');
    } catch (error) {
      this._handleError('Failed to destroy module', error);
    }
  }

  on(eventName, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new TypeError('Event handler must be a function');
    }

    const wrappedHandler = this._wrapHandler(handler, eventName);
    const listenerId = this._eventBus.on(eventName, wrappedHandler, {
      ...options,
      moduleId: this._moduleId
    });

    this._listeners.set(listenerId, {
      eventName,
      handler,
      wrappedHandler,
      options,
      addedAt: Date.now()
    });

    this._logDebug(`Subscribed to event: ${eventName}`, { listenerId, options });
    
    return listenerId;
  }

  once(eventName, handler, options = {}) {
    return this.on(eventName, handler, { ...options, once: true });
  }

  off(eventNameOrId, handler = null) {
    if (this._isListenerId(eventNameOrId)) {
      const listenerInfo = this._listeners.get(eventNameOrId);
      if (listenerInfo) {
        this._eventBus.off(eventNameOrId);
        this._listeners.delete(eventNameOrId);
        this._logDebug(`Unsubscribed from event by ID: ${eventNameOrId}`);
        return true;
      }
      return false;
    }

    const eventName = eventNameOrId;
    let removed = false;
    
    for (const [listenerId, info] of this._listeners) {
      if (info.eventName === eventName && (!handler || info.handler === handler)) {
        this._eventBus.off(listenerId);
        this._listeners.delete(listenerId);
        removed = true;
        
        if (handler) break;
      }
    }

    if (removed) {
      this._logDebug(`Unsubscribed from event: ${eventName}`);
    }
    
    return removed;
  }

  emit(eventName, data = null, options = {}) {
    try {
      const startTime = performance.now();
      
      this._health.eventStats.emitted++;
      
      const eventId = this._eventBus.emit(eventName, data, {
        ...options,
        moduleId: this._moduleId
      });

      const duration = performance.now() - startTime;
      this._trackPerformance('emit', duration);
      
      this._logDebug(`Emitted event: ${eventName}`, { eventId, duration: `${duration.toFixed(2)}ms` });
      
      return eventId;
    } catch (error) {
      this._health.eventStats.errors++;
      this._handleError(`Failed to emit event: ${eventName}`, error);
      throw error;
    }
  }

  broadcast(eventName, data = null, options = {}) {
    return this.emit(`broadcast:${eventName}`, data, options);
  }

  request(eventName, data = null, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const responseEvent = `${eventName}:response`;
      const requestId = this._generateRequestId();
      const timeoutId = setTimeout(() => {
        this.off(listenerId);
        reject(new Error(`Request timeout for ${eventName} after ${timeout}ms`));
      }, timeout);

      const listenerId = this.once(responseEvent, (response) => {
        clearTimeout(timeoutId);
        
        if (response && response.requestId === requestId) {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.data);
          }
        }
      });

      this.emit(eventName, { ...data, requestId });
    });
  }

  respond(eventName, handler) {
    return this.on(eventName, async (request) => {
      const responseEvent = `${eventName}:response`;
      const requestId = request?.requestId;
      
      if (!requestId) {
        this._logWarn(`Received request without requestId for ${eventName}`);
        return;
      }

      try {
        const result = await handler(request);
        this.emit(responseEvent, {
          requestId,
          data: result,
          error: null
        });
      } catch (error) {
        this.emit(responseEvent, {
          requestId,
          data: null,
          error: error.message
        });
      }
    });
  }

  getState() {
    return this._state;
  }

  getHealth() {
    if (this._health.startTime) {
      this._health.uptime = Date.now() - this._health.startTime;
    }
    
    return {
      ...this._health,
      state: this._state,
      listeners: this._listeners.size,
      averageProcessingTime: this._performanceMetrics.averageProcessingTime
    };
  }

  getConfig() {
    return { ...this._config };
  }

  getModuleId() {
    return this._moduleId;
  }

  getStateHistory(limit = 50) {
    return this._stateHistory.slice(-limit);
  }

  getMetrics() {
    return {
      moduleId: this._moduleId,
      state: this._state,
      health: this.getHealth(),
      performance: {
        ...this._performanceMetrics,
        eventProcessingTimes: this._performanceMetrics.eventProcessingTimes.slice(-100)
      },
      stateHistory: this.getStateHistory(10)
    };
  }

  updateConfig(newConfig) {
    const oldConfig = { ...this._config };
    this._config = this._mergeConfig(newConfig);
    
    this._onConfigUpdate(oldConfig, this._config);
    
    this.emit('module:config:updated', {
      moduleId: this._moduleId,
      oldConfig,
      newConfig: this._config
    });
    
    this._logInfo('Module configuration updated');
  }

  _onStart() {
  }

  _onStop() {
  }

  _onDestroy() {
  }

  _onConfigUpdate(oldConfig, newConfig) {
  }

  _onHealthCheck() {
    return {
      custom: {}
    };
  }

  _mergeConfig(config) {
    return {
      debugMode: false,
      maxStateHistory: 100,
      healthCheckInterval: 30000,
      performanceTracking: true,
      ...config
    };
  }

  _enforceNoCoupling() {
    const restrictedGlobals = ['require', 'import'];
    const self = this;
    
    const handler = {
      get(target, prop) {
        if (restrictedGlobals.includes(prop)) {
          self._logWarn(`Direct module import/require attempted. Use EventBus for communication.`);
        }
        return target[prop];
      }
    };
    
    if (typeof Proxy !== 'undefined') {
      return new Proxy(this, handler);
    }
  }

  _registerModule() {
    const moduleInfo = {
      name: this.constructor.name,
      version: this._config.version || '1.0.0',
      allowedEvents: this._config.allowedEvents || [],
      deniedEvents: this._config.deniedEvents || [],
      metadata: {
        config: this._config,
        capabilities: this._getCapabilities()
      }
    };

    this._eventBus.registerModule(this._moduleId, moduleInfo);
    this._logDebug('Module registered with EventBus');
  }

  _getCapabilities() {
    return {
      hasCustomStart: this._onStart !== BaseBlock.prototype._onStart,
      hasCustomStop: this._onStop !== BaseBlock.prototype._onStop,
      hasCustomDestroy: this._onDestroy !== BaseBlock.prototype._onDestroy,
      hasCustomHealthCheck: this._onHealthCheck !== BaseBlock.prototype._onHealthCheck
    };
  }

  _setupCoreListeners() {
    this.on('module:health:check', () => {
      const health = this.getHealth();
      const customHealth = this._onHealthCheck();
      
      this.emit('module:health:report', {
        moduleId: this._moduleId,
        ...health,
        custom: customHealth.custom || {}
      });
    });

    this.on('module:config:get', () => {
      this.emit('module:config:report', {
        moduleId: this._moduleId,
        config: this.getConfig()
      });
    });

    this.on('module:metrics:get', () => {
      this.emit('module:metrics:report', {
        moduleId: this._moduleId,
        metrics: this.getMetrics()
      });
    });

    if (this._config.healthCheckInterval > 0) {
      this._healthCheckInterval = setInterval(() => {
        this.emit('module:health:check');
      }, this._config.healthCheckInterval);
    }
  }

  _wrapHandler(handler, eventName) {
    return async (data) => {
      const startTime = performance.now();
      
      try {
        this._health.eventStats.received++;
        this._logDebug(`Processing event: ${eventName}`);
        
        const result = await handler.call(this, data);
        
        const duration = performance.now() - startTime;
        this._trackPerformance('handle', duration);
        
        return result;
      } catch (error) {
        this._health.eventStats.errors++;
        this._handleError(`Error handling event: ${eventName}`, error);
        throw error;
      }
    };
  }

  _setState(newState) {
    const oldState = this._state;
    this._state = newState;
    
    const stateChange = {
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString()
    };
    
    this._stateHistory.push(stateChange);
    
    if (this._stateHistory.length > this._maxStateHistory) {
      this._stateHistory.shift();
    }
    
    this._logDebug(`State changed: ${oldState} -> ${newState}`);
    
    this.emit('module:state:changed', {
      moduleId: this._moduleId,
      ...stateChange
    });
  }

  _handleError(message, error) {
    this._health.status = 'unhealthy';
    this._health.lastError = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    this._health.errorCount++;
    
    this._logError(message, error);
    
    this.emit('module:error', {
      moduleId: this._moduleId,
      error: {
        message: error.message,
        stack: error.stack
      },
      context: message
    });
  }

  _trackPerformance(operation, duration) {
    if (!this._config.performanceTracking) return;
    
    this._performanceMetrics.eventProcessingTimes.push({
      operation,
      duration,
      timestamp: Date.now()
    });
    
    if (this._performanceMetrics.eventProcessingTimes.length > 1000) {
      this._performanceMetrics.eventProcessingTimes = 
        this._performanceMetrics.eventProcessingTimes.slice(-500);
    }
    
    const times = this._performanceMetrics.eventProcessingTimes.map(t => t.duration);
    this._performanceMetrics.averageProcessingTime = 
      times.reduce((a, b) => a + b, 0) / times.length;
  }

  _cleanupListeners() {
    this._logDebug(`Cleaning up ${this._listeners.size} listeners`);
    
    for (const listenerId of this._listeners.keys()) {
      this._eventBus.off(listenerId);
    }
    
    this._listeners.clear();
    
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  _isListenerId(value) {
    return typeof value === 'string' && value.startsWith('listener_');
  }

  _generateRequestId() {
    return `req_${this._moduleId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  _logDebug(message, data = null) {
    if (!this._debugMode) return;
    
    const logMessage = `[${this._moduleId}] ${message}`;
    
    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  _logInfo(message, data = null) {
    const logMessage = `[${this._moduleId}] [INFO] ${message}`;
    
    if (data) {
      console.info(logMessage, data);
    } else {
      console.info(logMessage);
    }
  }

  _logWarn(message, data = null) {
    const logMessage = `[${this._moduleId}] [WARN] ${message}`;
    
    if (data) {
      console.warn(logMessage, data);
    } else {
      console.warn(logMessage);
    }
  }

  _logError(message, error = null) {
    const logMessage = `[${this._moduleId}] [ERROR] ${message}`;
    
    if (error) {
      console.error(logMessage, error);
    } else {
      console.error(logMessage);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseBlock;
} else if (typeof window !== 'undefined') {
  window.BaseBlock = BaseBlock;
}