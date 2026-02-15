// CollabCode Classroom - Educational Live Coding Platform

(function() {
    'use strict';

    const CURSOR_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#dda0dd', '#87ceeb', '#f0e68c', '#deb887'];
    
    const DEFAULT_CODE = `// Welcome to CollabCode Classroom!
// Your teacher will guide you through this lesson.

// Let's start with a simple function
function greet(name) {
    return "Hello, " + name + "!";
}

// Try calling the function
console.log(greet("Student"));
`;

    const state = {
        userId: null,
        username: '',
        role: 'teacher', // 'teacher' or 'student'
        colorIndex: 0,
        roomId: null,
        isTeaching: false,
        codeLocked: false,
        following: null,
        students: new Map(),
        editor: null
    };

    const elements = {};

    function generateId(length = 6) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function showToast(message, type = 'info') {
        const container = elements.toastContainer;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle';
        toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // BroadcastChannel
    let broadcastChannel = null;

    function initBroadcastChannel() {
        if (!state.roomId) return;
        try {
            broadcastChannel = new BroadcastChannel(`collabcode-classroom-${state.roomId}`);
            broadcastChannel.onmessage = handleBroadcastMessage;
        } catch (e) {
            console.warn('BroadcastChannel not supported');
        }
    }

    function handleBroadcastMessage(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'user-join':
                handleUserJoin(msg.userId, msg.username, msg.role, msg.colorIndex);
                break;
            case 'code-change':
                if (state.role === 'student' || !state.codeLocked) {
                    handleCodeChange(msg.userId, msg.content);
                }
                break;
            case 'cursor-move':
                handleCursorMove(msg.userId, msg.position, msg.username, msg.colorIndex);
                if (state.following === msg.userId) {
                    followCursor(msg.position);
                }
                break;
            case 'class-start':
                if (state.role === 'student') {
                    showToast('Class has started!', 'success');
                }
                updateTeachingStatus(true);
                break;
            case 'code-lock':
                handleCodeLock(msg.locked, msg.userId);
                break;
            case 'run-code':
                handleRunCode(msg.output);
                break;
        }
    }

    function broadcast(type, data) {
        if (broadcastChannel) {
            broadcastChannel.postMessage({ type, ...data });
        }
    }

    // Monaco Editor
    function initMonacoEditor() {
        return new Promise((resolve) => {
            require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
            require(['vs/editor/editor.main'], function() {
                monaco.editor.defineTheme('classroom-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [],
                    colors: {
                        'editor.background': '#1e1e1e',
                        'editor.foreground': '#d4d4d4'
                    }
                });

                state.editor = monaco.editor.create(document.getElementById('monacoEditor'), {
                    value: DEFAULT_CODE,
                    language: 'javascript',
                    theme: 'classroom-dark',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 14,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: 'on',
                    padding: { top: 10 }
                });

                state.editor.onDidChangeCursorPosition((e) => {
                    updateCursorPosition(e.position);
                    if (state.role === 'teacher' && state.isTeaching) {
                        broadcastCursorPosition(e.position);
                    }
                });

                let debounceTimer = null;
                state.editor.onDidChangeModelContent(() => {
                    if (state.role === 'student' && state.codeLocked) return;
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        broadcastCodeChange(state.editor.getValue());
                    }, 150);
                });

                resolve();
            });
        });
    }

    function updateCursorPosition(position) {
        elements.cursorPosition.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
    }

    function broadcastCursorPosition(position) {
        broadcast('cursor-move', {
            userId: state.userId,
            username: state.username,
            position: position,
            colorIndex: state.colorIndex
        });
    }

    function broadcastCodeChange(content) {
        broadcast('code-change', { userId: state.userId, content: content });
    }

    function handleCodeChange(userId, content) {
        if (userId === state.userId || !state.editor) return;
        const position = state.editor.getPosition();
        state.editor.setValue(content);
        if (position) state.editor.setPosition(position);
    }

    // Remote Cursors
    const remoteCursors = new Map();

    function handleCursorMove(userId, position, username, colorIndex) {
        if (userId === state.userId) return;
        
        let cursor = remoteCursors.get(userId);
        if (!cursor) {
            cursor = createRemoteCursor(userId, username, colorIndex);
            remoteCursors.set(userId, cursor);
        }
        updateRemoteCursorPosition(cursor, position);
    }

    function createRemoteCursor(userId, username, colorIndex) {
        const color = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.innerHTML = `
            <div class="remote-cursor-caret" style="background: ${color}"></div>
            <div class="remote-cursor-label" style="background: ${color}">${username}</div>
        `;
        document.getElementById('monacoEditor').appendChild(cursor);
        return { element: cursor, username, colorIndex };
    }

    function updateRemoteCursorPosition(cursor, position) {
        if (!state.editor) return;
        try {
            const coords = state.editor.getScrolledVisiblePosition({
                lineNumber: position.lineNumber,
                column: position.column
            });
            if (coords) {
                const editorRect = document.getElementById('monacoEditor').getBoundingClientRect();
                cursor.element.style.left = `${editorRect.left + coords.left}px`;
                cursor.element.style.top = `${editorRect.top + coords.top}px`;
            }
        } catch (e) {}
    }

    function followCursor(position) {
        if (!state.editor || !position) return;
        state.editor.revealPositionInCenter(position);
        state.editor.setPosition(position);
    }

    // Student Management
    function handleUserJoin(userId, username, role, colorIndex) {
        if (state.students.has(userId)) return;
        
        state.students.set(userId, { username, role, colorIndex });
        
        // Add to participant avatars
        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.style.backgroundColor = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
        avatar.textContent = username.charAt(0).toUpperCase();
        avatar.title = username;
        elements.participants.appendChild(avatar);
        
        // Add to student list
        if (role === 'student') {
            addStudentToList(userId, username, colorIndex);
            updateStudentCount();
        }
        
        if (state.role === 'teacher') {
            showToast(`${username} joined the class`, 'success');
        }
    }

    function addStudentToList(userId, username, colorIndex) {
        const list = elements.studentList;
        const item = document.createElement('div');
        item.className = 'student-item';
        item.id = `student-${userId}`;
        item.innerHTML = `
            <div class="student-avatar" style="background: ${CURSOR_COLORS[colorIndex % CURSOR_COLORS.length]}">${username.charAt(0).toUpperCase()}</div>
            <div class="student-info">
                <div class="student-name">${username}</div>
                <div class="student-status">Joined</div>
            </div>
        `;
        item.addEventListener('click', () => toggleFollow(userId));
        list.appendChild(item);
    }

    function toggleFollow(userId) {
        if (state.following === userId) {
            state.following = null;
            showToast('Unfollowed student', 'info');
        } else {
            state.following = userId;
            const student = state.students.get(userId);
            showToast(`Following ${student?.username}`, 'info');
        }
        updateStudentListStyles();
    }

    function updateStudentListStyles() {
        document.querySelectorAll('.student-item').forEach(item => {
            const userId = item.id.replace('student-', '');
            item.classList.toggle('following', state.following === userId);
            const statusEl = item.querySelector('.student-status');
            if (state.following === userId) {
                statusEl.textContent = 'Following';
                statusEl.classList.add('following');
            } else {
                statusEl.textContent = 'Watching';
                statusEl.classList.remove('following');
            }
        });
    }

    function updateStudentCount() {
        const count = state.students.size;
        elements.studentCount.textContent = count;
        elements.studentCountBadge.textContent = count;
    }

    function updateTeachingStatus(teaching) {
        state.isTeaching = teaching;
        const status = document.getElementById('teachingMode');
        const dot = status.querySelector('i');
        
        if (teaching) {
            status.innerHTML = '<i class="fas fa-circle"></i> Live Teaching';
            status.style.color = '#ff9800';
        } else {
            status.innerHTML = '<i class="far fa-circle"></i> Ready';
            status.style.color = '';
        }
        
        const statusDot = document.querySelector('.connection-status .status-dot');
        statusDot.classList.toggle('teaching', teaching);
    }

    // Code Lock
    function handleCodeLock(locked, userId) {
        state.codeLocked = locked;
        
        const statusEl = document.getElementById('codeStatus');
        const lockBtn = document.getElementById('lockCode');
        
        if (locked) {
            statusEl.innerHTML = '<i class="fas fa-lock"></i> Code locked by teacher';
            statusEl.classList.add('locked');
            lockBtn.innerHTML = '<i class="fas fa-unlock"></i> Unlock Code';
            if (state.editor) {
                state.editor.updateOptions({ readOnly: true });
            }
        } else {
            statusEl.innerHTML = '<i class="fas fa-unlock"></i> Editing enabled';
            statusEl.classList.remove('locked');
            lockBtn.innerHTML = '<i class="fas fa-lock"></i> Lock Code';
            if (state.editor) {
                state.editor.updateOptions({ readOnly: false });
            }
        }
    }

    // Run Code
    function handleRunCode(output) {
        const outputContent = elements.outputContent;
        outputContent.textContent = output || 'No output';
        elements.outputPanel.style.display = 'flex';
    }

    function runCode() {
        if (!state.editor) return;
        
        const code = state.editor.getValue();
        let output = '';
        
        // Capture console.log
        const originalLog = console.log;
        const logs = [];
        console.log = function(...args) {
            logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
        };
        
        try {
            // Simple evaluation (in production, use a sandboxed runner)
            new Function(code)();
            output = logs.join('\n') || 'Code executed successfully (no output)';
        } catch (e) {
            output = 'Error: ' + e.message;
        }
        
        console.log = originalLog;
        
        // Show output
        elements.outputContent.textContent = output;
        elements.outputPanel.style.display = 'flex';
        
        // Broadcast to students
        if (state.role === 'teacher') {
            broadcast('run-code', { output });
        }
    }

    // Room Management
    function createRoom() {
        state.roomId = generateId(8);
        state.userId = generateId();
        state.role = document.querySelector('.role-card.active').dataset.role;
        state.colorIndex = 0;
        
        const url = new URL(window.location);
        url.searchParams.set('room', state.roomId);
        window.history.pushState({}, '', url);
        
        initBroadcastChannel();
        
        // Update UI for role
        updateRoleUI();
        
        state.students.set(state.userId, { username: state.username, role: state.role, colorIndex: 0 });
        
        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.style.backgroundColor = CURSOR_COLORS[0];
        avatar.textContent = state.username.charAt(0).toUpperCase();
        avatar.title = state.username;
        elements.participants.appendChild(avatar);
        
        elements.roomId.textContent = state.roomId;
        
        broadcast('user-join', { 
            userId: state.userId, 
            username: state.username, 
            role: state.role, 
            colorIndex: state.colorIndex 
        });
        
        elements.welcomeModal.classList.add('hidden');
        showToast('Classroom created! Share the link.', 'success');
    }

    function joinRoom(roomCode) {
        if (!roomCode || roomCode.length < 4) {
            showToast('Invalid class code', 'error');
            return;
        }
        
        state.roomId = roomCode.trim().toLowerCase();
        state.userId = generateId();
        state.role = document.querySelector('.role-card.active').dataset.role;
        state.colorIndex = Math.floor(Math.random() * CURSOR_COLORS.length);
        
        const url = new URL(window.location);
        url.searchParams.set('room', state.roomId);
        window.history.pushState({}, '', url);
        
        initBroadcastChannel();
        updateRoleUI();
        
        state.students.set(state.userId, { username: state.username, role: state.role, colorIndex: state.colorIndex });
        
        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.style.backgroundColor = CURSOR_COLORS[state.colorIndex];
        avatar.textContent = state.username.charAt(0).toUpperCase();
        avatar.title = state.username;
        elements.participants.appendChild(avatar);
        
        elements.roomId.textContent = state.roomId;
        
        broadcast('user-join', { 
            userId: state.userId, 
            username: state.username, 
            role: state.role, 
            colorIndex: state.colorIndex 
        });
        
        elements.welcomeModal.classList.add('hidden');
        showToast(`Joined class ${state.roomId}`, 'success');
    }

    function updateRoleUI() {
        const badge = document.getElementById('roleBadge');
        const icon = badge.querySelector('i');
        const text = badge.querySelector('span');
        
        if (state.role === 'teacher') {
            badge.classList.remove('student');
            icon.className = 'fas fa-chalkboard-teacher';
            text.textContent = 'Teacher';
            document.getElementById('startClass').style.display = 'flex';
            document.getElementById('lockCode').style.display = 'flex';
        } else {
            badge.classList.add('student');
            icon.className = 'fas fa-user-graduate';
            text.textContent = 'Student';
            document.getElementById('startClass').style.display = 'none';
            document.getElementById('lockCode').style.display = 'none';
        }
    }

    function checkUrlForRoom() {
        const url = new URL(window.location);
        const roomCode = url.searchParams.get('room');
        if (roomCode) {
            elements.roomCodeInput.value = roomCode;
            return true;
        }
        return false;
    }

    // Event Listeners
    function initEventListeners() {
        // Role selection
        document.querySelectorAll('.role-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.role-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            });
        });

        // Create/Join
        document.getElementById('createRoom').addEventListener('click', () => {
            state.username = document.getElementById('usernameInput').value || 'Anonymous';
            createRoom();
        });

        document.getElementById('joinRoom').addEventListener('click', () => {
            state.username = document.getElementById('usernameInput').value || 'Anonymous';
            joinRoom(document.getElementById('roomCodeInput').value);
        });

        // Copy link
        document.getElementById('copyRoomLink').addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href).then(() => {
                showToast('Class link copied!', 'success');
            }).catch(() => showToast('Failed to copy', 'error'));
        });

        // Start class (teacher)
        document.getElementById('startClass').addEventListener('click', () => {
            state.isTeaching = true;
            updateTeachingStatus(true);
            broadcast('class-start', { userId: state.userId });
            showToast('Class started!', 'success');
        });

        // Lock code (teacher)
        document.getElementById('lockCode').addEventListener('click', () => {
            state.codeLocked = !state.codeLocked;
            handleCodeLock(state.codeLocked, state.userId);
            broadcast('code-lock', { locked: state.codeLocked, userId: state.userId });
            showToast(state.codeLocked ? 'Code locked' : 'Code unlocked', 'info');
        });

        // Run code
        document.getElementById('runCode').addEventListener('click', runCode);
        
        // Clear output
        document.getElementById('clearOutput').addEventListener('click', () => {
            elements.outputContent.textContent = '';
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runCode();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                showToast('Saved', 'success');
            }
        });
    }

    // Init
    async function init() {
        elements.welcomeModal = document.getElementById('welcomeModal');
        elements.roomId = document.getElementById('roomId');
        elements.participants = document.getElementById('participants');
        elements.studentList = document.getElementById('studentList');
        elements.studentCount = document.getElementById('studentCount');
        elements.studentCountBadge = document.getElementById('studentCountBadge');
        elements.cursorPosition = document.getElementById('cursorPosition');
        elements.languageMode = document.getElementById('languageMode');
        elements.outputPanel = document.getElementById('outputPanel');
        elements.outputContent = document.getElementById('outputContent');
        elements.toastContainer = document.getElementById('toastContainer');

        await initMonacoEditor();
        initEventListeners();
        
        if (checkUrlForRoom()) {
            elements.welcomeModal.classList.remove('hidden');
        }

        console.log('CollabCode Classroom initialized');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
