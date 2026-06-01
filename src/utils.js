/**
 * utils.js — Shared utility functions
 */

/**
 * Show a toast notification
 * @param {string} message
 * @param {'success'|'error'|''} type
 * @param {number} duration ms
 */
export function showToast(message, type = '', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Escape HTML special characters
 */
export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format timestamp to HH:MM
 */
export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generate a color from a string (for user avatars)
 */
export function stringToColor(str) {
  const colors = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
    '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
  ];
  let hash = 0;
  for (const ch of str) hash = (hash << 5) - hash + ch.charCodeAt(0);
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Debounce
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
