document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    const formMessage = document.getElementById('formMessage');

    // Get token from URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        form.innerHTML = '<p class="form-error">Invalid or missing reset token. Please request a new link.</p>';
        return;
    }

    const displayMessage = (message, isError = false) => {
        formMessage.textContent = message;
        formMessage.className = isError ? 'form-error' : 'form-message';
        formMessage.style.display = 'block';
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const submitBtn = form.querySelector('button[type="submit"]');
        let isSuccess = false;

        if (newPassword !== confirmPassword) {
            displayMessage('Passwords do not match.', true);
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Resetting...';
        formMessage.style.display = 'none';

        try {
            const response = await fetch('/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });

            const result = await response.json();

            if (response.ok) {
                isSuccess = true;
                form.innerHTML = `<p class="form-message">${result.message} You will be redirected shortly.</p>`;
                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 3000);
            } else {
                displayMessage(result.error || 'An error occurred.', true);
            }
        } catch (error) {
            displayMessage('A network error occurred. Please try again.', true);
        } finally {
            if (!isSuccess) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Set New Password';
            }
        }
    });
});