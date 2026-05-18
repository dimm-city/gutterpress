/**
 * Toast Notification System
 *
 * Provides non-intrusive user feedback with automatic dismissal
 * and accessibility support (ARIA live regions).
 *
 * Usage:
 *   const toast = new ToastManager();
 *   toast.success('PDF generated successfully');
 *   toast.error('Failed to load folder');
 *   toast.warning('Unsaved changes');
 *   toast.info('Loading...');
 */


export class ToastManager {
	constructor() {
		this.container = this.createContainer();
		this.toasts = new Set();
		document.body.appendChild(this.container);
	}

	/**
	 * Create the toast container element
	 */
	createContainer() {
		const container = document.createElement('div');
		container.className = 'toast-container';
		container.setAttribute('role', 'region');
		container.setAttribute('aria-label', 'Notifications');
		container.setAttribute('aria-live', 'polite');
		return container;
	}

	/**
	 * Create a single toast element
	 */
	createToast(message, type = 'info') {
		const toast = document.createElement('div');
		toast.className = `toast toast-${type}`;
		toast.setAttribute('role', 'status');
		toast.setAttribute('aria-atomic', 'true');

		// Icon based on type
		const icon = this.getIcon(type);

		// Close button
		const closeBtn = document.createElement('button');
		closeBtn.className = 'toast-close';
		closeBtn.setAttribute('aria-label', 'Dismiss notification');
		closeBtn.innerHTML = '&times;';
		closeBtn.addEventListener('click', () => {
			this.dismiss(toast);
		});

		// Message content
		const messageEl = document.createElement('div');
		messageEl.className = 'toast-message';
		messageEl.textContent = message;

		// Assemble toast
		toast.innerHTML = `
			<div class="toast-icon">${icon}</div>
		`;
		toast.appendChild(messageEl);
		toast.appendChild(closeBtn);

		return toast;
	}

	/**
	 * Get SVG icon for toast type
	 */
	getIcon(type) {
		const icons = {
			success: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
				<path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/>
			</svg>`,
			error: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
				<path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"/>
			</svg>`,
			warning: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
				<path d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"/>
			</svg>`,
			info: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
				<path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/>
			</svg>`,
		};
		return icons[type] || icons.info;
	}

	/**
	 * Show a toast notification
	 * @param {string} message - Message to display
	 * @param {string} type - Toast type (success, error, warning, info)
	 * @param {number} duration - Auto-dismiss duration in milliseconds (0 = no auto-dismiss)
	 */
	show(message, type = 'info', duration = 4000) {
		console.log(`DEBUG: Showing toast: [${type}] ${message}`);
		const toast = this.createToast(message, type);
		this.toasts.add(toast);
		this.container.appendChild(toast);

		// Animate in
		requestAnimationFrame(() => {
			toast.classList.add('toast-show');
		});

		// Auto-dismiss
		if (duration > 0) {
			setTimeout(() => {
				this.dismiss(toast);
			}, duration);
		}

		return toast;
	}

	/**
	 * Dismiss a toast notification
	 */
	dismiss(toast) {
		if (!this.toasts.has(toast)) return;

		toast.classList.add('toast-removing');
		toast.classList.remove('toast-show');

		// Remove after animation
		setTimeout(() => {
			if (this.toasts.has(toast)) {
				this.toasts.delete(toast);
				toast.remove();
			}
		}, 300);
	}

	/**
	 * Convenience methods for common toast types
	 */
	success(message, duration = 3000) {		
		return this.show(message, 'success', duration);
	}

	error(message, duration = 5000) {
		return this.show(message, 'error', duration);
	}

	warning(message, duration = 4000) {
		return this.show(message, 'warning', duration);
	}

	info(message, duration = 3000) {
		return this.show(message, 'info', duration);
	}

	/**
	 * Clear all active toasts
	 */
	clear() {
		this.toasts.forEach(toast => {
			this.dismiss(toast);
		});
	}
}

// Auto-instantiate global toast manager
if (typeof window !== 'undefined') {
	console.log('DEBUG: Initializing global toast manager');
	window.toastManager = new ToastManager();

	// Expose showToast function for backwards compatibility
	window.showToast = function(title, message, type = 'info') {
		const fullMessage = title ? `${title}: ${message}` : message;
		window.toastManager.show(fullMessage, type);
	};
}
