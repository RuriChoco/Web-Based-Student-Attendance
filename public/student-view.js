import { showMessage, apiFetch, getLoadingHTML } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentStudent = null;

    // Main sections
    const lookupForm = document.getElementById('lookupForm');
    const resultsContainer = document.getElementById('resultsContainer');
    const studentNameDisplay = document.getElementById('studentNameDisplay');

    // Tab buttons and content
    const tabButtons = document.querySelectorAll('.card-tab-btn');
    const tabContents = {
        status: document.getElementById('statusTab'),
        summary: document.getElementById('summaryTab'),
    };

    // Forms
    const viewStatusForm = document.getElementById('viewStatusForm');
    const summaryForm = document.getElementById('summaryForm');

    const getTodayDateString = () => new Date().toISOString().split('T')[0];

    // --- Step 1: Student Lookup ---
    lookupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('lookupCode').value.trim();
        const submitBtn = lookupForm.querySelector('button');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Searching...';

        const response = await apiFetch(`/api/public/student/${code}`);

        if (response && response.success) {
            currentStudent = response.data;
            studentNameDisplay.textContent = `Records for: ${currentStudent.name} (${currentStudent.student_code})`;
            lookupForm.style.display = 'none';
            resultsContainer.style.display = 'block';
            initializeForms();
        } else {
            showMessage('Student code not found. Please try again.', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Find My Records';
        }
    });

    // --- Step 2: Tabbed Interface ---
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;

            // Update button styles
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Show correct content
            for (const key in tabContents) {
                tabContents[key].style.display = key === tabName ? 'block' : 'none';
            }
        });
    });

    // --- Form Initialization and Logic ---
    const initializeForms = () => {
        // Set default dates
        document.getElementById('viewDate').value = getTodayDateString();
        document.getElementById('summaryEndDate').value = getTodayDateString();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        document.getElementById('summaryStartDate').value = startDate.toISOString().split('T')[0];
    };

    viewStatusForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = document.getElementById('viewDate').value;
        const tbody = document.getElementById('viewStatusTable');
        tbody.innerHTML = getLoadingHTML(4);

        const response = await apiFetch(`/api/attendance/${date}`);
        if (!response || !response.success) {
            tbody.innerHTML = `<tr><td colspan="4">Could not retrieve records for this date.</td></tr>`;
            return;
        }

        const record = (response.data || []).find(r => r.student_code === currentStudent.student_code);
        if (record) {
            tbody.innerHTML = `<tr><td>${record.student_code}</td><td>${record.name}</td><td>${record.time}</td><td class="status-${record.status}">${record.status}</td></tr>`;
        } else {
            tbody.innerHTML = `<tr><td colspan="4">No attendance record found for you on ${date}.</td></tr>`;
        }
    });

    summaryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const startDate = document.getElementById('summaryStartDate').value;
        const endDate = document.getElementById('summaryEndDate').value;
        const resultDiv = document.getElementById('summaryResult');
        resultDiv.innerHTML = '';

        if (endDate < startDate) {
            return showMessage('End date cannot be before the start date.', 'error');
        }

        const response = await apiFetch(`/api/summary/${currentStudent.student_code}?start=${startDate}&end=${endDate}`);
        if (response && response.success) {
            const { name, student_code, room, summary } = response.data;
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div class="report-header">
                    <h4>${name}</h4>
                    <p><strong>Student ID:</strong> ${student_code} | <strong>Room:</strong> ${room || 'N/A'}</p>
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
});