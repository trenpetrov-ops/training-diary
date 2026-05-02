import {
    getFirestore,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    getDocs,
    query,       // 👈 добавь
    where
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { openCycleSelectModal } from '../script.js';
import { openDateModal } from '../script.js';
import { getTodayDateString } from '../script.js';
import { formatDayAndMonth } from '../script.js';
import { dateToInputFormat } from '../script.js';
import { generateDates } from '../script.js';
import { getCycleDocRef } from '../script.js';
import { showToast } from '../script.js';
import { openConfirmModal } from '../script.js';
import { ensureCycleSelected } from '../script.js';
import { renderTopBar } from '../script.js';
import { render } from '../script.js';
import { attachMonthCarouselSwipe } from '../calendar-month-carousel.js';
import {
    clearMealBottomNavOverlayMode,
    setMealBottomNavOverlayMode,
    syncSupplementsBottomNavBadge
} from '../nav/bottom-nav.js';

const SUPPLEMENTS_VIEW_MODE_KEY = 'trainingDiary:supplementsViewMode';
const SUPPLEMENTS_TABLE_RANGE_KEY = 'trainingDiary:supplementsTableRange';
const MAX_SUPPLEMENTS_COUNT = 20;
const SUPPLEMENT_SHORT_NAME_LIMIT = 7;
const SUPPLEMENT_TABLE_VISIBLE_WEEKS = 4;
const SUPPLEMENT_TABLE_RENDER_WEEKS = 8;
const SUPPLEMENT_TABLE_SHIFT_WEEKS = 2;
const SUPPLEMENT_TABLE_VISIBLE_DAYS = SUPPLEMENT_TABLE_VISIBLE_WEEKS * 7;
const SUPPLEMENT_TABLE_RENDER_DAYS = SUPPLEMENT_TABLE_RENDER_WEEKS * 7;
const SUPPLEMENT_TABLE_SHIFT_DAYS = SUPPLEMENT_TABLE_SHIFT_WEEKS * 7;
let supplementCalendarMonthDate = null;
let supplementCalendarSelectedDate = null;
let supplementTableViewportSyncController = null;
let supplementTableScrollState = null;
let supplementDoseClipboard = null;
let supplementDoseClipboardMeta = null;
let supplementDoseLongPressOverlayCleanup = null;
let supplementTableVirtualState = null;

export function sanitizeSupplementPlan(planData) {
    const plan = planData && typeof planData === 'object'
        ? planData
        : { supplements: [], data: [] };

    let changed = false;

    if (!Array.isArray(plan.supplements)) {
        plan.supplements = [];
        changed = true;
    }

    if (!Array.isArray(plan.data)) {
        plan.data = [];
        changed = true;
    }

    const supplementsBefore = JSON.stringify(plan.supplements);
    ensureSupplementEntrySlots(plan);
    if (JSON.stringify(plan.supplements) !== supplementsBefore) {
        changed = true;
    }

    const allowedNames = new Set(
        getSupplementNames(plan, { includeArchived: true })
            .map(name => String(name || '').trim())
            .filter(Boolean)
    );

    plan.data = plan.data.map((dayRecord) => {
        if (!dayRecord || typeof dayRecord !== 'object' || Array.isArray(dayRecord)) {
            changed = true;
            return {
                date: '',
                dayOfWeek: '',
                doses: {}
            };
        }

        if (!dayRecord.doses || typeof dayRecord.doses !== 'object' || Array.isArray(dayRecord.doses)) {
            dayRecord.doses = {};
            changed = true;
            return dayRecord;
        }

        Object.keys(dayRecord.doses).forEach((name) => {
            if (!allowedNames.has(String(name || '').trim())) {
                delete dayRecord.doses[name];
                changed = true;
            }
        });

        return dayRecord;
    });

    return { plan, changed };
}

function resetSupplementsTableScrollMemory() {
    supplementTableScrollState = null;
}

export function resetSupplementsListener() {
    // План БАДов синхронизируется через onSnapshot на документе цикла в script.js (setupDynamicListeners).
}
// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР ПЛАНА БАДОВ/ДОБАВОК (Обновлена)
// =================================================================
export async function renderSupplementsPage() {
    const root = document.getElementById('root');
    supplementTableViewportSyncController?.abort?.();
    supplementTableViewportSyncController = null;
    supplementTableVirtualState = null;
    clearSupplementDoseLongPressPopover();
    if (!ensureCycleSelected(render)) return;
    const isDayDetailsPage = Boolean(state.supplementCalendarDetailDate);

    const currentCycle = state.cycles?.find(c => c.id === state.selectedCycleId);
    root.innerHTML = '';

    if (state._supplementsForceDefaultOpen) {
        state._supplementsForceDefaultOpen = false;
        // Всегда открываем как "с нуля": таблица + без сохранённого скролла.
        setSupplementsViewMode('calendar');
        resetSupplementsTableScrollMemory();
        supplementCalendarMonthDate = null;
        supplementCalendarSelectedDate = null;
        state.supplementCalendarDetailDate = null;
    }

    if (!isDayDetailsPage) {
        renderTopBar();
    }

    const contentContainer = document.createElement('div');
    contentContainer.id = 'supplements-content';
    contentContainer.className = 'supplements-page';

    if (!currentCycle) {
        contentContainer.append(
            createElement('h3', null, 'План приема БАДов'),
            createElement('div', 'muted', 'Цикл не найден. Выберите другой.')
        );
        root.append(contentContainer);
        return false;
    }


    // --- Заголовок ---
    const supplementViewMode = getSupplementsViewMode();
    const title = createElement('h3');
    title.innerHTML = `План добавок: <span>${currentCycle.name}</span>`;
    if (supplementViewMode !== 'table') {
        contentContainer.append(title);
    }




    // --- Проверяем план добавок ---
    if (!state.supplementPlan || !state.supplementPlan.data) {
        contentContainer.append(
            createElement('div', 'muted', 'План добавок пока не загружен.')
        );
        root.append(contentContainer);
        return false;
    }

    // --- Всё готово, можно рендерить план ---
    console.log('✅ План добавок загружен:', state.supplementPlan);
    root.append(contentContainer);

    const activePlanData = state.supplementPlan || { supplements: [], data: [] };
    if (!isDayDetailsPage) {
        configureSupplementsTopBar(supplementViewMode, activePlanData);
    }

    if (state.supplementCalendarDetailDate) {
        if (!title.isConnected) {
            contentContainer.prepend(title);
        }
        title.innerHTML = `Добавки: <span>${formatDayAndMonth(state.supplementCalendarDetailDate)}</span>`;
        renderSupplementCalendarDayDetailsPage(contentContainer, activePlanData, state.supplementCalendarDetailDate);
        return;
    }

    clearMealBottomNavOverlayMode();

    if (supplementViewMode === 'calendar') {
        renderSupplementsCalendarView(contentContainer, activePlanData);
    } else {
        renderSupplementsTableView(contentContainer, activePlanData);
    }
    return;

    // TODO: здесь у тебя дальше идёт рендер таблицы / карточек добавок


    const controlsWrapper = createElement('div', 'supplements-controls-wrapper');

    // Группа кнопок +/- Неделя
    const weekControlsGroup = createElement('div', 'week-controls-group');
    const addSupplementBtnWrap = createElement('div', 'add-supplement-btn-wrap');


   // Удаляем кнопку, если уже есть
   const existingAddBtn = weekControlsGroup.querySelector('.add-supplement-btn');
   if (existingAddBtn) existingAddBtn.remove();

   // Проверяем количество добавок
   const currentSupplements = getSupplementNames(state.supplementPlan);
   const addSupplementBtnTitle = createElement('span', 'title-add-btn', 'добавить препарат');
   if (supplementViewMode === 'table' && currentSupplements.length >= 5 && currentSupplements.length < MAX_SUPPLEMENTS_COUNT) {
       const addSupplementBtn = createElement('button', 'btn btn-primary add-supplement-btn');
         addSupplementBtn.innerHTML = `
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Add-plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h6m0 0h6m-6 0v6m0-6V6"></path></svg>
           `;
       addSupplementBtnWrap.append(addSupplementBtnTitle,addSupplementBtn);


       addSupplementBtn.addEventListener('click', () => {
           openSupplementEditModal(currentSupplements.length, '');
       });
   } else if (supplementViewMode === 'table' && currentSupplements.length >= MAX_SUPPLEMENTS_COUNT) {
       addSupplementBtnWrap.append(addSupplementBtnTitle, createElement('span', 'supplement-limit-label', `${MAX_SUPPLEMENTS_COUNT}/${MAX_SUPPLEMENTS_COUNT}`));
   }


    // Кнопки +/- Неделя
    const removeWeekBtn = createElement('button', 'btn btn-secondary');
                 removeWeekBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20"><title>Minus-sm SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M5 10a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1" clip-rule="evenodd"/></svg>
                   `;
    removeWeekBtn.addEventListener('click', removeLastWeek);

    const weekLabel = createElement('span', 'week-label', 'неделя');

    const addWeekBtn = createElement('button', 'btn btn-secondary');
             addWeekBtn.innerHTML = `
                   <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><title>Add-plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h6m0 0h6m-6 0v6m0-6V6"></path></svg>
               `;
    addWeekBtn.addEventListener('click', addWeek);

    weekControlsGroup.append(removeWeekBtn, weekLabel, addWeekBtn);





    if (supplementViewMode === 'table') {
        const controlsLead = createElement('div', 'supplements-controls-lead');
        const tableActions = createElement('div', 'supplements-controls-actions');
        const actionsSpacer = createElement('div', 'supplements-controls-row-placeholder');
        const leadSpacer = createElement('div', 'supplements-controls-row-placeholder');
        const shouldShowAddControl = currentSupplements.length >= 5;
        controlsWrapper.classList.add('supplements-controls-wrapper--table');

        if (shouldShowAddControl) {
            controlsLead.append(weekControlsGroup);
            tableActions.append(addSupplementBtnWrap, actionsSpacer);
        } else {
            controlsLead.append(leadSpacer);
            tableActions.append(weekControlsGroup, actionsSpacer);
        }

        controlsWrapper.append(controlsLead, tableActions);
        contentContainer.append(controlsWrapper);
    }
    return;


// -----------------------------------------------------------
// РЕНДЕРИНГ ТАБЛИЦЫ
// -----------------------------------------------------------
const planData = state.supplementPlan || { supplements: [], data: [] };
const todayDateString = getTodayDateString(); // Сегодняшняя дата в формате ДД.ММ.ГГГГ
let todayRowElement = null; // Переменная для хранения элемента строки

if (planData.supplements.length === 0 && planData.data.length === 0) {
    contentContainer.append(createElement('div', 'muted', 'Начните с добавления первого препарата.'));
} else {
    const tableWrapper = createElement('div', 'supplement-table-wrapper');
    tableWrapper.id = 'supplement-table-wrapper'; // 🔥 ДОБАВЛЕНО: ID для прокрутки

 const guard = createElement('div', 'scroll-guard');
    const table = createElement('table', 'supplement-plan-table');

    // 🔹 ЗАГОЛОВОК ТАБЛИЦЫ (Препараты)
    const thead = createElement('thead');
    const headerRow = createElement('tr');

    const dateTh = createElement('th', 'date-col', 'Дата / Дни');
    dateTh.colSpan = 2;
    headerRow.append(dateTh);

    const activeEntries = getSupplementEntries(planData);
    const tableColumns = getSupplementTableColumns(planData);
    const displayNames = [...realNames];
    while (displayNames.length < 5) displayNames.push(''); // минимум 5 колонок

    // Строим столбцы
    displayNames.forEach((column) => {
        const th = createElement('th', 'supplement-col');
        th.dataset.index = i;
        const header = createElement('div', 'supplement-header');

            const nameDiv = createElement('div', 'sup-name', name || '—');
            nameDiv.addEventListener('click', () => {
              openSupplementEditModal(i, name);
            });




        header.append(nameDiv);
        th.append(header);
        headerRow.append(th);
    });

    thead.append(headerRow);
    table.append(thead);

    // 🔹 Включаем drag&drop для перестановки колонок
    setTimeout(() => enableHeaderDnd(thead, planData), 0);

    // 🔹 ТЕЛО ТАБЛИЦЫ (Даты и Дозировки)
    const tbody = createElement('tbody');
    planData.data.forEach((dayRecord, dayIndex) => {
        let rowClasses = '';
        const parsedDate = parseSupplementDateString(dayRecord.date);
        const dayNumber = parsedDate?.getDay?.();
        if (dayRecord.date === todayDateString) rowClasses += ' today-highlight';
        if (dayRecord.dayOfWeek === 'вс' || dayRecord.dayOfWeek === 'сб') rowClasses += ' weekend';

        const tr = createElement('tr', rowClasses.trim());
        if (dayNumber === 6) tr.classList.add('saturday');
        if (dayNumber === 0) tr.classList.add('sunday');
        tr.dataset.date = dayRecord.date;

        // Формат даты ДД.ММ
        tr.append(createElement('td', 'date-col', formatDayAndMonth(dayRecord.date)));
        tr.append(createElement('td', 'day-col', dayRecord.dayOfWeek));

        // Ячейки дозировок
        displayNames.forEach(supName => {
            const td = createElement('td', 'dose-col');

            if (!supName) {
                const disabled = createElement('input', 'dose-input');
                disabled.disabled = true;
                td.append(disabled);
                tr.append(td);
                return;
            }

            const doseInput = createElement('input', 'dose-input');
            doseInput.type = 'text';
            doseInput.value =
                (dayRecord.doses && dayRecord.doses[supName]) ? dayRecord.doses[supName] : '';

            doseInput.addEventListener('input', e => {
                debouncedSaveDoseData(supName, dayIndex, e.target.value);
            });

            td.append(doseInput);
            tr.append(td);
        });

        tbody.append(tr);
        if (dayRecord.date === todayDateString) todayRowElement = tr;
    });

    table.append(tbody);
    tableWrapper.append(guard);
    guard.append(table);
    contentContainer.append(tableWrapper);
}

    root.append(contentContainer);

 // установка на сегоднешнюю дату в табл
    setTimeout(() => {
        const wrapper = document.getElementById('supplement-table-wrapper');
        if (!wrapper) return;

        if (todayRowElement) {
            const rowRect = todayRowElement.getBoundingClientRect();
            const wrapperRect = wrapper.getBoundingClientRect();

            const scrollPosition =
                rowRect.top - wrapperRect.top + wrapper.scrollTop -
                (wrapperRect.height / 2) + (rowRect.height / 2);

            wrapper.scrollTop = scrollPosition; // без анимации
        } else {
            wrapper.scrollTop = wrapper.scrollHeight; // в самый низ
        }
    }, 0);

}











// =================================================================
// 🔥 НОВАЯ ФУНКЦИЯ FIREBASE: Обновление плана добавок
// =================================================================
function getSupplementsViewMode() {
    try {
        return localStorage.getItem(SUPPLEMENTS_VIEW_MODE_KEY) === 'calendar' ? 'calendar' : 'table';
    } catch (error) {
        return 'table';
    }
}

function setSupplementsViewMode(mode) {
    try {
        localStorage.setItem(SUPPLEMENTS_VIEW_MODE_KEY, mode);
    } catch (error) {
        // localStorage can be unavailable in strict privacy modes.
    }
}

function getSupplementsTableRangeMode() {
    return 'two-weeks';
}

function setSupplementsTableRangeMode(mode) {
    try {
        localStorage.setItem(SUPPLEMENTS_TABLE_RANGE_KEY, 'two-weeks');
    } catch (error) {
        // localStorage can be unavailable in strict privacy modes.
    }
}

function createSupplementsTableRangeToggle(activeMode) {
    const toggle = createElement('div', 'supplements-table-range-toggle');

    const createButton = (mode, label) => {
        const btn = createElement('button', `supplements-table-range-btn ${activeMode === mode ? 'active' : ''}`, label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
            if (getSupplementsTableRangeMode() === mode) return;
            setSupplementsTableRangeMode(mode);
            renderSupplementsPage();
        });
        return btn;
    };

    toggle.append(
        createButton('week', '1 неделя'),
        createButton('two-weeks', '2 недели')
    );

    return toggle;
}

function createSupplementsViewToggle(activeMode) {
    const toggle = createElement('div', 'supplements-view-toggle');

    const createButton = (mode, label) => {
        const btn = createElement('button', `supplements-view-toggle-btn ${activeMode === mode ? 'active' : ''}`, label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
            if (getSupplementsViewMode() === mode) return;
            // Переключение Календарь → Таблица: как вход "по умолчанию"
            if (mode === 'table' && getSupplementsViewMode() === 'calendar') {
                resetSupplementsTableScrollMemory();
            }
            setSupplementsViewMode(mode);
            renderSupplementsPage();
        });
        return btn;
    };

    toggle.append(
        createButton('table', 'Таблица'),
        createButton('calendar', 'Календарь')
    );

    return toggle;
}

function createSupplementsViewAction(activeMode) {
    const targetMode = activeMode === 'calendar' ? 'table' : 'calendar';
    const label = activeMode === 'calendar' ? 'Таблица' : 'Календарь';
    const btn = createElement('button', 'supplements-view-switch-btn', label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
        if (getSupplementsViewMode() === targetMode) return;
        if (targetMode === 'table') {
            resetSupplementsTableScrollMemory();
        }
        setSupplementsViewMode(targetMode);
        renderSupplementsPage();
    });
    return btn;
}

function createSupplementsTopBarCalendarButton() {
    const btn = createElement('button', 'supplements-topbar-action-btn supplements-topbar-calendar-btn', 'Календарь');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Календарь');
    btn.addEventListener('click', () => {
        if (getSupplementsViewMode() === 'calendar') return;
        resetSupplementsTableScrollMemory();
        setSupplementsViewMode('calendar');
        renderSupplementsPage();
    });
    return btn;
}

function createSupplementsTopBarTableButton() {
    const btn = createElement('button', 'supplements-topbar-action-btn supplements-topbar-table-btn', 'Таблица');
    btn.type = 'button';
    btn.addEventListener('click', () => {
        if (getSupplementsViewMode() === 'table') return;
        resetSupplementsTableScrollMemory();
        setSupplementsViewMode('table');
        renderSupplementsPage();
    });
    return btn;
}

function createSupplementsTopBarAddButton(planData) {
    const currentSupplements = getSupplementNames(planData);
    if (currentSupplements.length < 5 || currentSupplements.length >= MAX_SUPPLEMENTS_COUNT) {
        return null;
    }

    const btn = createElement('button', 'supplements-topbar-action-btn supplements-topbar-add-btn');
    btn.type = 'button';
    btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Add-plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h6m0 0h6m-6 0v6m0-6V6"></path></svg>
        <span>препарат</span>
    `;
    btn.addEventListener('click', () => {
        openSupplementEditModal(currentSupplements.length, '');
    });
    return btn;
}

function createSupplementsTopBarWeekControls() {
    const group = createElement('div', 'week-controls-group supplements-topbar-week-controls');

    const removeWeekBtn = createElement('button', 'btn btn-secondary');
    removeWeekBtn.type = 'button';
    removeWeekBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 20 20"><title>Minus-sm SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M5 10a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1" clip-rule="evenodd"/></svg>
    `;
    removeWeekBtn.addEventListener('click', removeLastWeek);

    const weekLabel = createElement('span', 'week-label', 'неделя');

    const addWeekBtn = createElement('button', 'btn btn-secondary');
    addWeekBtn.type = 'button';
    addWeekBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><title>Add-plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h6m0 0h6m-6 0v6m0-6V6"></path></svg>
    `;
    addWeekBtn.addEventListener('click', addWeek);

    group.append(removeWeekBtn, weekLabel, addWeekBtn);
    return group;
}

function configureSupplementsTopBar(viewMode, planData) {
    const topBar = document.querySelector('.top-bar');
    const leftGroup = topBar?.querySelector('.topbar-cycle-btns');
    if (!topBar || !leftGroup) return;

    topBar.classList.remove('top-bar--supplements-table');
    topBar.querySelector('.supplements-topbar-right')?.remove();
    leftGroup.querySelector('.supplements-topbar-add-btn')?.remove();
    leftGroup.querySelector('.supplements-topbar-calendar-btn')?.remove();
    leftGroup.querySelector('.supplements-topbar-table-btn')?.remove();

    if (viewMode === 'calendar') {
        leftGroup.append(createSupplementsTopBarTableButton());
        return;
    }

    topBar.classList.add('top-bar--supplements-table');
    topBar.querySelector('.top-menu-btn')?.remove();

    const addBtn = createSupplementsTopBarAddButton(planData);
    if (addBtn) {
        leftGroup.append(addBtn);
    }
    leftGroup.append(createSupplementsTopBarCalendarButton());
}

function renderSupplementsTableView(contentContainer, planData) {
    const todayDateString = getTodayDateString();
    const tableColumns = getSupplementTableColumns(planData);
    const tableRangeMode = getSupplementsTableRangeMode();
    const currentCycle = state.cycles?.find(cycle => cycle.id === state.selectedCycleId) || null;

    contentContainer.classList.add('supplements-page--table-range');

    const tableWrapper = createElement('div', `supplement-table-wrapper supplement-table-wrapper--${tableRangeMode}`);
    tableWrapper.id = 'supplement-table-wrapper';
    tableWrapper.dataset.displayColumns = String(tableColumns.length);
    tableWrapper.classList.remove('supplement-table-wrapper--fitted');

    const guard = createElement('div', 'scroll-guard');
    const table = createElement('table', `supplement-plan-table supplement-plan-table--${tableRangeMode}`);
    const thead = createElement('thead');
    const headerRow = createElement('tr');

    const dateTh = createElement('th', 'date-col', 'Дата / Дни');
    dateTh.colSpan = 2;
    headerRow.append(dateTh);

    tableColumns.forEach((column) => {
        const th = createElement('th', 'supplement-col');
        const header = createElement('div', 'supplement-header');
        th.dataset.slot = String(column.slot);

        if (column.type === 'active') {
            th.dataset.index = String(column.activeIndex);
            th.dataset.activeIndex = String(column.activeIndex);
            const nameBtn = createElement('button', 'sup-name', column.shortName || column.name);
            nameBtn.type = 'button';
            nameBtn.addEventListener('click', () => {
                openSupplementEditModal({
                    planIndex: column.planIndex,
                    currentName: column.name,
                    slotIndex: column.slot
                });
            });
            header.append(nameBtn);
        } else {
            th.classList.add('supplement-col--empty');
            const addBtn = createElement('button', 'sup-name sup-name--add', '');
            addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><title>Add-plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h6m0 0h6m-6 0v6m0-6V6"></path></svg>`;
            addBtn.type = 'button';
            addBtn.addEventListener('click', () => {
                openSupplementEditModal({
                    planIndex: -1,
                    currentName: '',
                    slotIndex: column.slot
                });
            });
            header.append(addBtn);
        }

        th.append(header);
        headerRow.append(th);
    });

    thead.append(headerRow);
    table.append(thead);
    setTimeout(() => enableHeaderDnd(thead, planData), 0);

    const tbody = createElement('tbody');
    table.append(tbody);
    guard.append(table);
    tableWrapper.append(guard);

    const jumpBtnWrap = createElement('div', 'supplement-jump-btn-wrap is-hidden');
    const jumpBtn = createElement('button', 'btn btn-secondary supplement-jump-btn', '');
    jumpBtn.type = 'button';
    jumpBtnWrap.append(jumpBtn);
    tableWrapper.append(jumpBtnWrap);
    contentContainer.append(tableWrapper);
    enableSupplementDoseCellLongPressActions(tableWrapper);
    enableSupplementColumnLongPressDrag(tableWrapper, planData);
    const baseStartDate = getSupplementCycleBaseWeekStartDate(currentCycle);
    const savedScroll = getRememberedSupplementTableScroll(tableRangeMode);
    const savedWindowStart = parseSupplementDateString(savedScroll?.windowStartDate || '');
    const defaultTodayTargetState = getSupplementTodayWeekTargetState({
        baseStartDate
    });
    const initialWindowStart = savedWindowStart && compareSupplementDates(savedWindowStart, baseStartDate) >= 0
        ? savedWindowStart
        : (defaultTodayTargetState?.windowStartDate || baseStartDate);

    supplementTableVirtualState = {
        planData,
        tableColumns,
        tableWrapper,
        tbody,
        jumpBtnWrap,
        contentContainer,
        tableRangeMode,
        baseStartDate,
        windowStartDate: cloneSupplementDate(initialWindowStart),
        historyRangesBySlot: buildSupplementHistoryRangesBySlot(planData, tableColumns),
        lastScrollTop: 0
    };

    renderSupplementTableWindow(supplementTableVirtualState);
    bindSupplementJumpButton(jumpBtnWrap, supplementTableVirtualState);

    supplementTableViewportSyncController?.abort?.();
    supplementTableViewportSyncController = new AbortController();
    const syncTableViewportLayout = () => {
        if (!contentContainer.isConnected || !tableWrapper.isConnected) return;
        syncSupplementsTableViewport(contentContainer, tableWrapper);
        syncSupplementTableRangeLayout(tableWrapper, tableRangeMode, supplementTableVirtualState);
    };
    const scheduleTableViewportLayout = () => {
        requestAnimationFrame(syncTableViewportLayout);
    };

    requestAnimationFrame(() => {
        syncTableViewportLayout();
        if (savedScroll) {
            tableWrapper.scrollLeft = savedScroll.left;
            tableWrapper.scrollTop = savedScroll.top;
        } else {
            tableWrapper.scrollTop = Math.max(
                0,
                getSupplementTableRowHeightPx(tableWrapper) * (defaultTodayTargetState?.offsetDays || 0)
            );
        }
        supplementTableVirtualState.lastScrollTop = tableWrapper.scrollTop;
        syncSupplementJumpButtonVisibility(jumpBtnWrap, supplementTableVirtualState);
    });

    attachSupplementTableBounceLock(tableWrapper, supplementTableViewportSyncController.signal);
    window.addEventListener('resize', scheduleTableViewportLayout, { signal: supplementTableViewportSyncController.signal });
    window.addEventListener('orientationchange', scheduleTableViewportLayout, { signal: supplementTableViewportSyncController.signal });
    window.visualViewport?.addEventListener('resize', scheduleTableViewportLayout, { signal: supplementTableViewportSyncController.signal });
    window.visualViewport?.addEventListener('scroll', scheduleTableViewportLayout, { signal: supplementTableViewportSyncController.signal });

    let syncFrameId = 0;
    const handleScroll = () => {
        if (syncFrameId) return;
        syncFrameId = requestAnimationFrame(() => {
            syncFrameId = 0;
            if (!supplementTableVirtualState || !tableWrapper.isConnected) return;
            syncSupplementTableVirtualWindow(supplementTableVirtualState);
            rememberSupplementTableScroll(tableWrapper);
            syncSupplementJumpButtonVisibility(jumpBtnWrap, supplementTableVirtualState);
        });
    };

    tableWrapper.addEventListener('scroll', handleScroll, { passive: true, signal: supplementTableViewportSyncController.signal });
}

function renderSupplementTableWindow(tableState) {
    if (!tableState?.tbody || !tableState?.tableWrapper) return;

    const {
        tbody,
        tableWrapper,
        tableColumns,
        planData,
        tableRangeMode,
        historyRangesBySlot,
        windowStartDate
    } = tableState;
    const showCellTimes = tableRangeMode === 'week';
    const todayDateString = getTodayDateString();
    const virtualRecords = getSupplementTableWindowRecords(planData, windowStartDate, SUPPLEMENT_TABLE_RENDER_DAYS);
    const fragment = document.createDocumentFragment();
    let todayRowElement = null;

    tableColumns.forEach((column) => {
        column.labelShownEntries = new Set();
    });

    virtualRecords.forEach((dayRecord) => {
        const rowClasses = [];
        const parsedDate = parseSupplementDateString(dayRecord.date);
        const dayNumber = parsedDate?.getDay?.();

        if (dayRecord.date === todayDateString) rowClasses.push('today-highlight');
        if (dayNumber === 6) rowClasses.push('weekend', 'saturday');
        if (dayNumber === 0) rowClasses.push('weekend', 'sunday');
        const tr = createElement('tr', rowClasses.join(' '));
        tr.dataset.date = dayRecord.date;

        tr.append(createElement('td', 'date-col', formatSupplementDayCell(dayRecord.date)));
        tr.append(createElement('td', 'day-col', dayRecord.dayOfWeek || ''));

        tableColumns.forEach((column) => {
            const td = createElement('td', 'dose-col');

            if (column.type === 'empty') {
                td.append(createElement('div', 'supplement-dose-cell-btn supplement-dose-cell-btn--empty', ''));
                tr.append(td);
                return;
            }

            let historyRangeNameForRow = null;
            const slotRanges = historyRangesBySlot.get(column.slot);
            if (slotRanges && parsedDate) {
                for (const [name, range] of slotRanges.entries()) {
                    if (
                        range.startDate &&
                        range.endDate &&
                        compareSupplementDates(parsedDate, range.startDate) >= 0 &&
                        compareSupplementDates(parsedDate, range.endDate) <= 0
                    ) {
                        historyRangeNameForRow = name;
                        break;
                    }
                }
            }

            const displayEntry = getSupplementColumnDisplayEntry(column, dayRecord);
            const rawDose = displayEntry ? dayRecord.doses?.[displayEntry.name] : '';
            const quantityText = formatSupplementDoseQuantity(rawDose);
            const timeText = showCellTimes ? formatSupplementDoseTimeLabel(rawDose) : '';
            const hasValue = Boolean(quantityText || timeText);
            const isInteractive = Boolean(
                column.activeEntry &&
                (!displayEntry || displayEntry.name === column.activeEntry.name)
            );
            const doseBtn = createElement(
                isInteractive ? 'button' : 'div',
                `supplement-dose-cell-btn ${hasValue ? 'has-dose' : ''} ${timeText ? 'supplement-dose-cell-btn--with-time' : ''} ${displayEntry?.archived ? 'supplement-dose-cell-btn--history' : ''}`.trim()
            );

            if (
                historyRangeNameForRow &&
                (!displayEntry || displayEntry.name === historyRangeNameForRow) &&
                column.entriesWithHistory?.some((entry) => entry?.archived && entry?.name === historyRangeNameForRow)
            ) {
                doseBtn.classList.add('supplement-dose-cell-btn--history-range');
            }

            if (isInteractive) {
                td.dataset.supplementIndex = String(column.activeIndex);
                doseBtn.type = 'button';
                doseBtn.dataset.supplementIndex = String(column.activeIndex);
                doseBtn.dataset.date = dayRecord.date;
                doseBtn.dataset.supplementName = column.activeEntry.name;
                doseBtn.dataset.supplementSlot = String(column.slot);
                const shouldShowHistoryLabel = shouldShowSupplementColumnHistoryLabel(column, column.activeEntry);
                doseBtn.dataset.historyLabel = shouldShowHistoryLabel ? '1' : '0';
                doseBtn.dataset.historyLabelText = column.activeEntry.name;
            }

            const shouldShowHistoryLabel = Boolean(
                displayEntry &&
                hasValue &&
                shouldShowSupplementColumnHistoryLabel(column, displayEntry) &&
                !column.labelShownEntries.has(displayEntry.name)
            );

            if (shouldShowHistoryLabel) {
                doseBtn.append(createElement('span', 'supplement-dose-cell-history-label', displayEntry.name));
                column.labelShownEntries.add(displayEntry.name);
            }

            if (hasValue) {
                doseBtn.append(createElement('span', 'supplement-dose-cell-main', quantityText || ''));
                if (timeText) {
                    doseBtn.append(createElement('span', 'supplement-dose-cell-time', timeText));
                }
            }

            if (isInteractive) {
                doseBtn.addEventListener('click', () => {
                    openSupplementDoseModal({ dateStr: dayRecord.date, supplementName: column.activeEntry.name });
                });
            }

            td.append(doseBtn);
            tr.append(td);
        });

        fragment.append(tr);
        if (dayRecord.date === todayDateString) {
            todayRowElement = tr;
        }
    });

    tbody.replaceChildren(fragment);
    tableWrapper.dataset.windowStartDate = formatSupplementDateString(windowStartDate);
    tableState.todayRowElement = todayRowElement;
}

function getSupplementTableRowHeightPx(tableWrapper) {
    if (!tableWrapper) return 24;
    const cssRowHeight = parseFloat(
        getComputedStyle(tableWrapper).getPropertyValue('--supplement-table-row-height')
    );
    if (Number.isFinite(cssRowHeight) && cssRowHeight > 0) return cssRowHeight;
    return tableWrapper.querySelector('tbody tr')?.getBoundingClientRect().height || 24;
}

function canShiftSupplementTableWindowBackward(tableState) {
    return compareSupplementDates(tableState.windowStartDate, tableState.baseStartDate) > 0;
}

function shiftSupplementTableWindow(tableState, offsetDays) {
    if (!tableState || !offsetDays) return false;

    let nextStartDate = addSupplementDays(tableState.windowStartDate, offsetDays);
    if (compareSupplementDates(nextStartDate, tableState.baseStartDate) < 0) {
        nextStartDate = cloneSupplementDate(tableState.baseStartDate);
    }

    if (compareSupplementDates(nextStartDate, tableState.windowStartDate) === 0) {
        return false;
    }

    tableState.windowStartDate = nextStartDate;
    renderSupplementTableWindow(tableState);
    return true;
}

function syncSupplementTableVirtualWindow(tableState) {
    const { tableWrapper } = tableState || {};
    if (!tableWrapper) return;

    const currentScrollTop = tableWrapper.scrollTop;
    const previousScrollTop = Number.isFinite(tableState.lastScrollTop) ? tableState.lastScrollTop : currentScrollTop;
    const rowHeight = getSupplementTableRowHeightPx(tableWrapper);
    const shiftPixels = rowHeight * SUPPLEMENT_TABLE_SHIFT_DAYS;
    const backwardThreshold = Math.max(rowHeight * 2, 1);
    const scrollingDown = currentScrollTop > previousScrollTop + 0.5;
    const scrollingUp = currentScrollTop < previousScrollTop - 0.5;

    if (scrollingDown && currentScrollTop >= shiftPixels) {
        if (shiftSupplementTableWindow(tableState, SUPPLEMENT_TABLE_SHIFT_DAYS)) {
            tableWrapper.scrollTop = Math.max(0, currentScrollTop - shiftPixels);
        }
    } else if (scrollingUp && currentScrollTop <= backwardThreshold && canShiftSupplementTableWindowBackward(tableState)) {
        if (shiftSupplementTableWindow(tableState, -SUPPLEMENT_TABLE_SHIFT_DAYS)) {
            tableWrapper.scrollTop = currentScrollTop + shiftPixels;
        }
    }

    tableState.lastScrollTop = tableWrapper.scrollTop;
}
function scrollSupplementTableRowToTop(wrapper, rowElement) {
    const rowRect = rowElement.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const header = wrapper.querySelector('thead');
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const nextScrollTop = wrapper.scrollTop + rowRect.top - wrapperRect.top - headerHeight;

    wrapper.scrollTop = Math.max(0, nextScrollTop);
}

function isSupplementTableRowVisible(wrapper, rowElement) {
    if (!wrapper || !rowElement) return false;

    const wrapperRect = wrapper.getBoundingClientRect();
    const rowRect = rowElement.getBoundingClientRect();
    const header = wrapper.querySelector('thead');
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const visibleTop = wrapperRect.top + headerHeight;
    const visibleBottom = wrapperRect.bottom;

    return rowRect.bottom > visibleTop && rowRect.top < visibleBottom;
}

function getSupplementDefaultWeekTargetRow(wrapper) {
    if (!wrapper) return null;

    const todayDate = parseSupplementDateString(getTodayDateString()) || new Date();
    const currentWeekStartDate = getSupplementWeekStartDate(todayDate);
    const currentWeekEndDate = new Date(currentWeekStartDate);
    currentWeekEndDate.setDate(currentWeekStartDate.getDate() + 6);
    const currentWeekStartDateString = formatSupplementDateString(currentWeekStartDate);

    const tableRows = Array.from(wrapper.querySelectorAll('tbody tr[data-date]'));
    return tableRows.find(row => row.dataset.date === currentWeekStartDateString)
        || tableRows.find(row => {
            const parsedDate = parseSupplementDateString(row.dataset.date);
            return parsedDate && parsedDate >= currentWeekStartDate && parsedDate <= currentWeekEndDate;
        })
        || null;
}

function getSupplementTodayWeekTargetState(tableState) {
    if (!tableState) return null;

    const todayDate = parseSupplementDateString(getTodayDateString()) || new Date();
    const targetWeekStartDate = getSupplementWeekStartDate(todayDate);
    const desiredWindowStartDate = addSupplementDays(
        targetWeekStartDate,
        -(SUPPLEMENT_TABLE_SHIFT_DAYS + 7)
    );
    const windowStartDate = compareSupplementDates(desiredWindowStartDate, tableState.baseStartDate) >= 0
        ? desiredWindowStartDate
        : cloneSupplementDate(tableState.baseStartDate);
    const offsetDays = Math.max(
        0,
        Math.round(
            (
                addSupplementDays(targetWeekStartDate, -7).getTime() -
                windowStartDate.getTime()
            ) / 86400000
        )
    );

    return {
        windowStartDate,
        offsetDays
    };
}

function jumpSupplementTableToTodayWeek(tableState) {
    if (!tableState?.tableWrapper) return;

    const targetState = getSupplementTodayWeekTargetState(tableState);
    if (!targetState) return;

    tableState.windowStartDate = targetState.windowStartDate;
    renderSupplementTableWindow(tableState);

    const rowHeight = getSupplementTableRowHeightPx(tableState.tableWrapper);
    tableState.tableWrapper.scrollTop = rowHeight * targetState.offsetDays;
    tableState.lastScrollTop = tableState.tableWrapper.scrollTop;
    rememberSupplementTableScroll(tableState.tableWrapper);
    syncSupplementJumpButtonVisibility(tableState.jumpBtnWrap, tableState);
}

function getSupplementJumpArrowSvg(direction) {
    const isUp = direction === 'up';
    // Простая стрелка (chevron) без отдельной стилизации.
    return isUp
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 8.8L6.9 13.9a1 1 0 0 1-1.4-1.4l5.8-5.8a1 1 0 0 1 1.4 0l5.8 5.8a1 1 0 1 1-1.4 1.4z"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 15.2l5.1-5.1a1 1 0 0 1 1.4 1.4l-5.8 5.8a1 1 0 0 1-1.4 0l-5.8-5.8a1 1 0 1 1 1.4-1.4z"/></svg>`;
}

function syncSupplementJumpButtonVisibility(buttonWrap, wrapper) {
    if (!buttonWrap) return;

    const tableState = wrapper?.tableWrapper ? wrapper : supplementTableVirtualState;
    const resolvedWrapper = tableState?.tableWrapper || wrapper || document.getElementById('supplement-table-wrapper');
    const button = buttonWrap.querySelector('button.supplement-jump-btn');
    const todayDateString = getTodayDateString();
    const todayRow = resolvedWrapper?.querySelector?.(`tbody tr[data-date="${todayDateString}"]`);

    if (!resolvedWrapper || !button) {
        buttonWrap.classList.add('is-hidden');
        return;
    }

    if (todayRow) {
        if (isSupplementTableRowVisible(resolvedWrapper, todayRow)) {
            buttonWrap.classList.add('is-hidden');
            return;
        }

        const wrapperRect = resolvedWrapper.getBoundingClientRect();
        const rowRect = todayRow.getBoundingClientRect();
        const header = resolvedWrapper.querySelector('thead');
        const headerHeight = header?.getBoundingClientRect().height || 0;
        const visibleTop = wrapperRect.top + headerHeight;
        const direction = rowRect.top < visibleTop ? 'up' : 'down';

        button.dataset.direction = direction;
        button.innerHTML = getSupplementJumpArrowSvg(direction);
        buttonWrap.classList.remove('is-hidden');
        return;
    }

    if (!tableState?.windowStartDate) {
        buttonWrap.classList.add('is-hidden');
        return;
    }

    const renderedStartDate = tableState.windowStartDate;
    const renderedEndDate = addSupplementDays(renderedStartDate, SUPPLEMENT_TABLE_RENDER_DAYS - 1);
    const todayDate = parseSupplementDateString(todayDateString);
    if (!todayDate) {
        buttonWrap.classList.add('is-hidden');
        return;
    }

    if (compareSupplementDates(todayDate, renderedStartDate) < 0) {
        button.dataset.direction = 'up';
        button.innerHTML = getSupplementJumpArrowSvg('up');
        buttonWrap.classList.remove('is-hidden');
        return;
    }

    if (compareSupplementDates(todayDate, renderedEndDate) > 0) {
        button.dataset.direction = 'down';
        button.innerHTML = getSupplementJumpArrowSvg('down');
        buttonWrap.classList.remove('is-hidden');
        return;
    }

    buttonWrap.classList.add('is-hidden');
}

function bindSupplementJumpButton(buttonWrap, wrapper) {
    const tableState = wrapper?.tableWrapper ? wrapper : supplementTableVirtualState;
    const resolvedWrapper = tableState?.tableWrapper || wrapper || document.getElementById('supplement-table-wrapper');
    const button = buttonWrap?.querySelector?.('button.supplement-jump-btn');
    if (!buttonWrap || !resolvedWrapper || !button) {
        buttonWrap?.classList.add('is-hidden');
        return;
    }

    button.addEventListener('click', () => {
        if (tableState?.windowStartDate) {
            jumpSupplementTableToTodayWeek(tableState);
            return;
        }
        const targetRow = getSupplementDefaultWeekTargetRow(resolvedWrapper);
        if (!targetRow) return;
        scrollSupplementTableRowToTop(resolvedWrapper, targetRow);
        syncSupplementJumpButtonVisibility(buttonWrap, resolvedWrapper);
    });

    let frameId = 0;
    const syncVisibility = () => {
        if (frameId) return;
        frameId = requestAnimationFrame(() => {
            frameId = 0;
            syncSupplementJumpButtonVisibility(buttonWrap, tableState || resolvedWrapper);
        });
    };

    syncVisibility();
    resolvedWrapper.addEventListener('scroll', syncVisibility, { passive: true, signal: supplementTableViewportSyncController?.signal });
    window.addEventListener('resize', syncVisibility, { signal: supplementTableViewportSyncController?.signal });
    window.visualViewport?.addEventListener('resize', syncVisibility, { signal: supplementTableViewportSyncController?.signal });
}

function syncSupplementsTableViewport(contentContainer, activeViewport, options = {}) {
    if (!contentContainer || !activeViewport) return;
    const {
        constrainToNav = false,
        bottomOffset = 0
    } = options;

    const viewportHeight = Math.round(
        window.visualViewport?.height ||
        window.innerHeight ||
        document.documentElement?.clientHeight ||
        0
    );
    if (!viewportHeight) return;

    let bottomLimit = viewportHeight;
    if (constrainToNav) {
        const nav = document.querySelector('.navigation');
        if (nav) {
            const navRect = nav.getBoundingClientRect();
            if (Number.isFinite(navRect.top) && navRect.top > 0) {
                bottomLimit = Math.min(bottomLimit, navRect.top);
            }
        }
    }

    const contentRect = contentContainer.getBoundingClientRect();
    const contentHeight = Math.max(0, Math.floor(bottomLimit - contentRect.top - bottomOffset));
    if (!contentHeight) return;

    contentContainer.style.height = `${contentHeight}px`;
    contentContainer.style.minHeight = `${contentHeight}px`;
    contentContainer.style.maxHeight = `${contentHeight}px`;

    const activeRect = activeViewport.getBoundingClientRect();
    const availableHeight = Math.max(0, Math.floor(bottomLimit - activeRect.top - bottomOffset));
    if (!availableHeight) return;

    activeViewport.style.height = `${availableHeight}px`;
    activeViewport.style.minHeight = `${availableHeight}px`;
    activeViewport.style.maxHeight = `${availableHeight}px`;
}

function attachSupplementTableBounceLock(tableWrapper, signal) {
    if (!tableWrapper) return;

    let startX = 0;
    let startY = 0;
    let axis = null;

    tableWrapper.addEventListener('touchstart', event => {
        if (event.touches.length !== 1) {
            axis = null;
            return;
        }

        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        axis = null;
    }, { passive: true, signal });

    tableWrapper.addEventListener('touchmove', event => {
        if (event.touches.length !== 1 || tableWrapper.classList.contains('supplement-table-wrapper--column-dragging')) {
            return;
        }

        const touch = event.touches[0];
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;

        if (!axis && (Math.abs(diffX) > 6 || Math.abs(diffY) > 6)) {
            axis = Math.abs(diffX) > Math.abs(diffY) ? 'x' : 'y';
        }

        if (axis === 'y') {
            const maxScrollTop = Math.max(0, tableWrapper.scrollHeight - tableWrapper.clientHeight);
            const atTop = tableWrapper.scrollTop <= 0;
            const atBottom = tableWrapper.scrollTop >= maxScrollTop - 1;
            const noVerticalOverflow = maxScrollTop <= 1;
            const pullingPastTop = diffY > 0;
            const pullingPastBottom = diffY < 0;

            if (noVerticalOverflow || (atTop && pullingPastTop) || (atBottom && pullingPastBottom)) {
                event.preventDefault();
            }
            return;
        }

        if (axis === 'x') {
            const maxScrollLeft = Math.max(0, tableWrapper.scrollWidth - tableWrapper.clientWidth);
            const atLeft = tableWrapper.scrollLeft <= 0;
            const atRight = tableWrapper.scrollLeft >= maxScrollLeft - 1;
            const noHorizontalOverflow = maxScrollLeft <= 1;
            const pullingPastLeft = diffX > 0;
            const pullingPastRight = diffX < 0;

            if (noHorizontalOverflow || (atLeft && pullingPastLeft) || (atRight && pullingPastRight)) {
                event.preventDefault();
            }
        }
    }, { passive: false, signal });
}

function syncSupplementTableRangeLayout(tableWrapper, tableRangeMode, tableState = null) {
    if (!tableWrapper) return;

    const visibleDays = SUPPLEMENT_TABLE_VISIBLE_DAYS;
    const header = tableWrapper.querySelector('thead');
    const table = tableWrapper.querySelector('.supplement-plan-table');
    const guard = tableWrapper.querySelector('.scroll-guard');
    const headerHeight = header?.getBoundingClientRect().height || 43;
    const wrapperRect = tableWrapper.getBoundingClientRect();
    const navRect = document.querySelector('.navigation')?.getBoundingClientRect?.();
    const visibleBottom = Number.isFinite(navRect?.top) && navRect.top > 0
        ? navRect.top
        : wrapperRect.bottom;
    const availableHeight = Math.max(Math.floor(visibleBottom - wrapperRect.top - headerHeight), 0);
    const rowHeight = availableHeight > 0
        ? Math.max(1, availableHeight / visibleDays)
        : 24;

    tableWrapper.style.setProperty('--supplement-table-row-height', `${rowHeight}px`);

    const displayColumns = Number(tableWrapper.dataset.displayColumns || 0);
    if (displayColumns > 0) {
        const leadWidth = getSupplementStickyLeadWidth(table);
        const minColumnWidth = tableRangeMode === 'week' ? 64 : 53;
        const fitAvailableWidth = Math.max(tableWrapper.clientWidth - leadWidth, 0);
        const dividerCompensation = Math.max(6, displayColumns + 1);
        const fittedCandidate = fitAvailableWidth > 0
            ? Math.floor((fitAvailableWidth - dividerCompensation) / displayColumns)
            : minColumnWidth;
        const canFitMinColumns = fitAvailableWidth >= (minColumnWidth * displayColumns);
        let columnWidth = Math.max(minColumnWidth, fittedCandidate);
        let fitted = canFitMinColumns;

        tableWrapper.classList.toggle('supplement-table-wrapper--fitted', fitted);
        tableWrapper.style.setProperty('--supplement-table-column-width', `${columnWidth}px`);

        if (table && fitted) {
            const initialOverflow = Math.max(0, Math.ceil(table.scrollWidth - tableWrapper.clientWidth));
            if (initialOverflow > 0) {
                columnWidth = Math.max(minColumnWidth, columnWidth - Math.ceil(initialOverflow / displayColumns));
                tableWrapper.style.setProperty('--supplement-table-column-width', `${columnWidth}px`);
            } else {
                const remainingWidth = Math.floor(tableWrapper.clientWidth - table.scrollWidth);
                const canGrow = remainingWidth > displayColumns ? Math.floor((remainingWidth - 1) / displayColumns) : 0;
                if (canGrow > 0) {
                    columnWidth += canGrow;
                    tableWrapper.style.setProperty('--supplement-table-column-width', `${columnWidth}px`);
                }
            }

            fitted = table.scrollWidth <= tableWrapper.clientWidth + 1;
            tableWrapper.classList.toggle('supplement-table-wrapper--fitted', fitted);
        }
    } else {
        tableWrapper.style.removeProperty('--supplement-table-column-width');
    }
}

function formatSupplementDayCell(dateString) {
    const parts = String(dateString || '').split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : (parts[0] || '');
}

function syncSupplementTableMonthLabel(tableWrapper, labelElement) {
    if (!tableWrapper || !labelElement) return;

    const visibleDates = getVisibleSupplementTableDates(tableWrapper);
    const firstDate = visibleDates[0];
    const lastDate = visibleDates[visibleDates.length - 1] || firstDate;

    labelElement.textContent = getSupplementMonthRangeLabel(firstDate, lastDate);
}

function getVisibleSupplementTableDates(tableWrapper) {
    const rows = Array.from(tableWrapper.querySelectorAll('tbody tr[data-date]'));
    if (!rows.length) return [];

    const wrapperRect = tableWrapper.getBoundingClientRect();
    const header = tableWrapper.querySelector('thead');
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const visibleTop = wrapperRect.top + headerHeight;
    const visibleBottom = wrapperRect.bottom;

    const visibleRows = rows.filter((row) => {
        const rowRect = row.getBoundingClientRect();
        return rowRect.bottom > visibleTop && rowRect.top < visibleBottom;
    });

    return (visibleRows.length ? visibleRows : rows).map((row) => row.dataset.date).filter(Boolean);
}

function getSupplementMonthRangeLabel(startDateString, endDateString) {
    const startDate = parseSupplementDateString(startDateString);
    const endDate = parseSupplementDateString(endDateString || startDateString);

    if (!startDate && !endDate) return '';
    if (!startDate) return formatSupplementMonthLabel(endDate);
    if (!endDate) return formatSupplementMonthLabel(startDate);

    const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
    if (sameMonth) {
        return formatSupplementMonthLabel(startDate);
    }

    const sameYear = startDate.getFullYear() === endDate.getFullYear();
    return sameYear
        ? `${formatSupplementMonthLabel(startDate)} - ${formatSupplementMonthLabel(endDate)}`
        : `${formatSupplementMonthLabel(startDate, true)} - ${formatSupplementMonthLabel(endDate, true)}`;
}

function formatSupplementMonthLabel(date, withYear = false) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

    const monthName = capitalizeFirstLetter(
        date.toLocaleDateString('ru-RU', { month: 'long' })
    );

    return withYear ? `${monthName} ${date.getFullYear()}` : monthName;
}

function capitalizeFirstLetter(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderSupplementsCalendarView(contentContainer, planData) {
    ensureSupplementCalendarState(planData);
    contentContainer.classList.add('supplements-page--calendar-range');

    const monthDate = getSupplementMonthStart(supplementCalendarMonthDate || new Date());
    const wrapper = createElement('div', 'supplements-calendar-view');
    const calendarCard = createElement('div', 'supplement-calendar-card');
    const header = createElement('div', 'supplement-calendar-header');
    const monthControls = createElement('div', 'supplement-calendar-month-controls');

    const prevBtn = createElement('button', 'supplement-calendar-nav-btn');
    prevBtn.type = 'button';
    prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M13.83 19a1 1 0 0 1-.78-.37l-4.83-6a1 1 0 0 1 0-1.27l5-6a1 1 0 0 1 1.54 1.28L10.29 12l4.32 5.36a1 1 0 0 1-.78 1.64"/></svg>`;
    prevBtn.addEventListener('click', () => changeSupplementCalendarMonth(planData, -1));

    const title = createElement('div', 'supplement-calendar-title', getSupplementMonthTitle(monthDate));

    const nextBtn = createElement('button', 'supplement-calendar-nav-btn');
    nextBtn.type = 'button';
    nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M10 19a1 1 0 0 1-.64-.23a1 1 0 0 1-.13-1.41L13.71 12L9.39 6.63a1 1 0 0 1 .15-1.41a1 1 0 0 1 1.46.15l4.83 6a1 1 0 0 1 0 1.27l-5 6A1 1 0 0 1 10 19"/></svg>`;
    nextBtn.addEventListener('click', () => changeSupplementCalendarMonth(planData, 1));

    monthControls.append(prevBtn, title, nextBtn);
    header.append(monthControls);

    const weekdays = createElement('div', 'supplement-calendar-weekdays');
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
        weekdays.append(createElement('div', 'supplement-calendar-weekday', day));
    });

    const viewport = createElement('div', 'supplement-calendar-months-viewport');
    const track = createElement('div', 'supplement-calendar-months-track');
    track.style.transform = 'translate3d(-100%, 0, 0)';

    [-1, 0, 1].forEach(offset => {
        const page = createElement('div', 'supplement-calendar-month-page');
        renderSupplementCalendarMonthPage(page, addSupplementMonths(monthDate, offset), planData);
        track.append(page);
    });

    viewport.append(track);
    attachSupplementCalendarSwipe(viewport, track, planData);

    calendarCard.append(header, weekdays, viewport);

    wrapper.append(calendarCard);
    contentContainer.append(wrapper);

    supplementTableViewportSyncController?.abort?.();
    supplementTableViewportSyncController = new AbortController();
    const syncCalendarLayout = () => {
        if (!contentContainer.isConnected) return;

        // 1) Сначала фиксируем высоту всего контента под текущий viewport (как в таблице).
        syncSupplementsTableViewport(contentContainer, viewport, {
            constrainToNav: true,
            bottomOffset: 12
        });

        // 2) Затем задаём высоту именно области месяцев (внизу карточки),
        // чтобы на любом экране календарь занимал весь доступный диапазон и
        // ячейки дней растягивались/сжимались по высоте.
        const cardRect = calendarCard.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const weekdaysRect = weekdays.getBoundingClientRect();
        const paddingBottom = 10;
        const paddingTop = 10;
        const fixedParts = (headerRect.height || 0) + (weekdaysRect.height || 0) + paddingTop + paddingBottom;
        const nextHeight = Math.max(120, Math.floor((cardRect.height || 0) - fixedParts));
        viewport.style.height = `${nextHeight}px`;

        const weeksCount = 6;
        const gridGap = 6;
        const availableForCells = Math.max(0, nextHeight - gridGap * (weeksCount - 1));
        const nextCellHeight = Math.max(44, Math.floor(availableForCells / weeksCount));
        calendarCard.style.setProperty('--supplement-calendar-cell-height', `${nextCellHeight}px`);
    };
    const scheduleCalendarLayout = () => requestAnimationFrame(syncCalendarLayout);
    requestAnimationFrame(syncCalendarLayout);
    window.addEventListener('resize', scheduleCalendarLayout, { signal: supplementTableViewportSyncController.signal });
    window.addEventListener('orientationchange', scheduleCalendarLayout, { signal: supplementTableViewportSyncController.signal });
    window.visualViewport?.addEventListener('resize', scheduleCalendarLayout, { signal: supplementTableViewportSyncController.signal });
    window.visualViewport?.addEventListener('scroll', scheduleCalendarLayout, { signal: supplementTableViewportSyncController.signal });
}

