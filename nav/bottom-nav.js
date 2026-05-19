/**
 * Нижняя навигация: видимость, активная вкладка, блокировка до выбора цикла/клиента,
 * переходы по разделам, Lottie-иконки, анимация SVG «программы».
 *
 * Отключение без правок по всему проекту: в script.js замените импорт на ./nav/bottom-nav.stub.js
 */

import { bottomNavMarkup } from './bottom-nav-markup.js';
import { shouldBlockSupplementTablePageNavigation } from '../pages/supplement.js';

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
    if (!document.getElementById('programs-btn')) {
        document.querySelector('#root')?.insertAdjacentHTML('afterend', bottomNavMarkup);
    }
    applyBottomNavButtonOrder();
}

function ensureBottomNavTrialCountdownNote() {
    const nav = document.querySelector('.navigation');
    if (!nav) return null;

    let note = nav.querySelector('.navigation-trial-countdown');
    if (!note) {
        note = document.createElement('div');
        note.className = 'navigation-trial-countdown';
        note.hidden = true;
        nav.appendChild(note);
    }

    return note;
}

export function syncBottomNavTrialCountdown(text = '') {
    const note = ensureBottomNavTrialCountdownNote();
    if (!note) return;

    const normalized = String(text || '').trim();
    note.textContent = normalized;
    note.hidden = !normalized;
}

let mealSearchNavOnBack = null;
let mealSearchNavOnAction = null;
let mealSearchNavOnSecondaryAction = null;
let mealBottomNavSuppressCommitTimer = 0;
const MEAL_BOTTOM_NAV_SUPPRESS_FADE_MS = 90;

function getMealOverlayNavElements() {
    ensureNavigationMealSearchStructure();

    const nav = document.querySelector('.navigation');
    if (!nav) return {};

    return {
        nav,
        backBtn: nav.querySelector('.meal-search-nav-back'),
        actionBtn: nav.querySelector('.meal-search-nav-action-primary'),
        secondaryActionBtn: nav.querySelector('.meal-search-nav-action-secondary'),
        wrap: nav.querySelector('.navigation__icons-wrap')
    };
}

export function setMealBottomNavSuppressed(hidden) {
    const { nav } = getMealOverlayNavElements();
    const fon = document.querySelector('.navigation-fon');
    const shouldHide = Boolean(hidden);

    if (shouldHide) {
        const alreadyHidden = nav?.classList.contains('navigation--suppressed')
            || nav?.classList.contains('navigation--suppressed-fade-only');

        if (!alreadyHidden) {
            nav?.classList.remove('navigation--suppressed-enter');
            fon?.classList.remove('navigation-fon--suppressed-enter');
            nav?.classList.add('navigation--suppressed-fade-only');
            fon?.classList.add('navigation-fon--suppressed-fade-only');

            mealBottomNavSuppressCommitTimer = window.setTimeout(() => {
                nav?.classList.add('navigation--suppressed-enter');
                fon?.classList.add('navigation-fon--suppressed-enter');
                nav?.classList.add('navigation--suppressed');
                fon?.classList.add('navigation-fon--suppressed');
                nav?.classList.remove('navigation--suppressed-fade-only');
                fon?.classList.remove('navigation-fon--suppressed-fade-only');
                mealBottomNavSuppressCommitTimer = 0;
            }, MEAL_BOTTOM_NAV_SUPPRESS_FADE_MS);
        }

        return;
    }

    if (mealBottomNavSuppressCommitTimer) {
        clearTimeout(mealBottomNavSuppressCommitTimer);
        mealBottomNavSuppressCommitTimer = 0;
    }

    nav?.classList.remove('navigation--suppressed-fade-only', 'navigation--suppressed-enter');
    fon?.classList.remove('navigation-fon--suppressed-fade-only', 'navigation-fon--suppressed-enter');
    nav?.classList.remove('navigation--suppressed');
    fon?.classList.remove('navigation-fon--suppressed');
}

