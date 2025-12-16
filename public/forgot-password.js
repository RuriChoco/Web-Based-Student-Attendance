document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgotPasswordForm');
    const formMessage = document.getElementById('formMessage');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
        formMessage.style.display = 'none';

        try {
            const response = await fetch('/api/request-password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const result = await response.json();

            // Always show a generic success message to prevent username enumeration
            formMessage.textContent = result.message || 'If an account with that username exists, instructions have been sent.';
            formMessage.classList.remove('form-error');
            formMessage.classList.add('form-message');
            formMessage.style.display = 'block';
            form.reset();

        } catch (error) {
            formMessage.textContent = 'A network error occurred. Please try again.';
            formMessage.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request Reset';
        }
    });
});