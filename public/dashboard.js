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
                    <li><strong>Room:</strong> ${profile.details.room}</li>
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
                <p>Upload a CSV file with columns: <strong>name, age, gender, room, student_code (optional)</strong>. The first row must be the header.</p>
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
                <div class="form-row" style="margin-bottom: 0;">
                    <label for="searchStudentInput">Search:</label>
                    <input type="text" id="searchStudentInput" placeholder="Filter by name...">
                </div>
                <div class="table-wrapper">
                    <table id="studentsTable"><thead><tr><th>CODE</th><th>NAME</th><th>AGE</th><th>GENDER</th><th>ROOM</th><th>ACTION</th></tr></thead><tbody></tbody></table>
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
                <h3>Attendance Management</h3>
                <div class="form-row">
                    <label>Select Date:</label>
                    <input type="date" id="selectDate">
                </div>
                <div class="form-row" style="justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4>Attendance for <span id="attendanceDateDisplay"></span></h4>
                    <button id="exportCsvBtn" class="btn btn-green">Export to CSV</button>
                </div>
                <div class="table-wrapper">
                    <table id="attendanceTable"><thead><tr><th>Code</th><th>Name</th><th>Time</th><th>Status</th></tr></thead><tbody id="attendanceBody"></tbody></table>
                </div>
            </div>
        `;
        initAttendance();
    };

    const loadExcusesSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Pending Excuses</h3>
                <div class="table-wrapper">
                    <table><thead><tr><th>CODE</th><th>NAME</th><th>DATE</th><th>REASON</th><th>ACTION</th></tr></thead><tbody id="pendingExcusesBody"></tbody></table>
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

    // --- Navigation ---

    const loadSection = (sectionName) => {
        navLinks.forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-link[data-section="${sectionName}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            mobileHeaderTitle.textContent = activeLink.textContent;
        }

        switch (sectionName) {
            case 'dashboard':
                loadDashboardSection();
                break;
            case 'students':
                loadStudentsSection();
                break;
            case 'attendance':
                loadAttendanceSection();
                break;
            case 'excuses':
                loadExcusesSection();
                break;
            case 'history':
                loadHistorySection();
                break;
            case 'staff':
                loadStaffSection();
                break;
            case 'audit':
                loadAuditSection();
                break;
        }
        // Close sidebar on navigation on mobile
        if (sidebar.classList.contains('open')) {
            toggleSidebar();
        }
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            loadSection(e.target.dataset.section);
        });
    });

    const setupSidebar = (user) => {
        if (!user) return;
        currentUser = user;
        userRoleBadge.textContent = user.role;

        const rolePermissions = {
            admin: ['dashboard', 'students', 'staff', 'attendance', 'excuses', 'history', 'audit'],
            registrar: ['dashboard', 'students'],
            teacher: ['dashboard', 'attendance', 'excuses', 'history']
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

        // Load the first available section for the user
        if (allowedSections.length > 0) {
            loadSection(allowedSections[0]);
        }
    };

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await apiFetch('/api/logout', { method: 'POST' });
        showMessage('You have been logged out.');
        window.location.href = '/login.html';
    });

    // --- Students Logic ---

    let currentStudentPage = 1;
    let currentStudentSearch = '';

    const renderStudentsTable = async (page = 1, searchTerm = '') => {
        currentStudentPage = page;
        currentStudentSearch = searchTerm;
        const tbody = document.getElementById('studentsTable').querySelector('tbody');
        tbody.innerHTML = getLoadingHTML(6);

        const response = await apiFetch(`/api/students?page=${page}&limit=10&search=${searchTerm}`);
        if (!response || !response.success) return;

        const { students, pagination } = response.data;
        tbody.innerHTML = '';
        if (students.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">No students found.</td></tr>`;
            renderPaginationControls({ totalPages: 0 });
            return;
        }

        const canEdit = currentUser && ['admin', 'registrar'].includes(currentUser.role);

        students.forEach(s => {
            const tr = document.createElement('tr');
            tr.className = s.gender === 'Male' ? 'gender-m' : 'gender-f';
            const actionButtons = canEdit ? `
                <button class="btn btn-green" data-action="edit" data-code="${s.student_code}" data-name="${s.name}" data-age="${s.age}" data-gender="${s.gender}" data-room="${s.room}">Edit</button>
                <button class="btn btn-red" data-action="delete" data-code="${s.student_code}" data-name="${s.name}">Delete</button>
            ` : '<span>View Only</span>';
            tr.innerHTML = `
                <td>${s.student_code}</td><td><a href="#" class="link-style" data-action="view-profile" data-code="${s.student_code}">${s.name}</a></td><td>${s.age}</td><td>${s.gender}</td><td>${s.room}</td>
                <td>${actionButtons}</td>`;
            tbody.appendChild(tr);
        });
        renderPaginationControls(pagination);
    };

    const renderPaginationControls = (pagination) => {
        const paginationControls = document.getElementById('paginationControls');
        const { currentPage, totalPages } = pagination;
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
        const studentsTable = document.getElementById('studentsTable');
        const paginationControls = document.getElementById('paginationControls');
        const addStudentBtn = document.getElementById('addStudentBtn');

        // Modal elements
        const modal = document.getElementById('studentFormModal');
        const form = document.getElementById('studentForm');
        const formTitle = document.getElementById('studentFormTitle');
        const cancelBtn = document.getElementById('cancelStudentFormBtn');
        const editCodeInput = form.querySelector('#editStudentCode');

        const openModal = (studentData = null) => {
            form.reset();
            if (studentData) { // Editing
                formTitle.textContent = 'Edit Student';
                editCodeInput.value = studentData.code;
                form.querySelector('#stuName').value = studentData.name;
                form.querySelector('#stuCode').value = studentData.code;
                form.querySelector('#stuAge').value = studentData.age;
                form.querySelector('#stuGender').value = studentData.gender;
                form.querySelector('#stuRoom').value = studentData.room;
                form.querySelector('#manualStudentCodeGroup').style.display = 'none';
                form.querySelector('#studentCodeGroup').style.display = 'block';
            } else { // Adding
                formTitle.textContent = 'Add New Student';
                editCodeInput.value = '';
                form.querySelector('#manualStudentCodeGroup').style.display = 'block';
                form.querySelector('#studentCodeGroup').style.display = 'none';
            }
            modal.style.display = 'flex';
        };

        const closeModal = () => {
            modal.style.display = 'none';
        };

        addStudentBtn.addEventListener('click', () => openModal());
        cancelBtn.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        searchInput.addEventListener('input', debounce((e) => renderStudentsTable(1, e.target.value), 300));

        paginationControls.addEventListener('click', (e) => {
            if (e.target.id === 'prevPageBtn') {
                if (currentStudentPage > 1) renderStudentsTable(currentStudentPage - 1, currentStudentSearch);
            } else if (e.target.id === 'nextPageBtn') {
                renderStudentsTable(currentStudentPage + 1, currentStudentSearch);
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
                room: form.querySelector('#stuRoom').value.trim(),
                student_code: form.querySelector('#stuCode').value.trim(), // For edits
            };
            const editCode = editCodeInput.value;

            // Only add student_code for new students
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
                renderStudentsTable(1, '');
            }
            submitBtn.disabled = false;
        });

        studentsTable.addEventListener('click', async (e) => {
            if (!e.target.matches('button, a')) return;
            const { action, code, name, age, gender, room } = e.target.dataset;

            if (action === 'delete') {
                if (confirm(`Are you sure you want to delete ${name} (${code})? This action is permanent.`)) {
                    const result = await apiFetch(`/api/students/${code}`, { method: 'DELETE' });
                    if (result) {
                        showMessage('Student deleted.');
                        renderStudentsTable(1, '');
                    }
                }
            } else if (action === 'edit') {
                openModal({ code, name, age, gender, room });
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
                renderStudentsTable(1, ''); // Refresh the student list
            }

            form.reset();
            submitBtn.disabled = false;
            submitBtn.textContent = 'UPLOAD';
        });
    };

    // --- Attendance Logic ---

    const initAttendance = () => {
        const selectDateField = document.getElementById('selectDate');
        const attendanceBody = document.getElementById('attendanceBody');
        const dateDisplay = document.getElementById('attendanceDateDisplay');
        const exportBtn = document.getElementById('exportCsvBtn');
        
        const getTodayDateString = () => new Date().toISOString().split('T')[0];

        const loadAttendanceByDate = async () => {
            const date = selectDateField.value;
            if (!date) {
                attendanceBody.innerHTML = '<tr><td colspan="4">Select a date to view attendance.</td></tr>';
                return;
            }
            dateDisplay.textContent = date;
            attendanceBody.innerHTML = getLoadingHTML(4);

            const response = await apiFetch(`/api/attendance/${date}`);
            if (!response || !response.success) return;

            const attendanceList = response.data || [];
            attendanceBody.innerHTML = '';
            if (attendanceList.length === 0) {
                attendanceBody.innerHTML = '<tr><td colspan="4">No students registered to take attendance.</td></tr>';
                return;
            }
            attendanceList.forEach(rec => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${rec.student_code}</td><td>${rec.name}</td><td>${rec.time}</td>
                    <td>
                        <select data-code="${rec.student_code}" data-date="${rec.date}">
                            <option ${rec.status === 'Present' ? 'selected' : ''}>Present</option>
                            <option ${rec.status === 'Late' ? 'selected' : ''}>Late</option>
                            <option ${rec.status === 'Absent' ? 'selected' : ''}>Absent</option>
                            <option ${rec.status === 'Excused' ? 'selected' : ''}>Excused</option>
                        </select>
                    </td>`;
                attendanceBody.appendChild(tr);
            });
        };

        selectDateField.addEventListener('change', loadAttendanceByDate);

        // Use event delegation on the table itself. This is safer than attaching to the whole mainContent.
        // The table is inside dynamicContentContainer now.
        const attendanceTable = dynamicContentContainer.querySelector('#attendanceTable');
        if (attendanceTable) {
            attendanceTable.addEventListener('change', async (e) => {
                if (!e.target.matches('select')) return;
                const select = e.target;
                select.disabled = true; // Disable while processing for better UX
                const update = {
                    student_code: select.dataset.code,
                    date: select.dataset.date,
                    status: select.value
                };
                const result = await apiFetch('/api/attendance', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(update)
                });
                if (result) loadAttendanceByDate(); // Reload to get updated timestamp and confirm change
            });
        }
        exportBtn.addEventListener('click', () => {
            const date = selectDateField.value;
            if (!date) {
                showMessage('Please select a date to export.', 'error');
                return;
            }
            window.location.href = `/api/attendance/${date}/csv`;
        });
        selectDateField.value = getTodayDateString();
        loadAttendanceByDate();
    };

    // --- Excuses Logic ---

    const initExcuses = () => {
        const pendingExcusesBody = document.getElementById('pendingExcusesBody');

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

        renderPendingExcuses();
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