function setMealBottomNavOverlayVisibility(visible) {
    const { nav, backBtn, actionBtn, secondaryActionBtn, wrap } = getMealOverlayNavElements();
    if (!nav) return;

    setMealBottomNavSuppressed(false);
    nav.classList.toggle('navigation--meal-search', Boolean(visible));
    nav.classList.remove('navigation--meal-search-expanded');
    wrap?.classList.remove('navigation__icons-wrap--from-right');

    if (!visible) {
        mealSearchNavOnBack = null;
        mealSearchNavOnAction = null;
        mealSearchNavOnSecondaryAction = null;

        if (backBtn) {
            backBtn.style.display = '';
            backBtn.setAttribute('aria-label', 'Назад');
        }

        if (actionBtn) {
            actionBtn.style.display = 'none';
            actionBtn.textContent = '';
            actionBtn.disabled = true;
            actionBtn.classList.remove('active', 'disabled', 'meal-search-nav-action--icon');
        }

        if (secondaryActionBtn) {
            secondaryActionBtn.style.display = 'none';
            secondaryActionBtn.innerHTML = '';
            secondaryActionBtn.disabled = true;
            secondaryActionBtn.classList.remove('active', 'disabled', 'meal-search-nav-action--icon');
            secondaryActionBtn.removeAttribute('aria-label');
        }
    }
}

function updateMealBottomNavButton(btn, opts, setHandler) {
    if (!btn) return;

    const text = opts.text != null ? String(opts.text) : '';
    const html = opts.html != null ? String(opts.html) : '';
    const show = opts.visible !== false && (html.length > 0 || text.length > 0);
    const disabled = show && opts.disabled === true;

    btn.style.display = show ? '' : 'none';
    btn.classList.toggle('meal-search-nav-action--icon', opts.icon === true);
    btn.disabled = !show || disabled;
    btn.classList.toggle('active', show && !disabled);
    btn.classList.toggle('disabled', show && disabled);

    if (show) {
        if (html.length > 0) {
            btn.innerHTML = html;
        } else {
            btn.textContent = text;
        }
        const ariaLabel = opts.label != null ? String(opts.label) : text;
        if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    } else {
        btn.textContent = '';
        btn.removeAttribute('aria-label');
    }

    setHandler(show && !disabled && typeof opts.onClick === 'function' ? opts.onClick : null);
}

/** Вызывается из pages/meal.js при смене верхнего слоя оверлея. */
export function syncMealSearchBottomNavFromOverlay(topOverlayEl) {
    const isSearchOnTop =
        topOverlayEl?.classList?.contains('meal-search-screen') &&
        !topOverlayEl?.classList?.contains('recipe-food-search-screen');

    setMealBottomNavOverlayVisibility(isSearchOnTop);
}

/**
 * @param {{
 *   text?: string,
 *   visible?: boolean,
 *   onClick?: (() => void) | null,
 *   disabled?: boolean
 * }} opts
 */
export function updateMealSearchBottomNavAction(opts) {
    const btn = document.querySelector('.meal-search-nav-action-primary');
    updateMealBottomNavButton(btn, opts || {}, (handler) => {
        mealSearchNavOnAction = handler;
    });
}

export function setMealSearchNavBackHandler(fn) {
    mealSearchNavOnBack = typeof fn === 'function' ? fn : null;
}

export function clearMealBottomNavOverlayMode() {
    setMealBottomNavOverlayVisibility(false);
}

/**
 * @param {{
 *   visible?: boolean,
 *   backVisible?: boolean,
 *   backLabel?: string,
 *   onBack?: (() => void) | null,
 *   actionText?: string,
 *   actionHtml?: string,
 *   actionLabel?: string,
 *   actionVisible?: boolean,
 *   onAction?: (() => void) | null,
 *   actionDisabled?: boolean,
 *   actionIcon?: boolean,
 *   secondaryActionText?: string,
 *   secondaryActionHtml?: string,
 *   secondaryActionLabel?: string,
 *   secondaryActionVisible?: boolean,
 *   onSecondaryAction?: (() => void) | null,
 *   secondaryActionDisabled?: boolean,
 *   secondaryActionIcon?: boolean
 * }} opts
 */
