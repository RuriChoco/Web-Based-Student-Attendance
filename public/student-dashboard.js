import { showMessage, apiFetch } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const dynamicContentContainer = document.getElementById('dynamicContentContainer');
    const navLinks = document.querySelectorAll('.sidebar-nav .nav-link');
    const sidebar = document.querySelector('.sidebar');
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const mobileHeaderTitle = document.getElementById('mobileHeaderTitle');
    const studentNameDisplay = document.getElementById('studentNameDisplay');
    const studentCodeDisplay = document.getElementById('studentCodeDisplay');

    let currentUser = null;
    let sidebarOverlay = null;
    let touchStartX = 0;
    let touchEndX = 0;

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
    const loadSummarySection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>My Attendance Summary</h3>
                <form id="summaryForm" class="form-row">
                    <div class="form-group"><label>Start Date</label><input type="date" id="summaryStartDate" required></div>
                    <div class="form-group"><label>End Date</label><input type="date" id="summaryEndDate" required></div>
                    <button type="submit" class="btn">Get Summary</button>
                </form>
                <div id="summaryResult" style="margin-top: 10px; display: none;"></div>
            </div>`;
        initSummary();
    };
    
    const loadExcuseSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card">
                <h3>Submit an Excuse</h3>
                <p>You can submit an excuse for today or a future date. You can update the reason as long as it is still 'Pending'.</p>
                <form id="excuseForm">
                    <div class="form-row">
                        <div class="form-group"><label>Date</label><input type="date" id="excuseDate" required></div>
                        <div class="form-group flex-2"><label>Reason</label><textarea id="excuseReason" required></textarea></div>
                    </div>
                     <div class="form-row" style="justify-content: flex-end;">
                        <button type="submit" class="btn">Submit for Review</button>
                    </div>
                </form>
            </div>`;
        initExcuse();
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

    // --- Navigation ---
    const loadSection = (sectionName) => {
        navLinks.forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-link[data-section="${sectionName}"]`);
        activeLink.classList.add('active');
        mobileHeaderTitle.textContent = activeLink.textContent;

        switch (sectionName) {
            case 'summary': loadSummarySection(); break;
            case 'excuse': loadExcuseSection(); break;
            case 'password': loadPasswordSection(); break;
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

    // --- Logic Initializers ---
    const initSummary = () => {
        const summaryForm = document.getElementById('summaryForm');
        const endDateField = document.getElementById('summaryEndDate');
        const startDateField = document.getElementById('summaryStartDate');
        
        endDateField.value = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        startDateField.value = thirtyDaysAgo.toISOString().split('T')[0];

        summaryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const startDate = startDateField.value;
            const endDate = endDateField.value;
            const resultDiv = document.getElementById('summaryResult');
            
            if (endDate < startDate) {
                return showMessage('End date cannot be before the start date.', 'error');
            }

            const response = await apiFetch(`/api/student/summary?start=${startDate}&end=${endDate}`);
            if (response && response.success) {
                const summary = response.data;
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = `
                    <div class="report-header">
                        <h4>${currentUser.name}</h4>
                        <p><strong>Student ID:</strong> ${currentUser.student_code} | <strong>Room:</strong> ${currentUser.room || 'N/A'}</p>
                    </div>
                    <div class="report-meta">
                        <p><strong>Report Period:</strong> ${startDate} to ${endDate}</p>
                    </div>
                    <div class="report-summary">
                        <div class="summary-grid">
                            <div class="summary-item">
                                <span class="summary-value status-Present">${summary.Present}</span>
                                <span class="summary-label">Present</span>
                            </div>
                            <div class="summary-item">
                                <span class="summary-value status-Late">${summary.Late}</span>
                                <span class="summary-label">Late</span>
                            </div>
                            <div class="summary-item">
                                <span class="summary-value status-Absent">${summary.Absent}</span>
                                <span class="summary-label">Absent</span>
                            </div>
                            <div class="summary-item">
                                <span class="summary-value status-Excused">${summary.Excused}</span>
                                <span class="summary-label">Excused</span>
                            </div>
                        </div>
                    </div>
                    <div class="form-row" style="justify-content: flex-end; margin-top: 15px;">
                        <button id="printSummaryBtn" class="btn btn-green">Print Report</button>
                    </div>
                `;
                document.getElementById('printSummaryBtn').addEventListener('click', () => {
                    document.body.setAttribute('data-print-date', new Date().toLocaleDateString());
                    window.print();
                });
            } else {
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = '<p style="color: var(--red);">Could not retrieve summary.</p>';
            }
        });
    };

    const initExcuse = () => {
        const excuseForm = document.getElementById('excuseForm');
        document.getElementById('excuseDate').value = new Date().toISOString().split('T')[0];

        excuseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const excuse = {
                date: document.getElementById('excuseDate').value,
                reason: document.getElementById('excuseReason').value.trim()
            };

            const result = await apiFetch('/api/student/excuse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(excuse) });

            if (result) {
                showMessage(result.data.message || 'Excuse submitted successfully.');
                excuseForm.reset();
                document.getElementById('excuseDate').value = new Date().toISOString().split('T')[0];
            }
        });
    };

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

            const result = await apiFetch('/api/user/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });

            if (result && result.success) {
                showMessage('Password changed successfully.');
                form.reset();
            }
        });
    };

    // --- Initial Load ---
    const initializeDashboard = async () => {
        const response = await apiFetch('/api/session');
        if (response && response.success && response.data.authenticated) {
            currentUser = response.data.user;
            studentNameDisplay.textContent = currentUser.name;
            studentCodeDisplay.textContent = currentUser.student_code;
            loadSection('summary'); // Load default section
        } else {
            window.location.href = '/login.html';
        }
    };

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await apiFetch('/api/logout', { method: 'POST' });
        showMessage('You have been logged out.');
        window.location.href = '/login.html';
    });

    initializeDashboard();
});