function renderSupplementCalendarMonthPage(page, monthDate, planData) {
    const grid = createElement('div', 'supplement-calendar-grid');
    const dateMap = getSupplementPlanDateMap(planData);
    const todayDateString = getTodayDateString();
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const totalDays = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const trailingDays = (7 - ((startOffset + totalDays) % 7)) % 7;
    const totalCells = startOffset + totalDays + trailingDays;
    const prevMonthTotalDays = new Date(monthDate.getFullYear(), monthDate.getMonth(), 0).getDate();

    for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
        // Показываем дни соседних месяцев (полупрозрачные), вместо пустых плейсхолдеров
        if (cellIndex < startOffset) {
            const dayNum = prevMonthTotalDays - startOffset + 1 + cellIndex;
            const cell = createElement('div', 'supplement-calendar-day supplement-calendar-day--placeholder supplement-calendar-day--other-month');
            cell.append(createElement('span', 'supplement-calendar-day-num', String(dayNum)));
            grid.append(cell);
            continue;
        }
        if (cellIndex >= startOffset + totalDays) {
            const dayNum = cellIndex - (startOffset + totalDays) + 1;
            const cell = createElement('div', 'supplement-calendar-day supplement-calendar-day--placeholder supplement-calendar-day--other-month');
            cell.append(createElement('span', 'supplement-calendar-day-num', String(dayNum)));
            grid.append(cell);
            continue;
        }

        const dayNumber = cellIndex - startOffset + 1;
        const cellDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayNumber);
        const dateStr = formatSupplementDateString(cellDate);
        const dayRecord = dateMap.get(dateStr);
        const doseEntries = getSupplementDayDoseEntries(dayRecord, planData);
        const doseCount = doseEntries.length;
        const isCompleted = doseCount > 0 && doseEntries.every(entry => entry.taken);
        const cell = createElement('button', 'supplement-calendar-day');
        cell.type = 'button';
        cell.dataset.date = dateStr;

        const isToday = dateStr === todayDateString;
        const isSelected = dateStr === todayDateString;
        const isEmptySelected = isSelected && doseCount === 0;

        if (isToday) cell.classList.add('is-today');
        if (isSelected) cell.classList.add('is-selected');
        if (isEmptySelected) cell.classList.add('is-selected-empty');
        if (dayRecord) cell.classList.add('is-in-plan');
        if (!dayRecord) cell.classList.add('is-out-of-plan');
        if (doseCount > 0) cell.classList.add('has-doses');
        if (doseCount > 0 && isCompleted) cell.classList.add('is-completed');
        if (doseCount > 0 && !isCompleted) cell.classList.add('is-planned');

        cell.append(createElement('span', 'supplement-calendar-day-num', String(cellDate.getDate())));

        if (doseCount > 0) {
            const supplementsList = createElement('span', 'supplement-calendar-day-supplements');
            doseEntries.slice(0, 4).forEach(entry => {
                supplementsList.append(createElement('span', 'supplement-calendar-day-supplement', entry.shortName || entry.name));
            });

            if (doseEntries.length > 4) {
                const hiddenCount = doseEntries.length - 4;
                supplementsList.append(
                    createElement('span', 'supplement-calendar-day-more', `еще +${hiddenCount}`)
                );
            }

            cell.append(supplementsList);
        }

        cell.addEventListener('click', () => {
            supplementCalendarMonthDate = getSupplementMonthStart(cellDate);
            state.supplementCalendarDetailDate = dateStr;
            setSupplementsViewMode('calendar');
            renderSupplementsPage();
        });

        grid.append(cell);
    }

    page.append(grid);
}

