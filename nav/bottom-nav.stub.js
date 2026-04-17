/**
 * Заглушка: нижнее меню отключено (нет обработчиков, панель скрыта).
 * В script.js замените импорт с ./bottom-nav.js на ./bottom-nav.stub.js
 */

export function isBottomNavLocked() {
    return false;
}

export function bottomNavLockedMessage() {
    return '';
}

export function syncBottomNavAfterRender() {}

export function setBottomNavLayoutFromAppVisibility(_isAuthenticated, _modeSelected) {
    const nav = document.querySelector('.navigation');
    const fon = document.querySelector('.navigation-fon');
    if (nav) nav.style.display = 'none';
    if (fon) fon.style.display = 'none';
}

export function initBottomNav() {}

export function syncMealSearchBottomNavFromOverlay() {}

export function updateMealSearchBottomNavAction() {}

export function setMealSearchNavBackHandler() {}
