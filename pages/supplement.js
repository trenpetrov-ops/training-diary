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
import { MODAL_TEXT_INPUT_CLASS } from '../script.js';
import { prepareKeyboardDockedModal } from '../script.js';
import { presentKeyboardDockedModal } from '../script.js';
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
const SUPPLEMENT_TABLE_VISIBLE_DAYS = SUPPLEMENT_TABLE_VISIBLE_WEEKS * 7;
/** Сколько недель плана от даты начала цикла держим минимум (и показываем в таблице без виртуального окна). */
const SUPPLEMENT_TABLE_INITIAL_WEEKS = 12;
const SUPPLEMENT_TABLE_DEFAULT_ADD_WEEKS = 12;

let supplementCalendarMonthDate = null;
let supplementCalendarSelectedDate = null;
let supplementTableViewportSyncController = null;
let supplementTableScrollState = null;
let supplementDoseClipboard = null;
let supplementDoseClipboardMeta = null;
let supplementDoseRangeClipboard = null;
let supplementDoseRangeClipboardMeta = null;
let supplementDoseLongPressOverlayCleanup = null;
let supplementTableVirtualState = null;
let supplementDoseMergeSession = null;
let supplementTableSheetState = createSupplementTableSheetDefaultState();
let supplementTableSheetElements = null;
let supplementTableSheetViewportAbortController = null;
let supplementPlanHistoryState = createSupplementPlanHistoryDefaultState();
let supplementsCurrentViewMode = 'calendar';
let supplementTableEditorDeferredScrollTimer = null;

const SUPPLEMENT_SHEET_TEXT_COLORS = ['#111827', '#d93c3c', '#0f766e', '#2563eb', '#7c3aed', '#b45309'];
const SUPPLEMENT_SHEET_FILL_COLORS = ['', '#fff7cc', '#dff5df', '#dbeafe', '#f3e8ff', '#fee2e2'];
const SUPPLEMENT_PLAN_HISTORY_LIMIT = 120;

function createSupplementTableSheetDefaultState() {
    return {
        menuOpen: false,
        selectedCell: null,
        draft: null,
        initialDraft: null,
        history: [],
        historyIndex: -1,
        formatPanelOpen: false,
        formatColorPaletteOpen: false,
        timePanelOpen: false,
        textInputFocused: false,
        numericPadMode: false
    };
}

function createSupplementPlanHistoryDefaultState() {
    return {
        cycleId: '',
        entries: [],
        index: -1
    };
}

function isSupplementPlanDayRangeConsecutiveInData(plan, i0, i1) {
    if (i0 === i1) return true;
    const lo = Math.min(i0, i1);
    const hi = Math.max(i0, i1);
    const data = plan?.data;
    if (!Array.isArray(data)) return false;
    for (let i = lo + 1; i <= hi; i++) {
        const prev = parseSupplementDateString(data[i - 1]?.date);
        const cur = parseSupplementDateString(data[i]?.date);
        if (!prev || !cur) return false;
        const next = addSupplementDays(prev, 1);
        if (compareSupplementDates(cur, next) !== 0) return false;
    }
    return true;
}

function findSupplementDoseMergeCovering(planData, dateStr, slot, supplementName) {
    const merges = planData?.doseMerges;
    if (!Array.isArray(merges) || !dateStr || !supplementName) return null;
    const d = parseSupplementDateString(dateStr);
    if (!d) return null;
    for (const m of merges) {
        if (!m || typeof m !== 'object') continue;
        if (Number(m.slot) !== Number(slot)) continue;
        if (String(m.supplementName || '') !== String(supplementName)) continue;
        const sd = parseSupplementDateString(m.startDate);
        const ed = parseSupplementDateString(m.endDate);
        if (!sd || !ed) continue;
        if (compareSupplementDates(d, sd) >= 0 && compareSupplementDates(d, ed) <= 0) {
            return m;
        }
    }
    return null;
}

function findSupplementDoseMergeCoveringByName(planData, dateStr, supplementName) {
    const merges = planData?.doseMerges;
    if (!Array.isArray(merges) || !dateStr || !supplementName) return null;
    const d = parseSupplementDateString(dateStr);
    if (!d) return null;
    for (const m of merges) {
        if (!m || typeof m !== 'object') continue;
        if (String(m.supplementName || '') !== String(supplementName)) continue;
        const sd = parseSupplementDateString(m.startDate);
        const ed = parseSupplementDateString(m.endDate);
        if (!sd || !ed) continue;
        if (compareSupplementDates(d, sd) >= 0 && compareSupplementDates(d, ed) <= 0) {
            return m;
        }
    }
    return null;
}

function getSupplementDoseMergeRowspan(planData, merge) {
    if (!merge?.startDate || !merge?.endDate) return 1;
    const data = planData?.data;
    if (!Array.isArray(data)) return 1;
    const i0 = data.findIndex((day) => day?.date === merge.startDate);
    const i1 = data.findIndex((day) => day?.date === merge.endDate);
    if (i0 < 0 || i1 < 0 || i1 < i0) return 1;
    return i1 - i0 + 1;
}

function getSupplementDoseMergeDateStrings(planData, merge) {
    if (!merge?.startDate || !merge?.endDate) return [];
    const data = planData?.data;
    if (!Array.isArray(data)) return [];
    const i0 = data.findIndex((day) => day?.date === merge.startDate);
    const i1 = data.findIndex((day) => day?.date === merge.endDate);
    if (i0 < 0 || i1 < 0) return [];
    const lo = Math.min(i0, i1);
    const hi = Math.max(i0, i1);
    return data.slice(lo, hi + 1).map((day) => day?.date).filter(Boolean);
}

function filterSupplementDoseMergesOverlappingRange(plan, slot, supplementName, startDate, endDate) {
    const list = plan?.doseMerges;
    if (!Array.isArray(list)) return;
    plan.doseMerges = list.filter((m) => {
        if (!m || typeof m !== 'object') return false;
        if (Number(m.slot) !== Number(slot)) return true;
        if (String(m.supplementName || '') !== String(supplementName)) return true;
        if (compareSupplementDateStrings(m.endDate, startDate) < 0) return true;
        if (compareSupplementDateStrings(m.startDate, endDate) > 0) return true;
        return false;
    });
}

/** @returns {{ scope: 'none' | 'single' | 'merge' }} */
function clearSupplementDoseCellOrMergeInPlan(plan, dateStr, supplementName, slot) {
    if (!plan || !dateStr || !supplementName) return { scope: 'none' };
    const merge =
        Number.isFinite(slot) && slot >= 0
            ? findSupplementDoseMergeCovering(plan, dateStr, slot, supplementName)
            : null;
    if (merge) {
        const dates = getSupplementDoseMergeDateStrings(plan, merge);
        for (const ds of dates) {
            const di = (plan.data || []).findIndex((d) => d.date === ds);
            if (di >= 0) {
                plan.data[di].doses = plan.data[di].doses || {};
                plan.data[di].doses[supplementName] = '';
            }
        }
        plan.doseMerges = (plan.doseMerges || []).filter(
            (m) =>
                !(
                    Number(m.slot) === Number(merge.slot) &&
                    String(m.supplementName || '') === String(merge.supplementName || '') &&
                    m.startDate === merge.startDate &&
                    m.endDate === merge.endDate
                )
        );
        return { scope: 'merge' };
    }
    const dayIndex = (plan.data || []).findIndex((day) => day.date === dateStr);
    if (dayIndex === -1) return { scope: 'none' };
    plan.data[dayIndex].doses = plan.data[dayIndex].doses || {};
    plan.data[dayIndex].doses[supplementName] = '';
    return { scope: 'single' };
}

/** @returns {{ scope: 'none' | 'single' | 'merge' }} */
function pasteSupplementDoseToCellOrMergeInPlan(plan, dateStr, supplementName, slot, clipboardRaw) {
    if (!plan || !dateStr || !supplementName) return { scope: 'none' };
    const merge =
        Number.isFinite(slot) && slot >= 0
            ? findSupplementDoseMergeCovering(plan, dateStr, slot, supplementName)
            : null;
    const val = cloneSupplementDoseValue(clipboardRaw);
    if (merge) {
        const dates = getSupplementDoseMergeDateStrings(plan, merge);
        for (const ds of dates) {
            const di = (plan.data || []).findIndex((d) => d.date === ds);
            if (di >= 0) {
                plan.data[di].doses = plan.data[di].doses || {};
                plan.data[di].doses[supplementName] = cloneSupplementDoseValue(val);
            }
        }
        return { scope: 'merge' };
    }
    const dayIndex = (plan.data || []).findIndex((day) => day.date === dateStr);
    if (dayIndex === -1) return { scope: 'none' };
    plan.data[dayIndex].doses = plan.data[dayIndex].doses || {};
    plan.data[dayIndex].doses[supplementName] = val;
    return { scope: 'single' };
}

function buildSupplementDoseRangeClipboardFromSession(session, planData) {
    if (!session || !Array.isArray(planData?.data)) return null;
    const i0 = Math.min(session.anchorIdx, session.extentIdx);
    const i1 = Math.max(session.anchorIdx, session.extentIdx);
    if (i0 < 0 || i1 < i0) return null;

    const rows = planData.data.slice(i0, i1 + 1);
    if (rows.length === 0) return null;

    const values = rows.map((day) => cloneSupplementDoseValue(day?.doses?.[session.supplementName] || ''));
    const merges = Array.isArray(planData.doseMerges)
        ? planData.doseMerges
            .filter((merge) => {
                if (!merge || typeof merge !== 'object') return false;
                if (Number(merge.slot) !== Number(session.slot)) return false;
                if (String(merge.supplementName || '') !== String(session.supplementName || '')) return false;
                const startIndex = planData.data.findIndex((day) => day?.date === merge.startDate);
                const endIndex = planData.data.findIndex((day) => day?.date === merge.endDate);
                if (startIndex < 0 || endIndex < startIndex) return false;
                return startIndex >= i0 && endIndex <= i1;
            })
            .map((merge) => {
                const startIndex = planData.data.findIndex((day) => day?.date === merge.startDate);
                const endIndex = planData.data.findIndex((day) => day?.date === merge.endDate);
                const anchorIndex = planData.data.findIndex((day) => day?.date === merge.anchorDate);
                return {
                    startOffset: startIndex - i0,
                    endOffset: endIndex - i0,
                    anchorOffset: anchorIndex >= i0 && anchorIndex <= i1 ? anchorIndex - i0 : startIndex - i0
                };
            })
        : [];

    return {
        values,
        merges
    };
}

function setSupplementDoseRangeClipboardValue(clipboardData, meta = {}) {
    supplementDoseRangeClipboard = clipboardData
        ? {
            values: Array.isArray(clipboardData.values)
                ? clipboardData.values.map((item) => cloneSupplementDoseValue(item))
                : [],
            merges: Array.isArray(clipboardData.merges)
                ? clipboardData.merges.map((item) => ({ ...item }))
                : []
        }
        : null;
    supplementDoseRangeClipboardMeta = {
        dateStr: meta.dateStr || '',
        supplementName: meta.supplementName || '',
        length: Array.isArray(clipboardData?.values) ? clipboardData.values.length : 0
    };
    supplementDoseClipboard = null;
    supplementDoseClipboardMeta = null;
}

function hasSupplementDoseRangeClipboardValue() {
    return Boolean(
        supplementDoseRangeClipboard &&
        Array.isArray(supplementDoseRangeClipboard.values) &&
        supplementDoseRangeClipboard.values.length > 0
    );
}

function pasteSupplementDoseRangeToPlan(plan, dateStr, supplementName, slot, clipboardData) {
    if (!plan || !dateStr || !supplementName) return { scope: 'none' };
    const parsedStartDate = parseSupplementDateString(dateStr);
    const values = Array.isArray(clipboardData?.values) ? clipboardData.values : [];
    if (!parsedStartDate || values.length === 0) return { scope: 'none' };

    const targetDates = values.map((_, index) =>
        formatSupplementDateString(addSupplementDays(parsedStartDate, index))
    );
    const targetStartDate = targetDates[0];
    const targetEndDate = targetDates[targetDates.length - 1];

    filterSupplementDoseMergesOverlappingRange(plan, slot, supplementName, targetStartDate, targetEndDate);

    targetDates.forEach((targetDate, index) => {
        const dayIndex = ensureSupplementDayRecord(plan, targetDate);
        if (dayIndex < 0) return;
        plan.data[dayIndex].doses = plan.data[dayIndex].doses || {};
        const nextValue = cloneSupplementDoseValue(values[index] || '');
        plan.data[dayIndex].doses[supplementName] = nextValue;
    });

    if (!Array.isArray(plan.doseMerges)) plan.doseMerges = [];
    (Array.isArray(clipboardData?.merges) ? clipboardData.merges : []).forEach((merge) => {
        const startOffset = Number(merge?.startOffset);
        const endOffset = Number(merge?.endOffset);
        if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return;
        if (startOffset < 0 || endOffset < startOffset || endOffset >= targetDates.length) return;
        const anchorOffset = Number.isInteger(Number(merge?.anchorOffset))
            ? Number(merge.anchorOffset)
            : startOffset;
        const safeAnchorOffset =
            anchorOffset >= startOffset && anchorOffset <= endOffset ? anchorOffset : startOffset;
        plan.doseMerges.push({
            slot,
            supplementName,
            startDate: targetDates[startOffset],
            endDate: targetDates[endOffset],
            anchorDate: targetDates[safeAnchorOffset]
        });
    });

    return { scope: values.length > 1 ? 'block' : 'single' };
}

function endSupplementDoseMergeMode() {
    const sess = supplementDoseMergeSession;
    if (sess?.tableWrapper && typeof sess.onTableClickCapture === 'function') {
        sess.tableWrapper.removeEventListener('click', sess.onTableClickCapture, true);
    }
    const tw = sess?.tableWrapper || document.getElementById('supplement-table-wrapper');
    tw?.querySelectorAll?.('button.supplement-dose-cell-btn--merge-pick')?.forEach((btn) =>
        btn.classList.remove('supplement-dose-cell-btn--merge-pick')
    );
    if (sess?.tableWrapper) {
        sess.tableWrapper.classList.remove('supplement-table-wrapper--merge-select');
    } else {
        document.getElementById('supplement-table-wrapper')?.classList.remove('supplement-table-wrapper--merge-select');
    }
    document.getElementById('supplement-dose-merge-toolbar')?.remove();
    document.querySelector('.top-bar')?.classList?.remove('top-bar--supplement-dose-merge');
    supplementDoseMergeSession = null;
}

function syncSupplementDoseMergeHighlights() {
    const s = supplementDoseMergeSession;
    if (!s?.tableWrapper) return;
    const tw = s.tableWrapper;
    tw.querySelectorAll('button.supplement-dose-cell-btn--merge-pick').forEach((btn) =>
        btn.classList.remove('supplement-dose-cell-btn--merge-pick')
    );
    const plan = state.supplementPlan;
    if (!plan?.data) return;
    const i0 = Math.min(s.anchorIdx, s.extentIdx);
    const i1 = Math.max(s.anchorIdx, s.extentIdx);
    const slotStr = String(s.slot);
    const name = String(s.supplementName || '');
    const dateSet = new Set();
    for (let i = i0; i <= i1; i++) {
        const d = plan.data[i]?.date;
        if (d) dateSet.add(d);
    }
    if (dateSet.size === 0) return;
    for (const btn of tw.querySelectorAll('button.supplement-dose-cell-btn')) {
        if (!dateSet.has(btn.dataset.date)) continue;
        if (btn.dataset.supplementSlot !== slotStr) continue;
        if (String(btn.dataset.supplementName || '') !== name) continue;
        btn.classList.add('supplement-dose-cell-btn--merge-pick');
    }
}

function startSupplementDoseMergeMode(tableWrapper, sourceButton) {
    endSupplementDoseMergeMode();
    const dateStr = sourceButton?.dataset?.date || '';
    const supplementName = sourceButton?.dataset?.supplementName || '';
    const slot = Number(sourceButton?.dataset?.supplementSlot);
    const plan = state.supplementPlan;
    const idx = plan?.data?.findIndex((d) => d.date === dateStr) ?? -1;
    if (idx < 0 || !supplementName || !Number.isFinite(slot)) return;

    const bar = createElement('div', 'supplement-dose-merge-toolbar');
    bar.id = 'supplement-dose-merge-toolbar';
    const cancelBtn = createElement('button', 'btn btn-secondary supplement-dose-merge-cancel', 'Отмена');
    cancelBtn.type = 'button';
    const mergeBtn = createElement('button', 'btn btn-primary supplement-dose-merge-confirm', 'Объединить');
    mergeBtn.type = 'button';
    mergeBtn.disabled = true;
    mergeBtn.textContent = 'Объединить ячейки';
    const copyBtn = createElement('button', 'btn btn-secondary supplement-dose-merge-copy', 'Копировать');
    copyBtn.type = 'button';
    copyBtn.disabled = true;
    const hint = createElement('div', 'supplement-dose-merge-toolbar-hint', '');
    const row = createElement('div', 'supplement-dose-merge-toolbar-row');
    row.append(cancelBtn, mergeBtn, copyBtn);
    bar.append(row, hint);

    const topBar = document.querySelector('.top-bar');
    if (!topBar) {
        return;
    }
    topBar.classList.add('top-bar--supplement-dose-merge');
    topBar.insertBefore(bar, topBar.firstChild);

    const onTableClickCapture = (e) => {
        const sess = supplementDoseMergeSession;
        if (!sess) return;
        const btn = e.target?.closest?.('button.supplement-dose-cell-btn');
        if (!btn || !sess.tableWrapper.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.supplementSlot !== String(sess.slot) || btn.dataset.supplementName !== sess.supplementName) {
            hint.textContent = 'Только этот столбец и подряд идущие дни.';
            return;
        }
        const j = state.supplementPlan?.data?.findIndex((d) => d.date === btn.dataset.date) ?? -1;
        if (j < 0) return;
        hint.textContent = '';
        sess.extentIdx = j;
        syncSupplementDoseMergeHighlights();
        const lo = Math.min(sess.anchorIdx, sess.extentIdx);
        const hi = Math.max(sess.anchorIdx, sess.extentIdx);
        sess.mergeBtn.disabled = hi - lo < 1;
        const selectedValues = state.supplementPlan?.data?.slice(lo, hi + 1) || [];
        sess.copyBtn.disabled = !selectedValues.some((day) =>
            hasSupplementDoseValue(day?.doses?.[sess.supplementName])
        );
    };

    supplementDoseMergeSession = {
        tableWrapper,
        anchorIdx: idx,
        extentIdx: idx,
        supplementName,
        slot,
        mergeBtn,
        copyBtn,
        hintEl: hint,
        onTableClickCapture
    };

    cancelBtn.addEventListener('click', () => endSupplementDoseMergeMode());
    mergeBtn.addEventListener('click', () => void commitSupplementDoseMerge());
    copyBtn.addEventListener('click', () => {
        const clipboardData = buildSupplementDoseRangeClipboardFromSession(supplementDoseMergeSession, state.supplementPlan);
        if (!clipboardData || !clipboardData.values.some((value) => hasSupplementDoseValue(value))) {
            showToast('Нет данных для копирования');
            return;
        }
        setSupplementDoseRangeClipboardValue(clipboardData, {
            dateStr,
            supplementName
        });
        navigator.vibrate?.(8);
        endSupplementDoseMergeMode();
        showToast('Диапазон скопирован');
    });

    tableWrapper.classList.add('supplement-table-wrapper--merge-select');
    tableWrapper.addEventListener('click', onTableClickCapture, true);
    syncSupplementDoseMergeHighlights();
    copyBtn.disabled = true;
}