function syncSupplementCalendarViewportHeight(viewport, track) {
    const activePage = track?.children?.[1];
    if (!viewport || !activePage) return;
    viewport.style.height = `${activePage.scrollHeight}px`;
}

function renderSupplementCalendarDayDetailsPage(contentContainer, planData, dateStr) {
    contentContainer.classList.add('supplements-page--day-details');

    const screen = createElement('div', 'supplement-day-details-screen');
    const panel = createElement('div', 'supplement-calendar-day-panel supplement-calendar-day-panel--screen');
    renderSupplementCalendarDayPanel(panel, planData, dateStr, {
        allowAdd: false,
        showHeader: false,
        markable: true
    });

    screen.append(panel);
    contentContainer.append(screen);

    syncSupplementDayDetailsBottomNav();
}

function closeSupplementDayDetailsPage() {
    state.supplementCalendarDetailDate = null;
    setSupplementsViewMode('calendar');
    clearMealBottomNavOverlayMode();
    renderSupplementsPage();
}

function syncSupplementDayDetailsBottomNav() {
    setMealBottomNavOverlayMode({
        visible: true,
        backLabel: 'Назад к календарю',
        onBack: closeSupplementDayDetailsPage,
        actionVisible: false,
        secondaryActionVisible: false
    });
}

function attachSupplementDayDetailsSwipe(screen, planData, dateStr) {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let isHorizontal = false;
    let isTracking = false;

    screen.addEventListener('touchstart', event => {
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        lastX = startX;
        isHorizontal = false;
        isTracking = true;
    }, { passive: true });

    screen.addEventListener('touchmove', event => {
        if (!isTracking) return;
        const touch = event.touches[0];
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;
        lastX = touch.clientX;

        if (!isHorizontal && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
            isHorizontal = Math.abs(diffX) > Math.abs(diffY);
        }

        if (isHorizontal) event.preventDefault();
    }, { passive: false });

    screen.addEventListener('touchend', () => {
        if (!isTracking) return;

        const diffX = lastX - startX;
        if (isHorizontal && Math.abs(diffX) > 52) {
            const nextDate = getAdjacentSupplementPlanDate(planData, dateStr, diffX < 0 ? 1 : -1);
            if (nextDate) {
                state.supplementCalendarDetailDate = nextDate;
                const parsed = parseSupplementDateString(nextDate);
                if (parsed) supplementCalendarMonthDate = getSupplementMonthStart(parsed);
                renderSupplementsPage();
            }
        }

        isTracking = false;
    });
}

function getAdjacentSupplementPlanDate(planData, dateStr, direction) {
    const dates = (Array.isArray(planData?.data) ? planData.data : [])
        .map(day => day?.date)
        .filter(Boolean);
    const index = dates.indexOf(dateStr);
    if (index === -1) return null;
    return dates[index + direction] || null;
}