export function setMealBottomNavOverlayMode(opts = {}) {
    const { backBtn, secondaryActionBtn } = getMealOverlayNavElements();
    const visible = opts.visible !== false;

    setMealBottomNavOverlayVisibility(visible);

    if (!visible) return;

    if (backBtn) {
        backBtn.style.display = opts.backVisible === false ? 'none' : '';
        backBtn.setAttribute('aria-label', opts.backLabel || 'Назад');
    }

    mealSearchNavOnBack = typeof opts.onBack === 'function' ? opts.onBack : null;

    updateMealSearchBottomNavAction({
        text: opts.actionText,
        html: opts.actionHtml,
        label: opts.actionLabel,
        visible: opts.actionVisible,
        onClick: opts.onAction,
        disabled: opts.actionDisabled,
        icon: opts.actionIcon
    });

    updateMealBottomNavButton(
        secondaryActionBtn,
        {
            text: opts.secondaryActionText,
            html: opts.secondaryActionHtml,
            label: opts.secondaryActionLabel,
            visible: opts.secondaryActionVisible,
            onClick: opts.onSecondaryAction,
            disabled: opts.secondaryActionDisabled,
            icon: opts.secondaryActionIcon
        },
        (handler) => {
            mealSearchNavOnSecondaryAction = handler;
        }
    );
}

function ensureNavigationMealSearchStructure() {
    const nav = document.querySelector('.navigation');
    if (!nav || nav.dataset.mealSearchStruct === '1') return;
    nav.dataset.mealSearchStruct = '1';

    const lead = document.createElement('div');
    lead.className = 'navigation__meal-search-lead';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'meal-search-nav-back';
    const Spanback = document.createElement('span');
    Spanback.innerHTML = ` Назад `;
    back.setAttribute('aria-label', 'Назад к приёмам пищи');
    back.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Arrow-back-ios-rounded SVG Icon</title><path fill="currentColor" d="m3.55 12l7.35 7.35q.375.375.363.875t-.388.875t-.875.375t-.875-.375l-7.7-7.675q-.3-.3-.45-.675T.825 12t.15-.75t.45-.675l7.7-7.7q.375-.375.888-.363t.887.388t.375.875t-.375.875z"/></svg>
    `;

    const actions = document.createElement('div');
    actions.className = 'meal-search-nav-actions';

    const secondaryAction = document.createElement('button');
    secondaryAction.type = 'button';
    secondaryAction.className = 'meal-search-nav-action meal-search-nav-action-secondary';
    secondaryAction.style.display = 'none';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'meal-search-nav-action meal-search-nav-action-primary meal-search-main-action meal-search-main-action--text';
    action.style.display = 'none';

    back.append(Spanback);
    actions.append(secondaryAction, action);
    lead.append(back, actions);

    const wrap = document.createElement('div');
    wrap.className = 'navigation__icons-wrap';
    while (nav.firstChild) {
        wrap.appendChild(nav.firstChild);
    }
    nav.append(lead, wrap);

    back.addEventListener('click', () => {
        if (typeof mealSearchNavOnBack === 'function') mealSearchNavOnBack();
    });

    action.addEventListener('click', () => {
        if (typeof mealSearchNavOnAction === 'function') mealSearchNavOnAction();
    });

    secondaryAction.addEventListener('click', () => {
        if (typeof mealSearchNavOnSecondaryAction === 'function') mealSearchNavOnSecondaryAction();
    });
}

function st() {
    return window.state;
}

function renderApp() {
    const fn = window.render;
    if (typeof fn === 'function') fn();
}

function shouldBlockBottomNavPageSwitch(targetPage, state) {
    if (!state) return false;
    if (state.currentPage === targetPage) return false;
    return shouldBlockSupplementTablePageNavigation();
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

const NAV_BTN_ORDER = ['reports-btn', 'journal-btn', 'programs-btn', 'meal-btn', 'supplements-btn'];

function applyBottomNavButtonOrder() {
    const nav = document.querySelector('.navigation');
    if (!nav) return;
    const buttonHost = nav.querySelector('.navigation__icons-wrap') || nav;

    NAV_BTN_ORDER.forEach((btnId) => {
        const btn = document.getElementById(btnId);
        if (btn && (btn.parentElement === buttonHost || btn.parentElement === nav)) {
            buttonHost.appendChild(btn);
        }
    });
}

function getBottomNavTodayDateString() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}.${month}.${year}`;
}

function normalizeBottomNavSupplementTimes(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    const singleValue = String(value || '').trim();
    return singleValue ? [singleValue] : [];
}

