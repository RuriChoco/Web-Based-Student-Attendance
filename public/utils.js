/**
 * A centralized function for showing toast notifications.
 * @param {string} message The message to display.
 * @param {'success' | 'error'} type The type of notification.
 */
export function showMessage(message, type = 'success') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 5000);
}

/**
 * A wrapper for the Fetch API to handle responses and errors consistently.
 * @param {string} url The URL to fetch.
 * @param {object} options Fetch options (method, headers, body, etc.).
 * @returns {Promise<{success: boolean, data: any}|null>}
 */
export async function apiFetch(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (response.status === 401 && !window.location.pathname.endsWith('/login.html')) {
            showMessage('Authentication error. Please log in.', 'error');
            window.location.href = '/login.html';
            return null;
        }
        const responseData = response.status === 204 ? null : await response.json().catch(() => null);

        if (!response.ok) {
            const errorMessage = responseData?.error || `HTTP error! Status: ${response.status}`;
            throw new Error(errorMessage);
        }

        // Prevent double wrapping if the server already returns the standard format
        if (responseData && typeof responseData === 'object' && 'success' in responseData && 'data' in responseData) {
            // Check if the data property is ALSO a standard response (double wrapped) and unwrap it
            if (responseData.data && typeof responseData.data === 'object' && 'success' in responseData.data && 'data' in responseData.data) {
                return responseData.data;
            }
            return responseData;
        }

        return { success: true, data: responseData };
    } catch (error) {
        showMessage(error.message, 'error');
        return null;
    }
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds.
 * @param {Function} func The function to debounce.
 * @param {number} delay The number of milliseconds to delay.
 * @returns {Function}
 */
export const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

/**
 * Returns an HTML string for a loading row in a table.
 * @param {number} colspan The number of columns the loader should span.
 * @returns {string}
 */
export const getLoadingHTML = (colspan) => `<tr><td colspan="${colspan}" class="loader">Loading...</td></tr>`;