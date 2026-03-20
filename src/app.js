class AuthError extends Error {
    constructor(message) { super(message); this.name = 'AuthError'; }
}

class Slingr {
    constructor(app, env, token) {
        this.url = `https://${app}.slingrs.io/${env}/runtime/api`;
        this.token = token;
    }

    login = async (email, password) => {
        let res = await fetch(`${this.url}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
            throw new Error(`[${res.status}] ${res.statusText}`);
        }
        let data = await res.json();
        this.token = data.token;
        this.user = data.user;
        return res;
    }

    getCurrentUser = async () => {
        if (!this.token) {
            throw new Error('Not logged in');
        }
        this.user = await this.get('/users/current');
        return this.user;
    }

    request = async (method, path, params = {}, payload) => {
        let query = new URLSearchParams(params);
        let url = `${this.url}${path}?${query}`;
        let opts = {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Token': this.token },
        }
        if (payload) opts.body = JSON.stringify(payload);
        let res = await fetch(url, opts);
        if (!res.ok) throw new Error(`[${res.status}] ${res.statusText}`);
        return await res.json();
    }

    get = (path, params = {}) => {
        return this.request('GET', path, params);
    }

    post = (path, payload) => {
        return this.request('POST', path, {}, payload);
    }

    put = (path, payload) => {
        return this.request('PUT', path, {}, payload);
    }

    delete = (path) => {
        return this.request('DELETE', path);
    }
}

class ViewModel {
    constructor() {
        this.slingr = new Slingr('solutions', 'prod');

        // Login
        this.email = ko.observable(localStorage.getItem('solutions:timetracking:email') || null);
        this.pass = ko.observable(null);
        this.logginIn = ko.observable(false);
        this.logged = ko.observable(false);
        this.logged.subscribe(val => {
            if (val) {
                this.addToast('Logged in');
                this.initCalendar();
            }
        });

        let token = localStorage.getItem('solutions:timetracking:token');
        if (token) {
            console.log('Using token', token);
            this.slingr.token = token;
            this.logginIn(true);
            this.slingr.getCurrentUser()
            .then(user => {
                console.log('Logged in as', user);
                this.logged(true);
                localStorage.setItem('solutions:timetracking:token', this.slingr.token);
            })
            .catch(e => {
                console.warn('Invalid token', e);
                this.slingr.token = null;
                localStorage.removeItem('solutions:timetracking:token');
                this.logged(false);
                this.addToast('Invalid token or expired', 'error');
            })
            .finally(e => {
                this.logginIn(false);
            });

            const storedHours = localStorage.getItem('solutions:timetracking:dailyWorkHours');
            this.dailyWorkHours = ko.observable(storedHours ? parseInt(storedHours, 10) : 8);
            // Subscribe to changes so it saves and updates the dashboard automatically
            this.dailyWorkHours.subscribe(val => {
                localStorage.setItem('solutions:timetracking:dailyWorkHours', val);
                this.updateDashboard();
            });
        }
        
        // App State
        this.loading = ko.observable(false);
        this.logged = ko.observable(false);
        this.meetingState = ko.observable('login'); // 'login', 'setup', 'active', 'summary'
        
        // Setup State
        this.projects = ko.observableArray([]);
        this.selectedProject = ko.observable(null);
        this.availableParticipants = ko.observableArray([]);
        
        this.devReleases = ko.observableArray([]);
        this.stagingReleases = ko.observableArray([]);
        this.productionReleases = ko.observableArray([]);
        this.selectedParticipants = ko.observableArray([]);
        this.durationPerPerson = ko.observable(2);
        
        // Active Meeting State
        this.queue = ko.observableArray([]);
        this.activeSpeaker = ko.observable(null);
        this.activeTasks = ko.observableArray([]);
        this.parkingLot = ko.observableArray([]);
        this.blockers = ko.observableArray([]);
        this.actionItems = ko.observableArray([]);
        this.notes = ko.observableArray([]);
        this.currentBlockerInput = ko.observable('');
        this.currentParkingLotInput = ko.observable('');
        this.currentActionItemInput = ko.observable('');
        
        // Timer Engine
        this.remainingSeconds = ko.observable(0);
        this.isTimerRunning = ko.observable(false);
        this.timerInterval = null;
        this.totalMeetingTime = ko.observable(0);
        this.totalInterval = null;
        
        // Summary
        this.markdownSummary = ko.observable('');

        // Theme & UI
        this.theme = ko.observable(localStorage.getItem('solutions:pandadailies:theme') || 'dark');
        this.isDarkMode = ko.computed({
            read: () => this.theme() === 'dark',
            write: (v) => this.theme(v ? 'dark' : 'light')
        });
        this.theme.subscribe(v => {
            localStorage.setItem('solutions:pandadailies:theme', v);
            document.documentElement.setAttribute('data-bs-theme', v);
        });

        this.toasts = ko.observableArray([]);

        // Watchers
        this.selectedProject.subscribe(proj => {
            if (proj) this.fetchParticipants(proj.id);
        });


        // Computed Timer Visuals
        this.timerDisplay = ko.computed(() => {
            const sec = this.remainingSeconds();
            const absSec = Math.abs(sec);
            const m = Math.floor(absSec / 60).toString().padStart(2, '0');
            const s = (absSec % 60).toString().padStart(2, '0');
            return (sec < 0 ? '-' : '') + `${m}:${s}`;
        });

        this.timerColorClass = ko.computed(() => {
            const sec = this.remainingSeconds();
            if (sec > 60) return 'text-success';
            if (sec > 0) return 'text-warning';
            return 'text-danger animate-flash';
        });

        this.checkSession();
    }

    // --- AUTH ---
    checkSession = async () => {
        let token = localStorage.getItem('solutions:timetracking:token');
        if (token) {
            this.slingr.token = token;
            this.loading(true);
            try {
                await this.slingr.getCurrentUser();
                this.handleLoginSuccess();
            } catch (e) {
                this.logout();
            }
            this.loading(false);
        }
    }

    login = async () => {
        this.loading(true);
        this.slingr.token = null;
        try {
            await this.slingr.login(this.email(), this.pass());
        } catch (e) {
            this.addToast('Invalid email or password', 'error');
        }
        if (this.slingr.token) {
            localStorage.setItem('solutions:timetracking:email', this.email());
            localStorage.setItem('solutions:timetracking:token', this.slingr.token);
            let user = await this.slingr.getCurrentUser();
            console.log('Logged', user);
            this.logged(true)
            this.handleLoginSuccess();
        }
        this.pass('');
        this.loading(false);
    }

    logout = () => {
        localStorage.removeItem('solutions:timetracking:token');
        this.slingr.token = null;
        this.logged(false);
        this.meetingState('login');
    }

    handleLoginSuccess = () => {
        this.logged(true);
        this.meetingState('setup');
        this.fetchProjects();
    }

    // --- SETUP API CALLS ---
    fetchProjects = async () => {
        try {
            let { items } = await this.slingr.get('/data/projects', {
                'members.user': model.slingr.user.id,
                _sortField: 'name',
                _size: 1000,
                _sortField: 'name',
                _sortType: 'asc',
            });
            this.projects(items.map(p => ({ id: p.id, name: p.label })));
        } catch (e) {
            this.addToast('Failed to load projects.', 'error');
        }
    }

    fetchParticipants = async (projectId) => {
        try {
            // Fetch the specific project to get the full members array
            let projectData = await this.slingr.get(`/data/projects/${projectId}`);
            
            if (projectData && projectData.members) {
                const allowedRoles = [
                    'teamlead', 
                    'developer', 
                    'qa', 
                    'projectmanager',
                ];

                // Map the nested user structure into a flat array for the UI
                let formatted = projectData.members
                    .filter(m => m.role && allowedRoles.includes(m.role.toLowerCase().replaceAll(' ', '')))
                    .map(m => ({
                        id: m.user.id,
                        name: m.user.label,
                        role: m.role
                    }));

                // Sort alphabetically so the team isn't jumbled
                formatted.sort((a, b) => a.name.localeCompare(b.name));
                
                this.availableParticipants(formatted);
                this.selectedParticipants([...formatted]); // Check all boxes by default
            }
        } catch (e) {
            this.addToast('Failed to load project participants.', 'error');
        }
    }

     fetchReleases = async () => {
        if (!this.selectedProject()) return;
    
        const projectId = this.selectedProject().id;
    
        try {
            // Development Releases
            let devQuery = {
                project: projectId,
                type: 'release',
                status: 'toDo,inProgress,completed',
                _sortField: 'releaseInformation.number',
                _sortType: 'desc',
                _size: 1000
            };
    
            // Staging Releases
            let stagingQuery = {
                project: projectId,
                type: 'release',
                status: 'staging',
                _sortField: 'releaseInformation.number',
                _sortType: 'desc',
                _size: 1000
            };
    
            // Production Releases
            let productionQuery = {
                project: projectId,
                type: 'release',
                status: 'released',
                _sortField: 'releaseInformation.number',
                _sortType: 'desc',
                _size: 1
            };
    
            const [devRes, stagingRes, productionRes] = await Promise.all([
                this.slingr.get('/data/dev.tasks', devQuery),
                this.slingr.get('/data/dev.tasks', stagingQuery),
                this.slingr.get('/data/dev.tasks', productionQuery)
            ]);
    
            this.devReleases(devRes.items || []);
            this.stagingReleases(stagingRes.items || []);
            this.productionReleases(productionRes.items || []);
    
        } catch (error) {
            console.error("Error fetching releases:", error);
            this.addToast('Failed to load releases.', 'error');
        }
    };


    updateDurationPerPerson = (amount) => {
        let current = this.durationPerPerson();
        let newValue = current + amount;
        if (newValue >= 1) {
            this.durationPerPerson(current + amount);
        }
    }

    // --- MEETING CORE LOOP ---
    startMeeting = () => {
        // Shuffle array (Fisher-Yates)
        let array = [...this.selectedParticipants()];
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        
        this.queue(array);
        this.parkingLot([]);
        this.actionItems([]);
        this.blockers([]);
        this.notes([]);
        this.totalMeetingTime(0);
        this.meetingState('active');
        this.fetchReleases();
        
        // Start total meeting timer tracking
        this.totalInterval = setInterval(() => this.totalMeetingTime(this.totalMeetingTime() + 1), 1000);
        
        this.nextSpeaker();
    }

    nextSpeaker = () => {
        if (this.queue().length === 0) {
            this.endMeeting();
            return;
        }

        const next = this.queue.shift();
        this.activeSpeaker(next);
        this.fetchTasksForUser(next.id);
        
        let remainingSeconds = parseInt(this.durationPerPerson()) * 60;
        this.remainingSeconds(remainingSeconds);
        if (!this.isTimerRunning()) {
            this.toggleTimer();
        }
    }

    toggleTimer = () => {
        if (this.isTimerRunning()) {
            clearInterval(this.timerInterval);
            this.isTimerRunning(false);
        } else {
            this.isTimerRunning(true);
            this.timerInterval = setInterval(() => {
                this.remainingSeconds(this.remainingSeconds() - 1);
            }, 1000);
        }
    }

    fetchTasksForUser = async (userId) => {
        this.activeTasks([]);
        try {
            const projectId = this.selectedProject().id;
            
            // Query 1: Tasks where the user is an assignee and it's active
            let assignedQuery = {
                project: projectId,
                'assignees.id': userId,
                type: 'notEquals(release)',
                status: 'toDo,inProgress,staging,completed',
                _size: 1000
            };
            
            // Query 2: Tasks where the user is a reviewer
            let reviewQuery = {
                project: projectId,
                'reviewers.id': userId,
                status: 'inReview',
                _size: 1000
            };

            // Fire both queries simultaneously for speed
            let [assignedRes, reviewRes] = await Promise.all([
                this.slingr.get('/data/dev.tasks', assignedQuery).catch(() => ({ items: [] })),
                this.slingr.get('/data/dev.tasks', reviewQuery).catch(() => ({ items: [] }))
            ]);

            // Map assigned tasks
            let tasks = assignedRes.items.map(t => ({
                id: t.id,
                number: t.number,
                title: t.title || t.label, // Fallback to label if title is empty
                status: t.status,
                type: t.type,
                relation: 'Assignee'
            }));

            // Map review tasks (preventing duplicates if they are somehow both)
            let existingIds = new Set(tasks.map(t => t.id));
            reviewRes.items.forEach(t => {
                if (!existingIds.has(t.id)) {
                    tasks.push({
                        id: t.id,
                        number: t.number,
                        title: t.title || t.label,
                        status: t.status,
                        type: t.type,
                        relation: 'Reviewer'
                    });
                }
            });

            this.activeTasks(tasks);
        } catch (e) {
            console.error("Error fetching tasks for user:", e);
        }
    }

    // --- EDGE CASES ---
    skipSpeaker = () => {
        if (this.activeSpeaker()) {
            this.queue.push(this.activeSpeaker());
            this.nextSpeaker();
        }
    }

    markAbsent = () => {
        if (this.activeSpeaker()) {
            this.addNoteToNotes(`${this.activeSpeaker().name} was absent.`);
            this.nextSpeaker();
        }
    }

    // --- SPLIT NOTES & SUMMARY ---
    addActionItem = () => {
        if (this.currentActionItemInput().trim() !== '') {
            this.addNoteToActionItems(`[${this.activeSpeaker() ? this.activeSpeaker().name : 'General'}]: ${this.currentActionItemInput()}`);
            this.currentActionItemInput('');
        }
    }

    addBlocker = () => {
        if (this.currentBlockerInput().trim() !== '') {
            this.addNoteToBlockers(`[${this.activeSpeaker() ? this.activeSpeaker().name : 'General'}]: ${this.currentBlockerInput()}`);
            this.currentBlockerInput('');
        }
    }

    addParkingLotTopic = () => {
        if (this.currentParkingLotInput().trim() !== '') {
            this.addNoteToParkingLot(`[${this.activeSpeaker() ? this.activeSpeaker().name : 'General'}]: ${this.currentParkingLotInput()}`);
            this.currentParkingLotInput('');
        }
    }

    addNoteToNotes = (text) => {
        this.notes.push({ text });
    }

    addNoteToParkingLot = (text) => {
        this.parkingLot.push({ text });
    }

    addNoteToBlockers = (text) => {
        this.blockers.push({ text });
    }

    addNoteToActionItems = (text) => {
        this.actionItems.push({ text });
    }

    endMeeting = () => {
        clearInterval(this.timerInterval);
        clearInterval(this.totalInterval);
        this.isTimerRunning(false);
        this.activeSpeaker(null);
        this.generateSummary();
        this.meetingState('summary');
    }

    generateSummary = () => {
        const projName = this.selectedProject() ? this.selectedProject().name : 'Unknown';
        const mins = Math.floor(this.totalMeetingTime() / 60);
        const secs = this.totalMeetingTime() % 60;
        
        let md = `🐼 *Panda-Dailies Summary*\n`;
        md += `💼 *Project Name:* ${projName}\n`;
        md += `⏱️ *Total Time:* ${mins}m ${secs}s\n`;
        md += `👥 *Participants:* ${this.selectedParticipants().map(p => p.name).join(', ')}\n\n`;
        
        let hasActionItems = this.actionItems().length > 0;
        let hasBlockers = this.blockers().length > 0;
        let hasParkingLot = this.parkingLot().length > 0;
        let hasNotes = this.notes().length > 0;
        
        if (! hasActionItems && ! hasBlockers && ! hasParkingLot && ! hasNotes) {
            md += `*No notes recorded today.*\n`;
        } else {
            md += `*Notes:*\n\n`;

            if (this.actionItems().length) {
                md += `*Action Items:*\n`;
                this.actionItems().forEach(note => {
                    md += `- 🗒️ ${note.text}\n`;
                });
            }
            if (this.blockers().length) {
                md += `*Blockers:*\n`;
                this.blockers().forEach(note => {
                    md += `- 🛑 ${note.text}\n`;
                });
            }
            if (this.parkingLot().length) {
                md += `*Parking Lot:*\n`;
                this.parkingLot().forEach(note => {
                    md += `- 🛻 ${note.text}\n`;
                });
            }
            if (this.notes().length) {
                md += `*General Notes:*\n`;
                this.notes().forEach(note => {
                    md += `- ${note.text}\n`;
                });
            }
        }
        this.markdownSummary(md);
    }

    copySummary = () => {
        navigator.clipboard.writeText(this.markdownSummary()).then(() => {
            this.addToast('Summary copied to clipboard!', 'success');
        });
    }

    resetMeeting = () => {
        this.meetingState('setup');
    }

    // --- UTILS ---
    addToast = (msg, type = 'info') => {
        this.toasts.push({ msg, title: type.charAt(0).toUpperCase() + type.slice(1) });
        setTimeout(() => this.toasts.shift(), 3000);
    }
    removeToast = (toast) => this.toasts.remove(toast);
}

// Custom select2 binding (reused from your code)
ko.bindingHandlers.select2 = {
    init: function(element, valueAccessor, allBindings) {
        $(element).select2(ko.unwrap(valueAccessor()) || {});
        const value = allBindings.get('value');
        if (ko.isObservable(value)) {
            $(element).on('change', () => value($(element).val() ? ko.dataFor($(element).find(':selected')[0]) : null));
        }
        ko.utils.domNodeDisposal.addDisposeCallback(element, () => $(element).select2('destroy'));
    },
    update: function(element, valueAccessor, allBindings) {
        const value = allBindings.get('value');
        if (ko.isObservable(value) && !$(element).is(':focus')) {
            $(element).val(ko.unwrap(value) ? ko.unwrap(value).id : null).trigger('change.select2');
        }
    }
};

const model = new ViewModel();

document.addEventListener('DOMContentLoaded', () => {
    ko.applyBindings(model);
});