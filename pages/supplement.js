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

export function resetSupplementsListener() {
    // План БАДов синхронизируется через onSnapshot на документе цикла в script.js (setupDynamicListeners).
}
// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР ПЛАНА БАДОВ/ДОБАВОК (Обновлена)
// =================================================================
export async function renderSupplementsPage() {
    const root = document.getElementById('root');
    if (!ensureCycleSelected(render)) return;

    const currentCycle = state.cycles?.find(c => c.id === state.selectedCycleId);
    root.innerHTML = '';

    renderTopBar();

    const contentContainer = document.createElement('div');
    contentContainer.id = 'supplements-content';
    contentContainer.className = 'supplements-page';

    if (!currentCycle) {
        contentContainer.append(
            createElement('h3', null, 'План приема БАДов'),
            createElement('div', 'muted', 'Цикл не найден. Выберите другой.')
        );
        root.append(contentContainer);
        return;
    }


    // --- Заголовок ---
    const title = createElement('h3');
    title.innerHTML = `План добавок: <span>${currentCycle.name}</span>`;
    contentContainer.append(title);




    // --- Проверяем план добавок ---
    if (!state.supplementPlan || !state.supplementPlan.data) {
        contentContainer.append(
            createElement('div', 'muted', 'План добавок пока не загружен.')
        );
        root.append(contentContainer);
        return;
    }

    // --- Всё готово, можно рендерить план ---
    console.log('✅ План добавок загружен:', state.supplementPlan);
    root.append(contentContainer);

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
   if (currentSupplements.length >= 5) {
       const addSupplementBtn = createElement('button', 'btn btn-primary add-supplement-btn');
       const addSupplementBtnTitle = createElement('span', 'title-add-btn','препарат');
         addSupplementBtn.innerHTML = `
               <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><title>Add-plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h6m0 0h6m-6 0v6m0-6V6"></path></svg>
           `;
       addSupplementBtnWrap.append(addSupplementBtnTitle,addSupplementBtn);


       addSupplementBtn.addEventListener('click', () => {
           // 🔹 Открываем ту же модалку, что при клике на supplement-col
           openSupplementEditModal(currentSupplements.length, '');
       });
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





    // Добавляем обе группы управления
    controlsWrapper.append(addSupplementBtnWrap,weekControlsGroup);
    contentContainer.append(controlsWrapper);


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

    const realNames = getSupplementNames(planData);
    const displayNames = [...realNames];
    while (displayNames.length < 5) displayNames.push(''); // минимум 5 колонок

    // Строим столбцы
    displayNames.forEach((name, i) => {
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
        if (dayRecord.date === todayDateString) rowClasses += ' today-highlight';
        if (dayRecord.dayOfWeek === 'вс' || dayRecord.dayOfWeek === 'сб') rowClasses += ' weekend';

        const tr = createElement('tr', rowClasses.trim());
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
async function updateSupplementPlanInFirestore(newPlan) {
    const cycleRef = getCycleDocRef(); // 👈 теперь цикл, а не supplements
    if (!cycleRef) {
        showToast('Ошибка: Не выбран цикл для сохранения плана добавок.');
        return;
    }

    try {
        await updateDoc(cycleRef, { supplementPlan: newPlan });
        // showToast('План добавок сохранен!');
        console.log("✅ supplementPlan обновлён в документе цикла:", newPlan);
    } catch (error) {
        console.error("Ошибка при сохранении плана добавок:", error);
        showToast('Ошибка сохранения плана добавок. Проверьте правила Firestore!');
    }
}

// 🔥 НОВАЯ ЛОГИКА: Добавление препарата (Минимальная версия)
async function addSupplement(supplementName) {
    if (!state.supplementPlan) return;

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

    if (newPlan.supplements.includes(supplementName)) {
        showToast('Этот препарат уже добавлен!');
        return;
    }

    newPlan.supplements.push(supplementName);

    // Добавляем пустые поля для нового препарата во все существующие записи
    newPlan.data = newPlan.data.map(dayRecord => {
        dayRecord.doses = dayRecord.doses || {};
        dayRecord.doses[supplementName] = '';
        return dayRecord;
    });

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
        newPlan.supplements.forEach(supName => {
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
    if (planData.supplements.length === 0 || filteredSupplementsData.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">План приема БАДов</h3>
                <p style="text-align: center; color: #888;">Нет данных по приему добавок за выбранный период.</p>
            </div>
        `;
    }

    const supplementNames = planData.supplements.map(name => {
        return typeof name === 'object' && name.name ? name.name : name;
    });

    // 🔥 НОВЫЙ ПАРАМЕТР: МАКСИМАЛЬНОЕ КОЛИЧЕСТВО СТОЛБЦОВ НА ЭКРАН (для мобильного)
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
                const dose = dayRecord.doses && dayRecord.doses[supName] ? dayRecord.doses[supName] : '';
                return `<td style="font-size: 0.9em;">${dose || '—'}</td>`;
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
function getSupplementNames(planData) {
  if (!planData || !Array.isArray(planData.supplements)) return [];
  return planData.supplements.map(s => (typeof s === 'object' && s?.name) ? s.name : String(s));
}

// Переименование препарата
async function renameSupplement(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const plan = JSON.parse(JSON.stringify(state.supplementPlan || { supplements: [], data: [] }));
  const names = getSupplementNames(plan);
  const idx = names.indexOf(oldName);
  if (idx === -1) return;

  plan.supplements[idx] = newName;

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
function enableHeaderDnd(thead, planData) {
  const names = getSupplementNames(planData);
  let dragFrom = null;

  thead.querySelectorAll('th.supplement-col').forEach((th, i) => {
    const isReal = i < names.length;
    th.draggable = isReal;

    th.addEventListener('dragstart', e => {
      if (!isReal) return;
      dragFrom = i;
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

      const dragTo = i;
      if (dragTo === dragFrom || dragTo >= names.length) { dragFrom = null; return; }

      const plan = JSON.parse(JSON.stringify(state.supplementPlan));
      const arr = getSupplementNames(plan);
      const moved = arr.splice(dragFrom, 1)[0];
      arr.splice(dragTo, 0, moved);
      plan.supplements = arr;

      await updateSupplementPlanInFirestore(plan);
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

function openSupplementEditModal(index, currentName) {
  const plan = JSON.parse(JSON.stringify(state.supplementPlan));
  const names = getSupplementNames(plan);
  const isExisting = !!currentName && currentName.trim() !== '';

  // Создаём затемнение
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal-window';
  modal.innerHTML = `
    <h3>${isExisting ? 'Редактирование препарата' : 'Добавить препарат'}</h3>
    <input type="text" class="modal-input" value="${currentName || ''}" placeholder="Введите имя препарата">
    ${isExisting ? `
      <div class="position-controls">
        <button class="btn small-btn" id="pos-left">←</button>
        <span>Позиция: <b id="pos-value">${index + 1}</b></span>
        <button class="btn small-btn" id="pos-right">→</button>
      </div>
    ` : ''}
    <div class="modal-buttons">
      ${isExisting ? '<button class="btn btn-danger" id="delete-sup">Удалить</button>' : ''}
      <button class="btn btn-secondary" id="cancel-modal">Отмена</button>
      <button class="btn btn-primary" id="save-modal">ОК</button>
    </div>
  `;

  backdrop.append(modal);
  document.body.append(backdrop);

  const input = modal.querySelector('.modal-input');
  const posValue = modal.querySelector('#pos-value');
  let newPos = index;

  // ===== стрелки для позиции =====
  if (isExisting) {
    modal.querySelector('#pos-left').addEventListener('click', () => {
      if (newPos > 0) {
        newPos--;
        posValue.textContent = newPos + 1;
      }
    });
    modal.querySelector('#pos-right').addEventListener('click', () => {
      if (newPos < names.length - 1) {
        newPos++;
        posValue.textContent = newPos + 1;
      }
    });
  }

  // ===== удаление через openConfirmModal =====
  if (isExisting) {
    modal.querySelector('#delete-sup').addEventListener('click', () => {
      // Сначала закрываем текущее окно редактирования
      backdrop.remove();

      // Затем вызываем твою модалку подтверждения
      openConfirmModal(`Удалить препарат "${currentName}"?`, async () => {
        plan.supplements = names.filter((_, i) => i !== index);
        plan.data = (plan.data || []).map(d => {
          if (d.doses) delete d.doses[currentName];
          return d;
        });

        await updateSupplementPlanInFirestore(plan);
      });
    });
  }

  // ===== сохранение =====
  modal.querySelector('#save-modal').addEventListener('click', async () => {
    const newName = input.value.trim();
    if (!newName) return showToast('Введите имя препарата');

    if (names.includes(newName) && newName !== currentName) {
      return showToast('Такой препарат уже есть.');
    }

    // Добавление нового
    if (!isExisting) {
      plan.supplements[index] = newName;
      plan.data = (plan.data || []).map(d => {
        d.doses = d.doses || {};
        d.doses[newName] = '';
        return d;
      });
      await updateSupplementPlanInFirestore(plan);
      backdrop.remove();
      return;
    }

    // Переименование
    (plan.data || []).forEach(d => {
      if (!d.doses) d.doses = {};
      if (d.doses[currentName]) {
        d.doses[newName] = d.doses[currentName];
        delete d.doses[currentName];
      }
    });

    plan.supplements[index] = newName;

    // Перемещение
    if (newPos !== index) {
      const moved = plan.supplements.splice(index, 1)[0];
      plan.supplements.splice(newPos, 0, moved);
    }

    await updateSupplementPlanInFirestore(plan);
    backdrop.remove();
  });

  modal.querySelector('#cancel-modal').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.remove();
  });
}


// =====================================================================
// 📅 МОДАЛЬНОЕ ОКНО ВЫБОРА ДАТ ДЛЯ PDF
// =====================================================================
export function openPdfDateModal(currentCycle) {
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