function openSupplementCalendarDayModal(planData, dateStr) {
    const backdrop = createElement('div', 'modal-backdrop supplement-calendar-day-backdrop');
    const modal = createElement('div', 'modal-window supplement-calendar-day-modal');
    const closeBtn = createElement('button', 'supplement-calendar-day-modal-close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';

    const panel = createElement('div', 'supplement-calendar-day-panel supplement-calendar-day-panel--modal');
    const closeModal = () => backdrop.remove();

    renderSupplementCalendarDayPanel(panel, planData, dateStr, {
        allowAdd: false,
        onAction: closeModal
    });

    closeBtn.addEventListener('click', closeModal);
    modal.append(closeBtn, panel);
    backdrop.append(modal);
    document.body.append(backdrop);

    backdrop.addEventListener('click', event => {
        if (event.target === backdrop) closeModal();
    });
}

function renderSupplementCalendarDayPanel(panel, planData, dateStr, options = {}) {
    panel.innerHTML = '';

    const record = getSupplementDayRecord(planData, dateStr);
    const allowAdd = options.allowAdd !== false;
    const showHeader = options.showHeader !== false;
    const markable = Boolean(options.markable);
    const editable = options.editable !== false && !markable;
    const showTableHint = options.showTableHint ?? (!allowAdd && !markable);

    if (showHeader) {
        const title = createElement('div', 'supplement-day-panel-head');
        title.append(
            createElement('span', 'supplement-day-panel-title', dateStr ? formatDayAndMonth(dateStr) : 'День'),
            createElement('span', 'supplement-day-panel-subtitle', dateStr || '')
        );
        panel.append(title);
    }

    if (!record) {
        panel.append(createElement('div', 'supplement-day-empty', 'Этот день пока не входит в план добавок.'));
        return;
    }

    const list = createElement('div', 'supplement-day-dose-list');
    const doseEntries = getSupplementDayDoseEntries(record, planData);

    if (doseEntries.length === 0) {
        list.append(createElement('div', 'supplement-day-empty', 'На этот день пока ничего не запланировано.'));
    } else {
        doseEntries.forEach(entry => {
            const row = createElement(editable ? 'button' : 'div', `supplement-day-dose-row ${entry.taken ? 'is-taken' : 'is-planned'}${editable ? ' is-editable' : ''}`);
            if (editable) row.type = 'button';

            const main = createElement('div', 'supplement-day-dose-main');
            main.append(createElement('span', 'supplement-day-dose-name', entry.name));

            if (entry.quantityText) {
                main.append(createElement('span', 'supplement-day-dose-amount', entry.quantityText));
            }

            if (entry.timesText) {
                main.append(createElement('span', 'supplement-day-dose-time-text', `В ${entry.timesText}`));
            }

            row.append(main);

            if (markable) {
                const actionBtn = createElement(
                    'button',
                    `supplement-day-dose-action${entry.taken ? ' is-active' : ''}`,
                    entry.taken ? 'Отмечено' : 'Отметить'
                );
                actionBtn.type = 'button';

                if (entry.taken) {
                    actionBtn.prepend(createElement('span', 'supplement-day-dose-action-check', '✓'));
                }

                actionBtn.addEventListener('click', async () => {
                    actionBtn.disabled = true;
                    await toggleSupplementDoseTaken({ dateStr, supplementName: entry.name });
                });

                row.append(actionBtn);
            }

            if (editable) {
                row.addEventListener('click', () => {
                    options.onAction?.();
                    openSupplementDoseModal({ dateStr, supplementName: entry.name });
                });
            }

            list.append(row);
        });
    }

    panel.append(list);

    if (!allowAdd) {
        if (showTableHint) {
            const info = createElement('div', 'supplement-calendar-add-info');
            info.innerHTML = `
                <span class="supplement-calendar-add-info-icon">i</span>
                <span>Добавить новый препарат можно во вкладке «Таблица».</span>
            `;
            panel.append(info);
        }
        return;
    }

    const addBtn = createElement('button', 'btn btn-primary supplement-day-add-btn', 'Добавить');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
        options.onAction?.();
        openSupplementDoseModal({ dateStr, supplementName: '', isNew: true });
    });
    panel.append(addBtn);
}

async function toggleSupplementDoseTaken({ dateStr, supplementName }) {
    const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
    const dayIndex = (plan.data || []).findIndex(day => day.date === dateStr);

    if (dayIndex === -1) return;

    const dayRecord = plan.data[dayIndex];
    dayRecord.doses = dayRecord.doses || {};

    if (!hasSupplementDoseValue(dayRecord.doses[supplementName])) return;

    const currentDose = parseSupplementDoseValue(dayRecord.doses[supplementName]);
    dayRecord.doses[supplementName] = buildSupplementDoseValue({
        dosage: currentDose.dosage,
        tablets: currentDose.tablets,
        times: currentDose.times,
        taken: !currentDose.taken
    });

    await updateSupplementPlanInFirestore(plan);
    renderSupplementsPage();
}

function openSupplementDoseModal({ dateStr, supplementName = '', isNew = false }) {
    if (isNew && getSupplementsViewMode() !== 'table') {
        showToast('Добавить новый препарат можно только во вкладке «Таблица».');
        return;
    }

    const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
    ensureSupplementEntrySlots(plan);
    const dayIndex = ensureSupplementDayRecord(plan, dateStr);

    if (dayIndex === -1) {
        showToast('Не удалось подготовить выбранный день.');
        return;
    }

    const names = getSupplementNames(plan, { includeArchived: true });
    const record = plan.data[dayIndex];
    const currentDose = parseSupplementDoseValue(supplementName ? record.doses?.[supplementName] : '');
    const backdrop = createElement('div', 'modal-backdrop supplement-dose-backdrop');
    const modal = createElement('div', 'modal-window supplement-dose-modal');

    modal.append(createElement('h3', null, isNew ? 'Добавить БАД' : supplementName));

    let nameInput = null;
    if (isNew) {
        const nameLabel = createElement('label', 'supplement-dose-field');
        nameLabel.append(createElement('span', null, 'Название БАДа'));
        nameInput = createElement('input', 'modal-input supplement-dose-name-input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Например: Омега-3';
        nameLabel.append(nameInput);
        modal.append(nameLabel);
    }

    const doseLabel = createElement('label', 'supplement-dose-field');
    doseLabel.append(createElement('span', null, 'Дозировка препарата'));
    const doseInput = createElement('input', 'modal-input supplement-dose-value-input');
    doseInput.type = 'text';
    doseInput.value = currentDose.dosage;
    doseInput.placeholder = 'Например: 500 мг';
    doseLabel.append(doseInput);
    modal.append(doseLabel);

    const tabletsLabel = createElement('label', 'supplement-dose-field');
    tabletsLabel.append(createElement('span', null, 'Количество таблеток'));
    const tabletsInput = createElement('input', 'modal-input supplement-dose-tablets-input');
    tabletsInput.type = 'number';
    tabletsInput.inputMode = 'decimal';
    tabletsInput.min = '0';
    tabletsInput.step = '0.5';
    tabletsInput.value = currentDose.tablets;
    tabletsInput.placeholder = 'Например: 2';
    tabletsLabel.append(tabletsInput);
    modal.append(tabletsLabel);

    const timesSection = createElement('div', 'supplement-dose-times-section');
    const timesHeader = createElement('div', 'supplement-dose-times-header');
    const timesHeaderText = createElement('div', 'supplement-dose-times-header-text');
    timesHeaderText.append(
        createElement('span', 'supplement-dose-times-title', 'Время приема'),
        createElement('span', 'supplement-dose-times-hint', 'Можно указать несколько приемов за день')
    );
    timesHeader.append(timesHeaderText);

    const timesList = createElement('div', 'supplement-dose-times-list');

    const updateTimeRows = () => {
        const rows = Array.from(timesList.querySelectorAll('.supplement-dose-time-row'));
        rows.forEach((row, index) => {
            const indexEl = row.querySelector('.supplement-dose-time-index');
            const removeBtn = row.querySelector('.supplement-dose-time-remove');
            if (indexEl) indexEl.textContent = `Прием ${index + 1}`;
            if (removeBtn) {
                removeBtn.disabled = rows.length <= 1;
                removeBtn.style.visibility = rows.length <= 1 ? 'hidden' : '';
            }
        });
    };

    const addTimeRow = (value = '') => {
        const row = createElement('div', 'supplement-dose-time-row');
        const indexEl = createElement('span', 'supplement-dose-time-index', 'Прием');
        const input = createElement('input', 'modal-input supplement-dose-time-input');
        input.type = 'time';
        input.value = normalizeSupplementTimeValue(value);

        const removeBtn = createElement('button', 'supplement-dose-time-remove');
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Удалить время приема');
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', () => {
            row.remove();
            updateTimeRows();
        });

        row.append(indexEl, input, removeBtn);
        timesList.append(row);
        updateTimeRows();
    };

    const savedTimes = currentDose.times.length > 0 ? currentDose.times : [''];
    savedTimes.forEach(time => addTimeRow(time));

    const addTimeBtn = createElement('button', 'supplement-dose-add-time-btn');
    addTimeBtn.type = 'button';
    addTimeBtn.textContent = '+ Добавить прием';
    addTimeBtn.addEventListener('click', () => {
        addTimeRow('');
        timesList.querySelector('.supplement-dose-time-row:last-child .supplement-dose-time-input')?.focus();
    });

    timesSection.append(timesHeader, timesList, addTimeBtn);
    modal.append(timesSection);

    const buttons = createElement('div', 'modal-buttons supplement-dose-buttons');

    if (!isNew) {
        const deleteBtn = createElement('button', 'btn btn-danger', 'Удалить');
        deleteBtn.type = 'button';
        deleteBtn.addEventListener('click', async () => {
            record.doses = record.doses || {};
            record.doses[supplementName] = '';
            await updateSupplementPlanInFirestore(plan);
            backdrop.remove();
            renderSupplementsPage();
        });
        buttons.append(deleteBtn);
    }

    const cancelBtn = createElement('button', 'btn btn-secondary', 'Отмена');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => backdrop.remove());

    const saveBtn = createElement('button', 'btn btn-primary', 'Сохранить');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', async () => {
        const nextName = isNew ? nameInput.value.trim() : supplementName;
        const nextDose = doseInput.value.trim();
        const nextTablets = tabletsInput.value.trim();
        const nextTimes = getSupplementDoseModalTimes(timesList);

        if (!nextName) {
            showToast('Введите название БАДа.');
            return;
        }

        if (nextTimes.length > 0 && !nextDose && !nextTablets) {
            showToast('Укажите дозировку или количество таблеток для выбранного времени.');
            return;
        }

        if (!names.includes(nextName)) {
            if (names.length >= MAX_SUPPLEMENTS_COUNT) {
                showToast(`Можно добавить не больше ${MAX_SUPPLEMENTS_COUNT} препаратов.`);
                return;
            }

            plan.supplements = Array.isArray(plan.supplements) ? plan.supplements : [];
            plan.supplements.push(createSupplementMeta(nextName, '', false, getNextAvailableSupplementSlot(plan)));
            plan.data = (plan.data || []).map(day => {
                day.doses = day.doses || {};
                day.doses[nextName] = day.doses[nextName] || '';
                return day;
            });
        }

        plan.data[dayIndex].doses = plan.data[dayIndex].doses || {};
        plan.data[dayIndex].doses[nextName] = buildSupplementDoseValue({
            dosage: nextDose,
            tablets: nextTablets,
            times: nextTimes,
            taken: currentDose.taken
        });

        rememberCurrentSupplementTableScroll();
        await updateSupplementPlanInFirestore(plan);
        backdrop.remove();
        renderSupplementsPage();
    });

    buttons.append(cancelBtn, saveBtn);
    modal.append(buttons);
    backdrop.append(modal);
    document.body.append(backdrop);

    setTimeout(() => (isNew ? nameInput : doseInput)?.focus(), 0);

    backdrop.addEventListener('click', event => {
        if (event.target === backdrop) backdrop.remove();
    });
}

function ensureSupplementCalendarState(planData) {
    const todayDateString = getTodayDateString();
    if (!supplementCalendarSelectedDate) {
        supplementCalendarSelectedDate = todayDateString;
    }

    if (!supplementCalendarMonthDate) {
        const selectedDate = parseSupplementDateString(supplementCalendarSelectedDate) || new Date();
        supplementCalendarMonthDate = getSupplementMonthStart(selectedDate);
    }
}

function changeSupplementCalendarMonth(planData, direction) {
    const baseDate = supplementCalendarMonthDate || new Date();
    const nextMonth = addSupplementMonths(baseDate, direction);
    supplementCalendarMonthDate = getSupplementMonthStart(nextMonth);
    renderSupplementsPage();
}

function attachSupplementCalendarSwipe(viewport, track, planData) {
    attachMonthCarouselSwipe(viewport, track, {
        onCommitNext: () => changeSupplementCalendarMonth(planData, 1),
        onCommitPrev: () => changeSupplementCalendarMonth(planData, -1)
    });
}

function getSupplementPlanDateMap(planData) {
    const dateMap = new Map();
    (Array.isArray(planData?.data) ? planData.data : []).forEach(day => {
        if (day?.date) dateMap.set(day.date, day);
    });
    return dateMap;
}

function ensureSupplementDayRecord(planData, dateStr) {
    if (!planData || !dateStr) return -1;

    planData.data = Array.isArray(planData.data) ? planData.data : [];
    let dayIndex = planData.data.findIndex(day => day?.date === dateStr);
    if (dayIndex !== -1) {
        planData.data[dayIndex].doses = planData.data[dayIndex].doses || {};
        return dayIndex;
    }

    const parsedDate = parseSupplementDateString(dateStr);
    if (!parsedDate) return -1;

    planData.data.push({
        date: dateStr,
        dayOfWeek: getSupplementWeekdayShortName(parsedDate),
        doses: {}
    });
    planData.data.sort((left, right) => compareSupplementDateStrings(left?.date || '', right?.date || ''));
    dayIndex = planData.data.findIndex(day => day?.date === dateStr);
    return dayIndex;
}

function getSupplementDayRecord(planData, dateStr) {
    if (!dateStr) return null;
    return getSupplementPlanDateMap(planData).get(dateStr) || null;
}

function getSupplementDoseCount(dayRecord, planData) {
    return getSupplementDayDoseEntries(dayRecord, planData).length;
}

function getSupplementDayDoseEntries(dayRecord, planData) {
    if (!dayRecord || !dayRecord.doses) return [];

    const metadataMap = new Map(
        getSupplementEntries(planData, { includeArchived: true }).map(entry => [entry.name, entry])
    );

    const orderedNames = [
        ...metadataMap.keys(),
        ...Object.keys(dayRecord.doses || {}).filter(name => !metadataMap.has(name))
    ];

    return orderedNames
        .map(name => {
            const rawDose = dayRecord.doses?.[name];
            const dose = formatSupplementDoseSummary(rawDose);
            if (!dose) return null;
            const parsed = parseSupplementDoseValue(rawDose);
            const meta = metadataMap.get(name) || {
                name,
                shortName: normalizeSupplementShortName('', name)
            };
            return {
                name,
                shortName: meta.shortName || normalizeSupplementShortName('', name),
                dose,
                quantityText: formatSupplementDoseQuantity(rawDose, { compactTabletSuffix: false }),
                timesText: formatSupplementDoseTimeLine(rawDose),
                taken: parsed.taken
            };
        })
        .filter(Boolean);
}
function parseSupplementDoseValue(rawDose) {
    if (rawDose && typeof rawDose === 'object' && !Array.isArray(rawDose)) {
        const times = normalizeSupplementTimes(rawDose.times || rawDose.time || rawDose.at);

        return {
            dosage: String(rawDose.dosage || rawDose.dose || rawDose.value || '').trim(),
            tablets: String(rawDose.tablets || rawDose.pills || rawDose.count || '').trim(),
            time: times[0] || '',
            times,
            taken: Boolean(rawDose.taken || rawDose.completed || rawDose.done || rawDose.isTaken)
        };
    }

    return {
        dosage: rawDose == null ? '' : String(rawDose).trim(),
        tablets: '',
        time: '',
        times: [],
        taken: false
    };
}

function buildSupplementDoseValue({ dosage = '', tablets = '', time = '', times = [], taken = false } = {}) {
    const cleanDose = String(dosage || '').trim();
    const cleanTablets = String(tablets || '').trim();
    const cleanTimes = normalizeSupplementTimes(times.length > 0 ? times : time);
    const isTaken = Boolean(taken);

    if (!cleanDose && !cleanTablets && cleanTimes.length === 0) return '';
    if (cleanDose && !cleanTablets && cleanTimes.length === 0 && !isTaken) return cleanDose;

    const value = {
        dosage: cleanDose,
        tablets: cleanTablets,
        times: cleanTimes
    };

    if (isTaken) {
        value.taken = true;
    }

    return value;
}

function hasSupplementDoseValue(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    return Boolean(dose.dosage || dose.tablets || dose.times.length);
}

function cloneSupplementDoseValue(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    return buildSupplementDoseValue({
        dosage: dose.dosage,
        tablets: dose.tablets,
        times: dose.times,
        taken: dose.taken
    });
}

function setSupplementDoseClipboardValue(rawDose, meta = {}) {
    supplementDoseClipboard = cloneSupplementDoseValue(rawDose);
    supplementDoseClipboardMeta = {
        cellKey: meta.cellKey || '',
        dateStr: meta.dateStr || '',
        supplementName: meta.supplementName || ''
    };
}

function hasSupplementDoseClipboardValue() {
    return hasSupplementDoseValue(supplementDoseClipboard);
}

export function getSupplementPlanSnapshotSignature(planData) {
    const normalizedPlan = {
        supplements: Array.isArray(planData?.supplements)
            ? planData.supplements.map((item) => {
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                    return {
                        name: String(item.name || '').trim(),
                        shortName: String(item.shortName || '').trim(),
                        archived: Boolean(item.archived)
                    };
                }
                return String(item || '').trim();
            })
            : [],
        data: Array.isArray(planData?.data)
            ? planData.data.map((day) => ({
                date: String(day?.date || ''),
                dayOfWeek: String(day?.dayOfWeek || ''),
                doses: Object.fromEntries(
                    Object.entries(day?.doses || {})
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([name, value]) => [name, cloneSupplementDoseValue(value)])
                )
            }))
            : []
    };

    return JSON.stringify(normalizedPlan);
}

function clearSupplementDoseLongPressPopover() {
    if (typeof supplementDoseLongPressOverlayCleanup === 'function') {
        supplementDoseLongPressOverlayCleanup();
    }
    supplementDoseLongPressOverlayCleanup = null;
}

function getSupplementDoseFromState(dateStr, supplementName) {
    const plan = state.supplementPlan || { data: [] };
    const dayRecord = (plan.data || []).find(day => day.date === dateStr);
    return dayRecord?.doses?.[supplementName] || '';
}

function updateSupplementDoseCellButton(button, rawDose) {
    if (!button) return;

    const showCellTimes = getSupplementsTableRangeMode() === 'week';
    const quantityText = formatSupplementDoseQuantity(rawDose);
    const timeText = showCellTimes ? formatSupplementDoseTimeLabel(rawDose) : '';
    const hasValue = Boolean(quantityText || timeText);

    button.classList.toggle('has-dose', hasValue);
    button.classList.toggle('supplement-dose-cell-btn--with-time', Boolean(timeText));
    button.replaceChildren();

    if (!hasValue) return;

    const shouldRenderHistoryLabel =
        button.dataset.historyLabel === '1' &&
        (() => {
            const wrapper = button.closest('.supplement-table-wrapper');
            const supplementName = button.dataset.supplementName || '';
            const currentDate = button.dataset.date || '';
            if (!wrapper || !supplementName || !currentDate) return false;

            const rows = Array.from(wrapper.querySelectorAll('tbody tr[data-date]'));
            for (const row of rows) {
                if (row.dataset.date === currentDate) return true;
                if (hasSupplementDoseValue(getSupplementDoseFromState(row.dataset.date, supplementName))) {
                    return false;
                }
            }
            return true;
        })();

    if (shouldRenderHistoryLabel) {
        button.append(
            createElement(
                'span',
                'supplement-dose-cell-history-label',
                button.dataset.historyLabelText || button.dataset.supplementName || ''
            )
        );
    }

    button.append(createElement('span', 'supplement-dose-cell-main', quantityText || ''));
    if (timeText) {
        button.append(createElement('span', 'supplement-dose-cell-time', timeText));
    }
}

