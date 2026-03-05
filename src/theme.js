/* ============================================
   theme.js — Dark / Light Theme Toggle
   ============================================ */

const THEME_KEY = 'mymarks-theme';

export function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const theme = saved || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    return theme;
}

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    return next;
}
