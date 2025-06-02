class PageMonitor extends BaseBlock {
  constructor(eventBus, config = {}) {
    const defaultConfig = {
      mutationThrottle: 250,
      mutationBatchSize: 10,
      observeSubtree: true,
      observeAttributes: true,
      observeAttributeFilter: ['class', 'id', 'data-page', 'data-route'],
      significantChangeThreshold: 5,
      urlCheckInterval: 500,
      domStabilizationDelay: 300,
      enableFormDetection: true,
      enableAjaxMonitoring: true,
      debugMode: false
    };

    super('PageMonitor', eventBus, { ...defaultConfig, ...config });

    this._currentUrl = null;
    this._currentPageSignature = null;
    this._observer = null;
    this._urlCheckTimer = null;
    this._mutationQueue = [];
    this._mutationTimer = null;
    this._domStabilizationTimer = null;
    this._pageStats = {
      navigations: 0,
      domChanges: 0,
      significantChanges: 0,
      errors: 0,
      lastChangeTimestamp: null
    };
    this._ajaxInterceptor = null;
    this._historyPatched = false;
  }

  async _onStart() {
    this._currentUrl = window.location.href;
    this._currentPageSignature = this._generatePageSignature();

    this._setupNavigationDetection();
    this._setupMutationObserver();
    this._setupAjaxMonitoring();
    this._setupEventListeners();

    this._performInitialScan();

    this._logInfo('PageMonitor started', {
      url: this._currentUrl,
      signature: this._currentPageSignature
    });
  }

  async _onStop() {
    this._stopUrlMonitoring();
    this._stopMutationObserver();
    this._stopAjaxMonitoring();
    this._restoreHistoryMethods();
    
    if (this._mutationTimer) {
      clearTimeout(this._mutationTimer);
      this._mutationTimer = null;
    }

    if (this._domStabilizationTimer) {
      clearTimeout(this._domStabilizationTimer);
      this._domStabilizationTimer = null;
    }

    this._logInfo('PageMonitor stopped');
  }

  _onHealthCheck() {
    return {
      custom: {
        currentUrl: this._currentUrl,
        pageStats: this._pageStats,
        observerActive: this._observer !== null,
        mutationQueueSize: this._mutationQueue.length
      }
    };
  }

  _setupNavigationDetection() {
    this._startUrlMonitoring();
    this._patchHistoryMethods();
    
    this.on('browser:navigation', (data) => {
      this._handleNavigation(data);
    });
  }

  _setupMutationObserver() {
    const observerConfig = {
      childList: true,
      subtree: this._config.observeSubtree,
      attributes: this._config.observeAttributes,
      attributeFilter: this._config.observeAttributeFilter,
      characterData: false
    };

    this._observer = new MutationObserver((mutations) => {
      this._handleMutations(mutations);
    });

    this._observer.observe(document.body, observerConfig);
    this._logDebug('Mutation observer started');
  }

  _setupAjaxMonitoring() {
    if (!this._config.enableAjaxMonitoring) return;

    this._ajaxInterceptor = {
      originalOpen: XMLHttpRequest.prototype.open,
      originalSend: XMLHttpRequest.prototype.send,
      originalFetch: window.fetch
    };

    const self = this;

    XMLHttpRequest.prototype.open = function(...args) {
      this._pageMonitorUrl = args[1];
      return self._ajaxInterceptor.originalOpen.apply(this, args);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('load', function() {
        self._handleAjaxComplete({
          url: this._pageMonitorUrl,
          status: this.status,
          type: 'xhr'
        });
      });
      return self._ajaxInterceptor.originalSend.apply(this, args);
    };

    window.fetch = function(...args) {
      return self._ajaxInterceptor.originalFetch.apply(this, args)
        .then(response => {
          self._handleAjaxComplete({
            url: args[0],
            status: response.status,
            type: 'fetch'
          });
          return response;
        });
    };

    this._logDebug('AJAX monitoring enabled');
  }

  _setupEventListeners() {
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        this._handlePageShow();
      }
    });

    window.addEventListener('popstate', () => {
      this._checkUrlChange();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this._checkUrlChange();
      }
    });
  }

  _performInitialScan() {
    const pageData = this._analyzeCurrentPage();
    
    this.emit('page:initial', {
      url: this._currentUrl,
      signature: this._currentPageSignature,
      analysis: pageData,
      timestamp: new Date().toISOString()
    });

    if (this._config.enableFormDetection && pageData.forms.length > 0) {
      this.emit('forms:detected', {
        forms: pageData.forms,
        count: pageData.forms.length,
        url: this._currentUrl
      });
    }
  }

  _startUrlMonitoring() {
    this._urlCheckTimer = setInterval(() => {
      this._checkUrlChange();
    }, this._config.urlCheckInterval);
  }

  _stopUrlMonitoring() {
    if (this._urlCheckTimer) {
      clearInterval(this._urlCheckTimer);
      this._urlCheckTimer = null;
    }
  }

  _patchHistoryMethods() {
    if (this._historyPatched) return;

    const self = this;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args);
      self.emit('browser:navigation', {
        type: 'pushState',
        url: window.location.href,
        state: args[0]
      });
      return result;
    };

    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args);
      self.emit('browser:navigation', {
        type: 'replaceState',
        url: window.location.href,
        state: args[0]
      });
      return result;
    };

    this._historyPatched = true;
    this._logDebug('History methods patched');
  }

  _restoreHistoryMethods() {
    if (!this._historyPatched || !this._ajaxInterceptor) return;

    history.pushState = this._ajaxInterceptor.originalPushState;
    history.replaceState = this._ajaxInterceptor.originalReplaceState;
    
    this._historyPatched = false;
  }

  _stopMutationObserver() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
      this._logDebug('Mutation observer stopped');
    }
  }

  _stopAjaxMonitoring() {
    if (!this._ajaxInterceptor) return;

    XMLHttpRequest.prototype.open = this._ajaxInterceptor.originalOpen;
    XMLHttpRequest.prototype.send = this._ajaxInterceptor.originalSend;
    window.fetch = this._ajaxInterceptor.originalFetch;
    
    this._ajaxInterceptor = null;
    this._logDebug('AJAX monitoring disabled');
  }

  _checkUrlChange() {
    const currentUrl = window.location.href;
    
    if (currentUrl !== this._currentUrl) {
      this._handleUrlChange(currentUrl);
    }
  }

  _handleUrlChange(newUrl) {
    const previousUrl = this._currentUrl;
    this._currentUrl = newUrl;
    this._pageStats.navigations++;
    this._pageStats.lastChangeTimestamp = Date.now();

    const navigationData = {
      from: previousUrl,
      to: newUrl,
      type: this._detectNavigationType(previousUrl, newUrl),
      timestamp: new Date().toISOString()
    };

    this._logInfo('URL change detected', navigationData);
    
    this.emit('page:url:changed', navigationData);

    setTimeout(() => {
      const newSignature = this._generatePageSignature();
      if (newSignature !== this._currentPageSignature) {
        this._handlePageChange(newSignature, 'url_change');
      }
    }, this._config.domStabilizationDelay);
  }

  _handleNavigation(data) {
    this._checkUrlChange();
  }

  _handleMutations(mutations) {
    try {
      const significantMutations = this._filterSignificantMutations(mutations);
      
      if (significantMutations.length === 0) return;

      this._mutationQueue.push(...significantMutations);
      this._pageStats.domChanges += significantMutations.length;

      if (this._mutationTimer) {
        clearTimeout(this._mutationTimer);
      }

      this._mutationTimer = setTimeout(() => {
        this._processMutationBatch();
      }, this._config.mutationThrottle);

    } catch (error) {
      this._pageStats.errors++;
      this._handleError('Error handling mutations', error);
    }
  }

  _filterSignificantMutations(mutations) {
    return mutations.filter(mutation => {
      if (mutation.type === 'attributes') {
        return this._isSignificantAttributeChange(mutation);
      }
      
      if (mutation.type === 'childList') {
        return this._isSignificantDomChange(mutation);
      }
      
      return false;
    });
  }

  _isSignificantAttributeChange(mutation) {
    const target = mutation.target;
    const attribute = mutation.attributeName;
    
    if (target.matches('input, select, textarea, form')) {
      return true;
    }
    
    if (attribute === 'data-page' || attribute === 'data-route') {
      return true;
    }
    
    if (target.id && attribute === 'class') {
      const oldValue = mutation.oldValue || '';
      const newValue = target.getAttribute(attribute) || '';
      return this._hasSignificantClassChange(oldValue, newValue);
    }
    
    return false;
  }

  _isSignificantDomChange(mutation) {
    const addedNodes = Array.from(mutation.addedNodes);
    const removedNodes = Array.from(mutation.removedNodes);
    
    const hasSignificantAddition = addedNodes.some(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches('form, main, section, article, [data-page], [data-view]') ||
             node.querySelectorAll('form, input, select, textarea').length > 0;
    });
    
    const hasSignificantRemoval = removedNodes.some(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches('form, main, section, article, [data-page], [data-view]');
    });
    
    return hasSignificantAddition || hasSignificantRemoval;
  }

  _hasSignificantClassChange(oldClasses, newClasses) {
    const significantPatterns = [
      'active', 'selected', 'hidden', 'show', 'hide',
      'page-', 'view-', 'route-', 'state-'
    ];
    
    const oldSet = new Set(oldClasses.split(/\s+/));
    const newSet = new Set(newClasses.split(/\s+/));
    
    for (const pattern of significantPatterns) {
      const oldHasPattern = Array.from(oldSet).some(c => c.includes(pattern));
      const newHasPattern = Array.from(newSet).some(c => c.includes(pattern));
      
      if (oldHasPattern !== newHasPattern) {
        return true;
      }
    }
    
    return false;
  }

  _processMutationBatch() {
    if (this._mutationQueue.length === 0) return;

    const batch = this._mutationQueue.splice(0, this._config.mutationBatchSize);
    const mutationSummary = this._summarizeMutations(batch);

    this.emit('page:dom:mutated', {
      summary: mutationSummary,
      count: batch.length,
      timestamp: new Date().toISOString()
    });

    if (this._domStabilizationTimer) {
      clearTimeout(this._domStabilizationTimer);
    }

    this._domStabilizationTimer = setTimeout(() => {
      this._checkForPageChange();
    }, this._config.domStabilizationDelay);

    if (this._mutationQueue.length > 0) {
      this._mutationTimer = setTimeout(() => {
        this._processMutationBatch();
      }, 100);
    }
  }

  _summarizeMutations(mutations) {
    const summary = {
      total: mutations.length,
      byType: { attributes: 0, childList: 0 },
      affectedElements: new Set(),
      addedForms: 0,
      removedForms: 0,
      significantChanges: []
    };

    mutations.forEach(mutation => {
      summary.byType[mutation.type]++;
      summary.affectedElements.add(mutation.target);

      if (mutation.type === 'childList') {
        const addedForms = Array.from(mutation.addedNodes)
          .filter(n => n.nodeType === Node.ELEMENT_NODE)
          .reduce((count, node) => {
            return count + (node.matches?.('form') ? 1 : 0) + 
                   node.querySelectorAll?.('form').length || 0;
          }, 0);
        
        const removedForms = Array.from(mutation.removedNodes)
          .filter(n => n.nodeType === Node.ELEMENT_NODE)
          .reduce((count, node) => {
            return count + (node.matches?.('form') ? 1 : 0);
          }, 0);

        summary.addedForms += addedForms;
        summary.removedForms += removedForms;
      }
    });

    summary.affectedElements = summary.affectedElements.size;
    return summary;
  }

  _checkForPageChange() {
    const newSignature = this._generatePageSignature();
    
    if (newSignature !== this._currentPageSignature) {
      const changeScore = this._calculateChangeScore(
        this._currentPageSignature,
        newSignature
      );

      if (changeScore >= this._config.significantChangeThreshold) {
        this._handlePageChange(newSignature, 'dom_mutation');
      }
    }
  }

  _handlePageChange(newSignature, trigger) {
    const previousSignature = this._currentPageSignature;
    this._currentPageSignature = newSignature;
    this._pageStats.significantChanges++;
    this._pageStats.lastChangeTimestamp = Date.now();

    const pageData = this._analyzeCurrentPage();
    
    const changeData = {
      trigger,
      url: this._currentUrl,
      previousSignature,
      newSignature,
      analysis: pageData,
      timestamp: new Date().toISOString()
    };

    this._logInfo('Page change detected', { trigger, url: this._currentUrl });
    
    this.emit('page:changed', changeData);

    if (this._config.enableFormDetection && pageData.forms.length > 0) {
      this.emit('forms:detected', {
        forms: pageData.forms,
        count: pageData.forms.length,
        url: this._currentUrl,
        trigger: 'page_change'
      });
    }
  }

  _handleAjaxComplete(request) {
    this.emit('page:ajax:complete', {
      url: request.url,
      status: request.status,
      type: request.type,
      timestamp: new Date().toISOString()
    });

    setTimeout(() => {
      this._checkForPageChange();
    }, this._config.domStabilizationDelay);
  }

  _handlePageShow() {
    this._checkUrlChange();
    this._checkForPageChange();
  }

  _generatePageSignature() {
    try {
      const elements = {
        title: document.title,
        forms: document.querySelectorAll('form').length,
        inputs: document.querySelectorAll('input, select, textarea').length,
        headings: document.querySelectorAll('h1, h2, h3').length,
        mainContent: document.querySelector('main, [role="main"], #main')?.innerHTML.length || 0,
        bodyClasses: document.body.className,
        dataAttributes: this._extractDataAttributes()
      };

      return JSON.stringify(elements);
    } catch (error) {
      this._handleError('Error generating page signature', error);
      return 'error-signature';
    }
  }

  _extractDataAttributes() {
    const dataAttrs = {};
    const relevantAttrs = ['data-page', 'data-view', 'data-route', 'data-app'];
    
    relevantAttrs.forEach(attr => {
      const element = document.querySelector(`[${attr}]`);
      if (element) {
        dataAttrs[attr] = element.getAttribute(attr);
      }
    });
    
    return dataAttrs;
  }

  _calculateChangeScore(oldSignature, newSignature) {
    try {
      const oldData = JSON.parse(oldSignature);
      const newData = JSON.parse(newSignature);
      
      let score = 0;
      
      if (oldData.title !== newData.title) score += 3;
      if (Math.abs(oldData.forms - newData.forms) > 0) score += 5;
      if (Math.abs(oldData.inputs - newData.inputs) > 2) score += 3;
      if (Math.abs(oldData.mainContent - newData.mainContent) > 100) score += 4;
      if (oldData.bodyClasses !== newData.bodyClasses) score += 2;
      
      const dataAttrChanges = Object.keys(oldData.dataAttributes).filter(
        key => oldData.dataAttributes[key] !== newData.dataAttributes[key]
      ).length;
      
      score += dataAttrChanges * 3;
      
      return score;
    } catch (error) {
      return 10;
    }
  }

  _analyzeCurrentPage() {
    const forms = Array.from(document.querySelectorAll('form')).map((form, index) => ({
      index,
      id: form.id || null,
      name: form.name || null,
      action: form.action || null,
      method: form.method || 'GET',
      fields: this._analyzeFormFields(form),
      attributes: this._extractElementAttributes(form)
    }));

    return {
      title: document.title,
      url: this._currentUrl,
      forms,
      hasAuthentication: this._detectAuthenticationElements(),
      timestamp: new Date().toISOString()
    };
  }

  _analyzeFormFields(form) {
    const fields = Array.from(form.querySelectorAll('input, select, textarea'));
    
    return fields.map(field => ({
      type: field.type || field.tagName.toLowerCase(),
      name: field.name || null,
      id: field.id || null,
      required: field.required || false,
      placeholder: field.placeholder || null
    }));
  }

  _extractElementAttributes(element) {
    const relevantAttrs = ['class', 'data-form-type', 'data-validation', 'data-submit-url'];
    const attrs = {};
    
    relevantAttrs.forEach(attr => {
      const value = element.getAttribute(attr);
      if (value) attrs[attr] = value;
    });
    
    return attrs;
  }

  _detectAuthenticationElements() {
    const authPatterns = [
      'input[type="password"]',
      'input[name*="password"]',
      'input[name*="email"][type="email"]',
      'input[name*="username"]',
      'button[type="submit"]:contains("Sign in")',
      'button[type="submit"]:contains("Log in")'
    ];

    return authPatterns.some(pattern => {
      try {
        return document.querySelector(pattern) !== null;
      } catch {
        return false;
      }
    });
  }

  _detectNavigationType(fromUrl, toUrl) {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    
    if (from.origin !== to.origin) return 'external';
    if (from.pathname !== to.pathname) return 'path_change';
    if (from.hash !== to.hash) return 'hash_change';
    if (from.search !== to.search) return 'query_change';
    
    return 'unknown';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageMonitor;
} else if (typeof window !== 'undefined') {
  window.PageMonitor = PageMonitor;
}