async function commitSupplementDoseMerge() {
    const s = supplementDoseMergeSession;
    if (!s) return;
    const i0 = Math.min(s.anchorIdx, s.extentIdx);
    const i1 = Math.max(s.anchorIdx, s.extentIdx);
    if (i1 - i0 < 1) return;

    const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
    ensureSupplementEntrySlots(plan);
    if (!isSupplementPlanDayRangeConsecutiveInData(plan, i0, i1)) {
        showToast('Не удалось объединить: в плане есть разрыв между датами.');
        return;
    }

    const startDate = plan.data[i0].date;
    const endDate = plan.data[i1].date;
    const name = s.supplementName;
    const slot = s.slot;

    let mergedValue = '';
    for (let i = i0; i <= i1; i++) {
        const v = plan.data[i]?.doses?.[name];
        if (hasSupplementDoseValue(v)) {
            mergedValue = cloneSupplementDoseValue(v);
            break;
        }
    }

    if (!Array.isArray(plan.doseMerges)) plan.doseMerges = [];
    filterSupplementDoseMergesOverlappingRange(plan, slot, name, startDate, endDate);
    const anchorDate = plan.data[s.anchorIdx].date;
    plan.doseMerges.push({ slot, supplementName: name, startDate, endDate, anchorDate });

    for (let i = i0; i <= i1; i++) {
        plan.data[i].doses = plan.data[i].doses || {};
        plan.data[i].doses[name] = mergedValue ? cloneSupplementDoseValue(mergedValue) : '';
    }

    endSupplementDoseMergeMode();
    const previousPlan = state.supplementPlan;
    rememberCurrentSupplementTableScroll();
    const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
    if (saved) {
        showToast('Ячейки объединены');
    }
    renderSupplementsPage();
}

async function applySplitSupplementDoseMerge(button) {
    const dateStr = button?.dataset.date || '';
    const supplementName = button?.dataset.supplementName || '';
    const slot = Number(button?.dataset.supplementSlot);
    if (!dateStr || !supplementName || !Number.isFinite(slot)) return;

    const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
    ensureSupplementEntrySlots(plan);
    const merge = findSupplementDoseMergeCovering(plan, dateStr, slot, supplementName);
    if (!merge || merge.startDate !== dateStr) return;

    const name = supplementName;
    const dates = getSupplementDoseMergeDateStrings(plan, merge);
    if (!dates.length) return;

    let anchor = String(merge.anchorDate || '').trim();
    if (!anchor || !dates.includes(anchor)) {
        anchor = merge.startDate;
    }

    const anchorDayIdx = plan.data.findIndex((d) => d.date === anchor);
    const rawVal = anchorDayIdx >= 0 ? plan.data[anchorDayIdx]?.doses?.[name] : '';
    const valueToKeep = hasSupplementDoseValue(rawVal) ? cloneSupplementDoseValue(rawVal) : '';

    for (const ds of dates) {
        const di = plan.data.findIndex((d) => d.date === ds);
        if (di < 0) continue;
        plan.data[di].doses = plan.data[di].doses || {};
        plan.data[di].doses[name] =
            ds === anchor ? (valueToKeep ? cloneSupplementDoseValue(valueToKeep) : '') : '';
    }

    plan.doseMerges = (plan.doseMerges || []).filter(
        (m) =>
            !(
                Number(m.slot) === Number(merge.slot) &&
                String(m.supplementName || '') === String(merge.supplementName || '') &&
                m.startDate === merge.startDate &&
                m.endDate === merge.endDate
            )
    );

    const previousPlan = state.supplementPlan;
    rememberCurrentSupplementTableScroll();
    const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
    if (saved) {
        showToast('Объединение снято');
    }
    renderSupplementsPage();
}

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

    const dateIndex = new Map(plan.data.map((d, i) => [d.date, i]));

    if (!Array.isArray(plan.doseMerges)) {
        plan.doseMerges = [];
        changed = true;
    } else {
        const beforeLen = plan.doseMerges.length;
        plan.doseMerges = plan.doseMerges
            .filter((m) => {
            if (!m || typeof m !== 'object') return false;
            const slot = Number(m.slot);
            const name = String(m.supplementName || '').trim();
            const sd = String(m.startDate || '').trim();
            const ed = String(m.endDate || '').trim();
            if (!Number.isFinite(slot) || !name || !sd || !ed) return false;
            if (!allowedNames.has(name)) return false;
            const i0 = dateIndex.get(sd);
            const i1 = dateIndex.get(ed);
            if (i0 == null || i1 == null || i1 < i0) return false;
            return isSupplementPlanDayRangeConsecutiveInData(plan, i0, i1);
        })
            .map((m) => {
                const ad = String(m.anchorDate || '').trim();
                if (!ad) return m;
                const i0 = dateIndex.get(String(m.startDate || '').trim());
                const i1 = dateIndex.get(String(m.endDate || '').trim());
                const ia = dateIndex.get(ad);
                if (i0 == null || i1 == null || ia == null || ia < i0 || ia > i1) {
                    changed = true;
                    const { anchorDate: _a, ...rest } = m;
                    return rest;
                }
                return m;
            });
        if (plan.doseMerges.length !== beforeLen) changed = true;
    }

    return { plan, changed };
}

function resetSupplementsTableScrollMemory() {
    supplementTableScrollState = null;
}

export function resetSupplementsListener() {
    // План БАДов синхронизируется через onSnapshot на документе цикла в script.js (setupDynamicListeners).
}

/**
 * Гарантирует непрерывный диапазон дней plan.data от startDateString цикла
 * до (cycleStart + weeks*7 - 1): при необходимости дописывает пустые дни в начало и в конец.
 */
function ensureSupplementPlanMinimumWeeksFromCycleStart(plan, cycle, weeks) {
    if (!plan || !cycle?.startDateString || !Number.isFinite(weeks) || weeks <= 0) {
        return { changed: false };
    }
    const cycleStart = parseSupplementDateString(cycle.startDateString);
    if (!cycleStart) return { changed: false };

    ensureSupplementEntrySlots(plan);
    const names = getSupplementNames(plan);
    const doseTemplate = () =>
        names.length
            ? Object.fromEntries(names.map((n) => [n, '']))
            : {};

    if (!Array.isArray(plan.data)) plan.data = [];

    const targetEnd = addSupplementDays(cycleStart, weeks * 7 - 1);
    let changed = false;

    if (plan.data.length === 0) {
        const chunk = generateDates(cycle.startDateString, weeks * 7);
        plan.data = chunk.map((dateInfo) => ({
            date: dateInfo.date,
            dayOfWeek: dateInfo.dayOfWeek,
            doses: { ...doseTemplate() }
        }));
        return { changed: true };
    }

    const firstParsed = parseSupplementDateString(plan.data[0].date);
    const lastParsed = parseSupplementDateString(plan.data[plan.data.length - 1].date);
    if (!firstParsed || !lastParsed) return { changed: false };

    if (compareSupplementDates(firstParsed, cycleStart) > 0) {
        let prependCount = Math.round((firstParsed.getTime() - cycleStart.getTime()) / 86400000);
        if (prependCount > weeks * 7) {
            prependCount = weeks * 7;
        }
        if (prependCount > 0) {
            const chunk = generateDates(formatSupplementDateString(cycleStart), prependCount);
            const newRows = chunk.map((dateInfo) => ({
                date: dateInfo.date,
                dayOfWeek: dateInfo.dayOfWeek,
                doses: { ...doseTemplate() }
            }));
            plan.data = [...newRows, ...plan.data];
            changed = true;
        }
    }

    const lastAfter = parseSupplementDateString(plan.data[plan.data.length - 1].date);
    if (lastAfter && compareSupplementDates(lastAfter, targetEnd) < 0) {
        const appendCount = Math.round((targetEnd.getTime() - lastAfter.getTime()) / 86400000);
        if (appendCount > 0) {
            const nextStart = addSupplementDays(lastAfter, 1);
            const chunk = generateDates(formatSupplementDateString(nextStart), appendCount);
            const newRows = chunk.map((dateInfo) => ({
                date: dateInfo.date,
                dayOfWeek: dateInfo.dayOfWeek,
                doses: { ...doseTemplate() }
            }));
            plan.data.push(...newRows);
            changed = true;
        }
    }

    return { changed };
}

// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР ПЛАНА БАДОВ/ДОБАВОК (Обновлена)
// =================================================================
export async function renderSupplementsPage() {
    const root = document.getElementById('root');
    supplementTableViewportSyncController?.abort?.();
    supplementTableViewportSyncController = null;
    supplementTableVirtualState = null;
    clearSupplementTableCellSelection({ preserveMenu: false, revertPreview: true });
    clearSupplementDoseLongPressPopover();
    endSupplementDoseMergeMode();
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
        resetSupplementPlanHistoryState();
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
        resetSupplementPlanHistoryState(state.selectedCycleId);
        contentContainer.append(
            createElement('div', 'muted', 'План добавок пока не загружен.')
        );
        root.append(contentContainer);
        return false;
    }

    // --- Всё готово, можно рендерить план ---
    console.log('✅ План добавок загружен:', state.supplementPlan);
    syncSupplementPlanHistoryWithState(state.supplementPlan, state.selectedCycleId);
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
        const cycleForEnsure = state.cycles?.find((c) => c.id === state.selectedCycleId);
        if (cycleForEnsure && state.supplementPlan) {
            const { changed } = ensureSupplementPlanMinimumWeeksFromCycleStart(
                state.supplementPlan,
                cycleForEnsure,
                SUPPLEMENT_TABLE_INITIAL_WEEKS
            );
            if (changed) {
                ensureSupplementEntrySlots(state.supplementPlan);
                await updateSupplementPlanInFirestore(state.supplementPlan);
                resetSupplementPlanHistoryState(state.selectedCycleId);
                syncSupplementPlanHistoryWithState(state.supplementPlan, state.selectedCycleId);
            }
        }
        renderSupplementsTableView(contentContainer, state.supplementPlan || activePlanData);
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
    return supplementsCurrentViewMode === 'table' ? 'table' : 'calendar';
}

function setSupplementsViewMode(mode) {
    supplementsCurrentViewMode = mode === 'table' ? 'table' : 'calendar';
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

function createSupplementsTopBarOverflowButton() {
    const btn = createElement('button', 'supplements-topbar-action-btn supplements-topbar-overflow-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Меню таблицы');
    btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>More SVG Icon</title><path fill="currentColor" d="M12 6a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 12 6m0 7.75A1.75 1.75 0 1 0 12 10a1.75 1.75 0 0 0 0 3.75M13.75 20a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 0 1 3.5 0"/></svg>
    `;
    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (supplementTableSheetState.selectedCell) {
            supplementTableSheetState.menuOpen = true;
        } else {
            supplementTableSheetState.menuOpen = !supplementTableSheetState.menuOpen;
        }
        syncSupplementTableTopBarMenu();
    });
    return btn;
}

function createSupplementsTopBarImportButton() {
    const btn = createElement('button', 'supplements-topbar-action-btn supplements-topbar-import-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Перенос плана БАДов');
    btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Import SVG Icon</title><path fill="currentColor" d="M12 3.25a.75.75 0 0 1 .75.75v8.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V4a.75.75 0 0 1 .75-.75"/><path fill="currentColor" d="M4.75 15a.75.75 0 0 1 .75.75v1.5A1.75 1.75 0 0 0 7.25 19h9.5a1.75 1.75 0 0 0 1.75-1.75v-1.5a.75.75 0 0 1 1.5 0v1.5a3.25 3.25 0 0 1-3.25 3.25h-9.5A3.25 3.25 0 0 1 4 17.25v-1.5a.75.75 0 0 1 .75-.75"/></svg>
    `;
    btn.addEventListener('click', () => {
        openSupplementPlanImportModal();
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

    group.append(removeWeekBtn, weekLabel);
    return group;
}

function configureSupplementsTopBar(viewMode, planData) {
    const topBar = document.querySelector('.top-bar');
    const leftGroup = topBar?.querySelector('.topbar-cycle-btns');
    if (!topBar || !leftGroup) return;

    topBar.classList.remove('top-bar--supplements-table');
    topBar.querySelector('.supplements-topbar-right')?.remove();
    leftGroup.querySelector('.supplements-topbar-add-btn')?.remove();
    leftGroup.querySelector('.supplements-topbar-import-btn')?.remove();
    leftGroup.querySelector('.supplements-topbar-calendar-btn')?.remove();
    leftGroup.querySelector('.supplements-topbar-table-btn')?.remove();
    leftGroup.querySelector('.supplements-topbar-inline-menu')?.remove();
    if (viewMode === 'calendar') {
        leftGroup.append(createSupplementsTopBarImportButton());
        leftGroup.append(createSupplementsTopBarTableButton());
        return;
    }

    topBar.classList.add('top-bar--supplements-table');
    topBar.querySelector('.top-menu-btn')?.remove();

    const addBtn = createSupplementsTopBarAddButton(planData);
    if (addBtn) {
        leftGroup.append(addBtn);
    }
    leftGroup.append(createElement('div', 'supplements-topbar-inline-menu'));
    leftGroup.append(createSupplementsTopBarCalendarButton());
    syncSupplementTableTopBarMenu();
}

function isSupplementTableSheetSelectionActive() {
    return Boolean(supplementTableSheetState.selectedCell);
}

function isSupplementTableSheetDraftDirty() {
    if (!supplementTableSheetState.selectedCell) return false;
    return !areSupplementTableCellDraftsEqual(
        supplementTableSheetState.draft,
        supplementTableSheetState.initialDraft
    );
}

function clearSupplementTableCellSelectionVisual() {
    const prevButton = supplementTableSheetState.selectedCell?.buttonEl;
    prevButton?.classList.remove('supplement-dose-cell-btn--selected');
}

function applySupplementTableCellSelectionVisual(button) {
    button?.classList.add('supplement-dose-cell-btn--selected');
}

function removeSupplementTableSheetEditorShell() {
    window.clearTimeout(supplementTableEditorDeferredScrollTimer);
    supplementTableEditorDeferredScrollTimer = null;
    supplementTableSheetViewportAbortController?.abort?.();
    supplementTableSheetViewportAbortController = null;
    const activeWrapper = supplementTableSheetState.selectedCell?.tableWrapper || null;
    if (activeWrapper) {
        setSupplementTableAddWeeksExtraPadding(activeWrapper, 0);
    }
    supplementTableSheetElements?.shell?.remove();
    supplementTableSheetElements = null;
    document.querySelectorAll('.supplement-table-wrapper--editor-locked').forEach((wrapper) => {
        wrapper.classList.remove('supplement-table-wrapper--editor-locked');
    });
    document.documentElement.classList.remove('supplement-table-sheet-editing');
    document.body.classList.remove('supplement-table-sheet-editing');
}

function clearSupplementTableCellSelection({ preserveMenu = false, revertPreview = true } = {}) {
    const selectedCell = supplementTableSheetState.selectedCell;
    if (selectedCell?.buttonEl && revertPreview) {
        updateSupplementDoseCellButton(selectedCell.buttonEl, selectedCell.originalRawDose);
    }
    if (selectedCell?.tableWrapper) {
        setSupplementTableAddWeeksExtraPadding(selectedCell.tableWrapper, 0);
    }
    clearSupplementTableCellSelectionVisual();
    supplementTableSheetState.selectedCell = null;
    supplementTableSheetState.draft = null;
    supplementTableSheetState.initialDraft = null;
    supplementTableSheetState.history = [];
    supplementTableSheetState.historyIndex = -1;
    supplementTableSheetState.formatPanelOpen = false;
    supplementTableSheetState.formatColorPaletteOpen = false;
    supplementTableSheetState.timePanelOpen = false;
    supplementTableSheetState.textInputFocused = false;
    supplementTableSheetState.numericPadMode = false;
    if (!preserveMenu) {
        supplementTableSheetState.menuOpen = false;
    }
    removeSupplementTableSheetEditorShell();
    syncSupplementTableTopBarMenu();
}

function resetSupplementTableSheetSelectionDraftState() {
    if (!supplementTableSheetState.selectedCell) return;
    const nextDraft = cloneSupplementTableCellDraft(supplementTableSheetState.draft);
    supplementTableSheetState.draft = nextDraft;
    supplementTableSheetState.initialDraft = cloneSupplementTableCellDraft(nextDraft);
    supplementTableSheetState.history = [cloneSupplementTableCellDraft(nextDraft)];
    supplementTableSheetState.historyIndex = 0;
}

function pushSupplementTableSheetHistorySnapshot(snapshot) {
    const normalizedSnapshot = cloneSupplementTableCellDraft(snapshot);
    const history = supplementTableSheetState.history || [];
    const currentSnapshot = history[supplementTableSheetState.historyIndex] || null;
    if (currentSnapshot && areSupplementTableCellDraftsEqual(currentSnapshot, normalizedSnapshot)) {
        supplementTableSheetState.draft = normalizedSnapshot;
        return;
    }

    const nextHistory = history.slice(0, supplementTableSheetState.historyIndex + 1);
    nextHistory.push(normalizedSnapshot);
    if (nextHistory.length > 40) {
        nextHistory.shift();
    }

    supplementTableSheetState.history = nextHistory;
    supplementTableSheetState.historyIndex = nextHistory.length - 1;
    supplementTableSheetState.draft = cloneSupplementTableCellDraft(normalizedSnapshot);
}

function restoreSupplementTableSheetHistorySnapshot(nextIndex) {
    const history = supplementTableSheetState.history || [];
    if (nextIndex < 0 || nextIndex >= history.length) return;
    supplementTableSheetState.historyIndex = nextIndex;
    supplementTableSheetState.draft = cloneSupplementTableCellDraft(history[nextIndex]);
    syncSupplementTableEditorShell();
    syncSupplementTableTopBarMenu();
}

function updateSupplementTableSelectedButtonPreview() {
    const selectedCell = supplementTableSheetState.selectedCell;
    if (!selectedCell?.buttonEl) return;
    const previewRawDose = buildSupplementDoseValueFromDraft(
        supplementTableSheetState.draft,
        selectedCell.originalRawDose
    );
    updateSupplementDoseCellButton(selectedCell.buttonEl, previewRawDose);
    applySupplementTableCellSelectionVisual(selectedCell.buttonEl);
}

function commitSupplementTableSheetDraftPatch(patch, options = {}) {
    if (!supplementTableSheetState.selectedCell || !supplementTableSheetState.draft) return;
    const nextDraft = cloneSupplementTableCellDraft({
        ...supplementTableSheetState.draft,
        ...patch,
        style: {
            ...supplementTableSheetState.draft.style,
            ...(patch?.style || {})
        }
    });
    pushSupplementTableSheetHistorySnapshot(nextDraft);
    updateSupplementTableSelectedButtonPreview();
    if (!options?.skipShellSync) {
        syncSupplementTableEditorShell();
    }
    syncSupplementTableTopBarMenu();
}

function normalizeSupplementTableDraftTimes(value) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) return [];
    return values.map((item) => normalizeSupplementTimeValue(item));
}

function collectSupplementTableEditorTimes(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('.supplement-sheet-editor__time-input')).map((node) => node.value);
}