function getSupplementDoseLongPressAction(dateStr, supplementName, rawDose) {
    if (hasSupplementDoseValue(rawDose)) {
        return 'copy';
    }
    if (hasSupplementDoseClipboardValue()) {
        return 'paste';
    }
    return '';
}

function showSupplementDoseLongPressPopover(tableWrapper, anchorElement, label, onAction) {
    clearSupplementDoseLongPressPopover();
    if (!tableWrapper || !anchorElement || !label || typeof onAction !== 'function') return;

    const popover = createElement('div', 'supplement-dose-longpress-popover');
    const button = createElement('button', 'supplement-dose-longpress-action', label);
    button.type = 'button';
    popover.append(button);
    document.body.append(popover);

    let closed = false;
    const syncPosition = () => {
        if (closed || !popover.isConnected || !anchorElement.isConnected) return;
        const anchorRect = anchorElement.getBoundingClientRect();
        const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 0);
        const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 0);
        const popoverWidth = Math.round(popover.offsetWidth || 92);
        const popoverHeight = Math.round(popover.offsetHeight || 46);
        const nextLeft = clampValue(
            Math.round(anchorRect.left + (anchorRect.width - popoverWidth) / 2),
            8,
            Math.max(8, viewportWidth - popoverWidth - 8)
        );
        const nextTop = clampValue(
            Math.round(anchorRect.top - popoverHeight - 8),
            8,
            Math.max(8, viewportHeight - popoverHeight - 8)
        );

        popover.style.left = `${nextLeft}px`;
        popover.style.top = `${nextTop}px`;
    };

    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', handlePointerDown, true);
        tableWrapper.removeEventListener('scroll', handleWrapperScroll);
        window.removeEventListener('resize', handleViewportChange);
        window.visualViewport?.removeEventListener('resize', handleViewportChange);
        window.visualViewport?.removeEventListener('scroll', handleViewportChange);
        popover.remove();
        if (supplementDoseLongPressOverlayCleanup === close) {
            supplementDoseLongPressOverlayCleanup = null;
        }
    };

    const handleViewportChange = () => syncPosition();
    const handleWrapperScroll = () => close();
    const handlePointerDown = (event) => {
        if (popover.contains(event.target)) return;
        close();
    };

    button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        await onAction();
    });

    document.addEventListener('pointerdown', handlePointerDown, true);
    tableWrapper.addEventListener('scroll', handleWrapperScroll, { passive: true });
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    requestAnimationFrame(syncPosition);
    supplementDoseLongPressOverlayCleanup = close;
}

function formatSupplementDoseQuantity(rawDose, options = {}) {
    const dose = parseSupplementDoseValue(rawDose);
    const hasManyTimes = dose.times.length > 1;
    const quantityPrefix = hasManyTimes ? 'по ' : '';
    const tabletSuffix = options.compactTabletSuffix === false ? ' табл.' : 'табл';
    const quantityParts = [];

    if (dose.dosage) quantityParts.push(`${quantityPrefix}${dose.dosage}`);
    if (dose.tablets) quantityParts.push(`${quantityPrefix}${dose.tablets}${tabletSuffix}`);

    return quantityParts.join(' · ');
}

function formatSupplementDoseTimeLabel(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    return formatSupplementTimesText(dose.times);
}

function formatSupplementDoseTimeLine(rawDose) {
    return normalizeSupplementTimes(parseSupplementDoseValue(rawDose).times)
        .map(time => time.replace(':', '.'))
        .join(', ');
}

function formatSupplementDoseSummary(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    const hasManyTimes = dose.times.length > 1;
    const quantityPrefix = hasManyTimes ? 'по ' : '';
    const quantityParts = [];
    const timesText = formatSupplementTimesText(dose.times);

    if (dose.dosage) quantityParts.push(`${quantityPrefix}${dose.dosage}`);
    if (dose.tablets) quantityParts.push(`${quantityPrefix}${dose.tablets} табл.`);

    const quantityText = quantityParts.join(' · ');

    if (quantityText && timesText) return `${quantityText} в ${timesText}`;
    if (quantityText) return quantityText;
    if (timesText) return `в ${timesText}`;

    return '';
}

function normalizeSupplementTimes(value) {
    const values = Array.isArray(value) ? value : [value];
    const normalized = values
        .map(item => normalizeSupplementTimeValue(item))
        .filter(Boolean);

    return Array.from(new Set(normalized));
}

function normalizeSupplementTimeValue(value) {
    const clean = String(value || '').trim().replace('.', ':');
    if (!clean) return '';

    const match = clean.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return clean;

    const hours = Math.min(Math.max(Number(match[1]), 0), 23);
    const minutes = Math.min(Math.max(Number(match[2]), 0), 59);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatSupplementTimesText(times) {
    const labels = normalizeSupplementTimes(times).map(time => time.replace(':', '.'));

    if (labels.length <= 1) return labels[0] || '';
    if (labels.length === 2) return `${labels[0]} и ${labels[1]}`;

    return `${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}`;
}

function getSupplementDoseModalTimes(timesList) {
    return normalizeSupplementTimes(
        Array.from(timesList.querySelectorAll('.supplement-dose-time-input')).map(input => input.value)
    );
}

function getSupplementPlural(count) {
    const lastTwo = count % 100;
    const last = count % 10;

    if (lastTwo >= 11 && lastTwo <= 14) return 'препаратов';
    if (last === 1) return 'препарат';
    if (last >= 2 && last <= 4) return 'препарата';
    return 'препаратов';
}

function getFirstSupplementRecordInMonth(planData, monthDate) {
    const records = Array.isArray(planData?.data) ? planData.data : [];
    const match = records.find(day => {
        const parsed = parseSupplementDateString(day.date);
        return parsed &&
            parsed.getFullYear() === monthDate.getFullYear() &&
            parsed.getMonth() === monthDate.getMonth();
    });

    return match?.date || null;
}

function parseSupplementDateString(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;

    const [day, month, year] = dateString.split('.').map(Number);
    if (!day || !month || !year) return null;

    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatSupplementDateString(date) {
    return [
        String(date.getDate()).padStart(2, '0'),
        String(date.getMonth() + 1).padStart(2, '0'),
        date.getFullYear()
    ].join('.');
}

function getSupplementWeekStartDate(date) {
    const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayIndex = weekStart.getDay();
    const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
    weekStart.setDate(weekStart.getDate() + mondayOffset);
    return weekStart;
}

function cloneSupplementDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addSupplementDays(date, offset) {
    const nextDate = cloneSupplementDate(date);
    nextDate.setDate(nextDate.getDate() + offset);
    return nextDate;
}

function compareSupplementDates(left, right) {
    return cloneSupplementDate(left).getTime() - cloneSupplementDate(right).getTime();
}

function compareSupplementDateStrings(leftDateString, rightDateString) {
    const left = parseSupplementDateString(leftDateString);
    const right = parseSupplementDateString(rightDateString);
    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;
    return compareSupplementDates(left, right);
}

function getSupplementWeekdayShortName(date) {
    const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    return dayNames[date.getDay()] || '';
}

function getSupplementCycleStartDate(cycle = null) {
    const currentCycle = cycle || state.cycles?.find(item => item.id === state.selectedCycleId) || null;
    const parsedStartDate = parseSupplementDateString(currentCycle?.startDateString);
    if (parsedStartDate) return parsedStartDate;

    if (Number.isFinite(currentCycle?.startDate)) {
        const rawDate = new Date(currentCycle.startDate);
        if (!Number.isNaN(rawDate.getTime())) {
            return new Date(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate());
        }
    }

    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getSupplementCycleBaseWeekStartDate(cycle = null) {
    return getSupplementWeekStartDate(getSupplementCycleStartDate(cycle));
}

function getSupplementVirtualDayRecord(date, dateMap) {
    const dateString = formatSupplementDateString(date);
    const existingRecord = dateMap.get(dateString);
    if (existingRecord) return existingRecord;

    return {
        date: dateString,
        dayOfWeek: getSupplementWeekdayShortName(date),
        doses: {}
    };
}

function getSupplementTableWindowRecords(planData, startDate, totalDays = SUPPLEMENT_TABLE_RENDER_DAYS) {
    const dateMap = getSupplementPlanDateMap(planData);
    return Array.from({ length: totalDays }, (_, index) => {
        const nextDate = addSupplementDays(startDate, index);
        return getSupplementVirtualDayRecord(nextDate, dateMap);
    });
}

function buildSupplementHistoryRangesBySlot(planData, tableColumns) {
    const rangesBySlot = new Map();
    const dataset = Array.isArray(planData?.data) ? planData.data : [];

    tableColumns.forEach((column) => {
        if (!column?.entriesWithHistory?.length) return;
        const slotRanges = new Map();
        column.entriesWithHistory.forEach((entry) => {
            if (!entry?.archived) return;
            slotRanges.set(entry.name, {
                startDate: null,
                endDate: null
            });
        });
        if (slotRanges.size > 0) {
            rangesBySlot.set(column.slot, slotRanges);
        }
    });

    dataset.forEach((dayRecord) => {
        const parsedDate = parseSupplementDateString(dayRecord?.date);
        if (!parsedDate) return;

        rangesBySlot.forEach((slotRanges) => {
            slotRanges.forEach((range, supplementName) => {
                if (!hasSupplementDoseValue(dayRecord?.doses?.[supplementName])) return;
                if (!range.startDate || compareSupplementDates(parsedDate, range.startDate) < 0) {
                    range.startDate = cloneSupplementDate(parsedDate);
                }
                if (!range.endDate || compareSupplementDates(parsedDate, range.endDate) > 0) {
                    range.endDate = cloneSupplementDate(parsedDate);
                }
            });
        });
    });

    rangesBySlot.forEach((slotRanges, slot) => {
        slotRanges.forEach((range, supplementName) => {
            if (!range.startDate || !range.endDate) {
                slotRanges.delete(supplementName);
            }
        });
        if (slotRanges.size === 0) {
            rangesBySlot.delete(slot);
        }
    });

    return rangesBySlot;
}

function getSupplementMonthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addSupplementMonths(date, offset) {
    return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function getSupplementMonthTitle(date) {
    const monthNames = [
        'Январь',
        'Февраль',
        'Март',
        'Апрель',
        'Май',
        'Июнь',
        'Июль',
        'Август',
        'Сентябрь',
        'Октябрь',
        'Ноябрь',
        'Декабрь'
    ];

    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

async function updateSupplementPlanInFirestore(newPlan) {
    const cycleRef = getCycleDocRef(); // 👈 теперь цикл, а не supplements
    if (!cycleRef) {
        showToast('Ошибка: Не выбран цикл для сохранения плана добавок.');
        return false;
    }

    try {
        // Любое изменение плана вызывает перерендер страницы; фиксируем текущий скролл таблицы,
        // чтобы после добавления/удаления/редактирования не сбрасывало на текущую неделю.
        const { plan: sanitizedPlan } = sanitizeSupplementPlan(newPlan);
        rememberCurrentSupplementTableScroll();
        await updateDoc(cycleRef, { supplementPlan: sanitizedPlan });
        state.supplementPlan = sanitizedPlan;
        syncSupplementsBottomNavBadge(sanitizedPlan);
        // return true;
        // showToast('План добавок сохранен!');
        console.log("✅ supplementPlan обновлён в документе цикла:", newPlan);
        return true;
    } catch (error) {
        console.error("Ошибка при сохранении плана добавок:", error);
        showToast('Ошибка сохранения плана добавок. Проверьте правила Firestore!');
        return false;
    }
}

// 🔥 НОВАЯ ЛОГИКА: Добавление препарата (Минимальная версия)
async function addSupplement(supplementName) {
    if (!state.supplementPlan) return;

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));
    ensureSupplementEntrySlots(newPlan);

    if (getSupplementNames(newPlan).length >= MAX_SUPPLEMENTS_COUNT) {
        showToast(`Можно добавить не больше ${MAX_SUPPLEMENTS_COUNT} препаратов.`);
        return;
    }

    if (getSupplementNames(newPlan, { includeArchived: true }).includes(supplementName)) {
        showToast('Этот препарат уже добавлен!');
        return;
    }

    newPlan.supplements.push(createSupplementMeta(supplementName, '', false, getNextAvailableSupplementSlot(newPlan)));

    // Добавляем пустые поля для нового препарата во все существующие записи
    newPlan.data = newPlan.data.map(dayRecord => {
        dayRecord.doses = dayRecord.doses || {};
        dayRecord.doses[supplementName] = '';
        return dayRecord;
    });

    rememberCurrentSupplementTableScroll();
    await updateSupplementPlanInFirestore(newPlan);
    showToast(`Препарат "${supplementName}" добавлен!`);
}

// 🔥 НОВАЯ ЛОГИКА: Добавление недели (7 дней)
async function addWeek() {
    const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);
    if (!currentCycle || !state.supplementPlan) return;

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));
    const currentLength = newPlan.data.length;

    let nextStartDateString;
    if (currentLength > 0) {
        // Берем последнюю дату и сдвигаем на 1 день вперед
        const lastDateString = newPlan.data[currentLength - 1].date;
        const [startDay, startMonth, startYear] = lastDateString.split('.');
        const lastDate = new Date(`${startYear}-${startMonth}-${startDay}`);
        const nextStartDate = new Date(lastDate);
        nextStartDate.setDate(lastDate.getDate() + 1);

        const day = String(nextStartDate.getDate()).padStart(2, '0');
        const month = String(nextStartDate.getMonth() + 1).padStart(2, '0');
        const year = nextStartDate.getFullYear();
        nextStartDateString = `${day}.${month}.${year}`;
    } else {
        // Если план пустой, начинаем с даты начала цикла
        nextStartDateString = currentCycle.startDateString;
    }

    const newDates = generateDates(nextStartDateString, 7);
    const newRecords = newDates.map(dateInfo => {
        const doseMap = {};
        // Заполняем пустые дозировки для всех существующих препаратов
        getSupplementNames(newPlan).forEach(supName => {
            doseMap[supName] = '';
        });

        return {
            date: dateInfo.date,
            dayOfWeek: dateInfo.dayOfWeek,
            doses: doseMap
        };
    });

    newPlan.data.push(...newRecords);

    // Если план был пустой, нам нужно обновить state.supplementPlan перед сохранением
    // чтобы onSnapshot не пропустил инициализацию, но в данном случае лучше просто сохранить.
    await updateSupplementPlanInFirestore(newPlan);
}

// Отложенное сохранение дозировки
const debouncedSaveDoseData = debounce(async (supName, dayIndex, value) => {
    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

    if (newPlan && newPlan.data[dayIndex]) {
        // Убедимся, что doses существует
        newPlan.data[dayIndex].doses = newPlan.data[dayIndex].doses || {};
        newPlan.data[dayIndex].doses[supName] = value;
        await updateSupplementPlanInFirestore(newPlan);
    }
}, 700);

// 🔥 НОВАЯ ЛОГИКА: Удаление последней недели (7 дней)
async function removeLastWeek() {
    if (!state.supplementPlan || state.supplementPlan.data.length === 0) {
        showToast('Нет данных для удаления.');
        return;
    }

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

    // Удаляем последние 7 записей
    newPlan.data.splice(Math.max(0, newPlan.data.length - 7));

    await updateSupplementPlanInFirestore(newPlan);
    showToast('Последняя неделя удалена.');
}


