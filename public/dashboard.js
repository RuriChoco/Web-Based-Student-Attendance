import { showMessage, apiFetch, debounce, getLoadingHTML } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const dynamicContentContainer = document.getElementById('dynamicContentContainer');
    const navLinks = document.querySelectorAll('.sidebar-nav .nav-link');
    const sidebar = document.querySelector('.sidebar');
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const mobileHeaderTitle = document.getElementById('mobileHeaderTitle');
    const userRoleBadge = document.getElementById('userRoleBadge');

    let currentUser = null;
    let sidebarOverlay = null;
    let touchStartX = 0;
    let touchEndX = 0;

    // --- Profile Modal Logic ---
    const profileModal = document.getElementById('studentProfileModal');
    const profileModalContent = document.getElementById('profileModalContent');

    // --- Reset Link Modal Logic ---
    const resetLinkModal = document.getElementById('resetLinkModal');
    const resetLinkInput = document.getElementById('resetLinkInput');
    const copyResetLinkBtn = document.getElementById('copyResetLinkBtn');
    const closeResetLinkModalBtn = document.getElementById('closeResetLinkModalBtn');

    const openResetLinkModal = (link) => {
        resetLinkInput.value = link;
        resetLinkModal.style.display = 'flex';
    };
    const closeResetLinkModal = () => {
        resetLinkModal.style.display = 'none';
    };

    closeResetLinkModalBtn.addEventListener('click', closeResetLinkModal);
    window.addEventListener('click', (e) => { if (e.target === resetLinkModal) closeResetLinkModal(); });
    copyResetLinkBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(resetLinkInput.value);
        showMessage('Link copied to clipboard!');
    });

    const openProfileModal = async (studentCode) => {
        profileModal.style.display = 'flex';
        profileModalContent.innerHTML = '<div class="loader">Loading profile...</div>';

        const response = await apiFetch(`/api/student-profile/${studentCode}`);
        if (!response || !response.success) {
            profileModalContent.innerHTML = '<p class="form-error">Could not load student profile.</p>';
            return;
        }

        const profile = response.data;
        const attendanceHtml = profile.attendance.length > 0
            ? profile.attendance.map(rec => `<tr><td>${rec.date}</td><td class="status-${rec.status}">${rec.status}</td><td>${rec.time}</td></tr>`).join('')
            : '<tr><td colspan="3">No attendance records in the last 30 days.</td></tr>';

        const excusesHtml = profile.excuses.length > 0
            ? profile.excuses.map(exc => `<tr><td>${exc.date}</td><td>${exc.reason}</td><td class="status-${exc.status}">${exc.status}</td></tr>`).join('')
            : '<tr><td colspan="3">No excuse records found.</td></tr>';

        profileModalContent.innerHTML = `
            <h3>Profile: ${profile.details.name} (${profile.details.student_code})</h3>
            <div class="card-tabs">
                <button class="card-tab-btn active" data-tab="profile-details">Details</button>
                <button class="card-tab-btn" data-tab="profile-attendance">Attendance History</button>
                <button class="card-tab-btn" data-tab="profile-excuses">Excuse History</button>
            </div>

            <div id="profile-details" class="card-tab-content">
                <ul>
                    <li><strong>Student Code:</strong> ${profile.details.student_code}</li>
                    <li><strong>Name:</strong> ${profile.details.name}</li>
                    <li><strong>Age:</strong> ${profile.details.age}</li>
                    <li><strong>Gender:</strong> ${profile.details.gender}</li>
                </ul>
            </div>

            <div id="profile-attendance" class="card-tab-content" style="display: none;">
                <h4>Attendance (Last 30 Days)</h4>
                <div class="table-wrapper"><table><thead><tr><th>Date</th><th>Status</th><th>Time In</th></tr></thead><tbody>${attendanceHtml}</tbody></table></div>
            </div>

            <div id="profile-excuses" class="card-tab-content" style="display: none;">
                <h4>Excuse Submissions</h4>
                <div class="table-wrapper"><table><thead><tr><th>Date</th><th>Reason</th><th>Status</th></tr></thead><tbody>${excusesHtml}</tbody></table></div>
            </div>
        `;

        profileModalContent.querySelector('.card-tabs').addEventListener('click', (e) => {
            if (e.target.matches('.card-tab-btn')) {
                const tabName = e.target.dataset.tab;
                profileModalContent.querySelectorAll('.card-tab-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                profileModalContent.querySelectorAll('.card-tab-content').forEach(content => {
                    content.style.display = content.id === tabName ? 'block' : 'none';
                });
            }
        });
    };

    const closeProfileModal = () => {
        profileModal.style.display = 'none';
    };

    window.addEventListener('click', (e) => { if (e.target === profileModal) closeProfileModal(); });
    
    // --- Sidebar Interaction (Toggle and Swipe) ---
    const toggleSidebar = () => {
        sidebar.classList.toggle('open');
        menuToggleBtn.classList.toggle('open');
        document.body.classList.toggle('no-scroll');
        if (sidebar.classList.contains('open')) {
            if (!sidebarOverlay) {
                sidebarOverlay = document.createElement('div');
                sidebarOverlay.className = 'sidebar-overlay';
                sidebarOverlay.addEventListener('click', toggleSidebar);
                document.body.appendChild(sidebarOverlay);
            }
            sidebarOverlay.style.display = 'block';
        } else {
            if (sidebarOverlay) {
                sidebarOverlay.style.display = 'none';
            }
        }
    };
    menuToggleBtn.addEventListener('click', toggleSidebar);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            toggleSidebar();
        }
    });

    const handleGesture = () => {
        const deltaX = touchEndX - touchStartX;
        if (deltaX > 75 && !sidebar.classList.contains('open') && touchStartX < 50) toggleSidebar(); // Swipe Right to Open from edge
        if (deltaX < -75 && sidebar.classList.contains('open')) toggleSidebar(); // Swipe Left to Close
    };

    document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    document.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleGesture(); }, { passive: true });

    // --- Section Loaders ---

    const loadDashboardSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Dashboard</h3>
                <p>Welcome, <strong>${currentUser.name}</strong>. Here is a summary of the system status for today, ${new Date().toLocaleDateString()}.</p>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <h4>Total Students</h4>
                    <p id="statTotalStudents">...</p>
                </div>
                <div class="stat-card">
                    <h4>Today's Present</h4>
                    <p id="statPresent">...</p>
                </div>
                <div class="stat-card">
                    <h4>Today's Absent</h4>
                    <p id="statAbsent">...</p>
                </div>
                <div class="stat-card">
                    <h4>Pending Excuses</h4>
                    <p id="statPendingExcuses">...</p>
                </div>
            </div>
        `;
        initDashboardStats();
    };

    // --- Section Loaders ---

    const loadStudentsSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Bulk Upload Students</h3>
                <p>Upload a CSV file with columns: <strong>name, age, gender, student_code (optional)</strong>. The first row must be the header.</p>
                <form id="bulkUploadForm">
                    <div class="form-row">
                        <div class="form-group flex-2">
                            <label for="studentCsv">CSV File</label>
                            <input type="file" id="studentCsv" accept=".csv" required>
                        </div>
                        <button type="submit" class="btn btn-green">UPLOAD</button>
                    </div>
                    <div id="bulkUploadResult" style="display: none; margin-top: 15px;"></div>
                </form>
            </div>
            <div class="card">
                <div class="card-header">
                    <h3>Registered Students</h3>
                    <button id="addStudentBtn" class="btn">Add New Student</button>
                </div>
                <div class="form-row" style="margin-bottom: 12px;">
                    <div class="form-group flex-1">
                        <label for="searchStudentInput">Search:</label>
                        <input type="text" id="searchStudentInput" placeholder="Filter by name...">
                    </div>
                    <div class="form-group flex-1">
                        <label for="filterYearLevel">Year Level:</label>
                        <select id="filterYearLevel">
                            <option value="">All Years</option>
                            <option value="1st Year">1st Year</option>
                            <option value="2nd Year">2nd Year</option>
                            <option value="3rd Year">3rd Year</option>
                            <option value="4th Year">4th Year</option>
                        </select>
                    </div>
                    <div class="form-group flex-1">
                        <label for="filterCourse">Course:</label>
                        <select id="filterCourse">
                            <option value="">All Courses</option>
                        </select>
                    </div>
                </div>
                <div class="table-wrapper">
                    <table id="studentsTable"><thead><tr><th>CODE</th><th>NAME</th><th>AGE</th><th>GENDER</th><th>YEAR</th><th>ACTION</th></tr></thead><tbody></tbody></table>
                </div>
                <div id="paginationControls" class="form-row" style="justify-content: center; margin-top: 12px; display: none;">
                    <button id="prevPageBtn" class="btn">Previous</button>
                    <span id="pageInfo" style="padding: 0 15px; align-self: center;"></span>
                    <button id="nextPageBtn" class="btn">Next</button>
                </div>
            </div>
        `;
        initStudents();
        initBulkUpload();
    };

    const loadAttendanceSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <div class="card-header" style="margin-bottom: 15px;">
                    <h3>Attendance Management</h3>
                </div>
                
                <div class="form-row">
                    <div class="form-group flex-1">
                        <label style="font-weight: 600; margin-bottom: 5px; display: block;">Date</label>
                        <input type="date" id="selectDate">
                    </div>
                    <div class="form-group flex-1">
                        <label style="font-weight: 600; margin-bottom: 5px; display: block;">Room</label>
                        <select id="selectRoom">
                            <option value="">All Rooms</option>
                        </select>
                    </div>
                    <div class="form-group flex-1">
                        <label style="font-weight: 600; margin-bottom: 5px; display: block;">Course</label>
                        <select id="selectCourse">
                            <option value="">Select Course...</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group flex-1">
                        <label style="font-weight: 600; margin-bottom: 5px; display: block;">Year Level Filter</label>
                        <select id="selectYearLevel">
                            <option value="">All Years</option>
                            <option value="1st Year">1st Year</option>
                            <option value="2nd Year">2nd Year</option>
                            <option value="3rd Year">3rd Year</option>
                            <option value="4th Year">4th Year</option>
                        </select>
                    </div>
                    <div class="form-group flex-1">
                        <label style="font-weight: 600; margin-bottom: 5px; display: block;">Start Time</label>
                        <div class="input-group-append">
                            <input type="time" id="sessionStartTime">
                            <button type="button" id="setStartTimeNowBtn" class="btn-icon" title="Set to current time">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group flex-1">
                        <label style="font-weight: 600; margin-bottom: 5px; display: block;">End Time</label>
                        <input type="time" id="sessionEndTime">
                    </div>
                    <div class="form-group flex-1" style="display: flex; align-items: flex-end; padding-bottom: 1px;">
                         <button id="generateCodeBtn" class="btn" style="background-color: var(--orange); display: none; width: 100%; height: 42px;">Generate Session Code</button>
                    </div>
                </div>

                <div id="sessionInfoPanel" class="session-info-panel">
                    <div>
                        <h4 style="margin: 0; color: var(--primary-dark);">Active Session</h4>
                        <p style="margin: 5px 0 0; color: var(--text-secondary); font-size: 14px;">Share this code with students.</p>
                    </div>
                    <div id="sessionCodeDisplay" class="session-code-box"></div>
                </div>

                <div class="form-row" style="justify-content: space-between; align-items: center; margin-top: 20px; margin-bottom: 12px;">
                    <h4 id="attendanceHeader" style="margin: 0;">Select a course to view attendance</h4>
                    <button id="exportCsvBtn" class="btn btn-green">Export CSV</button>
                </div>
                <div class="table-wrapper">
                    <table id="attendanceTable"><thead><tr><th>Code</th><th>Name</th><th>Course</th><th>Time</th><th>Status</th></tr></thead><tbody id="attendanceBody"></tbody></table>
                </div>
            </div>
            <div class="card">
                <h3>Recent Sessions</h3>
                <div class="table-wrapper">
                    <table id="sessionsTable"><thead><tr><th>Date</th><th>Course</th><th>Room</th><th>Time</th><th>Code</th><th>Attendance</th><th>Created By</th><th>Action</th></tr></thead><tbody></tbody></table>
                </div>
            </div>
            <!-- Edit Session Modal -->
            <div id="editSessionModal" class="modal" style="display:none;">
                <div class="modal-content">
                    <h3>Edit Session Time</h3>
                    <form id="editSessionForm">
                        <input type="hidden" id="editSessionId">
                        <div class="form-group">
                            <label>Start Time</label>
                            <input type="time" id="editSessionStartTime" required>
                        </div>
                        <div class="form-group">
                            <label>End Time</label>
                            <input type="time" id="editSessionEndTime">
                        </div>
                        <div class="form-row" style="justify-content: flex-end; gap: 10px;">
                            <button type="button" id="cancelEditSessionBtn" class="btn" style="background-color: var(--text-secondary);">Cancel</button>
                            <button type="submit" class="btn btn-green">Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        initAttendance();
    };

    const loadRoomsSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Manage Rooms</h3>
                    <button id="addRoomBtn" class="btn">Add New Room</button>
                </div>
                <div class="table-wrapper">
                    <table id="roomsTable"><thead><tr><th>Room Name</th><th>Room Number</th><th>Actions</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        initRooms();
    };

    // --- Attendance Logic ---

    const initAttendance = () => {
        // 1. Select DOM elements
        const selectDateField = document.getElementById('selectDate');
        const attendanceBody = document.getElementById('attendanceBody');
        const attendanceHeader = document.getElementById('attendanceHeader');
        const generateCodeBtn = document.getElementById('generateCodeBtn');
        const sessionCodeDisplay = document.getElementById('sessionCodeDisplay');
        const sessionInfoPanel = document.getElementById('sessionInfoPanel');
        const exportBtn = document.getElementById('exportCsvBtn');
        
        const selectRoom = document.getElementById('selectRoom');
        const selectCourse = document.getElementById('selectCourse');
        const selectYearLevel = document.getElementById('selectYearLevel');
        const sessionStartTime = document.getElementById('sessionStartTime');
        const sessionEndTime = document.getElementById('sessionEndTime');
        const setStartTimeNowBtn = document.getElementById('setStartTimeNowBtn');
        const sessionsTableBody = document.getElementById('sessionsTable').querySelector('tbody');

        // Edit Session Modal Elements
        const editSessionModal = document.getElementById('editSessionModal');
        const editSessionForm = document.getElementById('editSessionForm');
        const cancelEditSessionBtn = document.getElementById('cancelEditSessionBtn');

        let allCourses = [];

        // 2. Define Helper Functions (BEFORE usage)
        const getTodayDateString = () => new Date().toISOString().split('T')[0];

        const loadAttendanceByDate = async () => {
            const date = selectDateField.value;
            const roomId = selectRoom.value;
            const courseId = selectCourse.value;
            const yearLevel = selectYearLevel.value;

            // UI Reset
            attendanceBody.innerHTML = '';
            
            if (!date) {
                attendanceBody.innerHTML = '<tr><td colspan="5">Select a date to view attendance.</td></tr>';
                generateCodeBtn.style.display = 'none';
                sessionInfoPanel.style.display = 'none';
                return;
            }

            if (!courseId && !roomId) {
                attendanceHeader.textContent = 'Select a course or room to view attendance';
                attendanceBody.innerHTML = '<tr><td colspan="5">Please select a course or room.</td></tr>';
                generateCodeBtn.style.display = 'none';
                sessionInfoPanel.style.display = 'none';
                return;
            }

            if (courseId) {
                const courseName = selectCourse.options[selectCourse.selectedIndex].text;
                attendanceHeader.innerHTML = `Attendance for <strong>${courseName}</strong> on ${date}`;
                generateCodeBtn.style.display = 'block';
            } else {
                const roomName = selectRoom.options[selectRoom.selectedIndex].text;
                attendanceHeader.innerHTML = `Attendance for Room <strong>${roomName}</strong> on ${date}`;
                generateCodeBtn.style.display = 'none'; // Hide generate button when viewing by room
            }

            attendanceBody.innerHTML = getLoadingHTML(5);

            // Append course to query
            const params = new URLSearchParams();
            if (courseId) params.append('course_id', courseId);
            if (roomId) params.append('room_id', roomId);
            if (yearLevel) params.append('year_level', yearLevel);
            const url = `/api/attendance/${date}?${params.toString()}`;

            const response = await apiFetch(url);
            if (!response || !response.success) {
                 attendanceBody.innerHTML = '<tr><td colspan="5">Error loading attendance.</td></tr>';
                 return;
            }

            const attendanceList = response.data || [];
            attendanceBody.innerHTML = '';
            
            if (attendanceList.length === 0) {
                attendanceBody.innerHTML = '<tr><td colspan="5">No students found for this selection.</td></tr>';
                return;
            }

            attendanceList.forEach(rec => {
                const tr = document.createElement('tr');
                
                // Status Color Logic
                let statusColor = '';
                if(rec.status === 'Present') statusColor = 'color: var(--green); font-weight: bold;';
                else if(rec.status === 'Late') statusColor = 'color: var(--orange); font-weight: bold;';
                else if(rec.status === 'Absent') statusColor = 'color: var(--red); font-weight: bold;';
                else if(rec.status === 'Excused') statusColor = 'color: var(--primary); font-weight: bold;';

                tr.innerHTML = `
                    <td>${rec.student_code}</td>
                    <td>${rec.name} <small class="text-secondary">(${rec.year_level || 'N/A'})</small></td>
                    <td>${rec.course_code || '-'}</td>
                    <td>${rec.time}</td>
                    <td>
                        <select data-code="${rec.student_code}" data-date="${rec.date}" style="${statusColor}">
                            <option value="Present" ${rec.status === 'Present' ? 'selected' : ''}>Present</option>
                            <option value="Late" ${rec.status === 'Late' ? 'selected' : ''}>Late</option>
                            <option value="Absent" ${rec.status === 'Absent' ? 'selected' : ''}>Absent</option>
                            <option value="Excused" ${rec.status === 'Excused' ? 'selected' : ''}>Excused</option>
                        </select>
                    </td>`;
                attendanceBody.appendChild(tr);
            });
        };

        const populateCourses = () => {
            const currentCourseId = selectCourse.value; 
            
            selectCourse.innerHTML = '<option value="">Select Course...</option>';

            if (!allCourses || allCourses.length === 0) return;

            // Show ALL courses regardless of room selection
            allCourses.forEach(course => {
                const opt = document.createElement('option');
                opt.value = course.id;
                opt.textContent = `${course.code} - ${course.name}`;
                opt.dataset.startTime = course.start_time || '';
                opt.dataset.endTime = course.end_time || '';
                selectCourse.appendChild(opt);
            });
            
            // Restore selection if valid
            if (currentCourseId && allCourses.find(c => String(c.id) === String(currentCourseId))) {
                selectCourse.value = currentCourseId;
            } else {
                // If selection invalid (e.g. switched room), reset start time
                sessionStartTime.value = '';
                sessionEndTime.value = '';
            }
        };

        // --- Edit Session Logic ---
        const openEditSessionModal = (id, start, end) => {
            document.getElementById('editSessionId').value = id;
            document.getElementById('editSessionStartTime').value = start;
            document.getElementById('editSessionEndTime').value = end;
            editSessionModal.style.display = 'flex';
        };

        const closeEditSessionModal = () => {
            editSessionModal.style.display = 'none';
            editSessionForm.reset();
        };

        cancelEditSessionBtn.addEventListener('click', closeEditSessionModal);
        window.addEventListener('click', (e) => { if (e.target === editSessionModal) closeEditSessionModal(); });

        editSessionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editSessionId').value;
            const start_time = document.getElementById('editSessionStartTime').value;
            const end_time = document.getElementById('editSessionEndTime').value;

            const response = await apiFetch(`/api/attendance/sessions/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start_time, end_time })
            });

            if (response && response.success) {
                showMessage('Session updated successfully.');
                closeEditSessionModal();
                loadSessions();
            }
        });

        const loadSessions = async () => {
            sessionsTableBody.innerHTML = getLoadingHTML(8);
            const response = await apiFetch('/api/attendance/sessions');
            if (!response || !response.success) {
                sessionsTableBody.innerHTML = '<tr><td colspan="8">Error loading sessions.</td></tr>';
                return;
            }
            const sessions = response.data;
            sessionsTableBody.innerHTML = '';
            if (sessions.length === 0) {
                sessionsTableBody.innerHTML = '<tr><td colspan="8">No recent sessions found.</td></tr>';
                return;
            }
            sessions.forEach(s => {
                const tr = document.createElement('tr');
                const roomStr = s.room_name ? `${s.room_name} (${s.room_number})` : 'N/A';
                const timeStr = `${s.start_time || '?'} - ${s.end_time || '?'}`;
                tr.innerHTML = `
                    <td>${s.date}</td>
                    <td>${s.course_code}</td>
                    <td>${roomStr}</td>
                    <td>${timeStr}</td>
                    <td><span class="session-code-box" style="font-size: 14px; padding: 2px 8px;">${s.code}</span></td>
                    <td>
                        <span class="status-Present">${s.present_count} Present</span> / 
                        <span class="status-Absent">${s.absent_count} Absent</span>
                    </td>
                    <td>${s.creator_name || 'Unknown'}</td>
                    <td>
                        <button class="btn btn-green" style="padding: 5px 10px; font-size: 12px;" 
                            data-action="view-session" 
                            data-date="${s.date}" 
                            data-course="${s.course_id}"
                            data-room="${s.room_id || ''}"
                            data-start="${s.start_time || ''}"
                            data-end="${s.end_time || ''}"
                            data-code="${s.code}">
                            View
                        </button>
                        <button class="btn" style="background-color: #fbbf24; padding: 5px 10px; font-size: 12px; margin-left: 5px;" 
                            data-action="edit-session" 
                            data-id="${s.id}"
                            data-start="${s.start_time || ''}"
                            data-end="${s.end_time || ''}">
                            Edit
                        </button>
                        <button class="btn btn-red" style="padding: 5px 10px; font-size: 12px; margin-left: 5px;" 
                            data-action="delete-session" 
                            data-id="${s.id}"
                            data-code="${s.code}">
                            Delete
                        </button>
                    </td>
                `;
                sessionsTableBody.appendChild(tr);
            });
        };

        if (setStartTimeNowBtn) {
            setStartTimeNowBtn.addEventListener('click', () => {
                sessionStartTime.value = new Date().toTimeString().slice(0, 5);
            });
        }

        // 3. Event Listeners
        selectRoom.addEventListener('change', () => {
            // Reset course selection to show all students in the room by default
            selectCourse.value = "";
            sessionStartTime.value = "";
            sessionEndTime.value = "";
            
            loadAttendanceByDate();
        });

        selectCourse.addEventListener('change', () => {
            const selectedOption = selectCourse.options[selectCourse.selectedIndex];
            if (selectedOption.dataset.startTime) {
                sessionStartTime.value = selectedOption.dataset.startTime;
                sessionEndTime.value = selectedOption.dataset.endTime || '';
            } else {
                sessionStartTime.value = '';
                sessionEndTime.value = '';
            }
            sessionInfoPanel.style.display = 'none';
            loadAttendanceByDate();
        });

        selectYearLevel.addEventListener('change', loadAttendanceByDate);
        selectDateField.addEventListener('change', () => {
            sessionInfoPanel.style.display = 'none';
            loadAttendanceByDate();
        });

        // Table Event Delegation
        const attendanceTable = document.getElementById('attendanceTable');
        if (attendanceTable) {
            // Remove old listener if any (though initAttendance is usually called once per section load)
            // Since we are replacing innerHTML of dynamicContentContainer, old listeners on elements inside it are gone.
            attendanceTable.addEventListener('change', async (e) => {
                if (!e.target.matches('select')) return;
                const select = e.target;
                const originalColor = select.style.cssText;
                const originalValue = select.getAttribute('data-original-value') || select.value; // fallback
                
                select.disabled = true; 
                const update = {
                    student_code: select.dataset.code,
                    date: select.dataset.date,
                    course_id: selectCourse.value,
                    session_start_time: sessionStartTime.value,
                    status: select.value
                };

                const result = await apiFetch('/api/attendance', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(update)
                });
                
                select.disabled = false;
                
                if (result && result.success) {
                    let statusColor = '';
                    if(select.value === 'Present') statusColor = 'color: var(--green); font-weight: bold;';
                    else if(select.value === 'Late') statusColor = 'color: var(--orange); font-weight: bold;';
                    else if(select.value === 'Absent') statusColor = 'color: var(--red); font-weight: bold;';
                    else if(select.value === 'Excused') statusColor = 'color: var(--primary); font-weight: bold;';
                    select.style.cssText = statusColor;
                } else {
                    select.value = originalValue; 
                    select.style.cssText = originalColor;
                }
            });
        }

        sessionsTableBody.addEventListener('click', async (e) => {
            if (e.target.matches('button[data-action="view-session"]')) {
                const btn = e.target;
                const { date, course, room, start, end, code } = btn.dataset;

                selectDate.value = date;
                selectRoom.value = room; 
                
                // Re-populate courses based on room (though currently we show all, this ensures consistency)
                populateCourses(); 
                selectCourse.value = course;
                
                sessionStartTime.value = start;
                sessionEndTime.value = end;
                
                sessionCodeDisplay.textContent = code;
                sessionInfoPanel.style.display = 'flex';

                loadAttendanceByDate();
                document.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
            } else if (e.target.matches('button[data-action="edit-session"]')) {
                const btn = e.target;
                const { id, start, end } = btn.dataset;
                openEditSessionModal(id, start, end);
            } else if (e.target.matches('button[data-action="delete-session"]')) {
                const btn = e.target;
                const { id, code } = btn.dataset;
                
                if (confirm(`Are you sure you want to delete session ${code}? This will remove all attendance records for this session.`)) {
                    btn.disabled = true;
                    const response = await apiFetch(`/api/attendance/sessions/${id}`, { method: 'DELETE' });
                    if (response && response.success) {
                        showMessage('Session deleted successfully.');
                        loadSessions();
                        // Clear the view if the deleted session was currently selected
                        if (sessionCodeDisplay.textContent === code) {
                            sessionInfoPanel.style.display = 'none';
                        }
                    } else {
                        btn.disabled = false;
                    }
                }
            }
        });

        generateCodeBtn.addEventListener('click', async () => {
            const date = selectDateField.value;
            const roomId = selectRoom.value;
            const courseId = selectCourse.value;
            const startTime = sessionStartTime.value;
            const endTime = sessionEndTime.value;

            if (!date || !courseId || !startTime) {
                showMessage('Please select a date, course, and ensure start time is set.', 'error');
                return;
            }

            generateCodeBtn.disabled = true;
            generateCodeBtn.textContent = 'Generating...';
            
            const response = await apiFetch('/api/attendance/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: courseId, date, start_time: startTime, end_time: endTime, room_id: roomId })
            });

            generateCodeBtn.disabled = false;
            generateCodeBtn.textContent = 'Generate Session Code';
            
            if (response && response.success) {
                sessionCodeDisplay.textContent = response.data.code; // Just the code
                sessionInfoPanel.style.display = 'flex';
                loadSessions(); // Refresh the list
            }
        });

        exportBtn.addEventListener('click', () => {
            const date = selectDateField.value;
            const courseId = selectCourse.value;
            if (!date || !courseId) {
                showMessage('Please select a date and course to export.', 'error');
                return;
            }
            window.location.href = `/api/attendance/${date}/csv?course_id=${courseId}`;
        });

        // 4. Initialization
        selectDateField.value = getTodayDateString();
        
        (async () => {
            // Load Rooms
            const roomRes = await apiFetch('/api/rooms');
            if (roomRes && roomRes.success) {
                selectRoom.innerHTML = '<option value="">All Rooms</option>';
                roomRes.data.forEach(room => {
                    const opt = document.createElement('option');
                    opt.value = room.id;
                    opt.textContent = `${room.name} (${room.room_number})`;
                    selectRoom.appendChild(opt);
                });
                selectRoom.value = "";
            }

            // Load Courses
            const courseRes = await apiFetch('/api/courses');
            if (courseRes && courseRes.success) {
                allCourses = courseRes.data;
                populateCourses();
            }
            loadSessions();
        })();
    };

    // --- Courses Management Logic ---

    const loadCoursesSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Manage Courses</h3>
                    <button id="addCourseBtn" class="btn">Add New Course</button>
                </div>
                <div class="table-wrapper">
                    <table id="coursesTable"><thead><tr><th>Code</th><th>Name</th><th>Room</th><th>Schedule</th><th>Actions</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        initCourses();
    };

    const initCourses = () => {
        const tableBody = document.getElementById('coursesTable').querySelector('tbody');
        const addBtn = document.getElementById('addCourseBtn');
        const modal = document.getElementById('courseFormModal');
        const form = document.getElementById('courseForm');
        const cancelBtn = document.getElementById('cancelCourseFormBtn');
        const formTitle = document.getElementById('courseFormTitle');
        const courseCodeInput = document.getElementById('courseCode');
        const courseNameInput = document.getElementById('courseName');
        const courseRoomSelect = document.getElementById('courseRoom');
        const courseStartTime = document.getElementById('courseStartTime');
        const courseEndTime = document.getElementById('courseEndTime');
        const editIdInput = document.getElementById('editCourseId');

        // Enrollment Modal Elements
        const enrollmentModal = document.getElementById('enrollmentModal');
        const enrollmentTableBody = document.getElementById('enrollmentTable').querySelector('tbody');
        const closeEnrollmentBtn = document.getElementById('closeEnrollmentBtn');
        const enrollmentSearch = document.getElementById('enrollmentSearch');
        let currentEnrollmentCourseId = null;

        const populateRooms = async () => {
            const response = await apiFetch('/api/rooms');
            if (response && response.success) {
                courseRoomSelect.innerHTML = '<option value="">None</option>';
                response.data.forEach(room => {
                    const option = document.createElement('option');
                    option.value = room.id;
                    option.textContent = `${room.name} (${room.room_number})`;
                    courseRoomSelect.appendChild(option);
                });
            }
        };

        const renderCourses = async () => {
            tableBody.innerHTML = getLoadingHTML(2);
            const response = await apiFetch('/api/courses');
            if (!response || !response.success) {
                tableBody.innerHTML = '<tr><td colspan="5">Error loading courses.</td></tr>';
                return;
            }
            const courses = response.data;
            tableBody.innerHTML = '';
            if (courses.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5">No courses found.</td></tr>';
                return;
            }
            courses.forEach(course => {
                const roomDisplay = course.room_name ? `${course.room_name} (${course.room_number})` : 'None';
                const scheduleDisplay = (course.days && course.start_time) ? `${course.days} ${course.start_time}-${course.end_time}` : 'No Schedule';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${course.code}</td>
                    <td>${course.name}</td>
                    <td>${roomDisplay}</td>
                    <td>${scheduleDisplay}</td>
                    <td>
                        <button class="btn" style="background-color: var(--blue);" data-action="enroll" data-id="${course.id}" data-name="${course.name}">Students</button>
                        <button class="btn btn-green" data-action="edit" data-id="${course.id}">Edit</button>
                        <button class="btn btn-red" data-action="delete" data-id="${course.id}" data-name="${course.name}">Delete</button>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        };

        const openModal = async (course = null) => {
            await populateRooms();
            if (course) {
                formTitle.textContent = 'Edit Course';
                editIdInput.value = course.id;
                courseCodeInput.value = course.code;
                courseNameInput.value = course.name;
                courseRoomSelect.value = course.room;
                courseStartTime.value = course.start_time || '';
                courseEndTime.value = course.end_time || '';
                
                // Set checkboxes
                const days = course.days ? course.days.split(',') : [];
                document.querySelectorAll('input[name="courseDays"]').forEach(cb => {
                    cb.checked = days.includes(cb.value);
                });
            } else {
                formTitle.textContent = 'Add New Course';
                editIdInput.value = '';
                courseCodeInput.value = '';
                courseNameInput.value = '';
                courseRoomSelect.value = '';
                courseStartTime.value = '';
                courseEndTime.value = '';
                document.querySelectorAll('input[name="courseDays"]').forEach(cb => {
                    cb.checked = false;
                });
            }
            modal.style.display = 'flex';
        };

        const closeModal = () => {
            modal.style.display = 'none';
            form.reset();
        };

        addBtn.addEventListener('click', () => openModal());
        cancelBtn.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        closeEnrollmentBtn.addEventListener('click', () => { enrollmentModal.style.display = 'none'; });
        window.addEventListener('click', (e) => { if (e.target === enrollmentModal) enrollmentModal.style.display = 'none'; });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = editIdInput.value;
            const code = courseCodeInput.value.trim();
            const name = courseNameInput.value.trim();
            const room_id = courseRoomSelect.value;
            const start_time = courseStartTime.value;
            const end_time = courseEndTime.value;
            const days = Array.from(document.querySelectorAll('input[name="courseDays"]:checked'))
                .map(cb => cb.value).join(',');

            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/courses/${id}` : '/api/courses';

            const result = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, name, room_id, start_time, end_time, days })
            });

            if (result && result.success) {
                showMessage(id ? 'Course updated.' : 'Course added.');
                closeModal();
                renderCourses();
            }
        });

        tableBody.addEventListener('click', async (e) => {
            if (!e.target.matches('button')) return;
            const { action, id, name } = e.target.dataset;
            if (action === 'edit') {
                // Fetch latest details to ensure we have schedule info
                const response = await apiFetch('/api/courses');
                const course = response.data.find(c => c.id == id);
                openModal({ ...course, room: course.room_id });
            } else if (action === 'delete') {
                if (confirm(`Delete course "${name}"?`)) {
                    const result = await apiFetch(`/api/courses/${id}`, { method: 'DELETE' });
                    if (result && result.success) {
                        showMessage('Course deleted.');
                        renderCourses();
                    }
                }
            } else if (action === 'enroll') {
                openEnrollmentModal(id, name);
            }
        });

        // Enrollment Logic
        const openEnrollmentModal = async (courseId, courseName) => {
            currentEnrollmentCourseId = courseId;
            document.getElementById('enrollmentTitle').textContent = `Manage Enrollment: ${courseName}`;
            enrollmentModal.style.display = 'flex';
            await renderEnrollmentList();
        };

        const renderEnrollmentList = async (search = '') => {
            enrollmentTableBody.innerHTML = getLoadingHTML(4);
            const response = await apiFetch(`/api/courses/${currentEnrollmentCourseId}/students?search=${search}`);
            if (!response || !response.success) {
                enrollmentTableBody.innerHTML = '<tr><td colspan="4">Error loading students.</td></tr>';
                return;
            }
            const students = response.data;
            enrollmentTableBody.innerHTML = '';
            if (students.length === 0) {
                enrollmentTableBody.innerHTML = '<tr><td colspan="4">No students found.</td></tr>';
                return;
            }

            students.forEach(s => {
                const tr = document.createElement('tr');
                const isEnrolled = s.is_enrolled === 1;
                tr.innerHTML = `
                    <td>${s.student_code}</td>
                    <td>${s.name}</td>
                    <td>${isEnrolled ? '<span class="status-Present">Enrolled</span>' : '<span class="status-Absent">Not Enrolled</span>'}</td>
                    <td>
                        <button class="btn ${isEnrolled ? 'btn-red' : 'btn-green'}" data-id="${s.user_id}" data-action="${isEnrolled ? 'unenroll' : 'enroll'}">
                            ${isEnrolled ? 'Remove' : 'Add'}
                        </button>
                    </td>
                `;
                enrollmentTableBody.appendChild(tr);
            });
        };

        enrollmentSearch.addEventListener('input', debounce((e) => {
            renderEnrollmentList(e.target.value);
        }, 300));

        enrollmentTableBody.addEventListener('click', async (e) => {
            if (!e.target.matches('button')) return;
            const { id, action } = e.target.dataset;
            const button = e.target;
            button.disabled = true;

            const url = `/api/courses/${currentEnrollmentCourseId}/${action}`;
            const result = await apiFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: id })
            });

            if (result && result.success) {
                renderEnrollmentList(enrollmentSearch.value);
            }
        });

        renderCourses();
    };

    // --- Rooms Management Logic ---

    const initRooms = () => {
        const tableBody = document.getElementById('roomsTable').querySelector('tbody');
        const addBtn = document.getElementById('addRoomBtn');
        const modal = document.getElementById('roomFormModal');
        const form = document.getElementById('roomForm');
        const cancelBtn = document.getElementById('cancelRoomFormBtn');
        const formTitle = document.getElementById('roomFormTitle');
        const roomNameInput = document.getElementById('roomName');
        const roomNumberInput = document.getElementById('roomNumber');
        const editIdInput = document.getElementById('editRoomId');
        
        const scheduleModal = document.getElementById('roomScheduleModal');
        const closeScheduleBtn = document.getElementById('closeRoomScheduleBtn');
        const scheduleGrid = document.getElementById('scheduleGrid');
        const scheduleTitle = document.getElementById('roomScheduleTitle');

        const renderRooms = async () => {
            tableBody.innerHTML = getLoadingHTML(2);
            const response = await apiFetch('/api/rooms');
            if (!response || !response.success) {
                tableBody.innerHTML = '<tr><td colspan="3">Error loading rooms.</td></tr>';
                return;
            }
            const rooms = response.data;
            tableBody.innerHTML = '';
            if (rooms.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="3">No rooms found.</td></tr>';
                return;
            }
            rooms.forEach(room => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${room.name}</td>
                    <td>${room.room_number}</td>
                    <td>
                        <button class="btn" style="background-color: var(--blue);" data-action="schedule" data-id="${room.id}" data-name="${room.name}">Schedule</button>
                        <button class="btn btn-green" data-action="edit" data-id="${room.id}" data-name="${room.name}" data-number="${room.room_number}">Edit</button>
                        <button class="btn btn-red" data-action="delete" data-id="${room.id}" data-name="${room.name}">Delete</button>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        };

        const openModal = (room = null) => {
            if (room) {
                formTitle.textContent = 'Edit Room';
                editIdInput.value = room.id;
                roomNameInput.value = room.name;
                roomNumberInput.value = room.number;
            } else {
                formTitle.textContent = 'Add New Room';
                editIdInput.value = '';
                roomNameInput.value = '';
                roomNumberInput.value = '';
            }
            modal.style.display = 'flex';
        };

        const closeModal = () => {
            modal.style.display = 'none';
            form.reset();
        };

        addBtn.addEventListener('click', () => openModal());
        cancelBtn.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        
        closeScheduleBtn.addEventListener('click', () => scheduleModal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === scheduleModal) scheduleModal.style.display = 'none'; });

        const openScheduleModal = async (roomId, roomName) => {
            scheduleTitle.textContent = `Schedule: ${roomName}`;
            scheduleGrid.innerHTML = getLoadingHTML(7);
            scheduleModal.style.display = 'flex';

            const response = await apiFetch(`/api/rooms/${roomId}/schedule`);
            if (!response || !response.success) {
                scheduleGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 20px;">Error loading schedule.</div>';
                return;
            }

            const courses = response.data;
            scheduleGrid.innerHTML = '';

            // 1. Render Time Labels (7:00 to 21:00, 30 min intervals)
            const startHour = 7;
            const endHour = 21;
            const slotsPerHour = 2;
            const totalSlots = (endHour - startHour) * slotsPerHour;

            for (let i = 0; i < totalSlots; i++) {
                const hour = Math.floor(startHour + i / 2);
                const min = (i % 2) === 0 ? '00' : '30';
                const timeLabel = document.createElement('div');
                timeLabel.className = 'time-label';
                timeLabel.textContent = `${hour}:${min}`;
                timeLabel.style.gridRow = `${i + 1} / span 1`;
                scheduleGrid.appendChild(timeLabel);
            }

            // 2. Render Vertical Column Lines (Mon-Sat)
            for (let i = 0; i < 6; i++) {
                const line = document.createElement('div');
                line.className = 'day-col-line';
                line.style.gridColumn = `${i + 2} / span 1`;
                scheduleGrid.appendChild(line);
            }

            // 3. Render Courses
            const dayMap = { 'Mon': 2, 'Tue': 3, 'Wed': 4, 'Thu': 5, 'Fri': 6, 'Sat': 7 };

            courses.forEach(course => {
                if (!course.days || !course.start_time || !course.end_time) return;

                const days = course.days.split(',');
                const [startH, startM] = course.start_time.split(':').map(Number);
                const [endH, endM] = course.end_time.split(':').map(Number);

                const startSlot = (startH - startHour) * 2 + (startM >= 30 ? 1 : 0);
                const endSlot = (endH - startHour) * 2 + (endM >= 30 ? 1 : 0);
                const duration = endSlot - startSlot;

                if (startSlot < 0 || endSlot > totalSlots) return;

                days.forEach(day => {
                    const col = dayMap[day.trim()];
                    if (!col) return;

                    const eventDiv = document.createElement('div');
                    eventDiv.className = 'schedule-event';
                    eventDiv.innerHTML = `<strong>${course.code}</strong>${course.name}`;
                    eventDiv.style.gridColumn = `${col} / span 1`;
                    eventDiv.style.gridRow = `${startSlot + 1} / span ${duration}`;
                    eventDiv.title = `${course.code}: ${course.name} (${course.start_time} - ${course.end_time})`;
                    scheduleGrid.appendChild(eventDiv);
                });
            });
        };

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = editIdInput.value;
            const name = roomNameInput.value.trim();
            const room_number = roomNumberInput.value.trim();
            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/rooms/${id}` : '/api/rooms';

            const result = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, room_number })
            });

            if (result && result.success) {
                showMessage(id ? 'Room updated.' : 'Room added.');
                closeModal();
                renderRooms();
            }
        });

        tableBody.addEventListener('click', async (e) => {
            if (!e.target.matches('button')) return;
            const { action, id, name, number } = e.target.dataset;
            if (action === 'edit') {
                openModal({ id, name, number });
            } else if (action === 'delete') {
                if (confirm(`Delete room "${name}"?`)) {
                    const result = await apiFetch(`/api/rooms/${id}`, { method: 'DELETE' });
                    if (result && result.success) {
                        showMessage('Room deleted.');
                        renderRooms();
                    }
                }
            } else if (action === 'schedule') {
                openScheduleModal(id, name);
            }
        });

        renderRooms();
    };

    // --- Registrations Logic ---

    const loadRegistrationsSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Pending Student Registrations</h3>
                <div class="table-wrapper">
                    <table id="registrationsTable"><thead><tr><th>Name</th><th>Username</th><th>Course</th><th>Year</th><th>Action</th></tr></thead><tbody></tbody></table>
                </div>
            </div>
            <div class="card">
                <h3>Pending Staff Registrations</h3>
                <div class="table-wrapper">
                    <table id="staffRegistrationsTable"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Action</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;

        const tbody = document.getElementById('registrationsTable').querySelector('tbody');
        tbody.addEventListener('click', async (e) => {
            if (!e.target.matches('button')) return;
            const { action, id } = e.target.dataset;
            const btn = e.target;
            btn.disabled = true;

            if (confirm(`Are you sure you want to ${action} this registration?`)) {
                const result = await apiFetch(`/api/student-registrations/${id}/${action}`, { method: 'POST' });
                if (result && result.success) {
                    showMessage(result.data.message);
                    initRegistrations(); // Reload table
                } else {
                    btn.disabled = false;
                }
            } else {
                btn.disabled = false;
            }
        });

        const staffTbody = document.getElementById('staffRegistrationsTable').querySelector('tbody');
        staffTbody.addEventListener('click', async (e) => {
            if (!e.target.matches('button')) return;
            const { action, id } = e.target.dataset;
            const btn = e.target;
            btn.disabled = true;

            if (confirm(`Are you sure you want to ${action} this staff registration?`)) {
                const result = await apiFetch(`/api/staff-registrations/${id}/${action}`, { method: 'POST' });
                if (result && result.success) {
                    showMessage(result.data.message);
                    initRegistrations(); // Reload both tables
                } else {
                    btn.disabled = false;
                }
            } else {
                btn.disabled = false;
            }
        });

        initRegistrations();
    };

    const initRegistrations = async () => {
        const tbody = document.getElementById('registrationsTable').querySelector('tbody');
        tbody.innerHTML = getLoadingHTML(5);
        const staffTbody = document.getElementById('staffRegistrationsTable').querySelector('tbody');
        staffTbody.innerHTML = getLoadingHTML(4);

        const response = await apiFetch('/api/student-registrations');
        if (!response || !response.success) {
            tbody.innerHTML = '<tr><td colspan="5">Error loading registrations.</td></tr>';
        } else {
            const registrations = response.data;
            tbody.innerHTML = '';
            if (registrations.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5">No pending registrations.</td></tr>';
            } else {
                registrations.forEach(reg => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${reg.name}</td>
                        <td>${reg.username}</td>
                        <td>${reg.course_code || 'N/A'}</td>
                        <td>${reg.year_level}</td>
                        <td>
                            <button class="btn btn-green" data-action="approve" data-id="${reg.id}">Approve</button>
                            <button class="btn btn-red" data-action="reject" data-id="${reg.id}">Reject</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }

        // --- Staff Registrations ---
        const staffResponse = await apiFetch('/api/staff-registrations');
        if (!staffResponse || !staffResponse.success) {
            staffTbody.innerHTML = '<tr><td colspan="4">Error loading staff registrations.</td></tr>';
            return;
        }

        const staffRegistrations = staffResponse.data;
        staffTbody.innerHTML = '';
        if (staffRegistrations.length === 0) {
            staffTbody.innerHTML = '<tr><td colspan="4">No pending staff registrations.</td></tr>';
        } else {
            staffRegistrations.forEach(reg => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${reg.name}</td>
                    <td>${reg.username}</td>
                    <td><span class="role-badge">${reg.role}</span></td>
                    <td>
                        <button class="btn btn-green" data-action="approve" data-id="${reg.id}">Approve</button>
                        <button class="btn btn-red" data-action="reject" data-id="${reg.id}">Reject</button>
                    </td>
                `;
                staffTbody.appendChild(tr);
            });
        }
    };

    // --- Excuses Logic ---

    const initExcuses = () => {
        const pendingExcusesBody = document.getElementById('pendingExcusesBody');
        const historyTableBody = document.getElementById('excuseHistoryTable').querySelector('tbody');

        const renderPendingExcuses = async () => {
            pendingExcusesBody.innerHTML = getLoadingHTML(5);
            const response = await apiFetch('/api/excuses');
            if (!response || !response.success) return;

            const excuses = response.data || [];
            pendingExcusesBody.innerHTML = '';
            if (excuses.length === 0) {
                pendingExcusesBody.innerHTML = '<tr><td colspan="5">No pending excuses.</td></tr>';
                return;
            }
            excuses.forEach(e => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${e.student_code}</td><td>${e.name}</td><td>${e.date}</td><td>${e.reason}</td>
                    <td>
                        <button class="btn btn-green" data-id="${e.id}" data-action="approve">Approve</button> <button class="btn btn-red" data-id="${e.id}" data-action="deny">Deny</button>
                        <button class="btn" style="background-color: #fbbf24;" data-id="${e.id}" data-date="${e.date}" data-reason="${e.reason}" data-action="edit">Edit</button>
                        <button class="btn btn-red" data-id="${e.id}" data-action="delete">Delete</button>
                    </td>`;
                pendingExcusesBody.appendChild(tr);
            });
        };

        const renderExcuseHistory = async () => {
            historyTableBody.innerHTML = getLoadingHTML(5);
            const response = await apiFetch('/api/excuses/history');
            if (!response || !response.success) return;

            const excuses = response.data || [];
            historyTableBody.innerHTML = '';
            if (excuses.length === 0) {
                historyTableBody.innerHTML = '<tr><td colspan="5">No history found.</td></tr>';
                return;
            }
            excuses.forEach(e => {
                const tr = document.createElement('tr');
                let statusColor = e.status === 'Approved' ? 'color: var(--green); font-weight: bold;' : 'color: var(--red); font-weight: bold;';
                tr.innerHTML = `
                    <td>${e.student_name} <small class="text-secondary">(${e.student_code})</small></td>
                    <td>${e.date}</td>
                    <td>${e.reason}</td>
                    <td style="${statusColor}">${e.status}</td>
                    <td>${e.processor_name || 'Unknown'}</td>
                `;
                historyTableBody.appendChild(tr);
            });
        };

        pendingExcusesBody.addEventListener('click', async (e) => {
            if (e.target.matches('button')) {
                const button = e.target;
                const { id, action, date, reason } = button.dataset;
                button.disabled = true;

                if (action === 'approve' || action === 'deny') {
                    const url = `/api/excuses/${id}/${action}`;
                    const result = await apiFetch(url, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    });

                    if (result) {
                        showMessage(`Excuse has been ${action}d.`);
                        renderPendingExcuses();
                        renderExcuseHistory(); // Refresh history if loaded
                    } else {
                        button.disabled = false;
                    }
                } else if (action === 'edit') {
                    openEditModal(id, date, reason);
                    button.disabled = false; // Re-enable button immediately for modals
                } else if (action === 'delete') {
                    if (confirm('Are you sure you want to permanently delete this pending excuse?')) {
                        const result = await apiFetch(`/api/excuses/${id}`, { method: 'DELETE' });
                        if (result) {
                            showMessage('Excuse deleted.');
                            renderPendingExcuses();
                        }
                    }
                    button.disabled = false; // Re-enable button after confirm dialog
                }
            }
        });

        const modal = document.getElementById('editExcuseModal');
        const editForm = document.getElementById('editExcuseForm');

        const openEditModal = (id, date, reason) => {
            document.getElementById('editExcuseId').value = id;
            document.getElementById('editExcuseDate').value = date;
            document.getElementById('editExcuseReason').value = reason;
            modal.style.display = 'flex';
        };

        const closeEditModal = () => {
            modal.style.display = 'none';
        };

        window.addEventListener('click', (e) => { if (e.target === modal) closeEditModal(); });

        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editExcuseId').value;
            const updatedExcuse = { date: document.getElementById('editExcuseDate').value, reason: document.getElementById('editExcuseReason').value };
            const result = await apiFetch(`/api/excuses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedExcuse) });
            if (result) {
                showMessage('Excuse updated successfully.');
                closeEditModal();
                renderPendingExcuses();
            }
        });

        // Tab Logic
        const tabsContainer = document.querySelector('.card-tabs');
        if (tabsContainer) {
            tabsContainer.addEventListener('click', (e) => {
                if (!e.target.matches('.card-tab-btn')) return;
                const tabId = e.target.dataset.tab;
                document.querySelectorAll('.card-tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                document.querySelectorAll('.card-tab-content').forEach(c => c.style.display = c.id === tabId ? 'block' : 'none');
                if (tabId === 'history-excuses') renderExcuseHistory();
            });
        }

        renderPendingExcuses();
    };

    // --- Announcements Logic ---
    const initAnnouncements = () => {
        const form = document.getElementById('announcementForm');
        const listContainer = document.getElementById('announcementsList');

        const renderAnnouncements = async () => {
            listContainer.innerHTML = '<div class="loader">Loading...</div>';
            const response = await apiFetch('/api/announcements');
            if (!response || !response.success) {
                listContainer.innerHTML = '<p>Error loading announcements.</p>';
                return;
            }
            const announcements = response.data;
            listContainer.innerHTML = '';
            if (announcements.length === 0) {
                listContainer.innerHTML = '<p>No announcements found.</p>';
                return;
            }
            announcements.forEach(a => {
                const item = document.createElement('div');
                item.className = 'card';
                item.style.marginBottom = '15px';
                item.style.border = '1px solid #e2e8f0';
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div>
                            <h4 style="margin:0 0 5px 0;">${a.title}</h4>
                            <small class="text-secondary">Posted by ${a.author_name} on ${new Date(a.created_at).toLocaleString()}</small>
                        </div>
                        <button class="btn btn-red" onclick="deleteAnnouncement(${a.id})">Delete</button>
                    </div>
                    <p style="margin-top:10px; white-space: pre-wrap;">${a.content}</p>
                `;
                listContainer.appendChild(item);
            });
        };

        window.deleteAnnouncement = async (id) => {
            if (!confirm('Delete this announcement?')) return;
            const res = await apiFetch(`/api/announcements/${id}`, { method: 'DELETE' });
            if (res && res.success) {
                showMessage('Announcement deleted.');
                renderAnnouncements();
            }
        };

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('announcementTitle').value;
            const content = document.getElementById('announcementContent').value;
            const btn = form.querySelector('button');
            btn.disabled = true;

            const res = await apiFetch('/api/announcements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content })
            });

            if (res && res.success) {
                showMessage('Announcement posted.');
                form.reset();
                renderAnnouncements();
            }
            btn.disabled = false;
        });

        renderAnnouncements();
    };

    // --- Staff Management Logic (Admin only) ---
    const initStaff = () => {
        const addStaffForm = document.getElementById('addStaffForm');
        const staffTableBody = document.getElementById('staffTable').querySelector('tbody');

        const renderStaffTable = async () => {
            staffTableBody.innerHTML = getLoadingHTML(4);
            const response = await apiFetch('/api/staff');
            if (!response || !response.success) return;

            staffTableBody.innerHTML = '';
            const staffList = response.data;
            if (staffList.length === 0) {
                staffTableBody.innerHTML = '<tr><td colspan="4">No staff users found.</td></tr>';
                return;
            }

            staffList.forEach(user => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${user.username}</td>
                    <td>${user.name}</td>
                    <td><span class="role-badge">${user.role}</span></td>
                    <td class="actions-cell">
                        <div style="display: flex; gap: 5px;">
                            <button class="btn" style="background-color: var(--orange);" data-action="reset-password" data-id="${user.id}" data-username="${user.username}">Reset Password</button>
                            <button class="btn btn-red" data-action="delete" data-id="${user.id}" data-username="${user.username}">Delete</button>
                        </div>
                    </td>
                `;
                staffTableBody.appendChild(tr);
            });
        };

        addStaffForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = addStaffForm.querySelector('button');
            submitBtn.disabled = true;

            const staffUser = {
                name: document.getElementById('staffName').value,
                username: document.getElementById('staffUsername').value,
                password: document.getElementById('staffPassword').value,
                role: document.getElementById('staffRole').value,
            };

            const result = await apiFetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(staffUser) });

            if (result) {
                showMessage('Staff user created successfully.');
                addStaffForm.reset();
                renderStaffTable();
            }
            submitBtn.disabled = false;
        });

        staffTableBody.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            const { action, id, username } = button.dataset;

            if (action === 'delete') {
                if (confirm(`Are you sure you want to delete staff user "${username}"? This cannot be undone.`)) {
                    const result = await apiFetch(`/api/staff/${id}`, { method: 'DELETE' });
                    if (result) {
                        showMessage('Staff user deleted.');
                        renderStaffTable();
                    }
                }
            } else if (action === 'reset-password') {
                if (confirm(`Are you sure you want to generate a password reset link for "${username}"?`)) {
                    const result = await apiFetch(`/api/staff/${id}/reset-password`, { method: 'POST' });
                    if (result) {
                        openResetLinkModal(result.data.resetLink);
                    }
                }
            }
        });

        renderStaffTable();
    };

    // --- Student History Logic ---
    const initHistorySection = () => {
        const form = document.getElementById('historyForm');
        const studentSearchInput = document.getElementById('historyStudentSearch');
        const studentResultsDiv = document.getElementById('historyStudentResults');
        const startDateInput = document.getElementById('historyStartDate');
        const endDateInput = document.getElementById('historyEndDate');
        const resultsCard = document.getElementById('historyResultsCard');
        const resultsTitle = document.getElementById('historyResultsTitle');
        const resultsTbody = document.getElementById('historyTable').querySelector('tbody');

        let allStudents = [];
        let selectedStudent = null;

        // Set default dates
        endDateInput.value = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        startDateInput.value = thirtyDaysAgo.toISOString().split('T')[0];

        // Fetch all students once and store them
        const fetchAllStudents = async () => {
            const response = await apiFetch('/api/students-list');
            if (response && response.success) {
                allStudents = response.data;
            } else {
                studentSearchInput.placeholder = 'Could not load students';
                studentSearchInput.disabled = true;
            }
        };

        studentSearchInput.addEventListener('input', () => {
            const searchTerm = studentSearchInput.value.toLowerCase();
            if (searchTerm.length < 1) {
                studentResultsDiv.innerHTML = '';
                studentResultsDiv.style.display = 'none';
                selectedStudent = null; // Clear selection if input is cleared
                return;
            }

            const filteredStudents = allStudents.filter(s => 
                s.name.toLowerCase().includes(searchTerm) || 
                s.student_code.toLowerCase().includes(searchTerm)
            ).slice(0, 10); // Limit to 10 results for performance

            studentResultsDiv.innerHTML = '';
            if (filteredStudents.length > 0) {
                filteredStudents.forEach(student => {
                    const item = document.createElement('div');
                    item.textContent = `${student.name} (${student.student_code})`;
                    item.dataset.studentCode = student.student_code;
                    item.dataset.studentName = student.name;
                    studentResultsDiv.appendChild(item);
                });
                studentResultsDiv.style.display = 'block';
            } else {
                studentResultsDiv.style.display = 'none';
            }
        });

        studentResultsDiv.addEventListener('click', (e) => {
            if (e.target.dataset.studentCode) {
                selectedStudent = {
                    student_code: e.target.dataset.studentCode,
                    name: e.target.dataset.studentName
                };
                studentSearchInput.value = `${selectedStudent.name} (${selectedStudent.student_code})`;
                studentResultsDiv.innerHTML = '';
                studentResultsDiv.style.display = 'none';
            }
        });

        // Hide results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.searchable-select-container')) {
                studentResultsDiv.style.display = 'none';
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (!selectedStudent) {
                return showMessage('Please select a student from the list.', 'error');
            }
            if (endDate < startDate) {
                return showMessage('End date cannot be before start date.', 'error');
            }

            resultsTbody.innerHTML = getLoadingHTML(3);
            resultsCard.style.display = 'block';
            resultsTitle.textContent = `Attendance History for ${selectedStudent.name}`;

            const response = await apiFetch(`/api/student-history?student_code=${selectedStudent.student_code}&startDate=${startDate}&endDate=${endDate}`);

            if (response && response.success) {
                const records = response.data;
                resultsTbody.innerHTML = '';
                if (records.length === 0) {
                    resultsTbody.innerHTML = '<tr><td colspan="3">No records found for this student in the selected date range.</td></tr>';
                } else {
                    records.forEach(rec => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `<td>${rec.date}</td><td class="status-${rec.status}">${rec.status}</td><td>${rec.time}</td>`;
                        resultsTbody.appendChild(tr);
                    });
                }
            } else {
                resultsTbody.innerHTML = '<tr><td colspan="3">Error loading history.</td></tr>';
            }
        });

        fetchAllStudents();
    };

    // --- Password Change Logic ---
    const initPasswordChange = () => {
        const form = document.getElementById('changePasswordForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (newPassword !== confirmPassword) {
                return showMessage('New passwords do not match.', 'error');
            }

            const result = await apiFetch('/api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            if (result && result.success) {
                showMessage('Password changed successfully.');
                form.reset();
            }
        });
    };

    // --- Dashboard Stats Logic ---
    const initDashboardStats = async () => {
        const response = await apiFetch('/api/dashboard-summary');
        if (!response || !response.success) {
            document.querySelectorAll('.stat-card p').forEach(el => el.textContent = 'N/A');
            return;
        }
        const stats = response.data;
        document.getElementById('statTotalStudents').textContent = stats.totalStudents;
        
        // Combine Present and Late for the "Present" card
        const totalPresent = (stats.todaysSummary.Present || 0) + (stats.todaysSummary.Late || 0);
        document.getElementById('statPresent').textContent = totalPresent;

        document.getElementById('statAbsent').textContent = stats.todaysSummary.Absent || 0;
        document.getElementById('statPendingExcuses').textContent = stats.pendingExcuses;
    };

    // --- Audit Log Logic ---
    const initAuditLog = () => {
        const tableBody = document.getElementById('auditLogTable').querySelector('tbody');
        const paginationControls = document.getElementById('auditPaginationControls');
        let currentPage = 1;

        const renderAuditLog = async (page = 1) => {
            currentPage = page;
            tableBody.innerHTML = getLoadingHTML(4);

            const response = await apiFetch(`/api/audit-logs?page=${page}`);
            if (!response || !response.success) return;

            const { logs, pagination } = response.data;
            tableBody.innerHTML = '';

            if (logs.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4">No audit logs found.</td></tr>';
            } else {
                logs.forEach(log => {
                    const tr = document.createElement('tr');
                    const details = log.details ? `<pre>${JSON.stringify(JSON.parse(log.details), null, 2)}</pre>` : 'N/A';
                    tr.innerHTML = `
                        <td>${new Date(log.timestamp).toLocaleString()}</td>
                        <td>${log.username || 'System/Unknown'}</td>
                        <td><span class="role-badge" style="background-color: #334155;">${log.action}</span></td>
                        <td>${details}</td>
                    `;
                    tableBody.appendChild(tr);
                });
            }
            renderPagination(pagination);
        };

        const renderPagination = (pagination) => {
            const { currentPage, totalPages } = pagination;
            if (totalPages <= 1) {
                paginationControls.style.display = 'none';
                return;
            }
            paginationControls.style.display = 'flex';
            paginationControls.querySelector('#auditPageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
            paginationControls.querySelector('#auditPrevPageBtn').disabled = currentPage <= 1;
            paginationControls.querySelector('#auditNextPageBtn').disabled = currentPage >= totalPages;
        };

        paginationControls.addEventListener('click', (e) => {
            if (e.target.id === 'auditPrevPageBtn') {
                if (currentPage > 1) renderAuditLog(currentPage - 1);
            } else if (e.target.id === 'auditNextPageBtn') {
                renderAuditLog(currentPage + 1);
            }
        });

        renderAuditLog(1);
    };

    // --- Missing Section Loaders ---

    const loadExcusesSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Excuses Management</h3>
                </div>
                <div class="card-tabs">
                    <button class="card-tab-btn active" data-tab="pending-excuses">Pending</button>
                    <button class="card-tab-btn" data-tab="history-excuses">History</button>
                </div>
                <div id="pending-excuses" class="card-tab-content">
                    <div class="table-wrapper"><table><thead><tr><th>CODE</th><th>NAME</th><th>DATE</th><th>REASON</th><th>ACTION</th></tr></thead><tbody id="pendingExcusesBody"></tbody></table></div>
                </div>
                <div id="history-excuses" class="card-tab-content" style="display:none;">
                    <div class="table-wrapper"><table id="excuseHistoryTable"><thead><tr><th>Student</th><th>Date</th><th>Reason</th><th>Status</th><th>Processed By</th></tr></thead><tbody></tbody></table></div>
                </div>
            </div>
            <!-- Edit Excuse Modal -->
            <div id="editExcuseModal" class="modal" style="display:none;">
                <div class="modal-content">
                    <h3>Edit Pending Excuse</h3>
                    <form id="editExcuseForm">
                        <input type="hidden" id="editExcuseId">
                        <div class="form-group">
                            <label for="editExcuseDate">Date</label>
                            <input type="date" id="editExcuseDate" required>
                        </div>
                        <div class="form-group">
                            <label for="editExcuseReason">Reason</label>
                            <textarea id="editExcuseReason" required></textarea>
                        </div>
                        <button type="submit" class="btn btn-green">Save Changes</button>
                    </form>
                </div>
            </div>
        `;
        initExcuses();
    };

    const loadAnnouncementsSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Post Announcement</h3>
                <form id="announcementForm">
                    <div class="form-group">
                        <label>Title</label>
                        <input type="text" id="announcementTitle" required placeholder="Announcement Title">
                    </div>
                    <div class="form-group">
                        <label>Content</label>
                        <textarea id="announcementContent" required placeholder="Write your announcement here..." style="min-height: 100px;"></textarea>
                    </div>
                    <button type="submit" class="btn btn-green">Post Announcement</button>
                </form>
            </div>
            <div class="card">
                <h3>Recent Announcements</h3>
                <div id="announcementsList"></div>
            </div>`;
        initAnnouncements();
    };

    const loadStaffSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Staff Management</h3>
                <p>Create new accounts for teachers and registrars.</p>
                <form id="addStaffForm">
                    <div class="form-row">
                        <div class="form-group flex-1"><label>Full Name</label><input type="text" id="staffName" required></div>
                        <div class="form-group flex-1"><label>Username</label><input type="text" id="staffUsername" required></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group flex-1"><label>Password</label><input type="password" id="staffPassword" placeholder="Set an initial password" required></div>
                        <div class="form-group flex-1"><label>Role</label>
                            <select id="staffRole" required>
                                <option value="teacher">Teacher</option>
                                <option value="registrar">Registrar</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row" style="justify-content: flex-end;">
                        <button type="submit" class="btn">ADD STAFF USER</button>
                    </div>
                </form>
            </div>
            <div class="card">
                <h4>Existing Staff</h4>
                <div class="table-wrapper">
                    <table id="staffTable"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Actions</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        initStaff();
    };

    const loadHistorySection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Student Attendance History</h3>
                <p>Select a student and a date range to view their attendance records.</p>
                <form id="historyForm">
                    <div class="form-row">
                        <div class="form-group flex-2">
                            <label>Student</label>
                            <div class="searchable-select-container">
                                <input type="text" id="historyStudentSearch" placeholder="Type to search for a student..." autocomplete="off" required>
                                <div id="historyStudentResults" class="searchable-results"></div>
                            </div>
                        </div>
                        <div class="form-group flex-1">
                            <label>Start Date</label>
                            <input type="date" id="historyStartDate" required>
                        </div>
                        <div class="form-group flex-1">
                            <label>End Date</label>
                            <input type="date" id="historyEndDate" required>
                        </div>
                    </div>
                    <div class="form-row" style="justify-content: flex-end;">
                        <button type="submit" class="btn">Search History</button>
                    </div>
                </form>
            </div>
            <div class="card" id="historyResultsCard" style="display: none;">
                <h4 id="historyResultsTitle"></h4>
                <div class="table-wrapper">
                    <table id="historyTable"><thead><tr><th>Date</th><th>Status</th><th>Time In</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        initHistorySection();
    };

    const loadPasswordSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Change My Password</h3>
                <form id="changePasswordForm">
                    <div class="form-group">
                        <label for="currentPassword">Current Password</label>
                        <input type="password" id="currentPassword" required>
                    </div>
                    <div class="form-group">
                        <label for="newPassword">New Password</label>
                        <input type="password" id="newPassword" required>
                    </div>
                    <div class="form-group">
                        <label for="confirmPassword">Confirm New Password</label>
                        <input type="password" id="confirmPassword" required>
                    </div>
                    <button type="submit" class="btn">Change Password</button>
                </form>
            </div>`;
        initPasswordChange();
    };

    const loadAuditSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>System Audit Log</h3>
                <p>Showing the most recent system events.</p>
                <div class="table-wrapper">
                    <table id="auditLogTable"><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody></tbody></table>
                </div>
                <div id="auditPaginationControls" class="form-row" style="justify-content: center; margin-top: 12px; display: none;">
                    <button id="auditPrevPageBtn" class="btn">Previous</button>
                    <span id="auditPageInfo" style="padding: 0 15px; align-self: center;"></span>
                    <button id="auditNextPageBtn" class="btn">Next</button>
                </div>
            </div>
        `;
        initAuditLog();
    };

    // --- Students Logic ---

    let currentStudentPage = 1;
    let currentStudentSearch = '';
    let currentStudentYear = '';
    let currentStudentCourse = '';

    const renderStudentsTable = async (page = 1, searchTerm = '', yearLevel = '', courseId = '') => {
        currentStudentPage = page;
        currentStudentSearch = searchTerm;
        currentStudentYear = yearLevel;
        currentStudentCourse = courseId;
        const tbody = document.getElementById('studentsTable').querySelector('tbody');
        tbody.innerHTML = getLoadingHTML(6);

        const response = await apiFetch(`/api/students?page=${page}&limit=10&search=${searchTerm}&year_level=${yearLevel}&course_id=${courseId}`);
        if (!response || !response.success) return;

        const { students, pagination } = response.data;
        tbody.innerHTML = '';
        if (students.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">No students found.</td></tr>`;
            renderPaginationControls(pagination);
            return;
        }

        const canEdit = currentUser && ['admin', 'registrar'].includes(currentUser.role);

        students.forEach(s => {
            const tr = document.createElement('tr');
            tr.className = s.gender === 'Male' ? 'gender-m' : 'gender-f';
            const actionButtons = canEdit ? `
                <button class="btn btn-green" data-action="edit" data-code="${s.student_code}" data-name="${s.name}" data-age="${s.age}" data-gender="${s.gender}" data-year="${s.year_level || ''}">Edit</button>
                <button class="btn btn-red" data-action="delete" data-code="${s.student_code}" data-name="${s.name}">Delete</button>
            ` : '<span>View Only</span>';
            tr.innerHTML = `
                <td>${s.student_code}</td><td><a href="#" class="link-style" data-action="view-profile" data-code="${s.student_code}">${s.name}</a></td><td>${s.age}</td><td>${s.gender}</td><td>${s.year_level || '-'}</td>
                <td>${actionButtons}</td>`;
            tbody.appendChild(tr);
        });
        renderPaginationControls(pagination);
    };

    const renderPaginationControls = (pagination) => {
        const paginationControls = document.getElementById('paginationControls');
        const { currentPage, totalPages } = pagination;
        if (!paginationControls) return;
        
        if (totalPages <= 1) {
            paginationControls.style.display = 'none';
            return;
        }
        paginationControls.style.display = 'flex';
        paginationControls.querySelector('#pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
        paginationControls.querySelector('#prevPageBtn').disabled = currentPage <= 1;
        paginationControls.querySelector('#nextPageBtn').disabled = currentPage >= totalPages;
    };

    const initStudents = () => {
        const searchInput = document.getElementById('searchStudentInput');
        const filterYearLevel = document.getElementById('filterYearLevel');
        const filterCourse = document.getElementById('filterCourse');
        const studentsTable = document.getElementById('studentsTable');
        const paginationControls = document.getElementById('paginationControls');
        const addStudentBtn = document.getElementById('addStudentBtn');

        // Populate Course Filter
        (async () => {
            const response = await apiFetch('/api/courses');
            if (response && response.success) {
                filterCourse.innerHTML = '<option value="">All Courses</option>';
                response.data.forEach(c => {
                    filterCourse.innerHTML += `<option value="${c.id}">${c.code} - ${c.name}</option>`;
                });
            }
        })();

        // Modal elements
        const modal = document.getElementById('studentFormModal');
        const form = document.getElementById('studentForm');
        const formTitle = document.getElementById('studentFormTitle');
        const cancelBtn = document.getElementById('cancelStudentFormBtn');
        const editCodeInput = form.querySelector('#editStudentCode');

        const openModal = async (studentData = null) => {
            form.reset();
            const stuCodeInput = form.querySelector('#stuCode');
            const manualCodeInput = form.querySelector('#manualStudentCode');
            if (studentData) { // Editing
                formTitle.textContent = 'Edit Student';
                editCodeInput.value = studentData.code;
                form.querySelector('#stuName').value = studentData.name;
                stuCodeInput.value = studentData.code;
                form.querySelector('#stuAge').value = studentData.age;
                form.querySelector('#stuGender').value = studentData.gender;
                form.querySelector('#stuYearLevel').value = studentData.year;

                form.querySelector('#manualStudentCodeGroup').style.display = 'none';
                form.querySelector('#studentCodeGroup').style.display = 'block';
                stuCodeInput.disabled = false;
                stuCodeInput.required = true;
                manualCodeInput.disabled = true;
                manualCodeInput.required = false;
            } else { // Adding
                formTitle.textContent = 'Add New Student';
                editCodeInput.value = '';
                form.querySelector('#manualStudentCodeGroup').style.display = 'block';
                form.querySelector('#studentCodeGroup').style.display = 'none';
                stuCodeInput.disabled = true;
                stuCodeInput.required = false;
                manualCodeInput.disabled = false;
                manualCodeInput.required = false;
            }
            modal.style.display = 'flex';
        };

        const closeModal = () => {
            modal.style.display = 'none';
        };

        addStudentBtn.addEventListener('click', () => openModal());
        cancelBtn.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        
        const refreshTable = () => renderStudentsTable(1, searchInput.value, filterYearLevel.value, filterCourse.value);
        searchInput.addEventListener('input', debounce(refreshTable, 300));
        filterYearLevel.addEventListener('change', refreshTable);
        filterCourse.addEventListener('change', refreshTable);

        paginationControls.addEventListener('click', (e) => {
            if (e.target.id === 'prevPageBtn') {
                if (currentStudentPage > 1) renderStudentsTable(currentStudentPage - 1, currentStudentSearch, currentStudentYear, currentStudentCourse);
            } else if (e.target.id === 'nextPageBtn') {
                renderStudentsTable(currentStudentPage + 1, currentStudentSearch, currentStudentYear, currentStudentCourse);
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            const student = {
                name: form.querySelector('#stuName').value.trim(),
                age: form.querySelector('#stuAge').value,
                gender: form.querySelector('#stuGender').value,
                year_level: form.querySelector('#stuYearLevel').value,
                student_code: form.querySelector('#stuCode').value.trim(),
            };
            const editCode = editCodeInput.value;

            if (!editCode) {
                student.student_code = form.querySelector('#manualStudentCode').value.trim();
            }

            const url = editCode ? `/api/students/${editCode}` : '/api/students';
            const method = editCode ? 'PUT' : 'POST';

            const result = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(student) });

            if (result) {
                showMessage(editCode ? 'Student updated successfully.' : 'Student added successfully.');
                closeModal();
                searchInput.value = '';
                refreshTable();
            }
            submitBtn.disabled = false;
        });

        studentsTable.addEventListener('click', async (e) => {
            if (!e.target.matches('button, a')) return;
            const { action, code, name, age, gender, year } = e.target.dataset;

            if (action === 'delete') {
                if (confirm(`Are you sure you want to delete ${name} (${code})? This action is permanent.`)) {
                    const result = await apiFetch(`/api/students/${code}`, { method: 'DELETE' });
                    if (result) {
                        showMessage('Student deleted.');
                        refreshTable();
                    }
                }
            } else if (action === 'edit') {
                openModal({ code, name, age, gender, year });
            } else if (action === 'view-profile') {
                e.preventDefault();
                openProfileModal(code);
            }
        });

        renderStudentsTable();
    };

    const initBulkUpload = () => {
        const form = document.getElementById('bulkUploadForm');
        if (!form) return;

        const resultDiv = document.getElementById('bulkUploadResult');
        const fileInput = document.getElementById('studentCsv');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button');
            submitBtn.disabled = true;
            submitBtn.textContent = 'UPLOADING...';
            resultDiv.style.display = 'none';
            resultDiv.innerHTML = '';

            if (!fileInput.files || fileInput.files.length === 0) {
                showMessage('Please select a CSV file to upload.', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'UPLOAD';
                return;
            }

            const formData = new FormData();
            formData.append('studentCsv', fileInput.files[0]);

            const response = await apiFetch('/api/students/upload-csv', { method: 'POST', body: formData });

            if (response && response.success) {
                const { message, errors, totalRows } = response.data;
                showMessage(message);
                resultDiv.style.display = 'block';

                let errorHtml = '';
                if (errors && errors.length > 0) {
                    errorHtml = '<h4>Upload Errors:</h4><ul>' + errors.map(err => `<li><strong>${err.student || 'Unknown Row'}:</strong> ${err.error}</li>`).join('') + '</ul>';
                }

                resultDiv.innerHTML = `<p>Processed ${totalRows} rows.</p>${errorHtml}`;
                renderStudentsTable(1, '');
            }

            form.reset();
            submitBtn.disabled = false;
            submitBtn.textContent = 'UPLOAD';
        });
    };

    // --- Navigation & Sidebar Setup ---

    const loadSection = (sectionName) => {
        navLinks.forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-link[data-section="${sectionName}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            mobileHeaderTitle.textContent = activeLink.textContent;
        }

        switch (sectionName) {
            case 'dashboard': loadDashboardSection(); break;
            case 'students': loadStudentsSection(); break;
            case 'attendance': loadAttendanceSection(); break;
            case 'courses': loadCoursesSection(); break;
            case 'rooms': loadRoomsSection(); break;
            case 'registrations': loadRegistrationsSection(); break;
            case 'excuses': loadExcusesSection(); break;
            case 'announcements': loadAnnouncementsSection(); break;
            case 'history': loadHistorySection(); break;
            case 'password': loadPasswordSection(); break;
            case 'staff': loadStaffSection(); break;
            case 'audit': loadAuditSection(); break;
        }
        if (sidebar.classList.contains('open')) {
            toggleSidebar();
        }
    };

    const setupSidebar = (user) => {
        if (!user) return;
        currentUser = user;
        userRoleBadge.textContent = user.role;

        const rolePermissions = {
            admin: ['dashboard', 'students', 'attendance', 'courses', 'rooms', 'registrations', 'excuses', 'announcements', 'history', 'password', 'staff', 'audit'],
            registrar: ['dashboard', 'students', 'password'],
            teacher: ['dashboard', 'attendance', 'excuses', 'announcements', 'history', 'password']
        };

        const allowedSections = rolePermissions[user.role] || [];

        navLinks.forEach(link => {
            const section = link.dataset.section;
            if (allowedSections.includes(section)) {
                link.style.display = 'block';
            } else {
                link.style.display = 'none';
            }
        });

        if (allowedSections.length > 0) {
            loadSection(allowedSections[0]);
        }
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            loadSection(e.target.dataset.section);
        });
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await apiFetch('/api/logout', { method: 'POST' });
        showMessage('You have been logged out.');
        window.location.href = '/login.html';
    });

    // --- Initial Load ---
    const initializeDashboard = async () => {
        const response = await apiFetch('/api/session');
        if (response && response.success && response.data.authenticated) {
            setupSidebar(response.data.user);
        } else {
            window.location.href = '/login.html';
        }
    };

    initializeDashboard();
});