function appendSupplementTableEditorTimeRow(container, value = '') {
    if (!container) return;
    const row = createElement('div', 'supplement-sheet-editor__time-row');
    const field = createElement('div', 'supplement-sheet-editor__time-field');
    const icon = createElement('span', 'supplement-sheet-editor__time-icon');
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.75a10.25 10.25 0 1 0 10.25 10.25A10.26 10.26 0 0 0 12 1.75m0 18.5A8.25 8.25 0 1 1 20.25 12A8.26 8.26 0 0 1 12 20.25m.75-12.5a1 1 0 0 0-2 0v4.67a1 1 0 0 0 .38.78l3.25 2.58a1 1 0 1 0 1.24-1.56l-2.87-2.28Z"/></svg>`;
    const meta = createElement('div', 'supplement-sheet-editor__time-meta');
    const label = createElement(
        'span',
        'supplement-sheet-editor__time-label',
        `Прием ${container.querySelectorAll('.supplement-sheet-editor__time-row').length + 1}`
    );
    const input = createElement('input', 'supplement-sheet-editor__time-input');
    input.type = 'time';
    input.step = '60';
    input.autocomplete = 'off';
    input.value = normalizeSupplementTimeValue(value);
    input.addEventListener('input', () => {
        commitSupplementTableSheetDraftPatch(
            { times: collectSupplementTableEditorTimes(container) },
            { skipShellSync: true }
        );
    });

    const removeBtn = createElement('button', 'supplement-sheet-editor__time-remove', '×');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', 'Удалить время приема');
    removeBtn.addEventListener('click', () => {
        const rows = container.querySelectorAll('.supplement-sheet-editor__time-row');
        if (rows.length <= 1) {
            input.value = '';
            commitSupplementTableSheetDraftPatch({ times: [] });
            requestAnimationFrame(() => input.focus());
            return;
        }

        row.remove();
        commitSupplementTableSheetDraftPatch({ times: collectSupplementTableEditorTimes(container) });
        syncSupplementTableEditorShell();
    });

    meta.append(label, input);
    field.append(icon, meta);
    row.append(field, removeBtn);
    container.append(row);
}

function toggleSupplementTableFormatPanel(forceValue = null) {
    const nextValue =
        typeof forceValue === 'boolean'
            ? forceValue
            : !supplementTableSheetState.formatPanelOpen;
    supplementTableSheetState.formatPanelOpen = nextValue;
    if (!nextValue) {
        supplementTableSheetState.formatColorPaletteOpen = false;
    }
    if (nextValue) {
        supplementTableSheetState.timePanelOpen = false;
        supplementTableSheetState.textInputFocused = false;
        supplementTableSheetElements?.textInput?.blur?.();
    }
    syncSupplementTableEditorShell();
}

function toggleSupplementTableTimePanel(forceValue = null) {
    const nextValue =
        typeof forceValue === 'boolean'
            ? forceValue
            : !supplementTableSheetState.timePanelOpen;
    supplementTableSheetState.timePanelOpen = nextValue;
    if (nextValue) {
        supplementTableSheetState.formatPanelOpen = false;
        supplementTableSheetState.formatColorPaletteOpen = false;
        supplementTableSheetState.textInputFocused = false;
        supplementTableSheetElements?.textInput?.blur?.();
    }
    syncSupplementTableEditorShell();
}

function insertSupplementTableEditorSymbol(symbol) {
    const input = supplementTableSheetElements?.textInput;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextValue = `${input.value.slice(0, start)}${symbol}${input.value.slice(end)}`;
    input.value = nextValue;
    const cursor = start + symbol.length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
    commitSupplementTableSheetDraftPatch({ text: nextValue });
}

function addSupplementTableEditorTimeRow(container, value = '') {
    if (!container) return;
    const row = createElement('div', 'supplement-sheet-editor__time-row');
    const input = createElement('input', 'supplement-sheet-editor__time-input');
    input.type = 'time';
    input.value = normalizeSupplementTimeValue(value);
    input.addEventListener('input', () => {
        const values = Array.from(container.querySelectorAll('.supplement-sheet-editor__time-input')).map((node) => node.value);
        commitSupplementTableSheetDraftPatch({ times: values });
    });

    const removeBtn = createElement('button', 'supplement-sheet-editor__time-remove', '×');
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', () => {
        row.remove();
        const values = Array.from(container.querySelectorAll('.supplement-sheet-editor__time-input')).map((node) => node.value);
        commitSupplementTableSheetDraftPatch({ times: values });
        syncSupplementTableEditorShell();
    });

    row.append(input, removeBtn);
    container.append(row);
}

function syncSupplementTableEditorViewportOffset() {
    const shell = supplementTableSheetElements?.shell;
    if (!shell?.isConnected) return;

    const dockOffset = getSupplementTableEditorDockOffset();
    shell.style.setProperty('--supplement-editor-bottom-offset', `${dockOffset}px`);
    shell.style.bottom = `${dockOffset}px`;
}

function getSupplementTableKeyboardHeight() {
    if (!document.body?.classList.contains('app-keyboard-visible')) return 0;
    const cssHeight = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height') || '0'
    );
    return Math.max(0, Math.round(Number.isFinite(cssHeight) ? cssHeight : 0));
}

function isSupplementTableEditorInputFocused() {
    const shell = supplementTableSheetElements?.shell;
    const active = document.activeElement;
    if (!shell?.isConnected || !active || active === document.body || active === document.documentElement) {
        return false;
    }
    if (!shell.contains(active)) return false;
    return Boolean(active.matches?.('input:not([type="hidden"]), textarea, select, [contenteditable="true"]'));
}

function getSupplementTableEditorKeyboardOffset() {
    if (!isSupplementTableEditorInputFocused()) return 0;
    return getSupplementTableKeyboardHeight();
}

function getSupplementTableBottomNavOffset() {
    const nav = document.querySelector('.navigation');
    if (!nav) return 0;

    const navRect = nav.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewportHeight || !navRect.height || navRect.top >= viewportHeight) return 0;

    return Math.max(0, Math.round(viewportHeight - navRect.top));
}

function getSupplementTableEditorDockOffset() {
    const keyboardOffset = getSupplementTableEditorKeyboardOffset();
    if (keyboardOffset > 0) return keyboardOffset;
    return getSupplementTableBottomNavOffset();
}

function getSupplementTableAddWeeksSection(wrapper) {
    return wrapper?.querySelector?.('.supplement-table-add-weeks') || null;
}

function getSupplementTableAddWeeksExtraPadding(wrapper) {
    const section = getSupplementTableAddWeeksSection(wrapper);
    if (!section) return 0;
    const raw = parseFloat(section.style.getPropertyValue('--supplement-editor-extra-space') || '0');
    return Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0));
}

function setSupplementTableAddWeeksExtraPadding(wrapper, paddingPx = 0) {
    const section = getSupplementTableAddWeeksSection(wrapper);
    if (!section) return;
    const nextPadding = Math.max(0, Math.round(Number(paddingPx) || 0));
    section.style.setProperty('--supplement-editor-extra-space', `${nextPadding}px`);
}

function scrollSupplementTableSelectedCellIntoView() {
    const selectedCell = supplementTableSheetState.selectedCell;
    const shell = supplementTableSheetElements?.shell;
    if (!selectedCell?.buttonEl || !shell) return;

    const wrapper = selectedCell.tableWrapper;
    if (!wrapper?.isConnected) return;

    const keyboardOffset = getSupplementTableEditorKeyboardOffset();
    if (!keyboardOffset && getSupplementTableAddWeeksExtraPadding(wrapper) > 0) {
        setSupplementTableAddWeeksExtraPadding(wrapper, 0);
    }

    const buttonRect = selectedCell.buttonEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const headerHeight = wrapper.querySelector('thead')?.getBoundingClientRect().height || 0;
    const topLimit = wrapperRect.top + headerHeight + 8;
    const bottomLimit = Math.min(wrapperRect.bottom, shellRect.top) - 12;

    if (buttonRect.bottom > bottomLimit) {
        const overflowBottom = Math.max(0, Math.ceil(buttonRect.bottom - bottomLimit));
        const currentExtraPadding = getSupplementTableAddWeeksExtraPadding(wrapper);
        const naturalMaxScrollTop = Math.max(
            0,
            Math.round((wrapper.scrollHeight - currentExtraPadding) - wrapper.clientHeight)
        );
        const naturalAvailableDown = Math.max(0, naturalMaxScrollTop - wrapper.scrollTop);
        const desiredExtraPadding = keyboardOffset
            ? Math.max(0, overflowBottom - naturalAvailableDown)
            : 0;

        if (desiredExtraPadding !== currentExtraPadding) {
            setSupplementTableAddWeeksExtraPadding(wrapper, desiredExtraPadding);
            requestAnimationFrame(scrollSupplementTableSelectedCellIntoView);
            return;
        }

        const maxScrollTop = Math.max(0, Math.round(wrapper.scrollHeight - wrapper.clientHeight));
        wrapper.scrollTop = Math.min(maxScrollTop, wrapper.scrollTop + overflowBottom);
    } else if (buttonRect.top < topLimit) {
        wrapper.scrollTop = Math.max(0, wrapper.scrollTop - Math.ceil(topLimit - buttonRect.top));
    }
}

function syncSupplementTableInteractionLock() {
    const activeWrapper = supplementTableSheetState.selectedCell?.tableWrapper || null;
    const shouldLock = Boolean(
        activeWrapper &&
        (supplementTableSheetState.formatPanelOpen ||
            supplementTableSheetState.timePanelOpen)
    );

    document.querySelectorAll('.supplement-table-wrapper--editor-locked').forEach((wrapper) => {
        if (wrapper !== activeWrapper || !shouldLock) {
            wrapper.classList.remove('supplement-table-wrapper--editor-locked');
        }
    });

    if (activeWrapper) {
        activeWrapper.classList.toggle('supplement-table-wrapper--editor-locked', shouldLock);
    }
}

