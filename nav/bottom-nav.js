/**
 * Нижняя навигация: видимость, активная вкладка, блокировка до выбора цикла/клиента,
 * переходы по разделам, Lottie-иконки, анимация SVG «программы».
 *
 * Отключение без правок по всему проекту: в script.js замените импорт на ./nav/bottom-nav.stub.js
 */

import { bottomNavMarkup } from './bottom-nav-markup.js';

let bottomNavStylesInjected = false;

function ensureBottomNavStyles() {
    if (bottomNavStylesInjected) return;
    bottomNavStylesInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./bottom-nav.css', import.meta.url).href;
    document.head.appendChild(link);
}

function mountBottomNavMarkup() {
    if (document.getElementById('programs-btn')) return;
    document.querySelector('#root')?.insertAdjacentHTML('afterend', bottomNavMarkup);
}

let mealSearchNavOnBack = null;
let mealSearchNavOnAction = null;

/** Вызывается из pages/meal.js при смене верхнего слоя оверлея. */
export function syncMealSearchBottomNavFromOverlay(topOverlayEl) {
    const nav = document.querySelector('.navigation');
    if (!nav) return;

    const isSearchOnTop =
        topOverlayEl?.classList?.contains('meal-search-screen') &&
        !topOverlayEl?.classList?.contains('recipe-food-search-screen');

    if (isSearchOnTop) {
        nav.classList.add('navigation--meal-search');
        nav.classList.remove('navigation--meal-search-expanded');
    } else {
        nav.classList.remove('navigation--meal-search', 'navigation--meal-search-expanded');
        const wrap = nav.querySelector('.navigation__icons-wrap');
        if (wrap) {
            wrap.classList.remove('navigation__icons-wrap--from-right');
        }
    }
}

/**
 * @param {{ text?: string, visible?: boolean, onClick?: (() => void) | null }} opts
 */
export function updateMealSearchBottomNavAction(opts) {
    const btn = document.querySelector('.meal-search-nav-action');
    if (!btn) return;

    const text = opts.text != null ? String(opts.text) : '';
    const show = opts.visible !== false && text.length > 0;
    btn.style.display = show ? '' : 'none';
    btn.textContent = text;
    mealSearchNavOnAction = show && typeof opts.onClick === 'function' ? opts.onClick : null;
}

export function setMealSearchNavBackHandler(fn) {
    mealSearchNavOnBack = typeof fn === 'function' ? fn : null;
}

