import { apiFetch } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginErrorDiv = document.getElementById('loginError');

    const displayLoginError = (message) => {
        loginErrorDiv.textContent = message;
        loginErrorDiv.style.display = 'block';
    };

    const hideLoginError = () => {
        loginErrorDiv.style.display = 'none';
    };

    usernameInput.addEventListener('input', hideLoginError);
    passwordInput.addEventListener('input', hideLoginError);

    // Check if already logged in, if so, redirect to dashboard
    apiFetch('/api/session').then(response => {
        if (response && response.success) {
            const { data } = response;
            if (data.needsSetup) {
                // If server is in setup mode, redirect to setup page
                window.location.href = '/setup.html';
            } else if (data.authenticated) {
                // The server-side root redirect will handle sending the user to the correct dashboard.
                // We just need to go to the root.
                window.location.href = '/';
            }
        }
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideLoginError();
        const username = usernameInput.value;
        const password = passwordInput.value;
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging in...';

        const response = await apiFetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response && response.success) {
            window.location.href = '/';
        } else {
            displayLoginError('Invalid credentials or network error.');
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Login';
    });

    togglePasswordBtn.addEventListener('click', () => {
        const passwordInput = document.getElementById('password');
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);

        // Update the button text
        togglePasswordBtn.textContent = type === 'password' ? 'Show' : 'Hide';
    });
});