function ensureSupplementTableSheetEditorShell() {
    if (supplementTableSheetElements?.shell?.isConnected) {
        return supplementTableSheetElements;
    }

    const shell = createElement('div', 'supplement-sheet-editor');
    const formulaRow = createElement('div', 'supplement-sheet-editor__formula');
    const formulaIcon = createElement('button', 'supplement-sheet-editor__formula-icon');
    formulaIcon.type = 'button';
    formulaIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 17 12" aria-hidden="true"><g><path fill="none" fill-rule="evenodd" d="M6.5,12.39 L6.5,12.39 L6.44,12.4 L6.43,12.4 L6.43,12.4 L6.38,12.39 C6.38,12.37 6.38,12.39 6.37,12.39 L6.37,12.39 L6.36,12.64 L6.37,12.65 L6.37,12.65 L6.43,12.7 L6.44,12.7 L6.44,12.7 L6.51,12.65 L6.51,12.65 L6.52,12.64 L6.51,12.39 C6.51,12.39 6.5,12.39 6.5,12.39 M6.65,12.31 L6.65,12.31 L6.53,12.37 L6.53,12.37 L6.53,12.39 L6.53,12.62 L6.54,12.64 L6.54,12.64 L6.66,12.69 C6.68,12.7 6.68,12.7 6.69,12.69 L6.69,12.68 L6.66,12.32 C6.66,12.32 6.66,12.31 6.65,12.31 M6.23,12.31 C6.23,12.31 6.22,12.31 6.22,12.32 L6.22,12.32 L6.19,12.68 C6.19,12.69 6.2,12.69 6.2,12.7 L6.22,12.69 L6.34,12.64 L6.35,12.64 L6.35,12.62 L6.35,12.39 L6.35,12.37 L6.35,12.37 Z"></path></g><g><path fill="none" fill-rule="evenodd" d="M6.44,12.09 L6.44,12.09 L6.39,12.1 L6.38,12.1 L6.38,12.1 L6.34,12.09 C6.34,12.08 6.34,12.09 6.31,12.09 L6.31,12.09 L6.3,12.34 L6.31,12.36 L6.31,12.36 L6.38,12.4 L6.39,12.4 L6.39,12.4 L6.46,12.36 L6.46,12.36 L6.47,12.34 L6.46,12.09 C6.46,12.09 6.44,12.09 6.44,12.09 M6.6,12.02 L6.6,12.02 L6.48,12.08 L6.48,12.08 L6.48,12.09 L6.48,12.32 L6.49,12.34 L6.49,12.34 L6.61,12.39 C6.63,12.4 6.63,12.4 6.63,12.39 L6.63,12.38 L6.61,12.03 C6.61,12.03 6.61,12.02 6.6,12.02 M6.18,12.02 C6.18,12.02 6.17,12.02 6.17,12.03 L6.17,12.03 L6.15,12.38 C6.15,12.39 6.16,12.39 6.16,12.4 L6.17,12.39 L6.29,12.34 L6.29,12.34 L6.29,12.32 L6.29,12.09 L6.29,12.08 L6.29,12.08 Z"></path><g><path fill="none" fill-rule="evenodd" d="M6.35,12.48 L6.35,12.48 L6.29,12.51 L6.28,12.51 L6.28,12.51 L6.24,12.48 C6.24,12.47 6.24,12.48 6.23,12.48 L6.23,12.48 L6.22,12.74 L6.23,12.75 L6.23,12.75 L6.28,12.8 L6.29,12.8 L6.29,12.8 L6.36,12.75 L6.36,12.75 L6.37,12.74 L6.36,12.48 C6.36,12.48 6.35,12.48 6.35,12.48 M6.51,12.41 L6.51,12.41 L6.38,12.47 L6.38,12.47 L6.38,12.48 L6.38,12.73 L6.39,12.74 L6.39,12.74 L6.52,12.79 C6.54,12.8 6.54,12.8 6.55,12.79 L6.55,12.78 L6.52,12.43 C6.52,12.43 6.52,12.41 6.51,12.41 M6.08,12.41 C6.08,12.41 6.06,12.41 6.06,12.43 L6.06,12.43 L6.04,12.78 C6.04,12.79 6.05,12.79 6.05,12.8 L6.06,12.79 L6.18,12.74 L6.2,12.74 L6.2,12.73 L6.2,12.48 L6.2,12.47 L6.2,12.47 Z"></path></g></g><g><path fill="none" fill-rule="evenodd" d="M5.3,10.73 L5.3,10.73 L5.26,10.75 L5.26,10.75 L5.25,10.75 L5.21,10.73 C5.21,10.73 5.21,10.73 5.2,10.74 L5.2,10.74 L5.19,10.95 L5.2,10.96 L5.2,10.96 L5.25,11 L5.26,11 L5.26,11 L5.31,10.96 L5.32,10.95 L5.32,10.95 L5.31,10.74 C5.31,10.74 5.31,10.73 5.3,10.73 M5.43,10.68 L5.42,10.68 L5.34,10.72 L5.33,10.73 L5.33,10.73 L5.34,10.94 L5.34,10.95 L5.35,10.95 L5.44,10.99 C5.45,11 5.45,11 5.46,10.99 L5.46,10.98 L5.44,10.69 C5.44,10.68 5.44,10.68 5.43,10.68 M5.09,10.68 C5.08,10.68 5.08,10.68 5.08,10.68 L5.07,10.69 L5.06,10.98 C5.06,10.99 5.06,10.99 5.06,11 L5.07,10.99 L5.17,10.95 L5.17,10.95 L5.17,10.94 L5.18,10.73 L5.18,10.73 L5.18,10.72 Z"></path><path fill="currentColor" fill-rule="evenodd" d="M11.31,9.45 C11.56,9.2 11.99,9.19 12.26,9.41 C12.53,9.65 12.56,10.04 12.35,10.33 L12.28,10.4 L11.25,11.39 C10.4,12.2 9.04,12.2 8.19,11.39 C7.92,11.11 7.47,11.1 7.18,11.32 L7.1,11.39 L6.75,11.74 C6.49,11.98 6.08,11.98 5.81,11.76 C5.53,11.52 5.47,11.11 5.72,10.84 L5.78,10.79 L6.12,10.46 C6.95,9.64 8.31,9.64 9.17,10.46 C9.44,10.72 9.89,10.74 10.21,10.5 L10.26,10.46 Z M10.04,.58 C10.72,-.05 11.78,-.06 12.46,.55 C13.12,1.16 13.19,2.19 12.58,2.86 L12.49,2.94 L4.49,10.65 C4.39,10.74 4.27,10.83 4.14,10.86 L4.04,10.92 L2.07,11.44 C1.84,11.51 1.59,11.46 1.42,11.3 C1.26,11.14 1.18,10.92 1.21,10.69 L1.22,10.61 L1.78,8.73 C1.82,8.59 1.89,8.47 1.98,8.37 L2.04,8.29 Z M11.68,1.19 C11.56,1.08 11.23,1.1 11.1,1.19 L10.67,1.46 L2.89,8.93 L2.31,10.33 L3.76,9.91 L11.82,2.15 C11.96,2.03 11.96,1.86 11.96,1.46"></path></g></svg>`;
    formulaIcon.addEventListener('click', () => {
        textInput.focus();
    });

    const textInput = createElement('textarea', 'supplement-sheet-editor__input');
    textInput.rows = 1;
    textInput.placeholder = 'Введите текст или дозировку';
    textInput.addEventListener('input', () => {
        commitSupplementTableSheetDraftPatch({ text: textInput.value });
    });
    textInput.addEventListener('focus', () => {
        supplementTableSheetState.formatPanelOpen = false;
        supplementTableSheetState.formatColorPaletteOpen = false;
        supplementTableSheetState.timePanelOpen = false;
        supplementTableSheetState.textInputFocused = true;
        syncSupplementTableEditorViewportOffset();
        syncSupplementTableEditorShell();
        requestAnimationFrame(scrollSupplementTableSelectedCellIntoView);
    });
    textInput.addEventListener('blur', () => {
        supplementTableSheetState.textInputFocused = false;
        window.setTimeout(() => {
            syncSupplementTableEditorViewportOffset();
            syncSupplementTableEditorShell();
        }, 32);
    });

    const blurBtn = createElement('button', 'supplement-sheet-editor__formula-commit');
    blurBtn.type = 'button';
    blurBtn.innerHTML = '✓';
    blurBtn.addEventListener('click', async () => {
        if (isSupplementTableSheetDraftDirty()) {
            supplementTableSheetState.textInputFocused = false;
            supplementTableSheetState.formatPanelOpen = false;
            supplementTableSheetState.formatColorPaletteOpen = false;
            supplementTableSheetState.timePanelOpen = false;
            textInput.blur();
            await saveSupplementTableSheetSelection({ preserveSelection: true });
            return;
        }
        supplementTableSheetState.textInputFocused = false;
        textInput.blur();
        syncSupplementTableEditorShell();
    });

    formulaRow.append(textInput, formulaIcon, blurBtn);

    const toolbar = createElement('div', 'supplement-sheet-editor__toolbar');
    const colorBtn = createElement('button', 'supplement-sheet-editor__tool-btn supplement-sheet-editor__tool-btn--color', 'A');
    colorBtn.type = 'button';
    colorBtn.addEventListener('click', () => toggleSupplementTableFormatPanel());

    const alignLeftBtn = createElement('button', 'supplement-sheet-editor__tool-btn', '≡');
    alignLeftBtn.type = 'button';
    alignLeftBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { align: 'left' } });
    });

    const alignCenterBtn = createElement('button', 'supplement-sheet-editor__tool-btn', '≣');
    alignCenterBtn.type = 'button';
    alignCenterBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { align: 'center' } });
    });

    const fillBtn = createElement('button', 'supplement-sheet-editor__tool-btn supplement-sheet-editor__tool-btn--fill');
    fillBtn.type = 'button';
    fillBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Fill SVG Icon</title><path fill="currentColor" d="M19 11H5v9h14zm0-7v5H5V4zm2-2H3v20h18z"/></svg>`;
    fillBtn.addEventListener('click', () => toggleSupplementTableFormatPanel(true));

    const timeBtn = createElement('button', 'supplement-sheet-editor__tool-btn supplement-sheet-editor__tool-btn--time');
    timeBtn.type = 'button';
    timeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"></path><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"></path><path fill="currentColor" d="M22 5h-2V3c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1V7h2c.55 0 1-.45 1-1s-.45-1-1-1"></path></svg>`;
    timeBtn.addEventListener('click', () => toggleSupplementTableTimePanel());

    toolbar.append(colorBtn, timeBtn);

    const formatPanel = createElement('div', 'supplement-sheet-editor__format-panel');
    const formatTabs = createElement('div', 'supplement-sheet-editor__format-tabs');
    const formatTab = createElement('button', 'supplement-sheet-editor__format-tab is-active', 'Текст');
    formatTab.type = 'button';
    const formatTabCell = createElement('button', 'supplement-sheet-editor__format-tab supplement-sheet-editor__format-tab--ghost', 'РЇС‡РµР№РєР°');
    formatTabCell.type = 'button';
    formatTabCell.disabled = true;
    formatTabs.append(formatTab, formatTabCell);
    formatTab.textContent = 'Текст';
    formatTabCell.textContent = 'Ячейка';

    const textStyleRow = createElement('div', 'supplement-sheet-editor__text-style-row');
    const formatContent = createElement('div', 'supplement-sheet-editor__format-content');
    const formatQuickRow = createElement('div', 'supplement-sheet-editor__format-quick-row');
    const formatBoldBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', 'B');
    formatBoldBtn.type = 'button';
    formatBoldBtn.addEventListener('click', () => {
        const nextBold = !Boolean(supplementTableSheetState.draft?.style?.bold);
        commitSupplementTableSheetDraftPatch({ style: { bold: nextBold } });
    });
    formatBoldBtn.className = 'supplement-sheet-editor__text-style-btn';
    const formatItalicBtn = createElement('button', 'supplement-sheet-editor__text-style-btn', 'I');
    formatItalicBtn.type = 'button';
    formatItalicBtn.addEventListener('click', () => {
        const nextItalic = !Boolean(supplementTableSheetState.draft?.style?.italic);
        commitSupplementTableSheetDraftPatch({ style: { italic: nextItalic } });
    });
    const formatUnderlineBtn = createElement('button', 'supplement-sheet-editor__text-style-btn', 'U');
    formatUnderlineBtn.type = 'button';
    formatUnderlineBtn.addEventListener('click', () => {
        const nextUnderline = !Boolean(supplementTableSheetState.draft?.style?.underline);
        commitSupplementTableSheetDraftPatch({ style: { underline: nextUnderline } });
    });
    const formatStrikeBtn = createElement('button', 'supplement-sheet-editor__text-style-btn', 'S');
    formatStrikeBtn.type = 'button';
    formatStrikeBtn.addEventListener('click', () => {
        const nextStrike = !Boolean(supplementTableSheetState.draft?.style?.strike);
        commitSupplementTableSheetDraftPatch({ style: { strike: nextStrike } });
    });
    textStyleRow.append(formatBoldBtn, formatItalicBtn, formatUnderlineBtn, formatStrikeBtn);
    const formatAlignLeftBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', 'в‰Ў');
    formatAlignLeftBtn.type = 'button';
    formatAlignLeftBtn.textContent = '≡';
    formatAlignLeftBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { align: 'left' } });
    });
    const formatAlignCenterBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', 'в‰Ј');
    formatAlignCenterBtn.type = 'button';
    formatAlignCenterBtn.textContent = '≣';
    formatAlignCenterBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { align: 'center' } });
    });
    const formatAlignRightBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', '☰');
    formatAlignRightBtn.type = 'button';
    formatAlignRightBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { align: 'right' } });
    });
    const formatVerticalTopBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', '↥');
    formatVerticalTopBtn.type = 'button';
    formatVerticalTopBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { verticalAlign: 'top' } });
    });
    const formatVerticalMiddleBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', '↕');
    formatVerticalMiddleBtn.type = 'button';
    formatVerticalMiddleBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { verticalAlign: 'middle' } });
    });
    const formatVerticalBottomBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn', '↧');
    formatVerticalBottomBtn.type = 'button';
    formatVerticalBottomBtn.addEventListener('click', () => {
        commitSupplementTableSheetDraftPatch({ style: { verticalAlign: 'bottom' } });
    });
    const formatFillBtn = createElement('button', 'supplement-sheet-editor__format-quick-btn supplement-sheet-editor__format-quick-btn--fill');
    formatFillBtn.type = 'button';
    formatFillBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Fill SVG Icon</title><path fill="currentColor" d="M19 11H5v9h14zm0-7v5H5V4zm2-2H3v20h18z"/></svg>`;
    formatFillBtn.addEventListener('click', () => {
        const currentIndex = Math.max(0, SUPPLEMENT_SHEET_FILL_COLORS.indexOf(supplementTableSheetState.draft?.style?.background || ''));
        const nextColor = SUPPLEMENT_SHEET_FILL_COLORS[(currentIndex + 1) % SUPPLEMENT_SHEET_FILL_COLORS.length];
        commitSupplementTableSheetDraftPatch({ style: { background: nextColor } });
    });
    formatFillBtn.style.display = 'none';
    formatQuickRow.append(
        formatAlignLeftBtn,
        formatAlignCenterBtn,
        formatAlignRightBtn,
        formatVerticalTopBtn,
        formatVerticalMiddleBtn,
        formatVerticalBottomBtn
    );
    const textColorRow = createElement('div', 'supplement-sheet-editor__palette-row');
    textColorRow.append(createElement('span', 'supplement-sheet-editor__palette-label', 'Цвет текста'));
    const textColorPalette = createElement('div', 'supplement-sheet-editor__palette');
    SUPPLEMENT_SHEET_TEXT_COLORS.forEach((color) => {
        const swatch = createElement('button', 'supplement-sheet-editor__swatch');
        swatch.type = 'button';
        swatch.style.setProperty('--supplement-swatch-color', color);
        swatch.addEventListener('click', () => {
            commitSupplementTableSheetDraftPatch({ style: { color } });
        });
        textColorPalette.append(swatch);
    });
    textColorRow.append(textColorPalette);
    textColorRow.querySelector('.supplement-sheet-editor__palette-label')?.remove();

    const fillColorRow = createElement('div', 'supplement-sheet-editor__palette-row');
    fillColorRow.append(createElement('span', 'supplement-sheet-editor__palette-label', 'Заливка'));
    const fillColorPalette = createElement('div', 'supplement-sheet-editor__palette');
    SUPPLEMENT_SHEET_FILL_COLORS.forEach((color) => {
        const swatch = createElement('button', 'supplement-sheet-editor__swatch');
        swatch.type = 'button';
        swatch.style.setProperty('--supplement-swatch-color', color || '#ffffff');
        if (!color) swatch.classList.add('supplement-sheet-editor__swatch--empty');
        swatch.addEventListener('click', () => {
            commitSupplementTableSheetDraftPatch({ style: { background: color } });
        });
        fillColorPalette.append(swatch);
    });
    fillColorRow.append(fillColorPalette);

    textColorRow.classList.add('supplement-sheet-editor__palette-row--collapsible');
    fillColorRow.style.display = 'none';

    const sizeRow = createElement('div', 'supplement-sheet-editor__setting-row supplement-sheet-editor__setting-row--size');
    const sizeLabel = createElement('span', 'supplement-sheet-editor__setting-label', 'Размер');
    const sizeValueWrap = createElement('span', 'supplement-sheet-editor__setting-value-wrap');
    const sizeDown = createElement('button', 'supplement-sheet-editor__step-btn', '−');
    sizeDown.type = 'button';
    const sizeValue = createElement('span', 'supplement-sheet-editor__setting-value', '10 пт');
    const sizeUp = createElement('button', 'supplement-sheet-editor__step-btn', '+');
    sizeUp.type = 'button';
    sizeValueWrap.append(sizeDown, sizeValue, sizeUp);
    sizeRow.append(sizeLabel, sizeValueWrap);
    const applyFontSizeDelta = (delta) => {
        const current = Number(supplementTableSheetState.draft?.style?.fontSize || 10);
        const next = Math.min(24, Math.max(8, current + delta));
        if (next === current) return;
        commitSupplementTableSheetDraftPatch({ style: { fontSize: next } });
    };
    sizeDown.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyFontSizeDelta(-1);
    });
    sizeUp.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyFontSizeDelta(1);
    });

    const textColorSettingRow = createElement('button', 'supplement-sheet-editor__setting-row');
    textColorSettingRow.type = 'button';
    const textColorLabel = createElement('span', 'supplement-sheet-editor__setting-label', 'Цвет текста');
    const textColorValueWrap = createElement('span', 'supplement-sheet-editor__setting-value-wrap');
    const textColorPreview = createElement('span', 'supplement-sheet-editor__color-preview');
    const textColorChevron = createElement('span', 'supplement-sheet-editor__setting-chevron', '›');
    textColorValueWrap.append(textColorPreview, textColorChevron);
    textColorSettingRow.append(textColorLabel, textColorValueWrap);
    textColorSettingRow.addEventListener('click', () => {
        supplementTableSheetState.formatColorPaletteOpen = !supplementTableSheetState.formatColorPaletteOpen;
        syncSupplementTableEditorShell();
    });

    formatContent.append(formatTabs, textStyleRow, formatQuickRow, sizeRow, textColorSettingRow, textColorRow);
    formatPanel.append(formatContent);

    const timesPanel = createElement('div', 'supplement-sheet-editor__times');
    const timesHeader = createElement('div', 'supplement-sheet-editor__times-header');
    timesHeader.append(
        createElement('span', 'supplement-sheet-editor__times-title', 'Время приема'),
        createElement('button', 'supplement-sheet-editor__times-add', '+ прием')
    );
    const timesList = createElement('div', 'supplement-sheet-editor__times-list');
    timesHeader.querySelector('.supplement-sheet-editor__times-add')?.addEventListener('click', () => {
        appendSupplementTableEditorTimeRow(timesList, '');
        commitSupplementTableSheetDraftPatch({ times: collectSupplementTableEditorTimes(timesList) });
        requestAnimationFrame(() => timesList.querySelector('.supplement-sheet-editor__time-input:last-child')?.focus());
    });
    timesPanel.append(timesHeader, timesList);

    const initialDockOffset = getSupplementTableEditorDockOffset();
    shell.style.setProperty('--supplement-editor-bottom-offset', `${initialDockOffset}px`);
    shell.style.bottom = `${initialDockOffset}px`;

    shell.append(formatPanel, timesPanel, formulaRow);
    document.body.append(shell);

    supplementTableSheetViewportAbortController?.abort?.();
    supplementTableSheetViewportAbortController = new AbortController();
    const syncViewport = () => {
        syncSupplementTableEditorViewportOffset();
        scrollSupplementTableSelectedCellIntoView();
    };
    const handleDismissPointerDown = (event) => {
        if (!supplementTableSheetState.selectedCell || !isSupplementTableSheetDraftDirty()) return;
        const target = event.target;
        if (!target) return;
        if (shell.contains(target)) return;
        if (document.querySelector('.top-bar.top-bar--supplements-table')?.contains?.(target)) return;

        const currentTableWrapper = supplementTableSheetState.selectedCell?.tableWrapper || null;
        const blockedCellTarget = target.closest?.('.supplement-dose-cell-btn');
        if (currentTableWrapper?.contains?.(target) && !blockedCellTarget) {
            return;
        }

        if (blockedCellTarget) {
            event.preventDefault();
            event.stopPropagation();
            showToast('Сохраните данные');
            suppressNextSupplementTableDoseCellClick(blockedCellTarget.closest('.supplement-table-wrapper'));
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        showToast('Сохраните данные');
    };
    window.addEventListener('resize', syncViewport, { signal: supplementTableSheetViewportAbortController.signal });
    window.addEventListener('orientationchange', syncViewport, { signal: supplementTableSheetViewportAbortController.signal });
    window.addEventListener('app-keyboardviewportchange', syncViewport, {
        signal: supplementTableSheetViewportAbortController.signal
    });
    document.addEventListener('pointerdown', handleDismissPointerDown, {
        signal: supplementTableSheetViewportAbortController.signal,
        capture: true
    });

    supplementTableSheetElements = {
        shell,
        formulaIcon,
        textInput,
        blurBtn,
        formatPanel,
        textStyleRow,
        formatQuickRow,
        formatBoldBtn,
        formatItalicBtn,
        formatUnderlineBtn,
        formatStrikeBtn,
        formatAlignLeftBtn,
        formatAlignCenterBtn,
        formatAlignRightBtn,
        formatVerticalTopBtn,
        formatVerticalMiddleBtn,
        formatVerticalBottomBtn,
        formatFillBtn,
        sizeRow,
        sizeValue,
        textColorSettingRow,
        textColorRow,
        textColorPreview,
        timesPanel,
        timesList,
        textColorPalette,
        fillColorPalette
    };

    return supplementTableSheetElements;
}

function syncSupplementTableEditorShell() {
    if (!supplementTableSheetState.selectedCell) {
        removeSupplementTableSheetEditorShell();
        syncSupplementTableTopBarMenu();
        return;
    }

    const refs = ensureSupplementTableSheetEditorShell();
    syncSupplementTableTopBarMenu();
    const draft = cloneSupplementTableCellDraft(supplementTableSheetState.draft);
    const style = cloneSupplementDoseStyle(draft.style);

    document.documentElement.classList.add('supplement-table-sheet-editing');
    document.body.classList.add('supplement-table-sheet-editing');
    refs.shell.classList.toggle('supplement-sheet-editor--format-open', supplementTableSheetState.formatPanelOpen);
    refs.shell.classList.toggle('supplement-sheet-editor--times-open', supplementTableSheetState.timePanelOpen);
    syncSupplementTableInteractionLock();

    refs.textInput.value = draft.text;
    refs.textInput.inputMode = 'text';
    const draftDirty = isSupplementTableSheetDraftDirty();
    refs.formulaIcon.classList.toggle('is-hidden', supplementTableSheetState.textInputFocused);
    refs.blurBtn.classList.toggle('is-visible', supplementTableSheetState.textInputFocused);
    refs.blurBtn.classList.toggle('is-ready', supplementTableSheetState.textInputFocused && draftDirty);
    refs.formatBoldBtn.classList.toggle('is-active', style.bold);
    refs.formatItalicBtn.classList.toggle('is-active', style.italic);
    refs.formatUnderlineBtn.classList.toggle('is-active', style.underline);
    refs.formatStrikeBtn.classList.toggle('is-active', style.strike);
    refs.formatAlignLeftBtn.classList.toggle('is-active', style.align === 'left');
    refs.formatAlignCenterBtn.classList.toggle('is-active', style.align === 'center');
    refs.formatAlignRightBtn.classList.toggle('is-active', style.align === 'right');
    refs.formatVerticalTopBtn.classList.toggle('is-active', style.verticalAlign === 'top');
    refs.formatVerticalMiddleBtn.classList.toggle('is-active', style.verticalAlign === 'middle');
    refs.formatVerticalBottomBtn.classList.toggle('is-active', style.verticalAlign === 'bottom');
    refs.formatFillBtn.style.setProperty('--supplement-editor-fill', style.background || 'transparent');
    refs.sizeValue.textContent = `${style.fontSize || 10} пт`;
    refs.textColorPreview.style.setProperty('--supplement-swatch-color', style.color || '#111827');
    refs.formatPanel.classList.toggle('is-open', supplementTableSheetState.formatPanelOpen);
    refs.timesPanel.classList.toggle('is-open', supplementTableSheetState.timePanelOpen);
    refs.textColorRow.classList.toggle('is-open', supplementTableSheetState.formatColorPaletteOpen);

    refs.textColorPalette.querySelectorAll('.supplement-sheet-editor__swatch').forEach((swatch, index) => {
        swatch.classList.toggle('is-active', SUPPLEMENT_SHEET_TEXT_COLORS[index] === style.color);
    });
    refs.fillColorPalette.querySelectorAll('.supplement-sheet-editor__swatch').forEach((swatch, index) => {
        swatch.classList.toggle('is-active', SUPPLEMENT_SHEET_FILL_COLORS[index] === style.background);
    });

    refs.timesList.replaceChildren();
    const timeValues = draft.times.length > 0 ? draft.times : [''];
    timeValues.forEach((timeValue) => appendSupplementTableEditorTimeRow(refs.timesList, timeValue));

    syncSupplementTableEditorViewportOffset();
    requestAnimationFrame(scrollSupplementTableSelectedCellIntoView);
    window.clearTimeout(supplementTableEditorDeferredScrollTimer);
    supplementTableEditorDeferredScrollTimer = window.setTimeout(scrollSupplementTableSelectedCellIntoView, 220);
}

function syncSupplementTableTopBarMenu() {
    const topBar = document.querySelector('.top-bar.top-bar--supplements-table');
    const leftGroup = topBar?.querySelector('.topbar-cycle-btns');
    if (!topBar || !leftGroup) return;

    const calendarBtn = leftGroup.querySelector('.supplements-topbar-calendar-btn');
    const addBtn = leftGroup.querySelector('.supplements-topbar-add-btn');
    let menu = leftGroup.querySelector('.supplements-topbar-inline-menu');
    if (!menu) {
        menu = createElement('div', 'supplements-topbar-inline-menu');
        calendarBtn?.insertAdjacentElement('beforebegin', menu);
    }

    const selectionActive = isSupplementTableSheetSelectionActive();
    const historyVisible = hasSupplementPlanHistoryChanges();
    const editorTopBarVisible = selectionActive && !supplementTableSheetState.textInputFocused;
    const historyActionsVisible = historyVisible && !selectionActive;
    const menuVisible = historyActionsVisible || editorTopBarVisible;

    topBar.classList.toggle(
        'supplements-topbar--editor-hidden',
        Boolean(selectionActive && supplementTableSheetState.textInputFocused)
    );

    if (calendarBtn) {
        calendarBtn.style.display = selectionActive ? 'none' : '';
        calendarBtn.classList.toggle('supplements-topbar-calendar-btn--history-visible', historyActionsVisible);
    }
    if (addBtn) {
        addBtn.style.display = selectionActive ? 'none' : '';
    }

    menu.replaceChildren();
    menu.classList.toggle('is-open', menuVisible);
    menu.classList.toggle('supplements-topbar-inline-menu--history-visible', historyActionsVisible);
    menu.classList.toggle('supplements-topbar-inline-menu--editor-visible', editorTopBarVisible);
    if (!menuVisible) return;

    const createIconBtn = (className, label, html, onClick, disabled = false) => {
        const btn = createElement('button', `supplements-topbar-inline-menu-btn ${className}`, '');
        btn.type = 'button';
        btn.disabled = disabled;
        btn.setAttribute('aria-label', label);
        btn.innerHTML = html;
        btn.addEventListener('click', onClick);
        return btn;
    };

    const draftDirty = isSupplementTableSheetDraftDirty();
    const canUndo = canUndoSupplementPlanHistory() && !draftDirty;
    const canRedo = canRedoSupplementPlanHistory() && !draftDirty;

    if (editorTopBarVisible) {
        const style = cloneSupplementDoseStyle(supplementTableSheetState.draft?.style);

        const colorBtn = createIconBtn(
            `supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--format ${supplementTableSheetState.formatPanelOpen ? 'is-active' : ''}`,
            'Формат',
            `<span class="supplements-topbar-inline-menu-btn__letter">A</span>`,
            () => toggleSupplementTableFormatPanel()
        );
        colorBtn.style.setProperty('--supplement-editor-accent', style.color || '#111827');
        colorBtn.setAttribute('aria-pressed', supplementTableSheetState.formatPanelOpen ? 'true' : 'false');

        const timeBtn = createIconBtn(
            `supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--time ${supplementTableSheetState.timePanelOpen ? 'is-active' : ''}`,
            'Время',
            `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"></path><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"></path><path fill="currentColor" d="M22 5h-2V3c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1V7h2c.55 0 1-.45 1-1s-.45-1-1-1"></path></svg>`,
            () => toggleSupplementTableTimePanel()
        );
        timeBtn.setAttribute('aria-pressed', supplementTableSheetState.timePanelOpen ? 'true' : 'false');

        const undoBtn = createIconBtn(
            'supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--undo',
            'Отменить',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Undo SVG Icon</title><path fill="currentColor" d="M7.825 13H15q1.25 0 2.125.875T18 16t-.875 2.125T15 19H8q-.425 0-.712-.288T7 18t.288-.712T8 17h7q.425 0 .713-.288T16 16t-.288-.712T15 15H7.825l1.6 1.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-3.3-3.3q-.15-.15-.213-.325T4.45 14t.063-.375t.212-.325l3.3-3.3q.275-.275.7-.275t.7.275t.275.7t-.275.7z"/></svg>`,
            () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index - 1),
            !canUndo
        );

        const redoBtn = createIconBtn(
            'supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--redo',
            'Повторить',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Redo SVG Icon</title><path fill="currentColor" d="M16.175 13H9q-1.25 0-2.125.875T6 16t.875 2.125T9 19h7q.425 0 .713-.288T17 18t-.288-.712T16 17H9q-.425 0-.712-.288T8 16t.288-.712T9 15h7.175l-1.6 1.6q-.275.275-.275.7t.275.7t.7.275t.7-.275l3.3-3.3q.15-.15.213-.325T19.55 14t-.062-.375t-.213-.325l-3.3-3.3q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7z"/></svg>`,
            () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index + 1),
            !canRedo
        );

        const doneBtn = createIconBtn(
            'supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--done',
            'Готово',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Check SVG Icon</title><path fill="currentColor" d="M9.55 18q-.3 0-.575-.125t-.475-.35l-3.9-3.9q-.3-.3-.287-.712t.287-.713q.3-.3.713-.3t.712.3l3.525 3.525l8.525-8.525q.3-.3.713-.3t.712.3q.3.3.3.713t-.3.712l-8.9 8.9q-.2.2-.475.325T9.55 18"/></svg>`,
            () => {
                if (isSupplementTableSheetDraftDirty()) {
                    showToast('Сохраните данные');
                    return;
                }
                clearSupplementTableCellSelection({ preserveMenu: false, revertPreview: false });
            }
        );

        menu.append(undoBtn, redoBtn, colorBtn, timeBtn, doneBtn);
        return;
    }

    if (historyVisible && !selectionActive) {
        menu.append(
        createIconBtn(
            'supplements-topbar-inline-menu-btn--undo',
            'Отменить',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Undo SVG Icon</title><path fill="currentColor" d="M7.825 13H15q1.25 0 2.125.875T18 16t-.875 2.125T15 19H8q-.425 0-.712-.288T7 18t.288-.712T8 17h7q.425 0 .713-.288T16 16t-.288-.712T15 15H7.825l1.6 1.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-3.3-3.3q-.15-.15-.213-.325T4.45 14t.063-.375t.212-.325l3.3-3.3q.275-.275.7-.275t.7.275t.275.7t-.275.7z"/></svg>`,
            () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index - 1),
            !canUndo
        ),
        createIconBtn(
            'supplements-topbar-inline-menu-btn--redo',
            'Повторить',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Redo SVG Icon</title><path fill="currentColor" d="M16.175 13H9q-1.25 0-2.125.875T6 16t.875 2.125T9 19h7q.425 0 .713-.288T17 18t-.288-.712T16 17H9q-.425 0-.712-.288T8 16t.288-.712T9 15h7.175l-1.6 1.6q-.275.275-.275.7t.275.7t.7.275t.7-.275l3.3-3.3q.15-.15.213-.325T19.55 14t-.062-.375t-.213-.325l-3.3-3.3q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7z"/></svg>`,
            () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index + 1),
            !canRedo
        )
    );
    }

    if (selectionActive) {
        const cancelBtn = createElement('button', 'supplements-topbar-inline-menu-text-btn supplements-topbar-inline-menu-text-btn--cancel', 'Отмена');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', () => {
            clearSupplementTableCellSelection({ preserveMenu: false, revertPreview: true });
        });

        const saveBtn = createElement('button', 'supplements-topbar-inline-menu-text-btn supplements-topbar-inline-menu-text-btn--save', 'Сохранить');
        saveBtn.type = 'button';
        saveBtn.disabled = !isSupplementTableSheetDraftDirty();
        saveBtn.addEventListener('click', async () => {
            await saveSupplementTableSheetSelection();
        });

        menu.append(cancelBtn, saveBtn);
    }
}