// =================================================================
// 🔄 ГЕНЕРАЦИЯ ПОЛНОГО HTML-КОНТЕНТА ОТЧЕТА (С ФИЛЬТРАЦИЕЙ ПРОГРАММ)
// =================================================================
function generateCycleReportHtml(
    currentCycle,
    startDateString,
    endDateString
) {
    const planData = state.supplementPlan || { supplements: [], data: [] };

    // 1. ФИЛЬТРАЦИЯ ПЛАНА ДОБАВОК ПО ДАТАМ
    const parseDate = (dateString) => new Date(dateString.split('.').reverse().join('-'));
    const start = parseDate(startDateString);
    const end = parseDate(endDateString);
    end.setHours(23, 59, 59, 999);

    const filteredSupplementsData = planData.data.filter(dayRecord => {
        const recordDate = parseDate(dayRecord.date);
        return recordDate >= start && recordDate <= end;
    });

    // 2. ПРОВЕРКА НАЛИЧИЯ ДАННЫХ
    if (filteredSupplementsData.length === 0) {
        showToast('В выбранном диапазоне нет данных по добавкам.');
        return null;
    }

    // -----------------------------------------------------------
    // 3. СОЗДАНИЕ HTML-КОНТЕНТА (ТОЛЬКО БАДЫ)
    // -----------------------------------------------------------

    let contentHtml = `
        <h1 style="color: #333; border-bottom: 3px solid #007bff; padding-bottom: 10px; font-size: 1.5em; text-align: center;">Отчет по добавкам: ${currentCycle.name}</h1>
        <p class="pdf-date-range" style="font-size: 1em; margin-bottom: 30px; text-align: center;">Период: ${startDateString} — ${endDateString}</p>
    `;

    // БЛОК БАДОВ (КАЛЕНДАРЬ)
    contentHtml += createSupplementsCalendarHtml(planData, filteredSupplementsData);

    // 🔥 Оборачиваем в полный HTML-документ (Остальная часть функции остается без изменений)
// 🔥 Оборачиваем в полный HTML-документ и **вставляем мобильные стили**
    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Отчет: ${currentCycle.name}</title>
            <style>
                /* Стили для печати (взяты из наших предыдущих исправлений для мобильной адаптации) */
                body {
                    margin: 0;
                    padding: 10px;
                    font-family: Arial, sans-serif;
                    background-color: #fff;
                    width: 100%;
                    box-sizing: border-box;
                    font-size: 11px;
                    line-height: 1.3;
                }
                .pdf-report-container { width: 100%; margin: 0 auto; }
                h1, h2, h3, h4 { page-break-after: avoid; margin-top: 10px; margin-bottom: 5px; }
                h1 { font-size: 1.6em; }
                h3 { font-size: 1.2em; color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
                h4 { font-size: 1em; color: #007bff; margin: 0 0 5px 0; }

                table { width: 100%; border-collapse: collapse; margin-top: 5px; table-layout: auto; }
                th, td { border: 1px solid #ccc; padding: 3px; text-align: center; vertical-align: top; box-sizing: border-box; }
                th { background-color: #e9ecef; font-weight: 600; }

                /* Стили для таблицы добавок */
                .pdf-calendar-table { font-size: 0.7em; }
                .pdf-calendar-table th, .pdf-calendar-table td {
                    padding: 2px; min-width: 40px; max-width: 60px; word-break: break-word; line-height: 1.1;
                }
                .pdf-calendar-table th:first-child, .pdf-calendar-table td:first-child {
                    min-width: 50px; max-width: 50px; font-size: 0.8em; padding: 3px 1px;
                }
                .pdf-calendar-table th:nth-child(2), .pdf-calendar-table td:nth-child(2) {
                    min-width: 30px; max-width: 30px; font-weight: bold;
                }
                .supplement-table-wrapper:not(:first-child) { margin-top: 15px; page-break-before: auto; }

                /* Стили для дневника и программ */
                .journal-record-block, .program-block { page-break-inside: avoid; margin-top: 15px; border: 1px solid #ddd; border-radius: 5px; padding: 5px; }
                .report-journal-table th, .report-journal-table td,
                .report-program-table th, .report-program-table td {
                    font-size: 0.8em; padding: 4px;
                }
                .report-journal-table td:nth-child(1) { width: 55%; text-align: left; }
                .report-journal-table td:nth-child(2) { width: 45%; white-space: pre-wrap; }
                .report-program-table td:nth-child(1) { width: 70%; text-align: left; }
                .report-program-table td:nth-child(2) { width: 30%; }

                .journal-comment { font-size: 0.8em; color: #555; margin: 5px 0 0 0; padding-left: 10px; border-left: 3px solid #007aff; }

                /* ПЕЧАТЬ (PDF) */
                @media print {
                    body { font-size: 9pt; padding: 0; }
                    .pdf-calendar-table th, .pdf-calendar-table td { font-size: 7pt; padding: 1pt; }
                    .report-journal-table th, .report-journal-table td,
                    .report-program-table th, .report-program-table td { font-size: 8pt; padding: 2pt; }
                    .journal-comment { font-size: 8pt; }
                    .pdf-report-container > h1 { margin-top: 0; }
                }
            </style>
        </head>
        <body>
            <div class="pdf-report-container">
                ${contentHtml}
            </div>
        </body>
        </html>
    `;

    return fullHtml;
}
// =================================================================
// ⚙️ МОДАЛЬНОЕ ОКНО ОПЦИЙ ОТЧЕТА ПО БАДАМ (С ВЫБОРОМ ПРОГРАММ)
// =================================================================

function openSupplementsPdfOptionsModal(cycleId, planData) {
    const root = document.getElementById('root');
    const overlay = createElement('div', 'modal-overlay', '');
    overlay.classList.add('active'); // Показываем оверлей сразу

    // Получаем программы текущего цикла для динамического рендера
    const programsInCycle = planData.programsInCycle || [];

    const modalContent = createElement('div', 'modal-content modal-compact');

    // --- ЗАГОЛОВОК ---
    modalContent.appendChild(createElement('div', 'modal-title', 'Параметры Отчета по БАДам'));

    // --- 1. ОПЦИЯ ВКЛЮЧЕНИЯ/ИСКЛЮЧЕНИЯ ТРЕНИРОВОК ---
    const programsToggleGroup = createElement('div', 'checkbox-group');
    programsToggleGroup.style.marginBottom = '15px';
    programsToggleGroup.innerHTML = `
        <label style="display: flex; align-items: center; justify-content: space-between; font-size: 16px;">
            Включить тренировки в отчет
            <input type="checkbox" id="include-programs-toggle" checked style="width: 18px; height: 18px;">
        </label>
    `;
    modalContent.appendChild(programsToggleGroup);

    // --- 2. КОНТЕЙНЕР ДЛЯ ВЫБОРА КОНКРЕТНЫХ ПРОГРАММ ---
    const programsSelectionContainer = createElement('div', 'programs-selection-container');
    programsSelectionContainer.style.borderTop = '1px solid #ccc';
    programsSelectionContainer.style.paddingTop = '10px';
    programsSelectionContainer.style.maxHeight = '200px'; // Ограничение высоты для скролла
    programsSelectionContainer.style.overflowY = 'auto';


    // 2.1. ЧЕКБОКС "ВЫБРАТЬ ВСЕ"
    if (programsInCycle.length > 0) {
        programsSelectionContainer.innerHTML = `
            <label style="display: flex; align-items: center; margin-bottom: 8px; font-weight: 600;">
                <input type="checkbox" id="select-all-programs" checked style="width: 16px; height: 16px; margin-right: 10px;">
                Выбрать все программы
            </label>
        `;
    }

    // 2.2. СПИСОК ПРОГРАММ
    programsInCycle.forEach(program => {
        const checkboxId = `program-checkbox-${program.id}`;
        const programItem = createElement('div', null, `
            <label style="display: flex; align-items: center; margin-left: 20px; margin-bottom: 5px;">
                <input type="checkbox" class="program-select-checkbox" data-program-id="${program.id}" checked style="width: 16px; height: 16px; margin-right: 10px;">
                ${program.name}
            </label>
        `);
        programsSelectionContainer.appendChild(programItem);
    });

    if (programsInCycle.length === 0) {
        programsSelectionContainer.innerHTML = '<p style="font-size: 14px; color: #888;">Нет программ в текущем цикле.</p>';
    }

    modalContent.appendChild(programsSelectionContainer);

    // --- 3. КНОПКИ УПРАВЛЕНИЯ ---
    const controls = createElement('div', 'modal-controls', '');
    const cancelBtn = createElement('button', 'btn', 'Отмена');
    cancelBtn.onclick = () => overlay.remove();

    const generateBtn = createElement('button', 'btn btn-primary', 'Сформировать PDF');
    generateBtn.onclick = () => {

        const includePrograms = document.getElementById('include-programs-toggle').checked;
        let selectedProgramIds = [];

        if (includePrograms) {
            // Собираем ID только тех, которые отмечены
            selectedProgramIds = Array.from(document.querySelectorAll('.program-select-checkbox:checked'))
                .map(checkbox => checkbox.dataset.programId);

            // Если включены, но ни одна не выбрана, предупреждаем
            if (programsInCycle.length > 0 && selectedProgramIds.length === 0) {
                showToast('Выберите хотя бы одну программу или отключите вывод тренировок.', 'error');
                return;
            }
        }

        overlay.remove();

        // 🔥 Вызываем генерацию отчета с новыми параметрами
        generateCycleReport(
            cycleId,
            planData,
            true, // includeSupplements - Всегда true для этой модалки
            includePrograms,
            selectedProgramIds // Передаем массив выбранных ID
        );
    };

    controls.appendChild(cancelBtn);
    controls.appendChild(generateBtn);
    modalContent.appendChild(controls);
    overlay.appendChild(modalContent);
    root.appendChild(overlay);

    // --- ЛОГИКА ЧЕКБОКСОВ ---
    const toggle = document.getElementById('include-programs-toggle');
    const selectAll = document.getElementById('select-all-programs');
    const checkboxes = document.querySelectorAll('.program-select-checkbox');

    // Переключение контейнера выбора программ
    const updateVisibility = () => {
        programsSelectionContainer.style.display = toggle.checked ? 'block' : 'none';
        generateBtn.disabled = toggle.checked && programsInCycle.length > 0 && Array.from(checkboxes).filter(c => c.checked).length === 0;
    };

    // Обработка "Выбрать все"
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            checkboxes.forEach(c => c.checked = selectAll.checked);
            updateVisibility();
        });
    }

    // Обработка одиночных чекбоксов
    checkboxes.forEach(c => {
        c.addEventListener('change', () => {
            if (selectAll && !c.checked) {
                selectAll.checked = false;
            } else if (selectAll && Array.from(checkboxes).every(cb => cb.checked)) {
                selectAll.checked = true;
            }
            updateVisibility();
        });
    });

    toggle.addEventListener('change', updateVisibility);

    updateVisibility(); // Первоначальная установка видимости
}

// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР СВОДНОГО HTML-ОТЧЕТА ДЛЯ ПЕЧАТИ
// =================================================================
export function renderCycleReportPage(htmlContent) {
    const root = document.getElementById('root');
    root.innerHTML = '';

    const contentContainer = document.createElement('div');
    contentContainer.id = 'cycle-report-content';
    contentContainer.className = 'report-page-container';

    // Кнопка назад
    const backButton = createElement('button', 'btn back-btn', '← Назад к БАДам');
    backButton.addEventListener('click', () => {
        state.currentPage = 'supplements';
        render();
    });

    // Кнопка печати
    const printButton = createElement('button', 'btn btn-primary print-btn', '🖨️ Печать / Сохранить как PDF');
    printButton.addEventListener('click', () => {
        // Открываем отчет в новом окне для печати
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.print(); // Запускаем печать
        // После закрытия окна печати оно может быть закрыто, или оставлено.
    });

    const header = createElement('div', 'report-header-controls');
    header.append(backButton, printButton);
    contentContainer.append(header);

    // Контейнер, куда будет вставлен сгенерированный HTML
    const reportDisplay = createElement('div', 'report-html-display');
    reportDisplay.innerHTML = htmlContent;

    contentContainer.append(reportDisplay);
    root.append(contentContainer);

    // Важно: Отключаем навигацию, пока находимся на странице печати
    document.querySelector('.navigation').style.display = 'none';
}

// =================================================================
// ⚙️ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: МОДАЛЬНОЕ ОКНО ДЛЯ ОПЦИЙ ОТЧЕТА
// =================================================================
// Внимание: Эта функция требует наличия div#modal-overlay в вашем HTML
function openPdfOptionsModal(callback) {
    const modal = document.getElementById('modal-overlay');
    if (!modal) {
        // Если модальное окно не найдено, вызываем колбэк со значениями по умолчанию и выходим
        callback(true, true);
        return;
    }

    modal.innerHTML = `
        <div class="modal-content">
            <h3>Настройка отчета</h3>
            <p>Какие данные включить в сводный отчет?</p>
            <div style="margin: 15px 0;">
                <label style="display: block; margin-bottom: 10px; font-weight: bold;">
                    <input type="checkbox" id="include-supplements" checked disabled style="margin-right: 10px;">
                    План приема БАДов (обязательно)
                </label>
                <label style="display: block; margin-bottom: 10px;">
                    <input type="checkbox" id="include-journal" checked style="margin-right: 10px;">
                    Завершенные тренировки (Дневник)
                </label>
                <label style="display: block; margin-bottom: 10px;">
                    <input type="checkbox" id="include-programs" style="margin-right: 10px;">
                    Тренировочный план (Шаблоны программ)
                </label>
            </div>
            <div class="modal-controls">
                <button id="modal-cancel-btn" class="btn btn-secondary">Отмена</button>
                <button id="modal-generate-btn" class="btn btn-primary">Сгенерировать отчет</button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    document.getElementById('modal-cancel-btn').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    document.getElementById('modal-generate-btn').addEventListener('click', () => {
        const includeJournal = document.getElementById('include-journal').checked;
        const includePrograms = document.getElementById('include-programs').checked;
        modal.style.display = 'none';

        // Вызываем основной колбэк с выбранными опциями
        callback(includePrograms, includeJournal);
    });
}
// =================================================================
// 🎨 НОВАЯ ФУНКЦИЯ: ГЕНЕРАЦИЯ HTML-СВОДКИ ДНЕВНИКА
// =================================================================
function createJournalSummaryHtml(journalData, startDateString, endDateString) {
    if (!journalData || journalData.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Завершенные тренировки (Дневник)</h3>
                <p style="text-align: center; color: #888;">Нет записей в дневнике за выбранный период.</p>
            </div>
        `;
    }

    // Вспомогательная функция для парсинга даты (копируется из downloadCycleReportPDF)
    const parseDate = (dateString) => new Date(dateString.split('.').reverse().join('-'));

    const start = parseDate(startDateString);
    const end = parseDate(endDateString);
    end.setHours(23, 59, 59, 999);

    // Фильтрация записей дневника по датам
    const filteredJournal = journalData.filter(record => {
        const recordDate = parseDate(record.date);
        return recordDate >= start && recordDate <= end;
    });

    if (filteredJournal.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Завершенные тренировки (Дневник)</h3>
                <p style="text-align: center; color: #888;">Нет записей в дневнике за выбранный период (${startDateString} – ${endDateString}).</p>
            </div>
        `;
    }

    let html = `
        <div class="pdf-journal-section" style="margin-top: 40px; page-break-before: always;">
            <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; font-size: 1.2em;">Завершенные тренировки (Дневник)</h3>
    `;

    filteredJournal.forEach(record => {
        html += `
            <div class="journal-record-block" style="margin-top: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9;">
                <h4 style="color: #007bff; margin: 0 0 10px 0; font-size: 1.1em;">
                    Дата: ${record.date} ${record.dayOfWeek ? `(${record.dayOfWeek})` : ''} — ${record.programName || 'Без программы'}
                </h4>
        `;

        // Таблица для упражнений
        if (record.exercises && record.exercises.length > 0) {
            html += `
                <table class="report-journal-table" style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 0.85em;">
                    <thead>
                        <tr style="background-color: #e9ecef;">
                            <th style="width: 45%; padding: 5px; border: 1px solid #ccc; text-align: left;">Упражнение</th>
                            <th style="width: 55%; padding: 5px; border: 1px solid #ccc;">Подходы и повторения (Вес x Повтор)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            record.exercises.forEach((exercise, index) => {
                const setsHtml = (exercise.sets || [])
                    .map(set => `${set.weight || '—'}x${set.reps || '—'}`)
                    .join(' / ');

                html += `
                    <tr>
                        <td style="padding: 5px; border: 1px solid #ccc; text-align: left;">${index + 1}. ${exercise.name}</td>
                        <td style="padding: 5px; border: 1px solid #ccc; text-align: center;">${setsHtml}</td>
                    </tr>
                `;

                // Отображение комментария к упражнению
                if (exercise.note && exercise.note.trim() !== '') {
                    html += `
                        <tr>
                            <td colspan="2" style="padding: 2px 5px 5px 25px; border: 1px solid #ccc; text-align: left; background-color: #f1f1f1; font-style: italic; font-size: 0.9em;">
                                * Комментарий: ${exercise.note}
                            </td>
                        </tr>
                    `;
                }
            });
            html += `
                    </tbody>
                </table>
            `;
        } else {
            html += `<p style="margin: 5px 0 15px 0; font-style: italic; color: #555;">(Тренировка без упражнений)</p>`;
        }

        // Комментарий к тренировке
        if (record.comment && record.comment.trim() !== '') {
            html += `<p style="margin: 5px 0 0 0; font-weight: bold; font-size: 0.9em;">Общий комментарий:</p>`;
            html += `<p style="margin: 0 0 5px 0; font-style: italic; color: #444; background-color: #fff; padding: 5px; border-radius: 3px;">${record.comment}</p>`;
        }


        html += `</div>`; // .journal-record-block
    });

    html += `</div>`; // .pdf-journal-section
    return html;
}





function createSupplementsCalendarHtml(planData, filteredSupplementsData) {
    const supplementEntries = getSupplementEntries(planData, { includeArchived: true })
        .filter(entry => supplementHasHistoryInRecords(filteredSupplementsData, entry.name));

    if (supplementEntries.length === 0 || filteredSupplementsData.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">План приема БАДов</h3>
                <p style="text-align: center; color: #888;">Нет данных по приему добавок за выбранный период.</p>
            </div>
        `;
    }

    // Важно для PDF: даже если в таблице несколько препаратов "живут" в одном визуальном slot,
    // в PDF каждый препарат должен иметь свой собственный столбец.
    const supplementNames = supplementEntries.map(entry => entry.name);

    const MAX_COLUMNS_PER_TABLE = 5;
    let finalHtml = `
        <div class="pdf-supplements-section" style="margin-top: 20px;">
            <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; font-size: 1.2em;">Прием добавок (Календарь)</h3>
    `;

    // Цикл для разделения таблицы на части
    for (let i = 0; i < supplementNames.length; i += MAX_COLUMNS_PER_TABLE) {
        const chunkedNames = supplementNames.slice(i, i + MAX_COLUMNS_PER_TABLE);
        const isFirstTable = i === 0;

        // Генерация заголовков для текущего чанка
        const headerHtml = chunkedNames.map(supName =>
            `<th style="min-width: 40px; font-size: 0.9em; text-align: center;">${supName}</th>`
        ).join('');

        finalHtml += `
            <div class="supplement-table-wrapper" style="overflow-x: auto; margin-top: ${isFirstTable ? '0' : '20px'};">
                ${!isFirstTable ? `<p style="margin: 0; font-size: 0.9em; color: #555;">(Продолжение списка добавок)</p>` : ''}
                <table class="pdf-calendar-table" style="min-width: 100%; table-layout: fixed; width: auto;">
                    <thead>
                        <tr style="background-color: #f1f1f1;">
                            <th style="min-width: 55px;">Дата</th>
                            <th style="min-width: 30px;">День</th>
                            ${headerHtml}
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Тело таблицы
        filteredSupplementsData.forEach(dayRecord => {
            finalHtml += `
                <tr>
                    <td style="font-weight: bold; background-color: #f8f8f8;">${formatDayAndMonth(dayRecord.date)}</td>
                    <td>${dayRecord.dayOfWeek || '—'}</td>

                    ${chunkedNames.map(supName => {
                const rawDose = dayRecord.doses?.[supName] ?? '';
                const doseText = formatSupplementDoseSummary(rawDose);
                return `<td style="font-size: 0.9em;">${doseText || '—'}</td>`;
            }).join('')}
                </tr>
            `;
        });

        finalHtml += `
                    </tbody>
                </table>
            </div>
        `;
    } // Конец цикла for

    finalHtml += `</div>`; // .pdf-supplements-section

    return finalHtml;
}


// =================================================================
// 4. ГЕНЕРАЦИЯ HTML ДЛЯ ОТЧЕТА (ИСПРАВЛЕНО)
// =================================================================

function createProgramsHtml(programsInCycle) {
    if (!programsInCycle || programsInCycle.length === 0) {
        return `
            <div style="margin-top: 20px; page-break-before: auto;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Тренировочный план (Шаблоны)</h3>
                <p style="text-align: center; color: #888;">Нет программ в текущем цикле.</p>
            </div>
        `;
    }

    let html = `
        <div class="pdf-programs-section" style="margin-top: 40px; page-break-before: always;">
            <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; font-size: 1.2em;">Тренировочный план (Шаблоны программ)</h3>
    `;

    programsInCycle.forEach(program => {
        // 🔥 ИСПРАВЛЕННАЯ ПРОВЕРКА: используем program.exercises?.length
        const hasExercises = program.exercises && program.exercises.length > 0;

        html += `
            <div class="program-block" style="margin-top: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9; page-break-inside: avoid;">
                <h4 style="color: #007bff; margin: 0 0 10px 0; font-size: 1.1em;">${program.name}</h4>
                <p style="margin: 0 0 5px 0;">Комментарий: ${program.comment || '—'}</p>

                ${hasExercises ? `
                    <table class="report-program-table" style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85em;">
                        <thead>
                            <tr style="background-color: #e9ecef;">
                                <th style="width: 70%; padding: 5px; border: 1px solid #ccc; text-align: left;">Упражнение</th>
                                <th style="width: 30%; padding: 5px; border: 1px solid #ccc;">Подходы x Повторения</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${program.exercises.map(ex => `
                                <tr>
                                    <td style="padding: 5px; border: 1px solid #ccc; text-align: left;">${ex.name}</td>
                                    <td style="padding: 5px; border: 1px solid #ccc; text-align: center;">${ex.sets || '—'}x${ex.reps || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p style="margin-top: 10px; font-style: italic; color: #555;">(Программа без упражнений)</p>'}
            </div>
        `; // .program-block
    });

    html += `</div>`; // .pdf-programs-section
    return html;
}


// ====== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======

// Безопасно получить список имён добавок
function normalizeSupplementShortName(value, fallback = '') {
  const cleanValue = String(value || '').trim().replace(/\s+/g, ' ');
  const baseValue = cleanValue || String(fallback || '').trim().replace(/\s+/g, ' ');
  return baseValue.slice(0, SUPPLEMENT_SHORT_NAME_LIMIT);
}

function normalizeSupplementSlot(slot) {
  const numericSlot = Number(slot);
  return Number.isInteger(numericSlot) && numericSlot >= 0 ? numericSlot : null;
}

function createSupplementMeta(name, shortName = '', archived = false, slot = null) {
  const cleanName = String(name || '').trim();
  const normalizedSlot = normalizeSupplementSlot(slot);
  return {
    name: cleanName,
    shortName: normalizeSupplementShortName(shortName, cleanName),
    archived: Boolean(archived),
    ...(normalizedSlot !== null ? { slot: normalizedSlot } : {})
  };
}

function collectSupplementEntries(planData) {
  if (!planData || !Array.isArray(planData.supplements)) return [];

  const reservedSlots = new Set();
  planData.supplements.forEach(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const slot = normalizeSupplementSlot(item.slot);
    if (slot !== null) reservedSlots.add(slot);
  });

  let nextAutoSlot = 0;
  const takeNextAutoSlot = () => {
    while (reservedSlots.has(nextAutoSlot)) {
      nextAutoSlot += 1;
    }
    const resolvedSlot = nextAutoSlot;
    reservedSlots.add(resolvedSlot);
    nextAutoSlot += 1;
    return resolvedSlot;
  };

  return planData.supplements
    .map((item, planIndex) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const name = String(item.name || '').trim();
        if (!name) return null;
        return {
          name,
          shortName: normalizeSupplementShortName(item.shortName, name),
          archived: Boolean(item.archived),
          slot: normalizeSupplementSlot(item.slot) ?? takeNextAutoSlot(),
          planIndex
        };
      }

      const name = String(item || '').trim();
      if (!name) return null;
      return {
        name,
        shortName: normalizeSupplementShortName('', name),
        archived: false,
        slot: takeNextAutoSlot(),
        planIndex
      };
    })
    .filter(Boolean);
}

function ensureSupplementEntrySlots(planData) {
  if (!planData) return [];
  const entries = collectSupplementEntries(planData);
  planData.supplements = entries
    .sort((left, right) => left.planIndex - right.planIndex)
    .map(entry => createSupplementMeta(entry.name, entry.shortName, entry.archived, entry.slot));
  return entries;
}

function getSupplementEntries(planData, options = {}) {
  const includeArchived = Boolean(options.includeArchived);

  return collectSupplementEntries(planData)
    .filter(Boolean)
    .filter(entry => includeArchived || !entry.archived)
    .sort((left, right) => left.slot - right.slot || left.planIndex - right.planIndex);
}

function getSupplementNames(planData, options = {}) {
  return getSupplementEntries(planData, options).map(entry => entry.name);
}

function getSupplementEntryByName(planData, supplementName) {
  return getSupplementEntries(planData, { includeArchived: true }).find(entry => entry.name === supplementName) || {
    name: supplementName,
    shortName: normalizeSupplementShortName('', supplementName),
    archived: false,
    slot: null,
    planIndex: -1
  };
}

function supplementHasHistoryInRecords(records, supplementName) {
  return Array.isArray(records) && records.some(dayRecord => hasSupplementDoseValue(dayRecord?.doses?.[supplementName]));
}

function supplementHasHistory(planData, supplementName) {
  return supplementHasHistoryInRecords(planData?.data, supplementName);
}

function getSupplementHistoryMap(planData, records = null) {
  const dataset = Array.isArray(records) ? records : planData?.data;
  const historyMap = new Map();
  getSupplementEntries(planData, { includeArchived: true }).forEach(entry => {
    if (historyMap.has(entry.name)) return;
    historyMap.set(entry.name, supplementHasHistoryInRecords(dataset, entry.name));
  });
  return historyMap;
}

function getSupplementTableColumns(planData) {
  const allEntries = getSupplementEntries(planData, { includeArchived: true })
    .sort((left, right) => left.slot - right.slot || left.planIndex - right.planIndex);
  const historyMap = getSupplementHistoryMap(planData);
  const slotMap = new Map();
  let maxSlot = -1;

  allEntries.forEach(entry => {
    maxSlot = Math.max(maxSlot, entry.slot);
    const column = slotMap.get(entry.slot) || {
      slot: entry.slot,
      entries: [],
      entriesWithHistory: [],
      activeEntry: null,
      hasHistory: false
    };
    column.entries.push(entry);
    if (!entry.archived) column.activeEntry = entry;
    if (historyMap.get(entry.name)) {
      column.entriesWithHistory.push(entry);
      column.hasHistory = true;
    }
    slotMap.set(entry.slot, column);
  });

  const totalColumns = Math.max(5, maxSlot + 1);
  const columns = [];
  let activeIndex = 0;

  for (let slot = 0; slot < totalColumns; slot += 1) {
    const column = slotMap.get(slot);
    if (!column || (!column.activeEntry && !column.hasHistory)) {
      columns.push({
        type: 'empty',
        slot,
        entries: [],
        entriesWithHistory: [],
        activeEntry: null,
        activeIndex: -1,
        hasHistory: false,
        labelShownEntries: new Set()
      });
      continue;
    }

    const isActiveColumn = Boolean(column.activeEntry);
    columns.push({
      type: isActiveColumn ? 'active' : 'history',
      slot,
      entries: column.entries,
      entriesWithHistory: column.entriesWithHistory,
      activeEntry: column.activeEntry,
      activeIndex: isActiveColumn ? activeIndex++ : -1,
      hasHistory: column.hasHistory,
      name: column.activeEntry?.name || '',
      shortName: column.activeEntry?.shortName || '',
      planIndex: column.activeEntry?.planIndex ?? -1,
      labelShownEntries: new Set()
    });
  }

  return columns;
}

function getNextAvailableSupplementSlot(planData) {
  const columns = getSupplementTableColumns(planData);
  const reusableColumn = columns.find(column => !column.activeEntry && !column.hasHistory);
  if (reusableColumn) return reusableColumn.slot;
  return columns.length;
}

function getSupplementColumnDisplayEntry(column, dayRecord) {
  if (!column || !dayRecord?.doses) return null;

  const visibleEntries = (column.entries || []).filter(entry => hasSupplementDoseValue(dayRecord.doses?.[entry.name]));
  if (visibleEntries.length === 0) return null;

  if (column.activeEntry) {
    const activeMatch = visibleEntries.find(entry => entry.name === column.activeEntry.name);
    if (activeMatch) return activeMatch;
  }

  return visibleEntries[visibleEntries.length - 1];
}

function shouldShowSupplementColumnHistoryLabel(column, entry) {
  if (!column || !entry) return false;
  if (entry.archived) return true;
  return (column.entriesWithHistory || []).some(item => item.name !== entry.name);
}

function rememberSupplementTableScroll(tableWrapper) {
  if (!tableWrapper) return;
  supplementTableScrollState = {
    cycleId: state.selectedCycleId || '',
    rangeMode: getSupplementsTableRangeMode(),
    left: tableWrapper.scrollLeft,
    top: tableWrapper.scrollTop,
    windowStartDate: String(tableWrapper.dataset.windowStartDate || '').trim()
  };
}

function getRememberedSupplementTableScroll(rangeMode) {
  if (!supplementTableScrollState) return null;
  if (supplementTableScrollState.cycleId !== (state.selectedCycleId || '')) return null;
  if (supplementTableScrollState.rangeMode !== rangeMode) return null;
  // Не обнуляем: используем как "последний известный скролл" и при входе на страницу,
  // и после любых изменений данных.
  return supplementTableScrollState;
}

function rememberCurrentSupplementTableScroll() {
  rememberSupplementTableScroll(document.getElementById('supplement-table-wrapper'));
}

// Переименование препарата
async function renameSupplement(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
  ensureSupplementEntrySlots(plan);
  const entries = getSupplementEntries(plan, { includeArchived: true });
  const currentEntry = entries.find(entry => entry.name === oldName);
  if (!currentEntry) return;

  plan.supplements[currentEntry.planIndex] = createSupplementMeta(newName, currentEntry.shortName, currentEntry.archived, currentEntry.slot);

  (plan.data || []).forEach(day => {
    if (!day.doses) day.doses = {};
    if (Object.prototype.hasOwnProperty.call(day.doses, oldName)) {
      if (!Object.prototype.hasOwnProperty.call(day.doses, newName)) {
        day.doses[newName] = day.doses[oldName];
      }
      delete day.doses[oldName];
    }
  });

  await updateSupplementPlanInFirestore(plan);
}

// Drag&Drop перестановка колонок
async function reorderSupplementColumns(dragFrom, dragTo) {
  const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
  ensureSupplementEntrySlots(plan);
  const activeEntries = getSupplementEntries(plan);
  if (dragFrom === dragTo) return false;
  if (dragFrom < 0 || dragTo < 0 || dragFrom >= activeEntries.length || dragTo >= activeEntries.length) return false;

  const orderedActiveSlots = activeEntries.map(entry => entry.slot);
  const reorderedSlots = [...orderedActiveSlots];
  const [movedSlot] = reorderedSlots.splice(dragFrom, 1);
  reorderedSlots.splice(dragTo, 0, movedSlot);

  if (!Number.isInteger(movedSlot)) return false;

  const slotRemap = new Map();
  reorderedSlots.forEach((sourceSlot, index) => {
    const targetSlot = orderedActiveSlots[index];
    if (sourceSlot !== targetSlot) {
      slotRemap.set(sourceSlot, targetSlot);
    }
  });

  if (slotRemap.size === 0) return false;

  plan.supplements = (Array.isArray(plan.supplements) ? plan.supplements : []).map(item => {
    const meta = item && typeof item === 'object' && !Array.isArray(item)
      ? createSupplementMeta(item.name, item.shortName, item.archived, item.slot)
      : createSupplementMeta(item);

    if (slotRemap.has(meta.slot)) {
      meta.slot = slotRemap.get(meta.slot);
    }

    return meta;
  });

  await updateSupplementPlanInFirestore(plan);
  return true;
}

function enableSupplementDoseCellLongPressActions(tableWrapper) {
  const table = tableWrapper?.querySelector('.supplement-plan-table');
  if (!tableWrapper || !table) return;
  if (tableWrapper.dataset.supplementDoseLongPressBound === '1') return;
  tableWrapper.dataset.supplementDoseLongPressBound = '1';

  const longPressDelay = 420;
  const moveCancelDistance = 20;
  let pressTimer = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let sourceButton = null;
  let longPressTriggered = false;

  tableWrapper.addEventListener('click', event => {
    if (tableWrapper.dataset.supplementDoseLongPressSuppress !== '1') return;
    event.preventDefault();
    event.stopPropagation();
    delete tableWrapper.dataset.supplementDoseLongPressSuppress;
  }, true);

  const clearPressTimer = () => {
    if (!pressTimer) return;
    clearTimeout(pressTimer);
    pressTimer = null;
  };

  const suppressNextClick = () => {
    tableWrapper.dataset.supplementDoseLongPressSuppress = '1';
    setTimeout(() => {
      if (tableWrapper.dataset.supplementDoseLongPressSuppress === '1') {
        delete tableWrapper.dataset.supplementDoseLongPressSuppress;
      }
    }, 260);
  };

  const cleanup = () => {
    clearPressTimer();
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerEnd);
    document.removeEventListener('pointercancel', handlePointerEnd);
    pointerId = null;
    sourceButton = null;
    longPressTriggered = false;
  };

  const runCellAction = async (button, action) => {
    const dateStr = button?.dataset.date || '';
    const supplementName = button?.dataset.supplementName || '';
    if (!dateStr || !supplementName) return;

    if (action === 'copy') {
      const rawDose = getSupplementDoseFromState(dateStr, supplementName);
      if (!hasSupplementDoseValue(rawDose)) return;
      setSupplementDoseClipboardValue(rawDose, {
        cellKey: `${dateStr}::${supplementName}`,
        dateStr,
        supplementName
      });
      navigator.vibrate?.(8);
      showToast('Скопировано');
      return;
    }

    if (action === 'paste') {
      if (!hasSupplementDoseClipboardValue()) return;

      const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
      const dayIndex = (plan.data || []).findIndex(day => day.date === dateStr);
      if (dayIndex === -1) return;
      const previousPlan = state.supplementPlan;
      const previousRawDose = getSupplementDoseFromState(dateStr, supplementName);

      plan.data[dayIndex].doses = plan.data[dayIndex].doses || {};
      plan.data[dayIndex].doses[supplementName] = cloneSupplementDoseValue(supplementDoseClipboard);
      state.supplementPlan = plan;
      syncSupplementsBottomNavBadge(plan);
      updateSupplementDoseCellButton(button, plan.data[dayIndex].doses[supplementName]);
      state._supplementsSkipNextRenderSignature = getSupplementPlanSnapshotSignature(plan);

      rememberCurrentSupplementTableScroll();
      navigator.vibrate?.(8);
      const saved = await updateSupplementPlanInFirestore(plan);
      if (!saved) {
        state.supplementPlan = previousPlan;
        syncSupplementsBottomNavBadge(previousPlan);
        delete state._supplementsSkipNextRenderSignature;
        updateSupplementDoseCellButton(button, previousRawDose);
        return;
      }
      showToast('Вставлено');
    }
  };

  const triggerLongPressAction = (button) => {
    const dateStr = button?.dataset.date || '';
    const supplementName = button?.dataset.supplementName || '';
    if (!dateStr || !supplementName) return;

    const rawDose = getSupplementDoseFromState(dateStr, supplementName);
    const action = getSupplementDoseLongPressAction(dateStr, supplementName, rawDose);
    if (!action) return;

    longPressTriggered = true;
    suppressNextClick();
    navigator.vibrate?.(8);
    showSupplementDoseLongPressPopover(
      tableWrapper,
      button,
      action === 'copy' ? 'Копировать' : 'Вставить',
      async () => runCellAction(button, action)
    );
  };

  function handlePointerMove(event) {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    const diffX = event.clientX - startX;
    const diffY = event.clientY - startY;

    if (Math.hypot(diffX, diffY) > moveCancelDistance) {
      clearPressTimer();
    }
  }

  function handlePointerEnd(event) {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    if (longPressTriggered) {
      event.preventDefault();
    }
    cleanup();
  }

  tableWrapper.addEventListener('contextmenu', event => {
    const button = event.target?.closest?.('button.supplement-dose-cell-btn');
    if (!button || !tableWrapper.contains(button)) return;
    event.preventDefault();
  });

  tableWrapper.addEventListener('pointerdown', event => {
    const button = event.target?.closest?.('button.supplement-dose-cell-btn');
    if (!button || !tableWrapper.contains(button)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    clearSupplementDoseLongPressPopover();
    cleanup();
    pointerId = event.pointerId;
    sourceButton = button;
    startX = event.clientX;
    startY = event.clientY;
    longPressTriggered = false;

    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);
    pressTimer = setTimeout(() => triggerLongPressAction(sourceButton), longPressDelay);
  });
}

function enableSupplementColumnLongPressDrag(tableWrapper, planData) {
  const activeEntries = getSupplementEntries(planData);
  const table = tableWrapper?.querySelector('.supplement-plan-table');
  if (!tableWrapper || !table || activeEntries.length < 2) return;

  const longPressDelay = 420;
  const moveCancelDistance = 36;
  let pressTimer = null;
  let active = false;
  let dragFrom = null;
  let dragTo = null;
  let startX = 0;
  let startY = 0;
  let startPointerType = 'mouse';
  let pointerId = null;
  let sourceButton = null;
  let lockedScrollTop = 0;
  let rootHadNoScroll = false;
  let documentScrollLocked = false;

  const syncDragAffordances = () => {
    if (!active || dragFrom === null) return;
    syncSupplementColumnDragChip(tableWrapper, table, dragFrom, dragTo ?? dragFrom);
    syncSupplementColumnDragDoseOverlay(tableWrapper, table, dragTo ?? dragFrom, activeEntries.length);
  };

  tableWrapper.addEventListener('click', event => {
    if (tableWrapper.dataset.supplementColumnDragSuppress !== '1') return;
    event.preventDefault();
    event.stopPropagation();
    delete tableWrapper.dataset.supplementColumnDragSuppress;
  }, true);

  const clearPressTimer = () => {
    if (!pressTimer) return;
    clearTimeout(pressTimer);
    pressTimer = null;
  };

  const handleContextMenu = (event) => {
    if (pointerId !== null || active) {
      event.preventDefault();
    }
  };

  const getPreDragCancelDistance = () => (
    startPointerType === 'mouse' ? moveCancelDistance : moveCancelDistance + 18
  );

  const cleanup = () => {
    const wasActive = active;
    clearPressTimer();
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerEnd);
    document.removeEventListener('pointercancel', handlePointerEnd);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('contextmenu', handleContextMenu, true);
    tableWrapper.classList.remove('supplement-table-wrapper--column-dragging');
    table.classList.remove('supplement-plan-table--column-dragging');
    if (wasActive) {
      const root = document.getElementById('root');
      if (root && !rootHadNoScroll) root.classList.remove('root-no-scroll');
      tableWrapper.scrollTop = lockedScrollTop;
    }
    if (documentScrollLocked) {
      document.documentElement.classList.remove('supplement-column-drag-lock');
      document.body.classList.remove('supplement-column-drag-lock');
    }
    clearSupplementColumnDragClasses(table);
    removeSupplementColumnDragChip(tableWrapper);
    removeSupplementColumnDragDoseOverlay();
    active = false;
    dragFrom = null;
    dragTo = null;
    pointerId = null;
    sourceButton = null;
    lockedScrollTop = 0;
    rootHadNoScroll = false;
    documentScrollLocked = false;
  };

  const suppressNextClick = () => {
    tableWrapper.dataset.supplementColumnDragSuppress = '1';
    setTimeout(() => {
      if (tableWrapper.dataset.supplementColumnDragSuppress === '1') {
        delete tableWrapper.dataset.supplementColumnDragSuppress;
      }
    }, 260);
  };

  const startColumnDrag = () => {
    if (dragFrom === null) return;
    active = true;
    dragTo = dragFrom;
    lockedScrollTop = tableWrapper.scrollTop;
    const root = document.getElementById('root');
    rootHadNoScroll = Boolean(root?.classList.contains('root-no-scroll'));
    root?.classList.add('root-no-scroll');
    document.documentElement.classList.add('supplement-column-drag-lock');
    document.body.classList.add('supplement-column-drag-lock');
    documentScrollLocked = true;
    tableWrapper.classList.add('supplement-table-wrapper--column-dragging');
    table.classList.add('supplement-plan-table--column-dragging');
    applySupplementColumnDragState(table, dragFrom, dragTo, activeEntries.length);
    syncDragAffordances();

    try {
      sourceButton?.setPointerCapture?.(pointerId);
    } catch (error) {
      // Pointer capture can fail if the pointer was already released.
    }

    navigator.vibrate?.(8);
  };

  function handleTouchMove(event) {
    if (!active) return;
    event.preventDefault();
    tableWrapper.scrollTop = lockedScrollTop;
    syncDragAffordances();
  }

  function handlePointerMove(event) {
    if (pointerId !== null && event.pointerId !== pointerId) return;

    const diffX = event.clientX - startX;
    const diffY = event.clientY - startY;

    if (!active) {
      if (Math.hypot(diffX, diffY) > getPreDragCancelDistance()) {
        clearPressTimer();
      }
      return;
    }

    event.preventDefault();
    tableWrapper.scrollTop = lockedScrollTop;
    autoScrollSupplementTableHorizontally(tableWrapper, event.clientX);

    const nextColumnIndex = getSupplementColumnIndexFromPoint(table, activeEntries.length, event.clientX);
    if (nextColumnIndex === null) {
      syncDragAffordances();
      return;
    }

    if (nextColumnIndex !== dragTo) {
      dragTo = nextColumnIndex;
      applySupplementColumnDragState(table, dragFrom, dragTo, activeEntries.length);
    }
    syncDragAffordances();
  }

  async function handlePointerEnd(event) {
    if (pointerId !== null && event.pointerId !== pointerId) return;

    const wasActive = active;
    const from = dragFrom;
    const to = dragTo;

    if (wasActive) {
      event.preventDefault();
      suppressNextClick();
    }

    cleanup();

    if (wasActive && from !== null && to !== null && from !== to) {
      await reorderSupplementColumns(from, to);
    }
  }

  const bindColumnDragHandle = (element, columnIndex) => {
    if (!Number.isInteger(columnIndex) || columnIndex >= activeEntries.length) return;

    element.addEventListener('contextmenu', event => event.preventDefault());
    element.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();

      cleanup();
      startPointerType = event.pointerType || 'mouse';
      pointerId = event.pointerId;
      sourceButton = element;
      dragFrom = columnIndex;
      dragTo = columnIndex;
      startX = event.clientX;
      startY = event.clientY;

      document.addEventListener('pointermove', handlePointerMove, { passive: false });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('pointerup', handlePointerEnd);
      document.addEventListener('pointercancel', handlePointerEnd);
      document.addEventListener('contextmenu', handleContextMenu, true);
      pressTimer = setTimeout(startColumnDrag, longPressDelay);
    });
  };

  table.querySelectorAll('th.supplement-col[data-active-index]').forEach((headerCell) => {
    const columnIndex = Number(headerCell.dataset.activeIndex);
    if (!Number.isInteger(columnIndex)) return;
    bindColumnDragHandle(headerCell.querySelector('.supplement-header') || headerCell, columnIndex);
  });

  tableWrapper.addEventListener('scroll', () => {
    if (!active) return;
    tableWrapper.scrollTop = lockedScrollTop;
    syncDragAffordances();
  }, { passive: true });
}

function getSupplementColumnIndexFromPoint(table, realColumnsCount, clientX) {
  const headers = Array.from(table.querySelectorAll('th.supplement-col[data-index]'))
    .sort((left, right) => Number(left.dataset.index) - Number(right.dataset.index))
    .slice(0, realColumnsCount);
  if (headers.length === 0) return null;

  let nearestIndex = 0;
  let nearestDistance = Infinity;

  headers.forEach((header, index) => {
    const rect = header.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      nearestIndex = index;
      nearestDistance = -1;
      return;
    }

    const distance = Math.abs(clientX - (rect.left + rect.width / 2));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function autoScrollSupplementTableHorizontally(tableWrapper, clientX) {
  const rect = tableWrapper.getBoundingClientRect();
  const edge = 42;
  const speed = 14;

  if (clientX < rect.left + edge) {
    tableWrapper.scrollLeft -= speed;
  } else if (clientX > rect.right - edge) {
    tableWrapper.scrollLeft += speed;
  }
}

function clearSupplementColumnDragClasses(table) {
  table.querySelectorAll('.supplement-column-selected, .supplement-column-drop-target, .supplement-column-source-hidden, .supplement-column-shift-left, .supplement-column-shift-right').forEach(element => {
    element.classList.remove(
      'supplement-column-selected',
      'supplement-column-drop-target',
      'supplement-column-source-hidden',
      'supplement-column-shift-left',
      'supplement-column-shift-right'
    );
  });
  table.classList.remove(
    'supplement-plan-table--can-move-left',
    'supplement-plan-table--can-move-right'
  );
  table.style.removeProperty('--supplement-column-shift-distance');
}

function syncSupplementColumnDragChip(tableWrapper, table, sourceColumnIndex, positionColumnIndex = sourceColumnIndex) {
  if (!tableWrapper || !table || !Number.isInteger(sourceColumnIndex) || !Number.isInteger(positionColumnIndex)) return;

  const sourceHeaderCell = table.querySelector(`th.supplement-col[data-index="${sourceColumnIndex}"]`);
  const positionHeaderCell = table.querySelector(`th.supplement-col[data-index="${positionColumnIndex}"]`);
  if (!sourceHeaderCell || !positionHeaderCell) return;
  const stickyHeader = table.querySelector('thead');

  let chip = document.body.querySelector('.supplement-column-drag-chip');
  if (!chip) {
    chip = createElement('div', 'supplement-column-drag-chip');
    document.body.append(chip);
  }

  chip.textContent = sourceHeaderCell.querySelector('.sup-name')?.textContent?.trim() || '';

  const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 0);
  const viewportWidth = Math.round(window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 0);
  const wrapperRect = tableWrapper.getBoundingClientRect();
  const stickyHeaderRect = stickyHeader?.getBoundingClientRect() || wrapperRect;
  const columnRect = positionHeaderCell.getBoundingClientRect();
  const chipWidth = Math.min(Math.max(Math.round(columnRect.width + 18), 78), Math.max(78, viewportWidth - 12));
  const nextLeft = clampValue(
    Math.round(columnRect.left + (columnRect.width - chipWidth) / 2),
    6,
    Math.max(6, viewportWidth - chipWidth - 6)
  );
  const chipHeight = 42;
  const visibleTop = 6;
  const visibleBottom = Math.max(6, viewportHeight - chipHeight - 18);
  const stickyTop = Math.round(Math.max(wrapperRect.top, stickyHeaderRect.top));
  const nextTop = clampValue(stickyTop - chipHeight - 8, visibleTop, visibleBottom);

  chip.style.width = `${chipWidth}px`;
  chip.style.left = `${nextLeft}px`;
  chip.style.top = `${nextTop}px`;
}

function removeSupplementColumnDragChip(tableWrapper) {
  document.body.querySelector('.supplement-column-drag-chip')?.remove();
}

function syncSupplementColumnDragDoseOverlay(tableWrapper, table, columnIndex, realColumnsCount = 0) {
  if (!tableWrapper || !table || !Number.isInteger(columnIndex)) return;

  const headerCell = table.querySelector(`th.supplement-col[data-index="${columnIndex}"]`);
  if (!headerCell) return;

  let overlay = document.body.querySelector('.supplement-column-drag-dose-overlay');
  if (!overlay) {
    overlay = createElement('div', 'supplement-column-drag-dose-overlay');
    document.body.append(overlay);
  }

  overlay.classList.toggle('can-move-left', columnIndex > 0);
  overlay.classList.toggle('can-move-right', columnIndex < realColumnsCount - 1);

  const wrapperRect = tableWrapper.getBoundingClientRect();
  const navRect = document.querySelector('.navigation')?.getBoundingClientRect?.();
  const header = table.querySelector('thead');
  const headerRect = header?.getBoundingClientRect() || headerCell.getBoundingClientRect();
  const columnRect = headerCell.getBoundingClientRect();
  const nextTop = Math.round(Math.max(wrapperRect.top, headerRect.top));
  const visibleBottom = Number.isFinite(navRect?.top) && navRect.top > 0
    ? Math.min(wrapperRect.bottom, navRect.top)
    : wrapperRect.bottom;
  const nextHeight = Math.max(0, Math.round(visibleBottom - nextTop));

  overlay.style.left = `${Math.round(columnRect.left)}px`;
  overlay.style.top = `${nextTop}px`;
  overlay.style.width = `${Math.round(columnRect.width)}px`;
  overlay.style.height = `${nextHeight}px`;
}

function removeSupplementColumnDragDoseOverlay() {
  document.body.querySelector('.supplement-column-drag-dose-overlay')?.remove();
}

function getSupplementStickyLeadWidth(table) {
  if (!table) return 72;

  const dateCellWidth = table.querySelector('tbody td.date-col')?.getBoundingClientRect().width || 40;
  const dayCellWidth = table.querySelector('tbody td.day-col')?.getBoundingClientRect().width || 29;
  return Math.round(dateCellWidth + dayCellWidth);
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSupplementColumnShiftDistance(table, dragFrom, dragTo) {
  const sourceHeader = table?.querySelector(`th.supplement-col[data-index="${dragFrom}"]`);
  const targetHeader = table?.querySelector(`th.supplement-col[data-index="${dragTo}"]`);
  const distance = Math.round(
    targetHeader?.getBoundingClientRect?.().width ||
    sourceHeader?.getBoundingClientRect?.().width ||
    0
  );
  return Math.max(distance, 0);
}

function markSupplementColumnShiftRange(table, dragFrom, dragTo) {
  if (!table || dragFrom === dragTo) return;

  if (dragTo > dragFrom) {
    for (let index = dragFrom + 1; index <= dragTo; index += 1) {
      markSupplementColumn(table, index, 'supplement-column-shift-left');
    }
    return;
  }

  for (let index = dragTo; index < dragFrom; index += 1) {
    markSupplementColumn(table, index, 'supplement-column-shift-right');
  }
}

function applySupplementColumnDragState(table, dragFrom, dragTo, realColumnsCount = 0) {
  clearSupplementColumnDragClasses(table);
  table.classList.toggle('supplement-plan-table--can-move-left', dragFrom > 0);
  table.classList.toggle('supplement-plan-table--can-move-right', dragFrom < realColumnsCount - 1);
  markSupplementColumn(table, dragFrom, 'supplement-column-source-hidden');
  const shiftDistance = getSupplementColumnShiftDistance(table, dragFrom, dragTo);
  if (shiftDistance > 0) {
    table.style.setProperty('--supplement-column-shift-distance', `${shiftDistance}px`);
  }
  markSupplementColumnShiftRange(table, dragFrom, dragTo);
}

function markSupplementColumn(table, columnIndex, className) {
  table.querySelectorAll(`th.supplement-col[data-index="${columnIndex}"], td.dose-col[data-supplement-index="${columnIndex}"]`).forEach(element => {
    element.classList.add(className);
  });
}

function enableHeaderDnd(thead, planData) {
  const activeEntries = getSupplementEntries(planData);
  let dragFrom = null;

  thead.querySelectorAll('th.supplement-col').forEach((th) => {
    const activeIndex = Number(th.dataset.activeIndex);
    const isReal = Number.isInteger(activeIndex);
    th.draggable = isReal;

    th.addEventListener('dragstart', e => {
      if (!isReal) return;
      dragFrom = activeIndex;
      e.dataTransfer.effectAllowed = 'move';
      th.classList.add('dragging');
    });

    th.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      th.classList.add('dragover');
    });

    th.addEventListener('dragleave', () => th.classList.remove('dragover'));

    th.addEventListener('drop', async () => {
      th.classList.remove('dragover');
      thead.querySelectorAll('th.supplement-col').forEach(el => el.classList.remove('dragging'));
      if (dragFrom === null) return;

      const dragTo = Number(th.dataset.activeIndex);
      if (!Number.isInteger(dragTo) || dragTo === dragFrom || dragTo >= activeEntries.length) { dragFrom = null; return; }

      await reorderSupplementColumns(dragFrom, dragTo);
      dragFrom = null;
    });

    th.addEventListener('dragend', () => {
      thead.querySelectorAll('th.supplement-col').forEach(el => el.classList.remove('dragging'));
      dragFrom = null;
    });
  });
}

// =================================================================
// 🌟 функцию модалки БАДОВ/ДОБАВОК
// =================================================================

function openSupplementEditModal(planIndexOrOptions, currentName = '') {
  const modalOptions = (typeof planIndexOrOptions === 'object' && planIndexOrOptions !== null)
    ? planIndexOrOptions
    : { planIndex: planIndexOrOptions, currentName };
  const planIndex = Number.isInteger(Number(modalOptions.planIndex)) ? Number(modalOptions.planIndex) : -1;
  const requestedSlot = normalizeSupplementSlot(modalOptions.slotIndex);
  const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
  plan.supplements = Array.isArray(plan.supplements) ? plan.supplements : [];
  ensureSupplementEntrySlots(plan);
  const allEntries = getSupplementEntries(plan, { includeArchived: true });
  const activeEntries = getSupplementEntries(plan);
  const currentEntry = allEntries.find(entry => entry.planIndex === planIndex) || null;
  const isExisting = Boolean(currentEntry && !currentEntry.archived);
  const targetSlot = isExisting ? currentEntry.slot : (requestedSlot ?? getNextAvailableSupplementSlot(plan));
  const currentFullName = currentEntry?.name || modalOptions.currentName || '';
  const currentShortName = currentEntry?.shortName || normalizeSupplementShortName('', currentFullName);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal-window supplement-edit-modal';

  const title = createElement('h3', null, isExisting ? 'Редактировать препарат' : 'Добавить препарат');

  const fullNameLabel = createElement('label', 'supplement-edit-field');
  fullNameLabel.append(createElement('span', 'supplement-edit-field-label', 'Введите полное название препарата'));
  const fullNameInput = createElement('input', 'modal-input supplement-edit-input');
  fullNameInput.type = 'text';
  fullNameInput.value = currentFullName;
  fullNameLabel.append(fullNameInput);

  const shortNameLabel = createElement('label', 'supplement-edit-field');
  shortNameLabel.append(createElement('span', 'supplement-edit-field-label', 'Подпись для таблицы и календаря'));
  const shortNameInput = createElement('input', 'modal-input supplement-edit-input');
  shortNameInput.type = 'text';
  shortNameInput.maxLength = SUPPLEMENT_SHORT_NAME_LIMIT;
  shortNameInput.value = currentShortName;
  shortNameLabel.append(shortNameInput);
  shortNameLabel.append(createElement('span', 'supplement-edit-field-hint', 'До 7 символов. Это название будет видно в таблице и календаре.'));

  modal.append(title, fullNameLabel, shortNameLabel);

  if (isExisting) {
    modal.append(
      createElement(
        'div',
        'supplement-edit-reorder-hint',
        'Чтобы изменить позицию препарата, зажмите его в шапке таблицы и перетащите в нужное место.'
      )
    );
  }

  const buttons = createElement('div', 'modal-buttons');
  if (isExisting) {
    const deleteBtn = createElement('button', 'btn btn-danger', 'Удалить препарат');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => {
      backdrop.remove();
      openSupplementDeleteOptionsModal({ planIndex: currentEntry.planIndex, entry: currentEntry });
    });
    buttons.append(deleteBtn);
  }

  const cancelBtn = createElement('button', 'btn btn-secondary', 'Отмена');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => backdrop.remove());

  const saveBtn = createElement('button', 'btn btn-primary', isExisting ? 'Сохранить' : 'Добавить');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    const nextFullName = fullNameInput.value.trim();
    const nextShortName = normalizeSupplementShortName(shortNameInput.value, nextFullName);

    if (!nextFullName) {
      showToast('Введите название препарата');
      return;
    }

    const hasDuplicate = allEntries.some(entry => entry.name === nextFullName && entry.planIndex !== currentEntry?.planIndex);
    if (hasDuplicate) {
      showToast('Такое название уже используется.');
      return;
    }

    if (!isExisting) {
      if (activeEntries.length >= MAX_SUPPLEMENTS_COUNT) {
        showToast(`Можно добавить не больше ${MAX_SUPPLEMENTS_COUNT} препаратов.`);
        return;
      }

      plan.supplements.push(createSupplementMeta(nextFullName, nextShortName, false, targetSlot));
      plan.data = (plan.data || []).map(day => {
        day.doses = day.doses || {};
        if (!Object.prototype.hasOwnProperty.call(day.doses, nextFullName)) {
          day.doses[nextFullName] = '';
        }
        return day;
      });

      rememberCurrentSupplementTableScroll();
      await updateSupplementPlanInFirestore(plan);
      backdrop.remove();
      return;
    }

    plan.supplements[currentEntry.planIndex] = createSupplementMeta(nextFullName, nextShortName, false, currentEntry.slot);

    if (nextFullName !== currentEntry.name) {
      (plan.data || []).forEach(day => {
        if (!day.doses) day.doses = {};
        if (Object.prototype.hasOwnProperty.call(day.doses, currentEntry.name)) {
          day.doses[nextFullName] = day.doses[currentEntry.name];
          delete day.doses[currentEntry.name];
        }
      });
    }

    await updateSupplementPlanInFirestore(plan);
    backdrop.remove();
  });

  buttons.append(cancelBtn, saveBtn);
  modal.append(buttons);
  backdrop.append(modal);
  document.body.append(backdrop);

  setTimeout(() => fullNameInput.focus(), 0);

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.remove();
  });
}

async function archiveSupplementKeepHistory(planIndex, entry) {
  const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
  ensureSupplementEntrySlots(plan);
  if (!Array.isArray(plan.supplements) || !plan.supplements[planIndex]) return;

  plan.supplements[planIndex] = createSupplementMeta(entry.name, entry.shortName, true, entry.slot);
  await updateSupplementPlanInFirestore(plan);
  showToast('Препарат убран из шапки. История сохранена.');
}

async function deleteSupplementCompletely(planIndex, entry) {
  const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
  ensureSupplementEntrySlots(plan);
  if (!Array.isArray(plan.supplements) || !plan.supplements[planIndex]) return;

  plan.supplements.splice(planIndex, 1);
  plan.data = (plan.data || []).map(day => {
    if (day.doses) delete day.doses[entry.name];
    return day;
  });

  await updateSupplementPlanInFirestore(plan);
  showToast('Препарат удален полностью.');
}

function openSupplementDeleteOptionsModal({ planIndex, entry }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal-window supplement-delete-modal';
  modal.append(
    createElement('h3', null, 'Как удалить препарат?'),
    createElement('div', 'supplement-delete-modal-text', 'Можно убрать препарат из шапки и сохранить его историю в таблице, или удалить его полностью вместе со всеми старыми записями.')
  );

  const buttons = createElement('div', 'modal-buttons supplement-delete-modal-actions');
  const keepHistoryBtn = createElement('button', 'btn btn-secondary', 'Убрать из шапки, сохранить историю');
  keepHistoryBtn.type = 'button';
  keepHistoryBtn.addEventListener('click', async () => {
    backdrop.remove();
    await archiveSupplementKeepHistory(planIndex, entry);
  });

  const deleteAllBtn = createElement('button', 'btn btn-danger', 'Удалить полностью');
  deleteAllBtn.type = 'button';
  deleteAllBtn.addEventListener('click', async () => {
    backdrop.remove();
    await deleteSupplementCompletely(planIndex, entry);
  });

  const cancelBtn = createElement('button', 'btn btn-primary', 'Отмена');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => backdrop.remove());

  buttons.append(keepHistoryBtn, deleteAllBtn, cancelBtn);
  modal.append(buttons);
  backdrop.append(modal);
  document.body.append(backdrop);

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.remove();
  });
}


// =====================================================================
// 📅 МОДАЛЬНОЕ ОКНО ВЫБОРА ДАТ ДЛЯ PDF
// =====================================================================
export function openPdfDateModal(currentCycle) {
    return openPdfDateModalStyled(currentCycle);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const modal = document.createElement('div');
    modal.className = 'modal-content modal-compact';
    modal.style.maxWidth = '400px';
    modal.style.textAlign = 'center';

    modal.append(createElement('h3', null, 'Выберите период отчета'));

    // --- поля выбора дат ---
    const defaultStart = currentCycle.startDateString || getTodayDateString();
    const defaultEnd = getTodayDateString();

    const startInput = createElement('input', 'date-filter-input');
    startInput.type = 'date';
    startInput.value = dateToInputFormat(defaultStart);
    startInput.style.margin = '10px';

    const endInput = createElement('input', 'date-filter-input');
    endInput.type = 'date';
    endInput.value = dateToInputFormat(defaultEnd);
    endInput.style.margin = '10px';

    modal.append(
        createElement('label', null, 'С даты:'),
        startInput,
        createElement('label', null, 'По дату:'),
        endInput
    );

    // --- кнопки ---
    const controls = createElement('div', 'modal-controls');
    const cancelBtn = createElement('button', 'btn btn-secondary', 'Отмена');
    const okBtn = createElement('button', 'btn btn-primary', 'ОК');

    cancelBtn.addEventListener('click', () => overlay.remove());
    okBtn.addEventListener('click', () => {
        if (!startInput.value || !endInput.value) {
            showToast('Выберите обе даты.');
            return;
        }

        const start = startInput.value.split('-').reverse().join('.');
        const end = endInput.value.split('-').reverse().join('.');

        // генерируем HTML и открываем PDF-страницу
        const reportHtml = generateCycleReportHtml(currentCycle, start, end);
        if (reportHtml) {
            state.reportHtmlCache = reportHtml;
            state.currentPage = 'cycleReport';
            render();
        }

        overlay.remove();
    });

    controls.append(cancelBtn, okBtn);
    modal.append(controls);
    overlay.append(modal);
    document.body.append(overlay);
}

function openPdfDateModalStyled(currentCycle) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.backdropFilter = 'blur(4px)';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.maxWidth = '520px';
    modal.style.width = '92%';
    modal.style.borderRadius = '20px';
    modal.style.padding = '20px';

    const defaultStart = currentCycle.startDateString || getTodayDateString();
    const defaultEnd = getTodayDateString();

    function formatDisplayDateValue(dateStr) {
        if (!dateStr) return 'Выбрать';
        const [y, m, d] = dateStr.split('-');
        return `${d}.${m}.${y}`;
    }

    function makePickerRow(labelText) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '12px';
        row.style.padding = '14px 16px';
        row.style.border = '1px solid #d9d9d9';
        row.style.borderRadius = '16px';
        row.style.background = '#fff';
        row.style.marginBottom = '14px';
        row.style.transition = '0.18s ease';

        const label = document.createElement('div');
        label.textContent = labelText;
        label.style.fontSize = '15px';
        label.style.fontWeight = '600';
        label.style.color = '#222';

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        right.style.gap = '8px';

        row.append(label, right);
        return { row, right };
    }

    function makeFancyDateButton(initialValue = '') {
        const wrap = document.createElement('div');
        let currentValue = initialValue || '';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '8px';
        btn.style.padding = '10px 12px';
        btn.style.border = '1px solid #d6d6d6';
        btn.style.borderRadius = '12px';
        btn.style.background = '#fff';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = '600';
        btn.style.color = initialValue ? '#222' : '#777';
        btn.style.minWidth = '128px';
        btn.style.justifyContent = 'space-between';

        const text = document.createElement('span');
        const icon = document.createElement('span');
        icon.textContent = '📅';

        function setValue(value) {
            currentValue = value || '';
            text.textContent = formatDisplayDateValue(currentValue);
            btn.style.color = currentValue ? '#222' : '#777';
        }

        function openPickerDirectly() {
            const now = new Date();
            const fallbackValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            openDateModal(currentValue || fallbackValue, (nextValue) => {
                if (!nextValue) return;
                setValue(nextValue);
            });
        }

        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            openPickerDirectly();
        });

        setValue(initialValue);
        btn.append(text, icon);
        wrap.append(btn);

        return {
            wrap,
            getValue: () => currentValue,
            openPickerDirectly
        };
    }

    const title = createElement('h3', null, 'Выберите период отчета');
    title.style.marginBottom = '18px';
    title.style.textAlign = 'center';

    const subtitle = createElement('div', 'muted', 'Выберите начальную и конечную дату');
    subtitle.style.textAlign = 'center';
    subtitle.style.marginBottom = '18px';
    subtitle.style.fontSize = '14px';

    const startRow = makePickerRow('С даты');
    const endRow = makePickerRow('По дату');
    const startPicker = makeFancyDateButton(dateToInputFormat(defaultStart));
    const endPicker = makeFancyDateButton(dateToInputFormat(defaultEnd));
    startRow.right.append(startPicker.wrap);
    endRow.right.append(endPicker.wrap);

    startRow.row.onclick = (event) => {
        if (event.target.closest('button')) return;
        startPicker.openPickerDirectly();
    };

    endRow.row.onclick = (event) => {
        if (event.target.closest('button')) return;
        endPicker.openPickerDirectly();
    };

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.justifyContent = 'flex-end';
    controls.style.gap = '10px';
    controls.style.marginTop = '18px';

    const cancelBtn = createElement('button', 'btn btn-secondary', 'Отмена');
    const okBtn = createElement('button', 'btn btn-primary', 'ОК');

    cancelBtn.addEventListener('click', () => overlay.remove());
    okBtn.addEventListener('click', () => {
        const startValue = startPicker.getValue();
        const endValue = endPicker.getValue();

        if (!startValue || !endValue) {
            showToast('Выберите обе даты.');
            return;
        }

        const start = startValue.split('-').reverse().join('.');
        const end = endValue.split('-').reverse().join('.');
        const reportHtml = generateCycleReportHtml(currentCycle, start, end);
        if (reportHtml) {
            state.reportHtmlCache = reportHtml;
            state.currentPage = 'cycleReport';
            render();
        }

        overlay.remove();
    });

    controls.append(cancelBtn, okBtn);
    modal.append(title, subtitle, startRow.row, endRow.row, controls);
    overlay.append(modal);
    document.body.append(overlay);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });
}


// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: DEBOUNCE (Устранение потери фокуса при вводе)
// =================================================================
export function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}
