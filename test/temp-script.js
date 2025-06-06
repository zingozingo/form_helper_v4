
        // Debug: Confirm script is loading
        console.log('🟢 Script starting to load...');
        console.log('🟢 Current URL:', window.location.href);
        console.log('🔍 EventBus available:', typeof EventBus);
        console.log('🔍 BaseBlock available:', typeof BaseBlock);
        console.log('🔍 PageMonitor available:', typeof PageMonitor);
        
        let eventBus = null;
        let pageMonitor = null;
        let eventCount = 0;
        let isPaused = false;
        let eventQueue = [];
        let eventTimestamps = [];
        let eventsPerSec = 0;
        let lastUpdateTime = 0;
        let updateThrottle = null;
        let activeAnimations = new Set();
        let statsUpdateTimer = null;
        let systemStartTime = null;
        let currentFilter = 'all';
        let eventRateHistory = [];

        // Working Simple Display - NO COMPLEX FEATURES
        let workingEventsList = [];

        function addWorkingEvent(eventType) {
            console.log(`✅ Working Display adding: ${eventType}`);
            const timestamp = new Date().toLocaleTimeString();
            
            // Determine event category and icon
            let category = 'default';
            let icon = '🔸';
            
            if (eventType.includes('page:')) {
                category = 'page-event';
                icon = '🔵';
            } else if (eventType.includes('forms:')) {
                category = 'form-event';
                icon = '🟡';
            } else if (eventType.includes('module:')) {
                category = 'module-event';
                icon = '🟢';
            } else if (eventType.includes('test:') || eventType.includes('content:')) {
                category = 'test-event';
                icon = '🟣';
            }
            
            const eventData = {
                timestamp,
                type: eventType,
                category,
                icon
            };
            
            // Add to beginning of list
            workingEventsList.unshift(eventData);
            
            // Keep only last 20 events
            if (workingEventsList.length > 20) {
                workingEventsList = workingEventsList.slice(0, 20);
            }
            
            // Update display immediately
            updateWorkingDisplay();
            
            // Update stats
            updateStatsBar();
        }

        function updateWorkingDisplay() {
            const container = document.getElementById('workingEventsList');
            if (container) {
                if (workingEventsList.length === 0) {
                    container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Waiting for events...</div>';
                } else {
                    // Filter events based on current filter
                    const filteredEvents = currentFilter === 'all' 
                        ? workingEventsList 
                        : workingEventsList.filter(event => {
                            if (currentFilter === 'page') return event.category === 'page-event';
                            if (currentFilter === 'form') return event.category === 'form-event';
                            if (currentFilter === 'module') return event.category === 'module-event';
                            return false;
                        });
                    
                    if (filteredEvents.length === 0) {
                        container.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">No events match the current filter</div>';
                    } else {
                        container.innerHTML = filteredEvents.map(event => 
                            `<div class="working-event ${event.category}">
                                <span class="event-icon">${event.icon}</span>
                                <span>${event.timestamp}</span>
                                <span style="flex: 1; margin-left: 10px;">${event.type}</span>
                            </div>`
                    ).join('');
                }
            }
        }

        function clearWorkingEvents() {
            workingEventsList = [];
            updateWorkingDisplay();
        }

        // Stats Bar Functions
        function updateStatsBar() {
            // Update events per second
            const now = Date.now();
            eventTimestamps.push(now);
            
            // Keep only events from last 5 seconds
            const fiveSecondsAgo = now - 5000;
            eventTimestamps = eventTimestamps.filter(t => t > fiveSecondsAgo);
            
            const eventsInLastSecond = eventTimestamps.filter(t => t > now - 1000).length;
            document.getElementById('eventsPerSec').textContent = eventsInLastSecond;
            
            // Update total events
            document.getElementById('totalEvents').textContent = eventCount;
            
            // Update uptime
            if (systemStartTime) {
                const uptimeMs = now - systemStartTime;
                const minutes = Math.floor(uptimeMs / 60000);
                const seconds = Math.floor((uptimeMs % 60000) / 1000);
                document.getElementById('uptime').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
            
            // Update active modules
            let activeModules = 0;
            if (eventBus) activeModules++;
            if (pageMonitor && pageMonitor.getState && pageMonitor.getState() === 'running') activeModules++;
            document.getElementById('activeModules').textContent = activeModules;
        }
        
        // Filter Functions
        function filterEvents(type) {
            currentFilter = type;
            
            // Update button states
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-filter') === type);
            });
            
            // Update display
            updateWorkingDisplay();
        }
        
        // Collapsible Log Functions
        function toggleComplexLog() {
            const log = document.getElementById('complexEventLog');
            const button = log.querySelector('.collapse-toggle');
            
            if (log.classList.contains('collapsed')) {
                log.classList.remove('collapsed');
                button.textContent = 'Collapse ▲';
            } else {
                log.classList.add('collapsed');
                button.textContent = 'Expand ▼';
            }
        }
        
        // Start stats update timer
        setInterval(updateStatsBar, 1000);

        async function initializeSystem() {
            console.log('🔵 Initialize button clicked!');
            
            // Check if already initialized
            if (eventBus && pageMonitor) {
                console.warn('System already initialized');
                return;
            }
            
            try {
                console.log('🚀 Initializing Foundation Architecture...');
                
                // Create EventBus instance
                eventBus = new EventBus({
                    debugMode: true,
                    enforceModuleRegistration: true, // PageMonitor will register itself
                    errorIsolation: true,
                    performanceTracking: true
                });
                
                console.log('✅ EventBus created');
                
                // Create PageMonitor instance
                pageMonitor = new PageMonitor(eventBus, {
                    debugMode: true,
                    mutationThrottle: 250,  // Balanced for responsiveness
                    domStabilizationDelay: 300,  // Quick but stable
                    enableFormDetection: true,
                    enableAjaxMonitoring: true,
                    significantChangeThreshold: 8  // Higher threshold to prevent duplicate events
                });
                
                console.log('✅ PageMonitor created');
                
                // Set up event listeners to display in UI
                setupEventListeners();
                
                // Start PageMonitor
                await pageMonitor.start();
                console.log('✅ PageMonitor started');
                
                // Set system start time
                systemStartTime = Date.now();
                
                // Update UI
                updateStatus();
                enableControls(true);
                
                // Make available for debugging
                window.__eventBus = eventBus;
                window.__pageMonitor = pageMonitor;
                
                console.log('✅ System initialized successfully!');
                
            } catch (error) {
                console.error('❌ Initialization failed:', error);
                console.error('Error stack:', error.stack);
                alert(`Failed to initialize system: ${error.message}\n\nCheck console for details.`);
                
                // Reset UI
                document.getElementById('eventBusStatus').textContent = 'Error';
                document.getElementById('pageMonitorStatus').textContent = 'Error';
                document.getElementById('eventBusInfo').textContent = error.message;
            }
        }

        function setupEventListeners() {
            // Listen to all PageMonitor events
            const events = [
                'page:initial',
                'page:changed',
                'page:url:changed',
                'page:dom:mutated',
                'forms:detected',
                'page:ajax:complete',
                'module:started',
                'module:stopped',
                'module:state:changed',
                'module:error',
                'content:added',      // Manual content addition event
                'content:removed',    // Manual content removal event
                'test:direct:event'   // Single test event
            ];
            
            events.forEach(eventName => {
                eventBus.on(eventName, (data) => {
                    // Working display - direct call
                    addWorkingEvent(eventName);
                    
                    // Complex display - may have issues
                    logEvent(eventName, data);
                    updateStatus();
                });
            });
        }

        function logEvent(eventName, data) {
            eventCount++;
            console.log(`📊 Event Log received: ${eventName}`);
            
            // Always update statistics
            if (!statsUpdateTimer) {
                statsUpdateTimer = setTimeout(() => {
                    updateEventStats(eventName);
                    statsUpdateTimer = null;
                }, 250);
            }
            
            // If paused, queue the event
            if (isPaused) {
                eventQueue.push({ eventName, data, time: new Date() });
                // Limit queue size
                if (eventQueue.length > 50) {
                    eventQueue = eventQueue.slice(-50);
                }
                return;
            }
            
            // Add to queue for processing
            eventQueue.push({ eventName, data, time: new Date() });
            
            // Process queue with throttling
            processEventQueue();
        }
        
        function processEventQueue() {
            const now = Date.now();
            
            // If we're still in throttle period, schedule for later
            if (now - lastUpdateTime < 200) { // Increased from 100ms to 200ms
                if (!updateThrottle) {
                    updateThrottle = setTimeout(() => {
                        updateThrottle = null;
                        processEventQueue();
                    }, 200);
                }
                return;
            }
            
            // Process ONE event at a time for better visibility
            if (eventQueue.length > 0 && !isPaused) {
                const event = eventQueue.shift();
                console.log(`✅ Displaying event: ${event.eventName}`);
                displayEvent(event.eventName, event.data, event.time);
                lastUpdateTime = Date.now();
                
                // Delay before processing next event
                if (eventQueue.length > 0) {
                    setTimeout(() => processEventQueue(), 300); // Increased delay
                }
            }
        }

        // Event type configurations for icons and colors
        const eventConfig = {
            'page:initial': { icon: '🚀', color: '#667eea' },
            'page:changed': { icon: '✅', color: '#48bb78' },
            'page:url:changed': { icon: '🔗', color: '#667eea' },
            'page:dom:mutated': { icon: '⚡', color: '#ed8936' },
            'forms:detected': { icon: '📝', color: '#38a169' },
            'page:ajax:complete': { icon: '🔄', color: '#3182ce' },
            'module:started': { icon: '▶️', color: '#667eea' },
            'module:stopped': { icon: '⏹️', color: '#e53e3e' },
            'module:state:changed': { icon: '🔀', color: '#667eea' },
            'module:error': { icon: '❌', color: '#e53e3e' },
            'content:added': { icon: '➕', color: '#10b981' },
            'content:removed': { icon: '➖', color: '#f59e0b' },
            'test:direct:event': { icon: '🧪', color: '#8b5cf6' }
        };

        function formatEventData(eventName, data) {
            const lines = [];
            
            switch(eventName) {
                case 'page:initial':
                    lines.push(`Initial page scan completed`);
                    if (data?.url) lines.push(`URL: ${data.url}`);
                    if (data?.analysis?.forms?.length) {
                        lines.push(`Found ${data.analysis.forms.length} form(s) on page`);
                    }
                    break;
                    
                case 'page:changed':
                    lines.push(`Page content changed significantly`);
                    if (data?.trigger) lines.push(`Trigger: ${data.trigger.replace('_', ' ')}`);
                    if (data?.url) lines.push(`URL: ${data.url}`);
                    if (data?.analysis?.forms?.length) {
                        lines.push(`Forms on page: ${data.analysis.forms.length}`);
                    }
                    break;
                    
                case 'page:url:changed':
                    lines.push(`Navigation detected`);
                    if (data?.to) lines.push(`New URL: ${data.to}`);
                    if (data?.type) lines.push(`Type: ${data.type.replace('_', ' ')}`);
                    break;
                    
                case 'page:dom:mutated':
                    lines.push(`DOM changes detected`);
                    if (data?.summary) {
                        if (data.summary.addedForms > 0) {
                            lines.push(`Added ${data.summary.addedForms} form(s)`);
                        }
                        if (data.summary.removedForms > 0) {
                            lines.push(`Removed ${data.summary.removedForms} form(s)`);
                        }
                        if (data.summary.affectedElements) {
                            lines.push(`${data.summary.affectedElements} elements changed`);
                        }
                    }
                    break;
                    
                case 'forms:detected':
                    lines.push(`New forms discovered!`);
                    if (data?.count !== undefined && data?.previousCount !== undefined) {
                        lines.push(`Was: ${data.previousCount} → Now: ${data.count} forms`);
                    } else if (data?.count !== undefined) {
                        lines.push(`Total forms: ${data.count}`);
                    }
                    if (data?.forms?.[0]) {
                        const form = data.forms[0];
                        if (form.fields?.length) {
                            lines.push(`New form has ${form.fields.length} fields`);
                        }
                    }
                    break;
                    
                case 'module:started':
                    lines.push(`Module started successfully`);
                    if (data?.moduleId) lines.push(`Module: ${data.moduleId}`);
                    break;
                    
                case 'module:stopped':
                    lines.push(`Module stopped`);
                    if (data?.moduleId) lines.push(`Module: ${data.moduleId}`);
                    if (data?.uptime) lines.push(`Uptime: ${Math.floor(data.uptime / 1000)}s`);
                    break;
                    
                case 'module:state:changed':
                    lines.push(`Module state changed`);
                    if (data?.from && data?.to) {
                        lines.push(`${data.from} → ${data.to}`);
                    }
                    break;
                    
                case 'module:error':
                    lines.push(`Module error occurred`);
                    if (data?.error?.message) lines.push(`Error: ${data.error.message}`);
                    break;
                    
                case 'content:added':
                    lines.push(`Test content added to page`);
                    if (data?.type) lines.push(`Type: ${data.type}`);
                    if (data?.trigger) lines.push(`Trigger: ${data.trigger}`);
                    break;
                    
                case 'content:removed':
                    lines.push(`Test content removed from page`);
                    if (data?.type) lines.push(`Type: ${data.type}`);
                    if (data?.trigger) lines.push(`Trigger: ${data.trigger}`);
                    break;
                    
                case 'test:direct:event':
                    lines.push(`Direct test event`);
                    if (data?.type) lines.push(`Type: ${data.type}`);
                    if (data?.trigger) lines.push(`Trigger: ${data.trigger}`);
                    break;
                    
                default:
                    // For unknown events, try to extract key info
                    if (data) {
                        if (typeof data === 'string') {
                            lines.push(data);
                        } else if (data.message) {
                            lines.push(data.message);
                        } else if (data.type) {
                            lines.push(`Type: ${data.type}`);
                        }
                    }
            }
            
            return lines;
        }

        function displayEvent(eventName, data, time = new Date()) {
            const container = document.getElementById('eventContainer');
            
            // Safety check - prevent too many active animations
            if (activeAnimations.size > 50) {
                console.warn('Too many active animations, clearing old ones');
                activeAnimations.clear();
            }
            
            // Safety check - limit container children
            if (container.children.length >= 10) {
                // Remove oldest without animation
                const oldest = container.lastChild;
                if (oldest) {
                    container.removeChild(oldest);
                }
            }
            
            const eventItem = document.createElement('div');
            eventItem.className = 'event-item new';
            const itemId = `event-${Date.now()}-${Math.random()}`;
            eventItem.id = itemId;
            
            const timeStr = time.toLocaleTimeString();
            const config = eventConfig[eventName] || { icon: '🔍', color: '#718096' };
            const description = formatEventData(eventName, data);
            
            eventItem.style.borderLeftColor = config.color;
            eventItem.innerHTML = `
                <div class="event-header">
                    <span class="event-name"><span class="event-icon">${config.icon}</span> ${eventName}</span>
                    <span class="event-time">${timeStr}</span>
                </div>
                <div class="event-description">
                    ${description.map(line => `<div class="event-line">${line}</div>`).join('')}
                </div>
            `;
            
            container.insertBefore(eventItem, container.firstChild);
            activeAnimations.add(itemId);
            
            // Highlight transitions: new -> recent -> normal
            requestAnimationFrame(() => {
                // Remove 'new' class after 3 seconds
                setTimeout(() => {
                    if (eventItem.parentNode) {
                        eventItem.classList.remove('new');
                        eventItem.classList.add('recent');
                    }
                }, 3000);
                
                // Remove 'recent' class after 6 seconds
                setTimeout(() => {
                    if (eventItem.parentNode) {
                        eventItem.classList.remove('recent');
                    }
                    activeAnimations.delete(itemId);
                }, 6000);
            });
            
            // Remove old events immediately if over limit
            while (container.children.length > 10) {
                const oldest = container.lastChild;
                if (oldest && oldest.id) {
                    activeAnimations.delete(oldest.id);
                }
                container.removeChild(oldest);
            }
        }

        function updateEventStats(eventName) {
            // Update total count
            document.getElementById('totalEventCount').textContent = eventCount;
            
            // Update last event type
            document.getElementById('lastEventType').textContent = eventName.split(':')[0];
            
            // Calculate events per second
            const now = Date.now();
            eventTimestamps.push(now);
            
            // Keep only timestamps from last 5 seconds
            eventTimestamps = eventTimestamps.filter(ts => now - ts < 5000);
            
            // Calculate rate
            if (eventTimestamps.length > 1) {
                const timeRange = (now - eventTimestamps[0]) / 1000;
                eventsPerSec = (eventTimestamps.length / timeRange).toFixed(1);
            } else {
                eventsPerSec = 0;
            }
            
            document.getElementById('eventsPerSecond').textContent = eventsPerSec;
        }

        function togglePause() {
            isPaused = !isPaused;
            const pauseBtn = document.getElementById('pauseBtn');
            const container = document.getElementById('eventContainer');
            
            if (isPaused) {
                pauseBtn.textContent = '▶️ Resume';
                pauseBtn.classList.add('active');
                container.classList.add('paused');
            } else {
                pauseBtn.textContent = '⏸️ Pause';
                pauseBtn.classList.remove('active');
                container.classList.remove('paused');
                
                // Display queued events
                const queueCopy = [...eventQueue];
                eventQueue = [];
                queueCopy.forEach(({ eventName, data, time }) => {
                    displayEvent(eventName, data, time);
                });
            }
        }

        function updateStatus() {
            // Update EventBus status
            if (eventBus) {
                const stats = eventBus.getStats();
                document.getElementById('eventBusStatus').textContent = 'Active';
                document.getElementById('eventBusInfo').textContent = 
                    `${stats.totalEvents} events • ${stats.totalListeners} listeners • ${stats.totalModules} modules`;
                document.getElementById('eventBusCard').classList.add('active');
                document.querySelector('#eventBusCard .status-indicator').classList.add('active');
            }
            
            // Update PageMonitor status
            if (pageMonitor) {
                const state = pageMonitor.getState();
                const health = pageMonitor.getHealth();
                document.getElementById('pageMonitorStatus').textContent = 
                    state.charAt(0).toUpperCase() + state.slice(1);
                document.getElementById('pageMonitorInfo').textContent = 
                    `Uptime: ${Math.floor(health.uptime / 1000)}s • ${health.eventStats.emitted} events emitted`;
                
                if (state === 'running') {
                    document.getElementById('pageMonitorCard').classList.add('active');
                    document.querySelector('#pageMonitorCard .status-indicator').classList.add('active');
                }
            }
        }

        async function stopSystem() {
            try {
                // Clear any pending updates first
                if (updateThrottle) {
                    clearTimeout(updateThrottle);
                    updateThrottle = null;
                }
                if (statsUpdateTimer) {
                    clearTimeout(statsUpdateTimer);
                    statsUpdateTimer = null;
                }
                
                if (pageMonitor) {
                    await pageMonitor.stop();
                    console.log('✅ PageMonitor stopped');
                }
                
                eventBus = null;
                pageMonitor = null;
                
                document.getElementById('eventBusStatus').textContent = 'Stopped';
                document.getElementById('eventBusInfo').textContent = '-';
                document.getElementById('pageMonitorStatus').textContent = 'Stopped';
                document.getElementById('pageMonitorInfo').textContent = '-';
                
                document.querySelectorAll('.status-card').forEach(card => {
                    card.classList.remove('active');
                });
                document.querySelectorAll('.status-indicator').forEach(indicator => {
                    indicator.classList.remove('active');
                });
                
                // Clear event log
                clearEventLog();
                
                enableControls(false);
                
            } catch (error) {
                console.error('❌ Error stopping system:', error);
            }
        }

        function enableControls(enabled) {
            document.getElementById('initBtn').disabled = enabled;
            document.getElementById('stopBtn').disabled = !enabled;
            document.getElementById('pageChangeBtn').disabled = !enabled;
            document.getElementById('formBtn').disabled = !enabled;
            document.getElementById('domBtn').disabled = !enabled;
        }

        function simulatePageChange() {
            console.log('🔵 simulatePageChange button clicked');
            
            if (!eventBus || !pageMonitor) {
                alert('System not initialized! Click "Initialize System" first.');
                return;
            }
            
            // Force emit page:changed event immediately
            console.log('📤 Emitting page:changed event directly');
            eventBus.emit('page:changed', {
                trigger: 'manual_test',
                url: window.location.href,
                timestamp: new Date().toISOString(),
                analysis: {
                    title: document.title,
                    forms: []
                }
            });
            
            // Also do actual DOM changes for visual feedback
            const oldTitle = document.title;
            document.title = 'Page Changed - ' + new Date().toLocaleTimeString();
            document.body.className = 'page-changed-' + Date.now();
            
            // Add visible content
            const mainContent = document.querySelector('.container');
            if (mainContent) {
                const tempDiv = document.createElement('div');
                tempDiv.id = 'temp-page-change';
                tempDiv.style.cssText = 'background: #fef3c7; border: 2px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 8px;';
                tempDiv.innerHTML = '<h2>✅ Page Change Simulated!</h2><p>This triggered a page:changed event.</p>';
                mainContent.insertBefore(tempDiv, mainContent.firstChild);
                
                // Remove after 2 seconds
                setTimeout(() => {
                    if (tempDiv.parentNode) {
                        tempDiv.remove();
                    }
                    document.title = oldTitle;
                    document.body.className = '';
                }, 2000);
            }
        }

        function toggleTestForm() {
            if (!eventBus || !pageMonitor) {
                alert('System not initialized! Click "Initialize System" first.');
                return;
            }
            
            const formContainer = document.getElementById('testForm');
            const message = document.getElementById('formMessage');
            const existingForm = formContainer.querySelector('form');
            
            if (existingForm) {
                // Form exists - remove it silently (no event expected)
                existingForm.remove();
                formContainer.classList.remove('visible');
                message.textContent = 'Form removed (silent - no event expected)';
            } else {
                // No form - add it (forms:detected event expected)
                const newForm = document.createElement('form');
                newForm.onsubmit = (e) => { e.preventDefault(); alert('Form submitted!'); };
                newForm.innerHTML = `
                    <input type="text" placeholder="Username" name="username">
                    <input type="email" placeholder="Email" name="email">
                    <input type="password" placeholder="Password" name="password">
                    <button type="submit" class="btn btn-primary">Submit</button>
                `;
                formContainer.appendChild(newForm);
                formContainer.classList.add('visible');
                message.textContent = 'Form added - expecting forms:detected event';
            }
        }

        function addDynamicContent() {
            if (!eventBus || !pageMonitor) {
                alert('System not initialized! Click "Initialize System" first.');
                return;
            }
            
            const container = document.createElement('div');
            container.setAttribute('data-test-content', 'true');
            container.style.cssText = 'border: 2px solid #f59e0b; padding: 20px; margin: 20px; background: #fff3cd; border-radius: 8px;';
            container.innerHTML = `
                <div>
                    <h4>🧪 Test Content Added</h4>
                    <p>Time: ${new Date().toLocaleTimeString()}</p>
                    <p>This is test content added by the button.</p>
                    <input type="text" placeholder="Test input field" style="margin: 5px 0; padding: 5px;">
                    <br>
                    <button type="button" style="margin-top: 10px; padding: 5px 10px; background: #ef4444; color: white; border: none; border-radius: 4px;" onclick="
                        console.log('📤 Emitting content:removed event');
                        if (window.eventBus) {
                            window.eventBus.emit('content:removed', {
                                type: 'test-content',
                                trigger: 'remove-button',
                                timestamp: new Date().toISOString()
                            });
                        }
                        this.parentElement.parentElement.remove();
                    ">Remove This Content</button>
                </div>
            `;
            
            // First emit content:added event manually
            console.log('📤 Emitting content:added event');
            eventBus.emit('content:added', {
                type: 'test-content',
                trigger: 'manual-button',
                timestamp: new Date().toISOString()
            });
            
            // Then add to DOM - this will trigger page:dom:mutated naturally
            document.body.appendChild(container);
        }

        function clearEventLog() {
            const container = document.getElementById('eventContainer');
            
            // Clear immediately for performance
            container.innerHTML = '';
            eventCount = 0;
            eventQueue = [];
            eventTimestamps = [];
            activeAnimations.clear();
            
            // Clear any pending throttles
            if (updateThrottle) {
                clearTimeout(updateThrottle);
                updateThrottle = null;
            }
            if (statsUpdateTimer) {
                clearTimeout(statsUpdateTimer);
                statsUpdateTimer = null;
            }
            
            updateEventStats('');
        }

        // Test direct event emission
        function testDirectEvent() {
            console.log('🔵 Test Direct Event button clicked');
            
            if (!eventBus) {
                alert('EventBus not initialized!');
                return;
            }
            
            // Emit ONLY ONE specific test event
            eventBus.emit('test:direct:event', {
                type: 'manual-test',
                trigger: 'test-button',
                timestamp: Date.now()
            });
            console.log('📤 Emitted test:direct:event');
        }

        // Update status every second
        setInterval(() => {
            if (pageMonitor && pageMonitor.getState() === 'running') {
                updateStatus();
            }
        }, 1000);
        
        // Debug: Check if functions exist
        console.log('🔍 initializeSystem exists:', typeof initializeSystem);
        console.log('🔍 window.initializeSystem exists:', typeof window.initializeSystem);
        
        // Make functions globally accessible
        window.initializeSystem = initializeSystem;
        window.stopSystem = stopSystem;
        window.filterEvents = filterEvents;
        window.toggleComplexLog = toggleComplexLog;
        window.clearWorkingEvents = clearWorkingEvents;
        window.simulatePageChange = simulatePageChange;
        window.toggleTestForm = toggleTestForm;
        window.addDynamicContent = addDynamicContent;
        window.testDirectEvent = testDirectEvent;
        window.clearEventLog = clearEventLog;
        window.togglePause = togglePause;
        window.enableControls = enableControls;
        window.updateStatus = updateStatus;
        
        console.log('🔍 After assignment - window.initializeSystem exists:', typeof window.initializeSystem);
        
        // Set up event listeners when DOM is ready
        document.addEventListener('DOMContentLoaded', function() {
            console.log('📄 DOM Content Loaded');
            
            const initBtn = document.getElementById('initBtn');
            console.log('🔍 Initialize button found:', !!initBtn);
            
            if (initBtn) {
                initBtn.addEventListener('click', function(e) {
                    console.log('🖱️ Initialize button clicked via addEventListener');
                    e.preventDefault();
                    initializeSystem();
                });
                console.log('✅ Click listener attached to Initialize button');
            } else {
                console.error('❌ Initialize button not found!');
            }
            
            // Check for any script errors
            window.addEventListener('error', function(e) {
                console.error('🚨 JavaScript Error:', e.message, 'at', e.filename, ':', e.lineno);
            });
        });
        
        // Additional error handler for syntax errors
        window.onerror = function(msg, url, lineNo, columnNo, error) {
            console.error('🚨 Global Error:', msg, 'at line', lineNo);
            return false;
        };
        
        console.log('🟢 Script finished loading');
        
    