function handleSupplementTableCellSelection(button, mergeRange = null) {
    if (!button?.dataset?.date || !button?.dataset?.supplementName) return;
    if (supplementDoseMergeSession) return;

    const isSameCell =
        supplementTableSheetState.selectedCell &&
        supplementTableSheetState.selectedCell.dateStr === button.dataset.date &&
        supplementTableSheetState.selectedCell.supplementName === button.dataset.supplementName;

    if (isSameCell) {
        supplementTableSheetState.menuOpen = true;
        syncSupplementTableEditorShell();
        return;
    }

    if (isSupplementTableSheetSelectionActive() && isSupplementTableSheetDraftDirty()) {
        showToast('Сохраните данные');
        return;
    }

    clearSupplementTableCellSelection({ preserveMenu: true, revertPreview: true });

    const rawDose = getSupplementDoseFromState(button.dataset.date, button.dataset.supplementName);
    const draft = createSupplementTableCellDraft(rawDose);

    supplementTableSheetState.selectedCell = {
        buttonEl: button,
        tableWrapper: button.closest('.supplement-table-wrapper'),
        dateStr: button.dataset.date,
        supplementName: button.dataset.supplementName,
        slot: Number(button.dataset.supplementSlot),
        mergeRange: mergeRange || null,
        originalRawDose: cloneSupplementDoseValue(rawDose)
    };
    supplementTableSheetState.menuOpen = true;
    supplementTableSheetState.draft = cloneSupplementTableCellDraft(draft);
    supplementTableSheetState.initialDraft = cloneSupplementTableCellDraft(draft);
    supplementTableSheetState.history = [cloneSupplementTableCellDraft(draft)];
    supplementTableSheetState.historyIndex = 0;
    supplementTableSheetState.formatPanelOpen = false;
    supplementTableSheetState.formatColorPaletteOpen = false;
    supplementTableSheetState.timePanelOpen = Boolean(draft.times.length > 0);
    supplementTableSheetState.textInputFocused = false;
    supplementTableSheetState.numericPadMode = false;

    applySupplementTableCellSelectionVisual(button);
    syncSupplementTableEditorShell();
}

async function saveSupplementTableSheetSelection({ preserveSelection = false } = {}) {
    const selectedCell = supplementTableSheetState.selectedCell;
    if (!selectedCell) return;

    const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
    const previousPlan = state.supplementPlan;
    const previousRawDose = selectedCell.originalRawDose;
    const nextRawDose = buildSupplementDoseValueFromDraft(supplementTableSheetState.draft, previousRawDose);

    let scope = 'single';
    if (!hasSupplementDoseValue(nextRawDose)) {
        const result = clearSupplementDoseCellOrMergeInPlan(
            plan,
            selectedCell.dateStr,
            selectedCell.supplementName,
            selectedCell.slot
        );
        scope = result.scope;
        if (scope === 'none') {
            clearSupplementTableCellSelection({ preserveMenu: false, revertPreview: true });
            return;
        }
    } else {
        const datesToSave =
            selectedCell.mergeRange?.startDate && selectedCell.mergeRange?.endDate
                ? getSupplementDoseMergeDateStrings(plan, selectedCell.mergeRange)
                : [selectedCell.dateStr];

        datesToSave.forEach((dateStr) => {
            const dayIndex = ensureSupplementDayRecord(plan, dateStr);
            if (dayIndex < 0) return;
            plan.data[dayIndex].doses = plan.data[dayIndex].doses || {};
            plan.data[dayIndex].doses[selectedCell.supplementName] = cloneSupplementDoseValue(nextRawDose);
        });
        scope = datesToSave.length > 1 ? 'merge' : 'single';
    }

    state.supplementPlan = plan;
    syncSupplementsBottomNavBadge(plan);
    state._supplementsSkipNextRenderSignature = getSupplementPlanSnapshotSignature(plan);

    rememberCurrentSupplementTableScroll();
    if (scope === 'single' && selectedCell.buttonEl?.isConnected) {
        updateSupplementDoseCellButton(selectedCell.buttonEl, nextRawDose);
    }

    const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
    if (!saved) {
        state.supplementPlan = previousPlan;
        syncSupplementsBottomNavBadge(previousPlan);
        delete state._supplementsSkipNextRenderSignature;
        if (selectedCell.buttonEl?.isConnected) {
            updateSupplementDoseCellButton(selectedCell.buttonEl, previousRawDose);
            applySupplementTableCellSelectionVisual(selectedCell.buttonEl);
        }
        return;
    }

    const previousSignature = getSupplementPlanSnapshotSignature(previousPlan);
    const nextSignature = getSupplementPlanSnapshotSignature(plan);
    if (previousSignature !== nextSignature && !hasSupplementPlanHistoryChanges()) {
        commitSupplementPlanHistoryEntry(previousPlan, plan);
    }

    if (preserveSelection && scope === 'single' && selectedCell.buttonEl?.isConnected) {
        selectedCell.originalRawDose = cloneSupplementDoseValue(nextRawDose);
        supplementTableSheetState.formatPanelOpen = false;
        supplementTableSheetState.formatColorPaletteOpen = false;
        supplementTableSheetState.timePanelOpen = false;
        supplementTableSheetState.textInputFocused = false;
        resetSupplementTableSheetSelectionDraftState();
        applySupplementTableCellSelectionVisual(selectedCell.buttonEl);
        syncSupplementTableEditorShell();
        return;
    }

    clearSupplementTableCellSelection({ preserveMenu: false, revertPreview: false });
    if (scope === 'merge') {
        renderSupplementsPage();
    }
}

function buildSupplementImportedPlan(sourceCycle, targetCycle, options = {}) {
    const sourceRawPlan = sourceCycle?.supplementPlan || { supplements: [], data: [] };
    const { plan: sourcePlan } = sanitizeSupplementPlan(
        JSON.parse(JSON.stringify(sourceRawPlan))
    );
    ensureSupplementEntrySlots(sourcePlan);

    const sortedSourceDays = (Array.isArray(sourcePlan.data) ? sourcePlan.data : [])
        .map((dayRecord) => ({
            dayRecord,
            parsedDate: parseSupplementDateString(dayRecord?.date)
        }))
        .filter((item) => item.parsedDate instanceof Date && !Number.isNaN(item.parsedDate.getTime()))
        .sort((left, right) => compareSupplementDates(left.parsedDate, right.parsedDate));

    if (sortedSourceDays.length === 0) return null;

    const boundsStartDate = cloneSupplementDate(sortedSourceDays[0].parsedDate);
    const boundsEndDate = cloneSupplementDate(sortedSourceDays[sortedSourceDays.length - 1].parsedDate);

    let selectedStartDate = options.importAll
        ? cloneSupplementDate(boundsStartDate)
        : parseSupplementDateString(options.startDate);
    let selectedEndDate = options.importAll
        ? cloneSupplementDate(boundsEndDate)
        : parseSupplementDateString(options.endDate);
    if (!selectedStartDate || !selectedEndDate || !boundsStartDate || !boundsEndDate) {
        return null;
    }

    if (compareSupplementDates(selectedStartDate, selectedEndDate) > 0) {
        const nextStartDate = selectedEndDate;
        selectedEndDate = selectedStartDate;
        selectedStartDate = nextStartDate;
    }

    if (compareSupplementDates(selectedStartDate, boundsStartDate) < 0) {
        selectedStartDate = cloneSupplementDate(boundsStartDate);
    }
    if (compareSupplementDates(selectedEndDate, boundsEndDate) > 0) {
        selectedEndDate = cloneSupplementDate(boundsEndDate);
    }
    if (compareSupplementDates(selectedStartDate, selectedEndDate) > 0) {
        return null;
    }

    const importedSupplements = (sourcePlan.supplements || []).map((entry) =>
        createSupplementMeta(entry.name, entry.shortName, entry.archived, entry.slot)
    );
    const supplementNames = importedSupplements
        .map((entry) => String(entry?.name || '').trim())
        .filter(Boolean);

    const importedDays = sortedSourceDays
        .filter(({ parsedDate }) =>
            compareSupplementDates(parsedDate, selectedStartDate) >= 0 &&
            compareSupplementDates(parsedDate, selectedEndDate) <= 0
        )
        .map(({ dayRecord, parsedDate }) => {
            const doses = {};
            supplementNames.forEach((supplementName) => {
                doses[supplementName] = cloneSupplementDoseValue(dayRecord?.doses?.[supplementName] ?? '');
            });

            return {
                date: formatSupplementDateString(parsedDate),
                dayOfWeek: getSupplementWeekdayShortName(parsedDate),
                doses
            };
        });

    if (importedDays.length === 0) return null;

    const importedPlan = {
        supplements: importedSupplements,
        data: importedDays
    };

    const sourceMerges = Array.isArray(sourcePlan.doseMerges) ? sourcePlan.doseMerges : [];
    const importedMerges = [];
    sourceMerges.forEach((merge) => {
        const mergeStartDate = parseSupplementDateString(merge?.startDate);
        const mergeEndDate = parseSupplementDateString(merge?.endDate);
        if (!mergeStartDate || !mergeEndDate) return;
        if (compareSupplementDates(mergeEndDate, selectedStartDate) < 0) return;
        if (compareSupplementDates(mergeStartDate, selectedEndDate) > 0) return;

        const clippedStartDate = compareSupplementDates(mergeStartDate, selectedStartDate) < 0
            ? cloneSupplementDate(selectedStartDate)
            : cloneSupplementDate(mergeStartDate);
        const clippedEndDate = compareSupplementDates(mergeEndDate, selectedEndDate) > 0
            ? cloneSupplementDate(selectedEndDate)
            : cloneSupplementDate(mergeEndDate);
        if (compareSupplementDates(clippedStartDate, clippedEndDate) > 0) {
            return;
        }

        const anchorSourceDate = parseSupplementDateString(merge?.anchorDate);
        const clippedAnchorDate =
            anchorSourceDate &&
            compareSupplementDates(anchorSourceDate, clippedStartDate) >= 0 &&
            compareSupplementDates(anchorSourceDate, clippedEndDate) <= 0
                ? cloneSupplementDate(anchorSourceDate)
                : cloneSupplementDate(clippedStartDate);

        importedMerges.push({
            slot: Number(merge.slot),
            supplementName: String(merge.supplementName || '').trim(),
            startDate: formatSupplementDateString(clippedStartDate),
            endDate: formatSupplementDateString(clippedEndDate),
            anchorDate: formatSupplementDateString(clippedAnchorDate)
        });
    });

    if (importedMerges.length > 0) {
        importedPlan.doseMerges = importedMerges;
    }

    const { plan: sanitizedImportedPlan } = sanitizeSupplementPlan(importedPlan);
    ensureSupplementEntrySlots(sanitizedImportedPlan);
    return sanitizedImportedPlan;
}

