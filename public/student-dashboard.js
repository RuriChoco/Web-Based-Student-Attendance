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
                <div class="form-row" style="gap:12px; align-items:center; margin-bottom:12px;">
                    <div class="range-buttons">
                        <button class="btn" data-range="7">Last 7 days</button>
                        <button class="btn" data-range="30">Last 30 days</button>
                        <button class="btn" data-range="90">Last 90 days</button>
                    </div>
                    <form id="summaryForm" class="form-row" style="margin:0;">
                        <div class="form-group"><label>Start Date</label><input type="date" id="summaryStartDate" required></div>
                        <div class="form-group"><label>End Date</label><input type="date" id="summaryEndDate" required></div>
                        <button type="submit" class="btn">Get Summary</button>
                    </form>
                    <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                        <button id="exportSummaryBtn" class="btn btn-green">Export CSV</button>
                        <button id="printSummaryBtn" class="btn">Print</button>
                    </div>
                </div>

                <div id="summaryResult" style="margin-top: 10px; display: none;">
                    <div class="summary-top" style="display:flex; gap:20px; align-items:center;">
                        <div class="donut-chart" id="donutChart"></div>
                        <div class="summary-breakdown" id="summaryBreakdown"></div>
                    </div>
                </div>
            </div>`;
        initSummary();
    };
    
    const loadExcuseSection = () => {
        dynamicContentContainer.innerHTML = `
            <div class="card excuse-card">
                <h3>Submit an Excuse</h3>
                <p>You can submit an excuse for today or a future date. You can update the reason as long as it is still 'Pending'.</p>
                <form id="excuseForm">
                    <div class="excuse-grid">
                        <div class="form-group">
                            <label for="excuseDate">Date</label>
                            <input type="date" id="excuseDate" required>
                        </div>
                        <div class="form-group">
                            <label for="excuseReason">Reason <small class="muted">(<span id="reasonCounter">0</span>/500)</small></label>
                            <textarea id="excuseReason" maxlength="500" required placeholder="Briefly explain the reason for the absence (max 500 characters)"></textarea>
                        </div>
                    </div>
                    <div id="excuseStatus" style="display:none; margin-top: 12px;"></div>
                    <div class="form-row excuse-actions" style="margin-top:12px;">
                        <div class="muted">Tip: Submit at least 1 day before or on the day of the absence.</div>
                        <div><button type="submit" id="submitExcuseBtn" class="btn">Submit for Review</button></div>
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
        const exportBtn = document.getElementById('exportSummaryBtn');

        endDateField.value = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        startDateField.value = thirtyDaysAgo.toISOString().split('T')[0];

        // Quick range buttons
        document.querySelectorAll('.range-buttons button').forEach(b => {
            b.setAttribute('role', 'button');
            b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', () => {
                // Toggle active state
                document.querySelectorAll('.range-buttons button').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
                b.classList.add('active');
                b.setAttribute('aria-pressed', 'true');

                const days = parseInt(b.dataset.range, 10);
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - (days - 1));
                startDateField.value = start.toISOString().split('T')[0];
                endDateField.value = end.toISOString().split('T')[0];
                summaryForm.dispatchEvent(new Event('submit'));
            });
        });

        // Print button
        const printBtn = document.getElementById('printSummaryBtn');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                // Add print date for footer and call print
                document.body.setAttribute('data-print-date', new Date().toLocaleString());
                window.print();
            });
        }

        summaryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const startDate = startDateField.value;
            const endDate = endDateField.value;
            const resultDiv = document.getElementById('summaryResult');

            if (endDate < startDate) {
                return showMessage('End date cannot be before the start date.', 'error');
            }

            const response = await apiFetch(`/api/summary/${currentUser.student_code}?start=${startDate}&end=${endDate}`);
            if (response && response.success) {
                const { name, student_code, room, summary } = response.data;
                resultDiv.style.display = 'block';

                // Render top-level header
                const headerHtml = `
                    <div class="report-header">
                        <h4>${name}</h4>
                        <p><strong>Student ID:</strong> ${student_code} | <strong>Room:</strong> ${room || 'N/A'}</p>
                    </div>
                    <div class="report-meta">
                        <p><strong>Report Period:</strong> ${startDate} to ${endDate}</p>
                    </div>
                `;

                // Prepare counts and percentages
                const total = summary.Present + summary.Late + summary.Absent + summary.Excused;
                const pct = (n) => total === 0 ? 0 : Math.round((n / total) * 100);

                // Donut chart SVG
                const segments = [
                    { label: 'Present', value: summary.Present, color: 'var(--green)' },
                    { label: 'Late', value: summary.Late, color: 'var(--orange)' },
                    { label: 'Absent', value: summary.Absent, color: 'var(--red)' },
                    { label: 'Excused', value: summary.Excused, color: 'var(--primary)' },
                ].filter(s => s.value > 0);

                const donutSvg = (() => {
                    if (total === 0) return `<div class="muted">No attendance records in this period.</div>`;
                    const size = 120; const r = 50; const c = 2 * Math.PI * r;
                    let offset = 0;
                    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Attendance distribution">
                        <g transform="translate(${size/2}, ${size/2})">
                            ${segments.map(s => {
                                const dash = (s.value / total) * c;
                                const circle = `<circle r="${r}" cx="0" cy="0" fill="transparent" stroke="${s.color}" stroke-width="20" stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${offset}" stroke-linecap="butt"></circle>`;
                                offset -= dash;
                                return circle;
                            }).join('')}
                            <circle r="${r - 22}" fill="#fff"></circle>
                            <text text-anchor="middle" y="6" style="font-weight:700; font-size:18px;">${total}</text>
                        </g>
                    </svg>`;
                })();

                // Breakdown HTML
                const breakdownHtml = `
                    <div class="report-summary">
                        <div class="summary-grid">
                            <div class="summary-item"><span class="summary-value status-Present">${summary.Present}</span><span class="summary-label">Present (${pct(summary.Present)}%)</span></div>
                            <div class="summary-item"><span class="summary-value status-Late">${summary.Late}</span><span class="summary-label">Late (${pct(summary.Late)}%)</span></div>
                            <div class="summary-item"><span class="summary-value status-Absent">${summary.Absent}</span><span class="summary-label">Absent (${pct(summary.Absent)}%)</span></div>
                            <div class="summary-item"><span class="summary-value status-Excused">${summary.Excused}</span><span class="summary-label">Excused (${pct(summary.Excused)}%)</span></div>
                        </div>
                    </div>
                `;

                document.getElementById('donutChart').innerHTML = donutSvg;
                document.getElementById('summaryBreakdown').innerHTML = headerHtml + breakdownHtml;

                // export CSV
                exportBtn.onclick = () => {
                    const csv = 'Status,Count\n' +
                        `Present,${summary.Present}\n` +
                        `Late,${summary.Late}\n` +
                        `Absent,${summary.Absent}\n` +
                        `Excused,${summary.Excused}\n`;
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `attendance-summary-${startDate}-to-${endDate}.csv`; document.body.appendChild(a); a.click(); a.remove();
                    URL.revokeObjectURL(url);
                };

            } else {
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = '<p style="color: var(--red);">Could not retrieve summary.</p>';
            }
        });

        // Trigger initial load
        summaryForm.dispatchEvent(new Event('submit'));
    };

    const initExcuse = () => {
        const excuseForm = document.getElementById('excuseForm');
        const dateField = document.getElementById('excuseDate');
        const reasonField = document.getElementById('excuseReason');
        const submitBtn = document.getElementById('submitExcuseBtn');
        const reasonCounter = document.getElementById('reasonCounter');
        const statusDiv = document.getElementById('excuseStatus');

        const todayStr = new Date().toISOString().split('T')[0];
        dateField.value = todayStr;

        const MAX_DAYS_AHEAD = 365;

        // Counter update
        const updateCounter = () => { reasonCounter.textContent = reasonField.value.length; };
        reasonField.addEventListener('input', updateCounter);
        updateCounter();

        // Simple date validation
        const validateDate = (d) => {
            if (!d) return 'Please select a date.';
            const selected = new Date(d);
            selected.setHours(0,0,0,0);
            const today = new Date(); today.setHours(0,0,0,0);
            if (selected < today) return 'Date cannot be in the past.';
            const futureLimit = new Date(); futureLimit.setDate(futureLimit.getDate() + MAX_DAYS_AHEAD);
            if (selected > futureLimit) return `Date cannot be more than ${MAX_DAYS_AHEAD} days in the future.`;
            return null;
        };

        const showStatus = (type, message) => {
            statusDiv.style.display = 'block';
            statusDiv.className = type === 'error' ? 'form-error' : 'form-message';
            statusDiv.setAttribute('role', 'alert');
            statusDiv.textContent = message;
            // Make it focusable for screen readers and keyboard users
            statusDiv.tabIndex = -1;
            statusDiv.focus();
        };

        excuseForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const dateVal = dateField.value;
            const reasonVal = reasonField.value.trim();

            const dateError = validateDate(dateVal);
            if (dateError) return showStatus('error', dateError);
            if (!reasonVal) return showStatus('error', 'Please enter a reason for the excuse.');

            // Disable UI while submitting
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
            showStatus('info', 'Submitting your excuse...');

            try {
                const result = await apiFetch('/api/student/excuse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: dateVal, reason: reasonVal }) });

                if (result && result.success) {
                    showStatus('info', result.data.message || 'Excuse submitted successfully.');
                    reasonField.value = '';
                    updateCounter();
                    dateField.value = todayStr;

                    // Show a compact confirmation card
                    const cardHtml = `<div class="excuse-status-card"><strong>Status:</strong> Pending<br><strong>Date:</strong> ${dateVal}<br><strong>Reason:</strong> ${escapeHtml(reasonVal)}</div>`;
                    statusDiv.innerHTML = cardHtml;
                    statusDiv.className = 'card';
                    statusDiv.tabIndex = -1;
                    statusDiv.focus();
                } else {
                    showStatus('error', result?.error || 'Failed to submit excuse.');
                }
            } catch (err) {
                showStatus('error', 'Network error. Please try again.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit for Review';
            }
        });

        // helper
        function escapeHtml(s) { return s.replace(/[&<>"'`]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',"`":'&#96;'}[c])); }
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