function ensureNavigationMealSearchStructure() {
    const nav = document.querySelector('.navigation');
    if (!nav || nav.dataset.mealSearchStruct === '1') return;
    nav.dataset.mealSearchStruct = '1';

    const lead = document.createElement('div');
    lead.className = 'navigation__meal-search-lead';

    const hamburger = document.createElement('button');
    hamburger.type = 'button';
    hamburger.className = 'meal-search-nav-hamburger';
    hamburger.setAttribute('aria-label', 'Меню навигации');
    hamburger.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 7h16v2H4V7zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>
        </svg>
    `;

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'meal-search-nav-back';
    back.setAttribute('aria-label', 'Назад к приёмам пищи');
    back.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'meal-search-nav-action meal-search-main-action meal-search-main-action--text';
    action.style.display = 'none';

    lead.append(hamburger, back, action);

    const wrap = document.createElement('div');
    wrap.className = 'navigation__icons-wrap';
    while (nav.firstChild) {
        wrap.appendChild(nav.firstChild);
    }
    nav.append(lead, wrap);

    hamburger.addEventListener('click', () => {
        if (!nav.classList.contains('navigation--meal-search')) return;

        if (nav.classList.contains('navigation--meal-search-expanded')) {
            nav.classList.remove('navigation--meal-search-expanded');
            wrap.classList.remove('navigation__icons-wrap--from-right');
            return;
        }

        nav.classList.add('navigation--meal-search-expanded');
        wrap.classList.add('navigation__icons-wrap--from-right');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                wrap.classList.remove('navigation__icons-wrap--from-right');
            });
        });
    });

    back.addEventListener('click', () => {
        if (typeof mealSearchNavOnBack === 'function') mealSearchNavOnBack();
    });

    action.addEventListener('click', () => {
        if (typeof mealSearchNavOnAction === 'function') mealSearchNavOnAction();
    });
}

function st() {
    return window.state;
}

function renderApp() {
    const fn = window.render;
    if (typeof fn === 'function') fn();
}

function toast(msg) {
    const fn = window.showToast;
    if (typeof fn === 'function') fn(msg);
}

export function isBottomNavLocked() {
    const state = st();
    if (!state?.currentMode) return false;
    if (state.currentMode === 'own') return !state.selectedCycleId;
    if (state.currentMode === 'personal') return !state.selectedClientId || !state.selectedCycleId;
    return false;
}

export function bottomNavLockedMessage() {
    const state = st();
    if (state?.currentMode === 'personal' && !state.selectedClientId) {
        return 'Сначала выберите или добавьте клиента.';
    }
    if (state?.currentMode === 'personal' && !state.selectedCycleId) {
        return 'Сначала выберите цикл для этого клиента.';
    }
    return 'Сначала выберите цикл на экране циклов.';
}

const NAV_BTN_ORDER = ['programs-btn', 'journal-btn', 'supplements-btn', 'meal-btn', 'reports-btn'];

export function setBottomNavLayoutFromAppVisibility(isAuthenticated, modeSelected) {
    const nav = document.querySelector('.navigation');
    const fon = document.querySelector('.navigation-fon');
    const show = !!(isAuthenticated && modeSelected);
    if (nav) nav.style.display = show ? 'flex' : 'none';
    if (fon) fon.style.display = show ? '' : 'none';
}

/**
 * Вызывать из render() после отрисовки контента: активная кнопка, «таблетка», блокировка.
 * Для экранов без меню — скрывает панель и подложку.
 */
export function syncBottomNavAfterRender(currentPage) {
    const navEl = document.querySelector('.navigation');
    const navFon = document.querySelector('.navigation-fon');
    if (!navEl) return;

    const hideNav =
        currentPage === 'cycleReport' ||
        currentPage === 'mealsReport' ||
        currentPage === 'modeSelect' ||
        currentPage === 'auth';

    if (hideNav) {
        navEl.style.display = 'none';
        if (navFon) navFon.style.display = 'none';
        return;
    }

    navEl.style.display = 'flex';
    if (navFon) navFon.style.display = '';

    navEl.classList.toggle('navigation--cycle-gate-locked', isBottomNavLocked());

    document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.remove('active'));

    const activeNavButtonId = {
        programs: 'programs-btn',
        programsInCycle: 'programs-btn',
        programDetails: 'programs-btn',
        journal: 'journal-btn',
        supplements: 'supplements-btn',
        meal: 'meal-btn',
        reports: 'reports-btn'
    }[currentPage];

    if (activeNavButtonId) {
        document.getElementById(activeNavButtonId)?.classList.add('active');
    }

    const activeBtn = document.querySelector('.nav-btn.active');
    const idx = activeBtn ? NAV_BTN_ORDER.indexOf(activeBtn.id) : 0;
    if (idx >= 0) navEl.dataset.active = String(idx);
}

function setupProgramsIconAnimation() {
    const btn = document.getElementById('programs-btn');
    const icon = btn?.querySelector('#icon');
    if (!btn || !icon) return;

    function playOnce() {
        icon.classList.remove('play');
        void icon.offsetWidth;
        icon.classList.add('play');
        setTimeout(() => icon.classList.remove('play'), 2000);
    }

    btn.addEventListener('click', playOnce);

    const mo = new MutationObserver(() => {
        const isActive =
            btn.classList.contains('active') ||
            btn.getAttribute('aria-selected') === 'true' ||
            btn.getAttribute('aria-current') === 'page';
        if (isActive) playOnce();
    });
    mo.observe(btn, { attributes: true });

    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (!e.isIntersecting) return;
            const isActive =
                btn.classList.contains('active') ||
                btn.getAttribute('aria-selected') === 'true' ||
                btn.getAttribute('aria-current') === 'page';
            if (isActive) playOnce();
        });
    });
    io.observe(btn);
}

function setupLottieNavClick(containerId, btnId, jsonPath) {
    const Lottie = window.lottie;
    if (!Lottie) return;
    const container = document.getElementById(containerId);
    const btn = document.getElementById(btnId);
    if (!container || !btn) return;

    const anim = Lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        path: jsonPath
    });

    let isPlaying = false;
    btn.addEventListener('click', () => {
        if (isPlaying) return;
        isPlaying = true;
        anim.goToAndPlay(0, true);
        anim.addEventListener(
            'complete',
            () => {
                isPlaying = false;
                anim.pause();
            },
            { once: true }
        );
    });
}

function wireRouteHandlers() {
    document.getElementById('programs-btn')?.addEventListener('click', () => {
        const state = st();
        if (!state?.currentMode) return;

        if (isBottomNavLocked()) {
            if (state.currentPage === 'profile') {
                state.currentPage = 'programs';
                state.profileCabinetEditing = false;
                renderApp();
                return;
            }
            if (!['programs', 'programsInCycle', 'programDetails'].includes(state.currentPage)) {
                state.currentPage = 'programs';
                renderApp();
                return;
            }
            toast(bottomNavLockedMessage());
            return;
        }

        if (['programs', 'programsInCycle', 'programDetails'].includes(state.currentPage)) return;

        if (state.lastProgramsPage === 'programDetails' && state.selectedProgramIdForDetails) {
            state.currentPage = 'programDetails';
        } else if (state.lastProgramsPage === 'programsInCycle' && state.selectedCycleId) {
            state.currentPage = 'programsInCycle';
        } else {
            state.currentPage = 'programs';
        }

        renderApp();
    });

    document.getElementById('journal-btn')?.addEventListener('click', () => {
        const state = st();
        if (!state?.currentMode) return;
        if (isBottomNavLocked()) {
            toast(bottomNavLockedMessage());
            return;
        }
        state.currentPage = 'journal';
        renderApp();
    });

    document.getElementById('supplements-btn')?.addEventListener('click', () => {
        const state = st();
        if (!state?.currentMode) return;
        if (isBottomNavLocked()) {
            toast(bottomNavLockedMessage());
            return;
        }
        state.currentPage = 'supplements';
        renderApp();
    });

    document.getElementById('meal-btn')?.addEventListener('click', () => {
        const state = st();
        if (!state?.currentMode) return;
        if (isBottomNavLocked()) {
            toast(bottomNavLockedMessage());
            return;
        }
        state.currentPage = 'meal';
        renderApp();
    });

    document.getElementById('reports-btn')?.addEventListener('click', () => {
        const state = st();
        if (!state?.currentMode) return;
        if (isBottomNavLocked()) {
            toast(bottomNavLockedMessage());
            return;
        }
        state.currentPage = 'reports';
        renderApp();
    });
}

let bottomNavInitialized = false;

export function initBottomNav() {
    if (bottomNavInitialized) return;
    bottomNavInitialized = true;

    const run = () => {
        ensureBottomNavStyles();
        mountBottomNavMarkup();
        ensureNavigationMealSearchStructure();
        setupProgramsIconAnimation();
        setupLottieNavClick('journal-icon', 'journal-btn', './icon-animations/menuCalendar.json');
        setupLottieNavClick('supplement-icon', 'supplements-btn', './icon-animations/menuBad.json');
        setupLottieNavClick('meal-icon', 'meal-btn', './icon-animations/menuMeal.json');
        setupLottieNavClick('reports-icon', 'reports-btn', './icon-animations/menuReports.json');
        wireRouteHandlers();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
}
