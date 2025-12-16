import { apiFetch } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // Step 1 elements
    const step1 = document.getElementById('step1');
    const validateIdForm = document.getElementById('validateIdForm');
    const validateError = document.getElementById('validateError');
    const studentCodeInput = document.getElementById('student_code');

    // Step 2 elements
    const step2 = document.getElementById('step2');
    const createCredentialsForm = document.getElementById('createCredentialsForm');
    const createError = document.getElementById('createError');
    const studentNameSpan = document.getElementById('studentName');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');

    // Step 1: Validate Student ID
    validateIdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const student_code = studentCodeInput.value.trim();
        const submitBtn = validateIdForm.querySelector('button');
        submitBtn.disabled = true;
        validateError.style.display = 'none';

        const response = await apiFetch('/api/student-setup/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_code })
        });

        if (response && response.success) {
            studentNameSpan.textContent = response.data.name;
            step1.style.display = 'none';
            step2.style.display = 'block';
            usernameInput.focus();
        } else {
            const errorMsg = response?.error || 'Invalid Student ID or account already set up.';
            validateError.textContent = errorMsg;
            validateError.style.display = 'block';
            submitBtn.disabled = false;
        }
    });

    // Step 2: Create Credentials
    createCredentialsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        createError.style.display = 'none';
        const submitBtn = createCredentialsForm.querySelector('button');
        submitBtn.disabled = true;

        const response = await apiFetch('/api/student-setup/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_code: studentCodeInput.value.trim(),
                username: usernameInput.value.trim(),
                password: passwordInput.value
            })
        });

        if (response && response.success) {
            step2.innerHTML = `<p class="form-message">${response.data.message} Redirecting to login...<p>`;
            setTimeout(() => { window.location.href = '/login.html'; }, 3000);
        } else {
            const errorMsg = response?.error || 'An unexpected error occurred.';
            createError.textContent = errorMsg;
            createError.style.display = 'block';
            submitBtn.disabled = false;
        }
    });
});