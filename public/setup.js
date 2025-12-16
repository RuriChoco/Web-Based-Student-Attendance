import { apiFetch } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('setupForm');
    const formMessage = document.getElementById('formMessage');

    // Check if setup is actually needed. If not, redirect to login.
    apiFetch('/api/session').then(response => {
        if (response && response.success) {
            if (!response.data.needsSetup) {
                window.location.href = '/login.html';
            }
        }
    });

    const displayMessage = (message, isError = false) => {
        formMessage.textContent = message;
        formMessage.className = isError ? 'form-error' : 'form-message';
        formMessage.style.display = 'block';
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('name').value;
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const submitBtn = form.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
        formMessage.style.display = 'none';

        const response = await apiFetch('/api/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, password })
        });

        if (response && response.success) {
            form.innerHTML = `<p class="form-message">${response.data.message} Redirecting to login page...</p>`;
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 3000);
        } else {
            displayMessage('Failed to create admin. The username might be taken.', true);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Admin';
        }
    });
});