function parseBottomNavSupplementDose(rawDose) {
    if (rawDose && typeof rawDose === 'object' && !Array.isArray(rawDose)) {
        const times = normalizeBottomNavSupplementTimes(rawDose.times || rawDose.time || rawDose.at);
        return {
            dosage: String(rawDose.dosage || rawDose.dose || rawDose.value || '').trim(),
            tablets: String(rawDose.tablets || rawDose.pills || rawDose.count || '').trim(),
            times,
            taken: Boolean(rawDose.taken || rawDose.completed || rawDose.done || rawDose.isTaken)
        };
    }

    return {
        dosage: rawDose == null ? '' : String(rawDose).trim(),
        tablets: '',
        times: [],
        taken: false
    };
}

function hasBottomNavSupplementDose(rawDose) {
    const parsedDose = parseBottomNavSupplementDose(rawDose);
    return Boolean(parsedDose.dosage || parsedDose.tablets || parsedDose.times.length);
}

function getTodayPendingSupplementsCount(planData = st()?.supplementPlan) {
    const todayDateString = getBottomNavTodayDateString();
    const dayRecord = Array.isArray(planData?.data)
        ? planData.data.find((day) => day?.date === todayDateString)
        : null;

    if (!dayRecord?.doses || typeof dayRecord.doses !== 'object') return 0;

    return Object.values(dayRecord.doses).reduce((count, rawDose) => {
        if (!hasBottomNavSupplementDose(rawDose)) return count;
        return count + (parseBottomNavSupplementDose(rawDose).taken ? 0 : 1);
    }, 0);
}

function ensureSupplementsNavBadge() {
    const supplementsBtn = document.getElementById('supplements-btn');
    if (!supplementsBtn) return null;

    let badge = supplementsBtn.querySelector('.nav-supplement-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-supplement-badge';
        badge.hidden = true;
        badge.setAttribute('aria-hidden', 'true');
        supplementsBtn.appendChild(badge);
    }

    return badge;
}

export function syncSupplementsBottomNavBadge(planData = st()?.supplementPlan) {
    const supplementsBtn = document.getElementById('supplements-btn');
    const badge = ensureSupplementsNavBadge();
    if (!supplementsBtn || !badge) return;

    const pendingCount = getTodayPendingSupplementsCount(planData);
    const hasBadge = pendingCount > 0;

    badge.hidden = !hasBadge;
    badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
    supplementsBtn.classList.toggle('nav-btn--has-badge', hasBadge);
}

export function setBottomNavLayoutFromAppVisibility(isAuthenticated, modeSelected) {
    const nav = document.querySelector('.navigation');
    const fon = document.querySelector('.navigation-fon');
    const show = !!(isAuthenticated && modeSelected);
    if (nav) nav.style.display = show ? 'flex' : 'none';
    if (fon) fon.style.display = show ? '' : 'none';
    syncBottomNavTrialCountdown(window.state?.localBuildTrial?.navText || '');
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
        syncBottomNavTrialCountdown(window.state?.localBuildTrial?.navText || '');
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
    if (idx >= 0) {
        navEl.dataset.active = String(idx);
    }

    syncSupplementsBottomNavBadge();
    syncBottomNavTrialCountdown(window.state?.localBuildTrial?.navText || '');
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
        if (shouldBlockBottomNavPageSwitch('programs', state)) return;

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
        if (shouldBlockBottomNavPageSwitch('journal', state)) return;
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
        if (shouldBlockBottomNavPageSwitch('supplements', state)) return;
        // Вход через кнопку меню: хотим дефолтное состояние (таблица, Пн текущей недели, верх таблицы),
        // а не "последний сохранённый скролл" после редактирований.
        state._supplementsForceDefaultOpen = true;
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
        if (shouldBlockBottomNavPageSwitch('meal', state)) return;
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
        if (shouldBlockBottomNavPageSwitch('reports', state)) return;
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
        syncSupplementsBottomNavBadge();
        syncBottomNavTrialCountdown(window.state?.localBuildTrial?.navText || '');
        // Animated bottom-nav icons are temporarily disabled; assets remain in the project.
        wireRouteHandlers();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
}