function createSupplementImportDateButton(initialValue = '', onChange = null) {
    const btn = createElement('button', 'supplement-plan-import-date-btn');
    btn.type = 'button';
    let currentValue = initialValue || '';

    const valueText = createElement(
        'span',
        `supplement-plan-import-date-btn__value${currentValue ? ' is-active' : ''}`,
        formatSupplementImportDateDisplay(currentValue)
    );
    const icon = document.createElement('span');
    icon.className = 'supplement-plan-import-date-btn__icon';
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><title>Calendar SVG Icon</title><path fill="currentColor" d="M19 4h-1V2.75a.75.75 0 0 0-1.5 0V4h-9V2.75a.75.75 0 0 0-1.5 0V4H5A2.75 2.75 0 0 0 2.25 6.75v11.5A2.75 2.75 0 0 0 5 21h14a2.75 2.75 0 0 0 2.75-2.75V6.75A2.75 2.75 0 0 0 19 4m1.25 14.25c0 .69-.56 1.25-1.25 1.25H5c-.69 0-1.25-.56-1.25-1.25V9h16.5zm0-10.75H3.75v-.75C3.75 6.06 4.31 5.5 5 5.5h14c.69 0 1.25.56 1.25 1.25z"/></svg>`;

    function syncValue(nextValue) {
        currentValue = nextValue || '';
        valueText.textContent = formatSupplementImportDateDisplay(currentValue);
        valueText.classList.toggle('is-active', Boolean(currentValue));
    }

    function openPicker() {
        if (btn.disabled) return;
        const fallback = currentValue || dateToInputFormat(getTodayDateString());
        openDateModal(fallback, (nextValue) => {
            if (!nextValue) return;
            syncValue(nextValue);
            if (typeof onChange === 'function') {
                onChange(nextValue);
            }
        });
    }

    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        openPicker();
    });

    btn.append(valueText, icon);
    syncValue(currentValue);

    return {
        button: btn,
        setValue: syncValue,
        getValue: () => currentValue,
        setDisabled: (disabled) => {
            btn.disabled = !!disabled;
            btn.classList.toggle('is-disabled', !!disabled);
        },
        openPicker
    };
}

function openSupplementPlanImportModal() {
    const currentCycle = state.cycles?.find((cycle) => cycle.id === state.selectedCycleId);
    if (!currentCycle) {
        showToast('Сначала выберите цикл.');
        return;
    }

    const sourceCycles = getSupplementImportSourceCycles();
    if (sourceCycles.length === 0) {
        showToast('Нет других циклов для переноса.');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle modal-overlay-cicle--sheet';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle modal-cicle--add-program supplement-plan-import-modal';

    const title = createElement('h3', 'modal-cicle__title', 'Перенос плана БАДов');
    const divider = createElement('div', 'add-program-section-label', 'Перенос плана из другого цикла');

    let selectedSourceCycle = null;
    let selectedSourcePlan = null;
    let importMode = 'all';

    const cycleRow = createElement('div', 'add-program-dropdown-row');
    const cycleText = createElement('span', 'add-program-dropdown-text', 'Выберите цикл');
    const cycleArrow = createElement('span', 'cycle-label-arrow', '▾');
    cycleRow.append(cycleText, cycleArrow);

    const cycleDropdown = createElement('div', 'add-program-dropdown-list');
    sourceCycles.forEach((cycle) => {
        const item = createElement('div', 'add-program-dropdown-item', cycle.name || 'Без названия');
        item.dataset.id = cycle.id;
        cycleDropdown.append(item);
    });

    const cycleWrap = createElement('div', 'add-program-dropdown-wrap');
    cycleWrap.append(cycleRow, cycleDropdown);

    const sourceHint = createElement(
        'div',
        'supplement-plan-import-hint',
        'Выберите цикл, чтобы загрузить доступный диапазон плана.'
    );

    const modeLabel = createElement('div', 'supplement-plan-import-mode-label', 'Что переносим');
    const modeToggle = createElement('div', 'supplement-plan-import-mode');
    const allBtn = createElement('button', 'supplement-plan-import-mode-btn is-active', 'Весь план');
    const rangeBtn = createElement('button', 'supplement-plan-import-mode-btn', 'Диапазон');
    allBtn.type = 'button';
    rangeBtn.type = 'button';
    modeToggle.append(allBtn, rangeBtn);

    const dateRows = createElement('div', 'supplement-plan-import-dates is-disabled');
    const startRow = createElement('div', 'supplement-plan-import-date-row');
    const startLabel = createElement('span', 'supplement-plan-import-date-row__label', 'С даты');
    const startPicker = createSupplementImportDateButton('', updateConfirmState);
    startRow.append(startLabel, startPicker.button);

    const endRow = createElement('div', 'supplement-plan-import-date-row');
    const endLabel = createElement('span', 'supplement-plan-import-date-row__label', 'По дату');
    const endPicker = createSupplementImportDateButton('', updateConfirmState);
    endRow.append(endLabel, endPicker.button);

    dateRows.append(startRow, endRow);

    const helperText = createElement(
        'div',
        'supplement-plan-import-helper',
        'План перенесется в текущий цикл с сохранением относительных позиций дней.'
    );

    const confirmBtn = createElement('button', 'btn btn-primary add-program-confirm-btn', 'Перенести');
    confirmBtn.disabled = true;
    const cancelBtn = createElement('button', 'btn add-program-cancel-btn', 'Отмена');
    const btnGroup = createElement('div', 'add-program-actions');
    btnGroup.append(cancelBtn, confirmBtn);

    function closeAllDropdowns() {
        cycleDropdown.classList.remove('open');
        cycleArrow.classList.remove('open');
    }

    function updateConfirmState() {
        const hasSource = !!selectedSourceCycle && !!selectedSourcePlan;
        const hasPlanBounds = !!getSupplementImportPlanBounds(selectedSourcePlan);
        const hasRange = importMode === 'all' || (startPicker.getValue() && endPicker.getValue());
        confirmBtn.disabled = !(hasSource && hasPlanBounds && hasRange);
        confirmBtn.classList.toggle('disabled', confirmBtn.disabled);
    }

    function updateModeUi() {
        const isAll = importMode === 'all';
        allBtn.classList.toggle('is-active', isAll);
        rangeBtn.classList.toggle('is-active', !isAll);
        dateRows.classList.toggle('is-disabled', isAll);
        startPicker.setDisabled(isAll);
        endPicker.setDisabled(isAll);
        updateConfirmState();
    }

    function applySourceCycleSelection(cycleId) {
        selectedSourceCycle = sourceCycles.find((cycle) => cycle.id === cycleId) || null;
        selectedSourcePlan = selectedSourceCycle
            ? sanitizeSupplementPlan(
                JSON.parse(JSON.stringify(selectedSourceCycle.supplementPlan || { supplements: [], data: [] }))
            ).plan
            : null;

        cycleDropdown.querySelectorAll('.add-program-dropdown-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.id === cycleId);
        });

        if (selectedSourceCycle) {
            cycleText.textContent = selectedSourceCycle.name || 'Без названия';
            cycleText.classList.add('add-program-dropdown-text--active');
        } else {
            cycleText.textContent = 'Выберите цикл';
            cycleText.classList.remove('add-program-dropdown-text--active');
        }

        const bounds = getSupplementImportPlanBounds(selectedSourcePlan);
        if (bounds) {
            sourceHint.textContent = `Доступный диапазон: ${bounds.firstDate} — ${bounds.lastDate}`;
            startPicker.setValue(bounds.firstIso);
            endPicker.setValue(bounds.lastIso);
        } else {
            sourceHint.textContent = 'В выбранном цикле еще нет плана БАДов.';
            startPicker.setValue('');
            endPicker.setValue('');
        }

        updateConfirmState();
    }

    cycleRow.addEventListener('click', (event) => {
        event.stopPropagation();
        cycleDropdown.classList.toggle('open');
        cycleArrow.classList.toggle('open');
    });

    cycleDropdown.addEventListener('click', (event) => {
        event.stopPropagation();
        const item = event.target.closest('.add-program-dropdown-item');
        if (!item) return;
        applySourceCycleSelection(item.dataset.id);
        closeAllDropdowns();
    });

    allBtn.addEventListener('click', () => {
        importMode = 'all';
        updateModeUi();
    });
    rangeBtn.addEventListener('click', () => {
        importMode = 'range';
        updateModeUi();
    });

    startRow.addEventListener('click', (event) => {
        if (event.target.closest('button') && event.target !== startRow) return;
        if (importMode !== 'range') return;
        startPicker.openPicker();
    });
    endRow.addEventListener('click', (event) => {
        if (event.target.closest('button') && event.target !== endRow) return;
        if (importMode !== 'range') return;
        endPicker.openPicker();
    });

    cancelBtn.addEventListener('click', () => {
        modal.remove();
    });

    confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled || !selectedSourceCycle) return;

        const nextPlan = buildSupplementImportedPlan(selectedSourceCycle, currentCycle, {
            importAll: importMode === 'all',
            startDate: startPicker.getValue() ? startPicker.getValue().split('-').reverse().join('.') : '',
            endDate: endPicker.getValue() ? endPicker.getValue().split('-').reverse().join('.') : ''
        });

        if (!nextPlan || !Array.isArray(nextPlan.data) || nextPlan.data.length === 0) {
            showToast('В выбранном диапазоне нет плана БАДов для переноса.');
            return;
        }

        const applyImport = async () => {
            resetSupplementsTableScrollMemory();
            const saved = await updateSupplementPlanInFirestore(nextPlan);
            if (!saved) return;
            modal.remove();
            showToast('План БАДов перенесен');
            renderSupplementsPage();
        };

        if (hasSupplementPlanContent(state.supplementPlan)) {
            openConfirmModal('Текущий план БАДов будет заменен. Продолжить?', applyImport);
            return;
        }

        await applyImport();
    });

    modalContent.addEventListener('click', closeAllDropdowns);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.remove();
        }
    });

    modalContent.append(
        title,
        divider,
        cycleWrap,
        sourceHint,
        modeLabel,
        modeToggle,
        dateRows,
        helperText,
        btnGroup
    );
    modal.append(modalContent);
    document.body.appendChild(modal);

    updateModeUi();
    if (sourceCycles.length === 1) {
        applySourceCycleSelection(sourceCycles[0].id);
    }
}

function renderSupplementsTableView(contentContainer, planData) {
    const todayDateString = getTodayDateString();
    const tableColumns = getSupplementTableColumns(planData);
    const tableRangeMode = getSupplementsTableRangeMode();

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
    const addWeeksSection = createSupplementTableAddWeeksSection();
    guard.append(addWeeksSection);
    tableWrapper.append(guard);

    const jumpBtnWrap = createElement('div', 'supplement-jump-btn-wrap is-hidden');
    const jumpBtn = createElement('button', 'btn btn-secondary supplement-jump-btn', '');
    jumpBtn.type = 'button';
    jumpBtnWrap.append(jumpBtn);
    tableWrapper.append(jumpBtnWrap);
    contentContainer.append(tableWrapper);
    enableSupplementDoseCellLongPressActions(tableWrapper);
    enableSupplementColumnLongPressDrag(tableWrapper, planData);
    const savedScroll = getRememberedSupplementTableScroll(tableRangeMode);

    const firstRowDate = planData.data?.[0]?.date;
    const firstPlanDate = parseSupplementDateString(firstRowDate);

    supplementTableVirtualState = {
        planData,
        tableColumns,
        tableWrapper,
        tbody,
        jumpBtnWrap,
        contentContainer,
        tableRangeMode,
        historyRangesBySlot: buildSupplementHistoryRangesBySlot(planData, tableColumns),
        lastScrollTop: 0
    };

    renderSupplementTableWindow(supplementTableVirtualState);
    if (firstPlanDate) {
        tableWrapper.dataset.windowStartDate = formatSupplementDateString(firstPlanDate);
    } else {
        tableWrapper.dataset.windowStartDate = '';
    }
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
            const firstIdx = getSupplementTableAnchoredFirstRowIndex(planData, todayDateString);
            scrollSupplementTableToPlanRowIndex(tableWrapper, planData, firstIdx);
        }
        supplementTableVirtualState.lastScrollTop = tableWrapper.scrollTop;
        syncSupplementJumpButtonVisibility(jumpBtnWrap, supplementTableVirtualState);
    });

    attachSupplementTableBounceLock(tableWrapper, supplementTableViewportSyncController.signal);
    window.addEventListener('resize', scheduleTableViewportLayout, { signal: supplementTableViewportSyncController.signal });
    window.addEventListener('orientationchange', scheduleTableViewportLayout, { signal: supplementTableViewportSyncController.signal });

    let syncFrameId = 0;
    const handleScroll = () => {
        if (syncFrameId) return;
        syncFrameId = requestAnimationFrame(() => {
            syncFrameId = 0;
            if (!supplementTableVirtualState || !tableWrapper.isConnected) return;
            rememberSupplementTableScroll(tableWrapper);
            syncSupplementJumpButtonVisibility(jumpBtnWrap, supplementTableVirtualState);
        });
    };

    tableWrapper.addEventListener('scroll', handleScroll, { passive: true, signal: supplementTableViewportSyncController.signal });
}

function createSupplementTableAddWeeksSection() {
    const wrap = createElement('div', 'supplement-table-add-weeks');
    const row = createElement('div', 'supplement-table-add-weeks-row');
    const addBtn = createElement('button', 'btn btn-secondary supplement-table-add-weeks-btn', 'Добавить');
    addBtn.type = 'button';
    const labelBefore = createElement('span', 'supplement-table-add-weeks-label', 'ниже (');
    const input = createElement('input', 'supplement-table-add-weeks-input');
    input.type = 'number';
    input.min = '-52';
    input.max = '52';
    input.value = String(SUPPLEMENT_TABLE_DEFAULT_ADD_WEEKS);
    input.setAttribute('inputmode', 'numeric');
    const labelAfter = createElement('span', 'supplement-table-add-weeks-label', ') недель');
    row.append(addBtn, labelBefore, input, labelAfter);
    const note = createElement('p', 'supplement-table-add-weeks-note');
    note.append(
        createElement('span', 'supplement-table-add-weeks-note-asterisk', '*'),
        document.createTextNode(
            ' Чтобы удалить недели с конца диапазона, поставьте знак «−» перед числом (например, −1 или −5).'
        )
    );
    wrap.append(row, note);
    addBtn.addEventListener('click', async () => {
        const w = Math.floor(Number(input.value));
        await addSupplementExtraWeeks(w);
    });
    return wrap;
}

function renderSupplementTableWindow(tableState) {
    if (!tableState?.tbody || !tableState?.tableWrapper) return;

    const {
        tbody,
        tableWrapper,
        tableColumns,
        planData,
        tableRangeMode,
        historyRangesBySlot
    } = tableState;
    const showCellTimes = tableRangeMode === 'week';
    const todayDateString = getTodayDateString();
    const dayRecords = Array.isArray(planData?.data) ? planData.data : [];
    const fragment = document.createDocumentFragment();
    let todayRowElement = null;
    const rowspanRemainingBySlot = new Map();

    tableColumns.forEach((column) => {
        column.labelShownEntries = new Set();
    });

    dayRecords.forEach((dayRecord) => {
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

            const slot = column.slot;
            const rowspanRem = rowspanRemainingBySlot.get(slot) || 0;
            if (rowspanRem > 0) {
                rowspanRemainingBySlot.set(slot, rowspanRem - 1);
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
                const mergeForModal = findSupplementDoseMergeCovering(
                    planData,
                    dayRecord.date,
                    slot,
                    column.activeEntry.name
                );
                doseBtn.addEventListener('click', () => {
                    if (supplementDoseMergeSession) return;
                    handleSupplementTableCellSelection(doseBtn, mergeForModal || null);
                });
            }

            const mergeCover =
                column.activeEntry &&
                findSupplementDoseMergeCovering(planData, dayRecord.date, slot, column.activeEntry.name);
            const isMergeStart = Boolean(mergeCover && mergeCover.startDate === dayRecord.date);
            const mergeRowspan = isMergeStart ? getSupplementDoseMergeRowspan(planData, mergeCover) : 1;
            if (mergeRowspan > 1) {
                td.rowSpan = mergeRowspan;
                td.classList.add('dose-col--merged');
                rowspanRemainingBySlot.set(slot, mergeRowspan - 1);
                doseBtn.classList.add('supplement-dose-cell-btn--merged-vertical');
            }

            td.append(doseBtn);
            applySupplementDoseCellVisualStyle(doseBtn, rawDose);
            tr.append(td);
        });

        fragment.append(tr);
        if (dayRecord.date === todayDateString) {
            todayRowElement = tr;
        }
    });

    tbody.replaceChildren(fragment);
    const firstDate = dayRecords[0]?.date;
    const firstParsed = parseSupplementDateString(firstDate);
    tableWrapper.dataset.windowStartDate = firstParsed ? formatSupplementDateString(firstParsed) : '';
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

function appendWeeksToSupplementPlan(plan, cycle, weeksToAdd) {
    if (!plan || !cycle) return null;
    const weeks = Math.min(52, Math.max(1, Math.floor(Number(weeksToAdd)) || 1));
    const newPlan = JSON.parse(JSON.stringify(plan));
    ensureSupplementEntrySlots(newPlan);
    const currentLength = newPlan.data.length;

    let nextStartDateString;
    if (currentLength > 0) {
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
        nextStartDateString = cycle.startDateString;
    }

    const newDates = generateDates(nextStartDateString, weeks * 7);
    const newRecords = newDates.map((dateInfo) => {
        const doseMap = {};
        getSupplementNames(newPlan).forEach((supName) => {
            doseMap[supName] = '';
        });

        return {
            date: dateInfo.date,
            dayOfWeek: dateInfo.dayOfWeek,
            doses: doseMap
        };
    });

    newPlan.data.push(...newRecords);
    return newPlan;
}

function removeWeeksFromSupplementPlan(plan, weeksToRemove) {
    if (!plan || !Array.isArray(plan.data) || plan.data.length === 0) return null;
    const w = Math.min(52, Math.max(1, Math.floor(Number(weeksToRemove)) || 0));
    if (w < 1) return null;

    const newPlan = JSON.parse(JSON.stringify(plan));
    const removeCount = Math.min(w * 7, newPlan.data.length);
    if (removeCount < 1) return null;

    newPlan.data.splice(newPlan.data.length - removeCount, removeCount);
    return newPlan;
}

function scrollSupplementTableRowToTop(wrapper, rowElement) {
    const rowRect = rowElement.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const header = wrapper.querySelector('thead');
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const nextScrollTop = wrapper.scrollTop + rowRect.top - wrapperRect.top - headerHeight;

    wrapper.scrollTop = Math.max(0, nextScrollTop);
}

/**
 * Индекс первой строки plan.data под шапкой: на экране 4 календарные недели (пн–вс),
 * неделя с «сегодня» — **вторая** сверху; у начала/конца диапазона плана — зажим (как раньше с виртуальным окном).
 */
function getSupplementTableAnchoredFirstRowIndex(planData, todayDateString) {
    const data = planData?.data;
    if (!Array.isArray(data) || data.length === 0) return 0;

    const today = parseSupplementDateString(todayDateString);
    const first = parseSupplementDateString(data[0]?.date);
    const last = parseSupplementDateString(data[data.length - 1]?.date);
    if (!today || !first || !last) return 0;

    const visDays = SUPPLEMENT_TABLE_VISIBLE_DAYS;
    const maxFirst = Math.max(0, data.length - visDays);

    if (compareSupplementDates(today, last) > 0) {
        return maxFirst;
    }

    const monday = getSupplementWeekStartDate(today);

    let weekStartIndex = 0;
    if (compareSupplementDates(monday, first) < 0) {
        weekStartIndex = 0;
    } else {
        const mondayStr = formatSupplementDateString(monday);
        let idx = data.findIndex((d) => d.date === mondayStr);
        if (idx < 0) {
            idx = data.findIndex((d) => {
                const p = parseSupplementDateString(d.date);
                return p && compareSupplementDates(p, monday) >= 0;
            });
        }
        weekStartIndex = idx < 0 ? 0 : idx;
    }

    let idealFirst = weekStartIndex - 7;
    if (idealFirst < 0) idealFirst = 0;
    if (idealFirst > maxFirst) idealFirst = maxFirst;
    return idealFirst;
}

function scrollSupplementTableToPlanRowIndex(tableWrapper, planData, rowIndex) {
    const data = planData?.data;
    if (!tableWrapper || !Array.isArray(data) || !data[rowIndex]) {
        if (tableWrapper) tableWrapper.scrollTop = 0;
        return;
    }
    const dateStr = data[rowIndex].date;
    const row = tableWrapper.querySelector(`tbody tr[data-date="${dateStr}"]`);
    if (!row) {
        tableWrapper.scrollTop = 0;
        return;
    }
    scrollSupplementTableRowToTop(tableWrapper, row);
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

function jumpSupplementTableToTodayWeek(tableState) {
    if (!tableState?.tableWrapper) return;

    const wrapper = tableState.tableWrapper;
    const todayDateString = getTodayDateString();
    const todayRow = wrapper.querySelector(`tbody tr[data-date="${todayDateString}"]`);
    if (todayRow) {
        const firstIdx = getSupplementTableAnchoredFirstRowIndex(tableState.planData, todayDateString);
        scrollSupplementTableToPlanRowIndex(wrapper, tableState.planData, firstIdx);
    } else {
        const fallbackRow = getSupplementDefaultWeekTargetRow(wrapper);
        if (fallbackRow) {
            scrollSupplementTableRowToTop(wrapper, fallbackRow);
        }
    }
    tableState.lastScrollTop = wrapper.scrollTop;
    rememberSupplementTableScroll(wrapper);
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

    if (!todayRow) {
        const rows = resolvedWrapper.querySelectorAll('tbody tr[data-date]');
        const firstDs = rows[0]?.dataset?.date;
        const lastDs = rows[rows.length - 1]?.dataset?.date;
        const renderedStartDate = parseSupplementDateString(firstDs);
        const renderedEndDate = parseSupplementDateString(lastDs);
        if (!renderedStartDate || !renderedEndDate) {
            buttonWrap.classList.add('is-hidden');
            return;
        }

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
        if (tableState?.tableWrapper) {
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
}

function syncSupplementsTableViewport(contentContainer, activeViewport, options = {}) {
    if (!contentContainer || !activeViewport) return;
    const {
        constrainToNav = false,
        bottomOffset = 0
    } = options;

    const viewportHeight = Math.round(
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

function isSupplementTableRowHeightFrozen() {
    return Boolean(
        document.body?.classList.contains('app-keyboard-visible') ||
        document.body?.classList.contains('supplement-table-sheet-editing') ||
        document.documentElement?.classList.contains('supplement-table-sheet-editing')
    );
}

function syncSupplementTableRangeLayout(tableWrapper, tableRangeMode, tableState = null) {
    if (!tableWrapper) return;

    const header = tableWrapper.querySelector('thead');
    const table = tableWrapper.querySelector('.supplement-plan-table');
    const hasFrozenRowHeight = Boolean(
        isSupplementTableRowHeightFrozen() &&
        String(tableWrapper.style.getPropertyValue('--supplement-table-row-height') || '').trim()
    );

    if (!hasFrozenRowHeight) {
        const visibleDays = SUPPLEMENT_TABLE_VISIBLE_DAYS;
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
    }

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
                    const mergeR = findSupplementDoseMergeCoveringByName(planData, dateStr, entry.name);
                    openSupplementDoseModal({
                        dateStr,
                        supplementName: entry.name,
                        mergeRange: mergeR || undefined
                    });
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

function openSupplementDoseModal({ dateStr, supplementName = '', isNew = false, mergeRange = null }) {
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
    doseInput.value = currentDose.text || currentDose.dosage;
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
            if (mergeRange?.startDate && mergeRange?.endDate) {
                const dates = getSupplementDoseMergeDateStrings(plan, mergeRange);
                for (const ds of dates) {
                    const di = plan.data.findIndex((d) => d.date === ds);
                    if (di >= 0) {
                        plan.data[di].doses = plan.data[di].doses || {};
                        plan.data[di].doses[supplementName] = '';
                    }
                }
                plan.doseMerges = (plan.doseMerges || []).filter(
                    (m) =>
                        !(
                            Number(m.slot) === Number(mergeRange.slot) &&
                            String(m.supplementName || '') === String(mergeRange.supplementName || '') &&
                            m.startDate === mergeRange.startDate &&
                            m.endDate === mergeRange.endDate
                        )
                );
            } else {
                record.doses = record.doses || {};
                record.doses[supplementName] = '';
            }
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

        const mergedDates =
            !isNew && mergeRange?.startDate && mergeRange?.endDate
                ? getSupplementDoseMergeDateStrings(plan, mergeRange)
                : null;
        const datesToSave =
            mergedDates && mergedDates.length > 0 ? mergedDates : [plan.data[dayIndex].date];

        for (const ds of datesToSave) {
            const di = ensureSupplementDayRecord(plan, ds);
            if (di < 0) continue;
            const prevTaken = parseSupplementDoseValue(plan.data[di].doses?.[nextName]).taken;
            plan.data[di].doses = plan.data[di].doses || {};
            plan.data[di].doses[nextName] = buildSupplementDoseValue({
                text: nextDose,
                dosage: nextDose,
                tablets: nextTablets,
                times: nextTimes,
                taken: prevTaken
            });
        }

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

function createDefaultSupplementDoseStyle() {
    return {
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        color: '#111827',
        align: 'center',
        verticalAlign: 'middle',
        background: '',
        fontSize: 10,
        fontFamily: 'Arial',
        textRotation: 'horizontal'
    };
}

function normalizeSupplementDoseStyle(style = {}) {
    const base = createDefaultSupplementDoseStyle();
    const align = ['left', 'center', 'right'].includes(String(style?.align || '').trim())
        ? String(style.align).trim()
        : base.align;
    const verticalAlign = ['top', 'middle', 'bottom'].includes(String(style?.verticalAlign || '').trim())
        ? String(style.verticalAlign).trim()
        : base.verticalAlign;
    const color = String(style?.color || '').trim() || base.color;
    const background = String(style?.background || '').trim();
    const fontSizeRaw = Number(style?.fontSize);
    const fontSize = Number.isFinite(fontSizeRaw)
        ? Math.min(32, Math.max(8, Math.round(fontSizeRaw)))
        : base.fontSize;
    const fontFamily = String(style?.fontFamily || '').trim() || base.fontFamily;
    const textRotation = ['horizontal'].includes(String(style?.textRotation || '').trim())
        ? String(style.textRotation).trim()
        : base.textRotation;

    return {
        bold: Boolean(style?.bold),
        italic: Boolean(style?.italic),
        underline: Boolean(style?.underline),
        strike: Boolean(style?.strike),
        color,
        align,
        verticalAlign,
        background,
        fontSize,
        fontFamily,
        textRotation
    };
}

function cloneSupplementDoseStyle(style = {}) {
    return normalizeSupplementDoseStyle(style);
}

function hasSupplementDoseStyleOverrides(style = {}) {
    const normalized = normalizeSupplementDoseStyle(style);
    const defaults = createDefaultSupplementDoseStyle();
    return (
        normalized.bold !== defaults.bold ||
        normalized.italic !== defaults.italic ||
        normalized.underline !== defaults.underline ||
        normalized.strike !== defaults.strike ||
        normalized.color !== defaults.color ||
        normalized.align !== defaults.align ||
        normalized.verticalAlign !== defaults.verticalAlign ||
        normalized.background !== defaults.background ||
        normalized.fontSize !== defaults.fontSize ||
        normalized.fontFamily !== defaults.fontFamily ||
        normalized.textRotation !== defaults.textRotation
    );
}
function parseSupplementDoseValue(rawDose) {
    if (rawDose && typeof rawDose === 'object' && !Array.isArray(rawDose)) {
        const times = normalizeSupplementTimes(rawDose.times || rawDose.time || rawDose.at);

        return {
            text: String(rawDose.text || rawDose.label || '').trim(),
            dosage: String(rawDose.dosage || rawDose.dose || rawDose.value || '').trim(),
            tablets: String(rawDose.tablets || rawDose.pills || rawDose.count || '').trim(),
            time: times[0] || '',
            times,
            taken: Boolean(rawDose.taken || rawDose.completed || rawDose.done || rawDose.isTaken),
            style: normalizeSupplementDoseStyle(rawDose.style || {
                bold: rawDose.bold,
                italic: rawDose.italic,
                underline: rawDose.underline,
                strike: rawDose.strike,
                color: rawDose.color,
                align: rawDose.align,
                verticalAlign: rawDose.verticalAlign,
                background: rawDose.background,
                fontSize: rawDose.fontSize,
                fontFamily: rawDose.fontFamily,
                textRotation: rawDose.textRotation
            })
        };
    }

    return {
        text: '',
        dosage: rawDose == null ? '' : String(rawDose).trim(),
        tablets: '',
        time: '',
        times: [],
        taken: false,
        style: createDefaultSupplementDoseStyle()
    };
}

function buildSupplementDoseValue({ text = '', dosage = '', tablets = '', time = '', times = [], taken = false, style = null } = {}) {
    const cleanText = String(text || '').trim();
    const cleanDose = String(dosage || '').trim();
    const cleanTablets = String(tablets || '').trim();
    const cleanTimes = normalizeSupplementTimes(times.length > 0 ? times : time);
    const isTaken = Boolean(taken);
    const normalizedStyle = normalizeSupplementDoseStyle(style || {});

    if (!cleanText && !cleanDose && !cleanTablets && cleanTimes.length === 0) return '';
    if (!cleanText && cleanDose && !cleanTablets && cleanTimes.length === 0 && !isTaken && !hasSupplementDoseStyleOverrides(normalizedStyle)) {
        return cleanDose;
    }

    const value = {
        text: cleanText,
        dosage: cleanDose,
        tablets: cleanTablets,
        times: cleanTimes
    };

    if (isTaken) {
        value.taken = true;
    }

    if (hasSupplementDoseStyleOverrides(normalizedStyle)) {
        value.style = normalizedStyle;
    }

    return value;
}

function hasSupplementDoseValue(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    return Boolean(dose.text || dose.dosage || dose.tablets || dose.times.length);
}

function cloneSupplementDoseValue(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    return buildSupplementDoseValue({
        text: dose.text,
        dosage: dose.dosage,
        tablets: dose.tablets,
        times: dose.times,
        taken: dose.taken,
        style: dose.style
    });
}

function createSupplementTableCellDraft(rawDose) {
    const dose = parseSupplementDoseValue(rawDose);
    const fallbackText = dose.text || formatSupplementDoseQuantity(rawDose);

    return {
        text: fallbackText,
        times: normalizeSupplementTableDraftTimes(dose.times),
        taken: dose.taken,
        style: cloneSupplementDoseStyle(dose.style)
    };
}

function cloneSupplementTableCellDraft(draft) {
    return {
        text: String(draft?.text || ''),
        times: normalizeSupplementTableDraftTimes(draft?.times || []),
        taken: Boolean(draft?.taken),
        style: cloneSupplementDoseStyle(draft?.style)
    };
}

function buildSupplementDoseValueFromDraft(draft, previousRawDose = '') {
    const previousDose = parseSupplementDoseValue(previousRawDose);
    return buildSupplementDoseValue({
        text: String(draft?.text || '').trim(),
        dosage: previousDose.dosage,
        tablets: previousDose.tablets,
        times: normalizeSupplementTimes(draft?.times || []),
        taken: Boolean(draft?.taken ?? previousDose.taken),
        style: cloneSupplementDoseStyle(draft?.style)
    });
}

function areSupplementTableCellDraftsEqual(left, right) {
    const a = cloneSupplementTableCellDraft(left);
    const b = cloneSupplementTableCellDraft(right);
    return JSON.stringify(a) === JSON.stringify(b);
}

function setSupplementDoseClipboardValue(rawDose, meta = {}) {
    supplementDoseClipboard = cloneSupplementDoseValue(rawDose);
    supplementDoseClipboardMeta = {
        cellKey: meta.cellKey || '',
        dateStr: meta.dateStr || '',
        supplementName: meta.supplementName || ''
    };
    supplementDoseRangeClipboard = null;
    supplementDoseRangeClipboardMeta = null;
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
            : [],
        doseMerges: Array.isArray(planData?.doseMerges)
            ? planData.doseMerges
                .filter((m) => m && typeof m === 'object')
                .map((m) => ({
                    slot: Number(m.slot),
                    supplementName: String(m.supplementName || '').trim(),
                    startDate: String(m.startDate || '').trim(),
                    endDate: String(m.endDate || '').trim(),
                    anchorDate: String(m.anchorDate || '').trim()
                }))
                .sort(
                    (a, b) =>
                        a.slot - b.slot ||
                        a.supplementName.localeCompare(b.supplementName) ||
                        compareSupplementDateStrings(a.startDate, b.startDate) ||
                        compareSupplementDateStrings(a.endDate, b.endDate) ||
                        compareSupplementDateStrings(a.anchorDate, b.anchorDate)
                )
            : []
    };

    return JSON.stringify(normalizedPlan);
}

function cloneSupplementPlanHistoryEntry(planData) {
    const { plan } = sanitizeSupplementPlan(
        JSON.parse(JSON.stringify(planData || { supplements: [], data: [], doseMerges: [] }))
    );
    return plan;
}

function resetSupplementPlanHistoryState(cycleId = '') {
    supplementPlanHistoryState = createSupplementPlanHistoryDefaultState();
    supplementPlanHistoryState.cycleId = String(cycleId || '');
}

function syncSupplementPlanHistoryWithState(planData = state.supplementPlan, cycleId = state.selectedCycleId) {
    const normalizedCycleId = String(cycleId || '');
    const nextPlan = cloneSupplementPlanHistoryEntry(planData);
    const nextSignature = getSupplementPlanSnapshotSignature(nextPlan);

    if (supplementPlanHistoryState.cycleId !== normalizedCycleId) {
        resetSupplementPlanHistoryState(normalizedCycleId);
    }

    const currentEntry =
        supplementPlanHistoryState.index >= 0
            ? supplementPlanHistoryState.entries[supplementPlanHistoryState.index] || null
            : null;
    const currentSignature = currentEntry ? getSupplementPlanSnapshotSignature(currentEntry) : '';

    if (supplementPlanHistoryState.entries.length === 0) {
        supplementPlanHistoryState.entries = [nextPlan];
        supplementPlanHistoryState.index = 0;
        return;
    }

    if (currentSignature === nextSignature) {
        return;
    }

    const existingIndex = supplementPlanHistoryState.entries.findIndex((entry) => {
        return getSupplementPlanSnapshotSignature(entry) === nextSignature;
    });

    if (existingIndex >= 0) {
        supplementPlanHistoryState.index = existingIndex;
        return;
    }

    let nextEntries = supplementPlanHistoryState.entries
        .slice(0, supplementPlanHistoryState.index + 1)
        .concat([nextPlan]);

    if (nextEntries.length > SUPPLEMENT_PLAN_HISTORY_LIMIT) {
        nextEntries = nextEntries.slice(nextEntries.length - SUPPLEMENT_PLAN_HISTORY_LIMIT);
    }

    supplementPlanHistoryState.entries = nextEntries;
    supplementPlanHistoryState.index = nextEntries.length - 1;
}

function hasSupplementPlanHistoryChanges() {
    return canUndoSupplementPlanHistory() || canRedoSupplementPlanHistory();
}

function canUndoSupplementPlanHistory() {
    return supplementPlanHistoryState.index > 0;
}

function canRedoSupplementPlanHistory() {
    return supplementPlanHistoryState.index >= 0 && supplementPlanHistoryState.index < supplementPlanHistoryState.entries.length - 1;
}

function syncSupplementTableTopBarMenuLegacy_DoNotUse() {
    const topBar = document.querySelector('.top-bar.top-bar--supplements-table');
    const leftGroup = topBar?.querySelector('.topbar-cycle-btns');
    if (!topBar || !leftGroup) return;

    const calendarBtn = leftGroup.querySelector('.supplements-topbar-calendar-btn');
    const addBtn = leftGroup.querySelector('.supplements-topbar-add-btn');
    let menu = leftGroup.querySelector('.supplements-topbar-inline-menu');
    if (!menu) {
        menu = createElement('div', 'supplements-topbar-inline-menu');
        calendarBtn?.insertAdjacentElement('beforebegin', menu);
    }

    const selectionActive = isSupplementTableSheetSelectionActive();
    const historyVisible = hasSupplementPlanHistoryChanges();
    const menuVisible = selectionActive || historyVisible;

    if (calendarBtn) {
        calendarBtn.style.display = selectionActive ? 'none' : '';
    }
    if (addBtn) {
        addBtn.style.display = selectionActive ? 'none' : '';
    }

    menu.replaceChildren();
    menu.classList.toggle('is-open', menuVisible);
    if (!menuVisible) return;

    const createIconBtn = (className, label, html, onClick, disabled = false) => {
        const btn = createElement('button', `supplements-topbar-inline-menu-btn ${className}`, '');
        btn.type = 'button';
        btn.disabled = disabled;
        btn.setAttribute('aria-label', label);
        btn.innerHTML = html;
        btn.addEventListener('click', onClick);
        return btn;
    };

    const draftDirty = isSupplementTableSheetDraftDirty();
    const canUndo = canUndoSupplementPlanHistory() && !draftDirty;
    const canRedo = canRedoSupplementPlanHistory() && !draftDirty;

    if (editorTopBarVisible) {
        const style = cloneSupplementDoseStyle(supplementTableSheetState.draft?.style);

        const colorBtn = createIconBtn(
            `supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--format ${supplementTableSheetState.formatPanelOpen ? 'is-active' : ''}`,
            'Формат',
            `<span class="supplements-topbar-inline-menu-btn__letter">A</span>`,
            () => toggleSupplementTableFormatPanel()
        );
        colorBtn.style.setProperty('--supplement-editor-accent', style.color || '#111827');
        colorBtn.setAttribute('aria-pressed', supplementTableSheetState.formatPanelOpen ? 'true' : 'false');

        const timeBtn = createIconBtn(
            `supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--time ${supplementTableSheetState.timePanelOpen ? 'is-active' : ''}`,
            'Время',
            `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"></path><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"></path><path fill="currentColor" d="M22 5h-2V3c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1V7h2c.55 0 1-.45 1-1s-.45-1-1-1"></path></svg>`,
            () => toggleSupplementTableTimePanel()
        );
        timeBtn.setAttribute('aria-pressed', supplementTableSheetState.timePanelOpen ? 'true' : 'false');

        const undoBtn = createIconBtn(
            'supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--undo',
            'Отменить',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Undo SVG Icon</title><path fill="currentColor" d="M7.825 13H15q1.25 0 2.125.875T18 16t-.875 2.125T15 19H8q-.425 0-.712-.288T7 18t.288-.712T8 17h7q.425 0 .713-.288T16 16t-.288-.712T15 15H7.825l1.6 1.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-3.3-3.3q-.15-.15-.213-.325T4.45 14t.063-.375t.212-.325l3.3-3.3q.275-.275.7-.275t.7.275t.275.7t-.275.7z"/></svg>`,
            () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index - 1),
            !canUndo
        );

        const redoBtn = createIconBtn(
            'supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--redo',
            'Повторить',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Redo SVG Icon</title><path fill="currentColor" d="M16.175 13H9q-1.25 0-2.125.875T6 16t.875 2.125T9 19h7q.425 0 .713-.288T17 18t-.288-.712T16 17H9q-.425 0-.712-.288T8 16t.288-.712T9 15h7.175l-1.6 1.6q-.275.275-.275.7t.275.7t.7.275t.7-.275l3.3-3.3q.15-.15.213-.325T19.55 14t-.062-.375t-.213-.325l-3.3-3.3q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7z"/></svg>`,
            () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index + 1),
            !canRedo
        );

        const doneBtn = createIconBtn(
            'supplements-topbar-inline-menu-btn--editor supplements-topbar-inline-menu-btn--done',
            'Готово',
            `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Check SVG Icon</title><path fill="currentColor" d="M9.55 18q-.3 0-.575-.125t-.475-.35l-3.9-3.9q-.3-.3-.287-.712t.287-.713q.3-.3.713-.3t.712.3l3.525 3.525l8.525-8.525q.3-.3.713-.3t.712.3q.3.3.3.713t-.3.712l-8.9 8.9q-.2.2-.475.325T9.55 18"/></svg>`,
            () => {
                if (isSupplementTableSheetDraftDirty()) {
                    showToast('Сохраните данные');
                    return;
                }
                clearSupplementTableCellSelection({ preserveMenu: false, revertPreview: false });
            }
        );

        menu.append(undoBtn, redoBtn, colorBtn, timeBtn, doneBtn);
        return;
    }

    if (historyVisible && !selectionActive) {
        menu.append(
            createIconBtn(
                'supplements-topbar-inline-menu-btn--undo',
                'Отменить',
                `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Undo SVG Icon</title><path fill="currentColor" d="M7.825 13H15q1.25 0 2.125.875T18 16t-.875 2.125T15 19H8q-.425 0-.712-.288T7 18t.288-.712T8 17h7q.425 0 .713-.288T16 16t-.288-.712T15 15H7.825l1.6 1.6q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-3.3-3.3q-.15-.15-.213-.325T4.45 14t.063-.375t.212-.325l3.3-3.3q.275-.275.7-.275t.7.275t.275.7t-.275.7z"/></svg>`,
                () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index - 1),
                !canUndo
            ),
            createIconBtn(
                'supplements-topbar-inline-menu-btn--redo',
                'Повторить',
                `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Redo SVG Icon</title><path fill="currentColor" d="M16.175 13H9q-1.25 0-2.125.875T6 16t.875 2.125T9 19h7q.425 0 .713-.288T17 18t-.288-.712T16 17H9q-.425 0-.712-.288T8 16t.288-.712T9 15h7.175l-1.6 1.6q-.275.275-.275.7t.275.7t.7.275t.7-.275l3.3-3.3q.15-.15.213-.325T19.55 14t-.062-.375t-.213-.325l-3.3-3.3q-.275-.275-.7-.275t-.7.275t-.275.7t.275.7z"/></svg>`,
                () => applySupplementPlanHistoryIndex(supplementPlanHistoryState.index + 1),
                !canRedo
            )
        );
    }
}

function commitSupplementPlanHistoryEntry(previousPlan, nextPlan) {
    syncSupplementPlanHistoryWithState(previousPlan);

    const prevEntry =
        supplementPlanHistoryState.index >= 0
            ? supplementPlanHistoryState.entries[supplementPlanHistoryState.index] || null
            : null;
    const prevSignature = prevEntry ? getSupplementPlanSnapshotSignature(prevEntry) : '';
    const nextEntry = cloneSupplementPlanHistoryEntry(nextPlan);
    const nextSignature = getSupplementPlanSnapshotSignature(nextEntry);

    if (prevSignature === nextSignature) return;

    let nextEntries = supplementPlanHistoryState.entries
        .slice(0, supplementPlanHistoryState.index + 1)
        .concat([nextEntry]);

    if (nextEntries.length > SUPPLEMENT_PLAN_HISTORY_LIMIT) {
        nextEntries = nextEntries.slice(nextEntries.length - SUPPLEMENT_PLAN_HISTORY_LIMIT);
    }

    supplementPlanHistoryState.entries = nextEntries;
    supplementPlanHistoryState.index = nextEntries.length - 1;
}

async function applySupplementPlanHistoryIndex(nextIndex) {
    if (
        nextIndex < 0 ||
        nextIndex >= supplementPlanHistoryState.entries.length ||
        nextIndex === supplementPlanHistoryState.index
    ) {
        return;
    }

    if (isSupplementTableSheetDraftDirty()) return;

    const nextPlan = cloneSupplementPlanHistoryEntry(supplementPlanHistoryState.entries[nextIndex]);
    const currentPlan = cloneSupplementPlanHistoryEntry(state.supplementPlan || supplementPlanHistoryState.entries[supplementPlanHistoryState.index]);

    clearSupplementTableCellSelection({ preserveMenu: true, revertPreview: true });
    state._supplementsSkipNextRenderSignature = getSupplementPlanSnapshotSignature(nextPlan);

    const saved = await updateSupplementPlanInFirestore(nextPlan, {
        previousPlanOverride: currentPlan,
        historyMode: 'apply-history',
        historyIndex: nextIndex
    });

    if (!saved) {
        delete state._supplementsSkipNextRenderSignature;
        return;
    }

    renderSupplementsPage();
    supplementTableSheetState.menuOpen = true;
    syncSupplementTableTopBarMenu();
}

function clearSupplementDoseLongPressPopover() {
    if (typeof supplementDoseLongPressOverlayCleanup === 'function') {
        supplementDoseLongPressOverlayCleanup();
    }
    supplementDoseLongPressOverlayCleanup = null;
}

/** Сбрасывает один следующий click по ячейкам таблицы (как после лонг-пресса), чтобы закрытие меню не открывало модалку. */
function suppressNextSupplementTableDoseCellClick(tableWrapper) {
    if (!tableWrapper) return;
    tableWrapper.dataset.supplementDoseLongPressSuppress = '1';
    setTimeout(() => {
        if (tableWrapper.dataset.supplementDoseLongPressSuppress === '1') {
            delete tableWrapper.dataset.supplementDoseLongPressSuppress;
        }
    }, 260);
}

function getSupplementDoseFromState(dateStr, supplementName) {
    const plan = state.supplementPlan || { data: [] };
    const dayRecord = (plan.data || []).find(day => day.date === dateStr);
    return dayRecord?.doses?.[supplementName] || '';
}

function applySupplementDoseCellVisualStyle(button, rawDose) {
    if (!button) return;
    const dose = parseSupplementDoseValue(rawDose);
    const style = cloneSupplementDoseStyle(dose.style);

    button.classList.toggle('supplement-dose-cell-btn--bold', style.bold);
    button.classList.toggle('supplement-dose-cell-btn--italic', style.italic);
    button.classList.toggle('supplement-dose-cell-btn--underline', style.underline);
    button.classList.toggle('supplement-dose-cell-btn--strike', style.strike);
    button.classList.toggle('supplement-dose-cell-btn--align-left', style.align === 'left');
    button.classList.toggle('supplement-dose-cell-btn--align-center', style.align === 'center');
    button.classList.toggle('supplement-dose-cell-btn--align-right', style.align === 'right');

    button.style.color = style.color || '';
    button.style.backgroundColor = style.background || '';
    button.style.textAlign = style.align || '';
    button.style.fontSize = `${style.fontSize || 10}px`;
    button.style.fontFamily = style.fontFamily || 'Arial';
    button.style.alignItems = style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center';
    button.style.justifyContent = style.verticalAlign === 'top' ? 'flex-start' : style.verticalAlign === 'bottom' ? 'flex-end' : 'center';
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
    applySupplementDoseCellVisualStyle(button, rawDose);

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

function showSupplementDoseLongPressActionMenu(tableWrapper, anchorElement, menuConfig) {
    clearSupplementDoseLongPressPopover();
    if (!tableWrapper || !anchorElement || !menuConfig || typeof menuConfig.onPick !== 'function') return;

    const { hasCellValue, hasClipboard, onPick, mergeMenu = { actionId: 'merge', label: 'Объединить' } } =
        menuConfig;
    const normalizedMergeMenu =
        mergeMenu?.actionId === 'merge'
            ? { ...mergeMenu, label: 'Выделить' }
            : mergeMenu?.actionId === 'splitMerge'
                ? { ...mergeMenu, label: 'Снять объединение' }
                : mergeMenu;
    const pasteLabel =
        menuConfig.pasteLabel ||
        (hasCellValue && hasClipboard ? 'Заменить' : 'Вставить');

    const cutEnabled = Boolean(hasCellValue);
    const copyEnabled = Boolean(hasCellValue);
    const pasteEnabled = Boolean(hasClipboard);
    const deleteEnabled = Boolean(hasCellValue);

    const popover = createElement(
        'div',
        'supplement-dose-longpress-popover supplement-dose-longpress-popover--menu'
    );

    const rows = [
        { id: 'cut', label: 'Вырезать', enabled: cutEnabled },
        { id: 'copy', label: 'Копировать', enabled: copyEnabled },
        { id: 'paste', label: pasteLabel, enabled: pasteEnabled },
        { id: 'delete', label: 'Удалить', enabled: deleteEnabled }
    ];

    rows.forEach((row) => {
        const btn = createElement('button', 'supplement-dose-longpress-menu-item', row.label);
        btn.type = 'button';
        btn.disabled = !row.enabled;
        if (!row.enabled) btn.classList.add('supplement-dose-longpress-menu-item--disabled');
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!row.enabled) return;
            close();
            await onPick(row.id);
        });
        popover.append(btn);
    });

    popover.append(createElement('div', 'supplement-dose-longpress-menu-divider'));

    const mergeBtn = createElement('button', 'supplement-dose-longpress-menu-item', normalizedMergeMenu.label);
    mergeBtn.type = 'button';
    mergeBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
        await onPick(normalizedMergeMenu.actionId);
    });
    popover.append(mergeBtn);

    document.body.append(popover);

    let closed = false;
    const syncPosition = () => {
        if (closed || !popover.isConnected || !anchorElement.isConnected) return;
        const anchorRect = anchorElement.getBoundingClientRect();
        const viewportWidth = Math.round(
            window.innerWidth ||
                document.documentElement?.clientWidth ||
                0
        );
        const viewportHeight = Math.round(
            window.innerHeight ||
                document.documentElement?.clientHeight ||
                0
        );
        const popoverWidth = Math.round(popover.offsetWidth || 160);
        const popoverHeight = Math.round(popover.offsetHeight || 120);
        const nextLeft = clampValue(
            Math.round(anchorRect.left + (anchorRect.width - popoverWidth) / 2),
            8,
            Math.max(8, viewportWidth - popoverWidth - 8)
        );
        let nextTop = Math.round(anchorRect.top - popoverHeight - 8);
        if (nextTop < 8) {
            nextTop = Math.round(anchorRect.bottom + 8);
        }
        nextTop = clampValue(nextTop, 8, Math.max(8, viewportHeight - popoverHeight - 8));

        popover.style.left = `${nextLeft}px`;
        popover.style.top = `${nextTop}px`;
    };

    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', handlePointerDown, true);
        tableWrapper.removeEventListener('scroll', handleWrapperScroll);
        window.removeEventListener('resize', handleViewportChange);
        popover.remove();
        if (supplementDoseLongPressOverlayCleanup === close) {
            supplementDoseLongPressOverlayCleanup = null;
        }
    };

    const handleViewportChange = () => syncPosition();
    const handleWrapperScroll = () => close();
    const handlePointerDown = (event) => {
        if (popover.contains(event.target)) return;
        if (tableWrapper.contains(event.target)) {
            suppressNextSupplementTableDoseCellClick(tableWrapper);
        }
        close();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    tableWrapper.addEventListener('scroll', handleWrapperScroll, { passive: true });
    window.addEventListener('resize', handleViewportChange);

    requestAnimationFrame(syncPosition);
    supplementDoseLongPressOverlayCleanup = close;
}

function formatSupplementDoseQuantity(rawDose, options = {}) {
    const dose = parseSupplementDoseValue(rawDose);
    if (dose.text) return dose.text;
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
    if (dose.text) {
        const textValue = dose.text;
        const timesText = formatSupplementTimesText(dose.times);
        return timesText ? `${textValue} в ${timesText}` : textValue;
    }
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

function getSupplementImportSourceCycles() {
    return (state.cycles || []).filter((cycle) => cycle?.id && cycle.id !== state.selectedCycleId);
}

function formatSupplementImportDateDisplay(isoDateString = '') {
    if (!isoDateString) return 'Выбрать';
    const [year, month, day] = String(isoDateString).split('-');
    if (!year || !month || !day) return 'Выбрать';
    return `${day}.${month}.${year}`;
}

function getSupplementImportPlanBounds(planData) {
    const sortedDates = (Array.isArray(planData?.data) ? planData.data : [])
        .map((dayRecord) => parseSupplementDateString(dayRecord?.date))
        .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
        .sort((left, right) => compareSupplementDates(left, right));
    if (sortedDates.length === 0) return null;

    const firstDate = formatSupplementDateString(sortedDates[0]);
    const lastDate = formatSupplementDateString(sortedDates[sortedDates.length - 1]);

    return {
        firstDate,
        lastDate,
        firstIso: dateToInputFormat(firstDate),
        lastIso: dateToInputFormat(lastDate)
    };
}

function hasSupplementPlanContent(planData) {
    const { plan } = sanitizeSupplementPlan(
        JSON.parse(JSON.stringify(planData || { supplements: [], data: [] }))
    );

    if (Array.isArray(plan.supplements) && plan.supplements.length > 0) {
        return true;
    }

    if (Array.isArray(plan.doseMerges) && plan.doseMerges.length > 0) {
        return true;
    }

    return Array.isArray(plan.data) && plan.data.some((dayRecord) =>
        Object.values(dayRecord?.doses || {}).some((value) => hasSupplementDoseValue(value))
    );
}

function getSupplementDateOffset(baseDate, targetDate) {
    return Math.round((cloneSupplementDate(targetDate).getTime() - cloneSupplementDate(baseDate).getTime()) / 86400000);
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

async function updateSupplementPlanInFirestore(newPlan, options = {}) {
    const cycleRef = getCycleDocRef(); // 👈 теперь цикл, а не supplements
    if (!cycleRef) {
        showToast('Ошибка: Не выбран цикл для сохранения плана добавок.');
        return false;
    }

    try {
        // Любое изменение плана вызывает перерендер страницы; фиксируем текущий скролл таблицы,
        // чтобы после добавления/удаления/редактирования не сбрасывало на текущую неделю.
        const previousPlan = cloneSupplementPlanHistoryEntry(options.previousPlanOverride ?? state.supplementPlan);
        const previousSignature = getSupplementPlanSnapshotSignature(previousPlan);
        const { plan: sanitizedPlan } = sanitizeSupplementPlan(newPlan);
        const nextSignature = getSupplementPlanSnapshotSignature(sanitizedPlan);
        if (previousSignature === nextSignature) {
            state.supplementPlan = sanitizedPlan;
            syncSupplementsBottomNavBadge(sanitizedPlan);
            if (options.historyMode === 'apply-history' && Number.isInteger(options.historyIndex)) {
                supplementPlanHistoryState.index = options.historyIndex;
            } else {
                syncSupplementPlanHistoryWithState(sanitizedPlan, state.selectedCycleId);
            }
            syncSupplementTableTopBarMenu();
            return true;
        }
        rememberCurrentSupplementTableScroll();
        await updateDoc(cycleRef, { supplementPlan: sanitizedPlan });
        state.supplementPlan = sanitizedPlan;
        syncSupplementsBottomNavBadge(sanitizedPlan);
        if (options.historyMode === 'apply-history' && Number.isInteger(options.historyIndex)) {
            supplementPlanHistoryState.index = options.historyIndex;
        } else {
            commitSupplementPlanHistoryEntry(previousPlan, sanitizedPlan);
        }
        syncSupplementTableTopBarMenu();
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

    const newPlan = appendWeeksToSupplementPlan(state.supplementPlan, currentCycle, 1);
    if (!newPlan) return;

    await updateSupplementPlanInFirestore(newPlan);
}

async function addSupplementExtraWeeks(weeksRaw) {
    const currentCycle = state.cycles.find((c) => c.id === state.selectedCycleId);
    if (!currentCycle || !state.supplementPlan) return;

    const weeks = Math.floor(Number(weeksRaw));
    if (!Number.isFinite(weeks) || weeks === 0) {
        showToast('Укажите число недель: положительное — добавить, отрицательное — убрать с конца.');
        return;
    }

    let newPlan;
    if (weeks < 0) {
        newPlan = removeWeeksFromSupplementPlan(state.supplementPlan, -weeks);
        if (!newPlan) {
            showToast('Не удалось удалить недели: мало дней в плане.');
            return;
        }
        showToast(`Удалено ${-weeks} ${formatSupplementWeeksWordRu(-weeks)} с конца плана.`);
    } else {
        newPlan = appendWeeksToSupplementPlan(state.supplementPlan, currentCycle, weeks);
        if (!newPlan) return;
    }

    await updateSupplementPlanInFirestore(newPlan);
}

function formatSupplementWeeksWordRu(n) {
    const abs = Math.abs(Math.floor(Number(n)) || 0);
    const last = abs % 10;
    const lastTwo = abs % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return 'недель';
    if (last === 1) return 'неделя';
    if (last >= 2 && last <= 4) return 'недели';
    return 'недель';
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
  const previousPlan = state.supplementPlan;
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

  if (Array.isArray(plan.doseMerges)) {
    plan.doseMerges = plan.doseMerges.map((merge) => {
      const nextMerge = { ...merge };
      const normalizedSlot = normalizeSupplementSlot(nextMerge.slot);
      if (slotRemap.has(normalizedSlot)) {
        nextMerge.slot = slotRemap.get(normalizedSlot);
      }
      return nextMerge;
    });
  }

  const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
  if (!saved) return false;

  const previousSignature = getSupplementPlanSnapshotSignature(previousPlan);
  const nextSignature = getSupplementPlanSnapshotSignature(plan);
  if (previousSignature !== nextSignature && !hasSupplementPlanHistoryChanges()) {
    commitSupplementPlanHistoryEntry(previousPlan, plan);
  }

  syncSupplementTableTopBarMenu();
  renderSupplementsPage();
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
    suppressNextSupplementTableDoseCellClick(tableWrapper);
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
    const slot = Number(button?.dataset.supplementSlot);
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

    if (action === 'cut') {
      const rawDose = getSupplementDoseFromState(dateStr, supplementName);
      if (!hasSupplementDoseValue(rawDose)) return;
      setSupplementDoseClipboardValue(rawDose, {
        cellKey: `${dateStr}::${supplementName}`,
        dateStr,
        supplementName
      });

      const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
      const { scope } = clearSupplementDoseCellOrMergeInPlan(plan, dateStr, supplementName, slot);
      if (scope === 'none') return;

      const previousPlan = state.supplementPlan;
      const previousRawDose = getSupplementDoseFromState(dateStr, supplementName);
      state.supplementPlan = plan;
      syncSupplementsBottomNavBadge(plan);
      state._supplementsSkipNextRenderSignature = getSupplementPlanSnapshotSignature(plan);

      rememberCurrentSupplementTableScroll();
      navigator.vibrate?.(8);
      if (scope === 'single') {
        updateSupplementDoseCellButton(button, '');
      }

      const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
      if (!saved) {
        state.supplementPlan = previousPlan;
        syncSupplementsBottomNavBadge(previousPlan);
        delete state._supplementsSkipNextRenderSignature;
        if (scope === 'single') {
          updateSupplementDoseCellButton(button, previousRawDose);
        } else if (scope === 'merge' || scope === 'block') {
          await renderSupplementsPage();
        }
        return;
      }
      showToast('Вырезано');
      if (scope === 'merge') {
        renderSupplementsPage();
      }
      return;
    }

    if (action === 'delete') {
      const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
      const { scope } = clearSupplementDoseCellOrMergeInPlan(plan, dateStr, supplementName, slot);
      if (scope === 'none') return;

      const previousPlan = state.supplementPlan;
      const previousRawDose = getSupplementDoseFromState(dateStr, supplementName);
      state.supplementPlan = plan;
      syncSupplementsBottomNavBadge(plan);
      state._supplementsSkipNextRenderSignature = getSupplementPlanSnapshotSignature(plan);

      rememberCurrentSupplementTableScroll();
      navigator.vibrate?.(8);
      if (scope === 'single') {
        updateSupplementDoseCellButton(button, '');
      }

      const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
      if (!saved) {
        state.supplementPlan = previousPlan;
        syncSupplementsBottomNavBadge(previousPlan);
        delete state._supplementsSkipNextRenderSignature;
        if (scope === 'single') {
          updateSupplementDoseCellButton(button, previousRawDose);
        }
        return;
      }
      showToast('Удалено');
      if (scope === 'merge') {
        renderSupplementsPage();
      }
      return;
    }

    if (action === 'paste') {
      if (!hasSupplementDoseClipboardValue() && !hasSupplementDoseRangeClipboardValue()) return;

      const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
      const previousPlan = state.supplementPlan;
      const previousRawDose = getSupplementDoseFromState(dateStr, supplementName);
      const { scope } = hasSupplementDoseRangeClipboardValue()
        ? pasteSupplementDoseRangeToPlan(
            plan,
            dateStr,
            supplementName,
            slot,
            supplementDoseRangeClipboard
          )
        : pasteSupplementDoseToCellOrMergeInPlan(
            plan,
            dateStr,
            supplementName,
            slot,
            supplementDoseClipboard
          );
      if (scope === 'none') return;

      state.supplementPlan = plan;
      syncSupplementsBottomNavBadge(plan);
      if (scope === 'single') {
        const dayIndex = plan.data.findIndex(day => day.date === dateStr);
        updateSupplementDoseCellButton(button, plan.data[dayIndex]?.doses?.[supplementName]);
      } else if (scope === 'merge' || scope === 'block') {
        await renderSupplementsPage();
      }
      state._supplementsSkipNextRenderSignature = getSupplementPlanSnapshotSignature(plan);

      rememberCurrentSupplementTableScroll();
      navigator.vibrate?.(8);
      const saved = await updateSupplementPlanInFirestore(plan, { previousPlanOverride: previousPlan });
      if (!saved) {
        state.supplementPlan = previousPlan;
        syncSupplementsBottomNavBadge(previousPlan);
        delete state._supplementsSkipNextRenderSignature;
        if (scope === 'single') {
          updateSupplementDoseCellButton(button, previousRawDose);
        }
        return;
      }
      showToast(hasSupplementDoseValue(previousRawDose) ? 'Заменено' : 'Вставлено');
      if (scope === 'merge' || scope === 'block') {
        await renderSupplementsPage();
      }
      return;
    }
  };

  const triggerLongPressAction = (button) => {
    const dateStr = button?.dataset.date || '';
    const supplementName = button?.dataset.supplementName || '';
    if (!dateStr || !supplementName) return;

    const rawDose = getSupplementDoseFromState(dateStr, supplementName);
    const hasCellValue = hasSupplementDoseValue(rawDose);
    const hasClipboard = hasSupplementDoseClipboardValue() || hasSupplementDoseRangeClipboardValue();

    const slot = Number(button?.dataset?.supplementSlot);
    const mergeCover =
        state.supplementPlan && Number.isFinite(slot)
            ? findSupplementDoseMergeCovering(state.supplementPlan, dateStr, slot, supplementName)
            : null;
    const isMergedDoseCell = Boolean(mergeCover && mergeCover.startDate === dateStr);

    longPressTriggered = true;
    suppressNextClick();
    navigator.vibrate?.(8);

    if (supplementDoseMergeSession?.tableWrapper === tableWrapper) {
      endSupplementDoseMergeMode();
    }

    showSupplementDoseLongPressActionMenu(tableWrapper, button, {
      hasCellValue,
      hasClipboard,
      pasteLabel: hasCellValue && hasClipboard ? 'Заменить' : 'Вставить',
      mergeMenu: isMergedDoseCell
        ? { actionId: 'splitMerge', label: 'Снять выделение' }
        : { actionId: 'merge', label: 'Объединить' },
      onPick: async (actionId) => {
        if (actionId === 'merge') {
          startSupplementDoseMergeMode(tableWrapper, button);
          return;
        }
        if (actionId === 'splitMerge') {
          await applySplitSupplementDoseMerge(button);
          return;
        }
        await runCellAction(button, actionId);
      }
    });
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

  const viewportHeight = Math.round(window.innerHeight || document.documentElement?.clientHeight || 0);
  const viewportWidth = Math.round(window.innerWidth || document.documentElement?.clientWidth || 0);
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
  modal.className = `modal-window supplement-edit-modal ${MODAL_TEXT_INPUT_CLASS}`;
  prepareKeyboardDockedModal(backdrop, modal);

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
  presentKeyboardDockedModal(backdrop, modal);

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
  prepareKeyboardDockedModal(backdrop, modal);
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
  presentKeyboardDockedModal(backdrop, modal);

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
