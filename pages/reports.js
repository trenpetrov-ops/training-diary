import {
    addDoc,
    deleteDoc,
    doc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getTodayDateString,
    getReportsCollection,
    ensureCycleSelected,
    render,
    showToast,
    openConfirmModal,
    openDateModal,
    uploadUserMediaFileWithProgress,
    deleteUserFirebaseStorageFileByDownloadUrl
} from '../script.js';

// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР СТРАНИЦЫ ОТЧЕТОВ (ИСПРАВЛЕНО)
// =================================================================
export function renderReportsPage() {
    const root = document.getElementById('root');
    if (!ensureCycleSelected(render)) return;

    const contentContainer = createElement('div', 'reports-page');
    contentContainer.style.padding = '10px';

    const selectedCycle = state.cycles?.find(c => c.id === state.selectedCycleId);

    if (!selectedCycle) {
        // Цикл не выбран — только заголовок и сообщение
        contentContainer.appendChild(createElement('h3', null, 'Отчеты'));
        contentContainer.appendChild(createElement('div', 'muted', 'Выберите цикл на вкладке "Программы" для создания отчета.'));
        root.appendChild(contentContainer);

        // Навигация остаётся видимой
        const nav = document.querySelector('.navigation');
        if (nav) nav.style.display = 'flex';
        return;
    }

    // Цикл выбран — рендерим отчет как раньше
    contentContainer.appendChild(createElement('h3', null, `Отчеты: ${selectedCycle.name}`));

    const summaryBtn = createElement('button', 'btn btn-primary', '📊 Сводный отчет');
    summaryBtn.style.marginBottom = '15px';
    summaryBtn.addEventListener('click', openReportsSummaryModal);
    contentContainer.appendChild(summaryBtn);


    // Кнопки доступны только если есть выбранный цикл
    const createProgressReportBtn = createElement('button', 'btn btn-primary', '➕ Новый Замер/Фото');
    createProgressReportBtn.style.marginBottom = '15px';
    createProgressReportBtn.addEventListener('click', () => openProgressReportModal());
    contentContainer.appendChild(createProgressReportBtn);

    const compareBtn = createElement('button', 'btn btn-primary', '🔍 Сравнить');
    compareBtn.style.marginBottom = '15px';
    compareBtn.addEventListener('click', openCompareModal);
    contentContainer.appendChild(compareBtn);

    // Далее рендер списка отчетов (тот же код что у тебя)
    const reportsList = createElement('div', 'reports-list');
    reportsList.style.display = 'flex';
    reportsList.style.flexDirection = 'column';
    reportsList.style.gap = '15px';

    if (!state.reports || state.reports.length === 0) {
        reportsList.append(createElement('div', 'muted', 'Нет сохраненных отчетов.'));
    } else {
        state.reports.sort((a, b) => new Date(b.date.split('.').reverse().join('-')) - new Date(a.date.split('.').reverse().join('-')));
        state.reports.forEach(report => {
            const reportItem = createElement('div', 'report-item');
            reportItem.style.border = '1px solid #ccc';
            reportItem.style.borderRadius = '8px';
            reportItem.style.padding = '10px';
            reportItem.style.backgroundColor = '#fff';
            reportItem.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
            reportItem.style.display = 'flex';
            reportItem.style.flexDirection = 'column';
            reportItem.style.gap = '10px';

            reportItem.appendChild(createElement('div', 'report-date', `📅 ${report.date}`));

            if (report.metrics && report.metrics.length > 0) {
                const metricsDiv = createElement('div', 'report-metrics');
                metricsDiv.style.display = 'flex';
                metricsDiv.style.flexWrap = 'wrap';
                metricsDiv.style.gap = '5px';
                report.metrics.forEach(metric => {
                    const metricItem = createElement('div', 'metric-item', `${metric.name}: ${metric.value}`);
                    metricItem.style.backgroundColor = '#f0f0f0';
                    metricItem.style.padding = '4px 6px';
                    metricItem.style.borderRadius = '4px';
                    metricItem.style.fontSize = '14px';
                    metricsDiv.appendChild(metricItem);
                });
                reportItem.appendChild(metricsDiv);
            }

            if (report.photos && report.photos.length > 0) {
                const photosDiv = createElement('div', 'report-photos');
                photosDiv.style.display = 'flex';
                photosDiv.style.flexWrap = 'wrap';
                photosDiv.style.gap = '8px';
                report.photos.forEach((photo, index) => {
                    if (photo.url) {
                        const img = createElement('img');
                        img.src = photo.url;
                        img.style.width = '100px';
                        img.style.height = '100px';
                        img.style.objectFit = 'cover';
                        img.style.borderRadius = '5px';
                        img.style.cursor = 'pointer';
                        img.title = photo.name || `Фото ${index + 1}`;
                        photo.number = index + 1;
                        img.addEventListener('click', () => openFullScreenPhoto(photo.url, photo.name));
                        photosDiv.appendChild(img);
                    }
                });
                reportItem.appendChild(photosDiv);
            }

            if (report.comment) {
                const commentPreview = createElement('div', 'report-comment', report.comment.length > 50 ? report.comment.substring(0, 50) + '...' : report.comment);
                commentPreview.style.fontStyle = 'italic';
                commentPreview.style.color = '#555';
                reportItem.appendChild(commentPreview);
            }

            const actionsDiv = createElement('div', 'report-actions');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '5px';
            actionsDiv.style.flexWrap = 'wrap';

            const editBtn = createElement('button', 'btn btn-small btn-secondary', '✏️ Редактировать');
            editBtn.addEventListener('click', () => openProgressReportModal(report));
            const duplicateBtn = createElement('button', 'btn btn-small btn-secondary', '📋 Дублировать');
            duplicateBtn.addEventListener('click', () => openProgressReportModal(report, true));

            const deleteBtn = createElement('button', 'btn btn-small btn-danger', '🗑️ Удалить');
            deleteBtn.addEventListener('click', () => {
                openConfirmModal("Удалить этот отчет?", async () => {
                    await deleteReport(report.id);
                    showToast("Отчет удален!");
                });
            });


            actionsDiv.append(editBtn, duplicateBtn, deleteBtn);
            reportItem.appendChild(actionsDiv);

            reportsList.appendChild(reportItem);
        });
    }

    contentContainer.appendChild(reportsList);
    root.appendChild(contentContainer);
}


// -----------------------------------------------------------
// 🔥  ФУНКЦИЯ: МОДАЛЬНОЕ ОКНО ОТЧЕТА О ПРОГРЕССЕ
// -----------------------------------------------------------
 function openProgressReportModal(reportData = null, isDuplicate = false) {
    const root = document.getElementById('root');
    const overlay = createElement('div', 'modal-overlay', '');
    overlay.classList.add('active');

    let reportToEdit = reportData ? JSON.parse(JSON.stringify(reportData)) : {};

    if (isDuplicate && reportData) {
        // Дублирование: сохраняем шаблон, но очищаем значения, фото и ID
        reportToEdit = {
            metricTemplate: reportData.metricTemplate,
            metrics: (reportData.metricTemplate || []).map(m => ({ name: m.name, value: '' })),
            comment: '',
            photos: [],
            id: null
        };
    } else if (!reportToEdit.metrics) {
        reportToEdit.metrics = [];
        reportToEdit.photos = [];
        reportToEdit.comment = '';
    }

    const modalContent = createElement('div', 'modal-content modal-progress-report');
    modalContent.style.maxWidth = '600px';

    // --- ЗАГОЛОВОК ---
    modalContent.appendChild(createElement('div', 'modal-title', reportData ? 'Редактирование Отчета' : 'Новый Отчет о Прогрессе'));

    // --- Дата ---
    const reportDateRow = createElement('div', 'report-date-display', '');
    reportDateRow.style.marginBottom = '15px';

    const reportDateText = createElement('span', null, `Дата: ${reportToEdit.date || getTodayDateString()}`);
    reportDateRow.appendChild(reportDateText);

    // Редактирование даты — только когда открыли "Редактировать" (не при дубликате и не при новом)
    if (reportData && !isDuplicate) {
        const editBtn = createElement('button', 'edit-date-btn');
        editBtn.type = 'button';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24"><title>Edit SVG Icon</title><path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path></svg>`;

        editBtn.addEventListener('click', () => {
            const current = reportToEdit.date || getTodayDateString();
            openDateModal(current, async (newDate) => {
                if (!newDate) return;
                const [year, month, day] = newDate.split('-');
                const formatted = `${day}.${month}.${year}`;
                reportToEdit.date = formatted;
                reportDateText.textContent = `Дата: ${formatted}`;
            });
        });

        reportDateRow.appendChild(editBtn);
    }

    modalContent.appendChild(reportDateRow);


    // -----------------------------------------------------------
    // СЕКЦИЯ 1: ЗАМЕРЫ (МЕТРИКИ)
    // -----------------------------------------------------------
    const metricsContainer = createElement('div', 'metrics-editor-container');
    metricsContainer.innerHTML = '<h4>Замеры</h4>';

    const metricsListDiv = createElement('div', 'metrics-list');
    metricsContainer.appendChild(metricsListDiv);

    // Кнопка "Добавить замер"
    const addMetricBtn = createElement('button', 'btn btn-secondary btn-small', '+');
    addMetricBtn.style.marginTop = '10px';

    addMetricBtn.addEventListener('click', () => {
        // 🔥 ИСПРАВЛЕНИЕ 1: Собираем текущие значения из DOM, чтобы не потерять их
        reportToEdit.metrics = collectCurrentMetrics(metricsListDiv);

        // Добавляем новое пустое поле
        reportToEdit.metrics.push({ name: '', value: '' });

        // Перерисовываем список
        renderMetricsList(reportToEdit.metrics, metricsListDiv, true);
    });

    metricsContainer.appendChild(addMetricBtn);
    modalContent.appendChild(metricsContainer);

    // -----------------------------------------------------------
    // СЕКЦИЯ 2: ФОТО
    // -----------------------------------------------------------
    const photosContainer = createElement('div', 'photos-editor-container');
    photosContainer.innerHTML = '<h4 style="margin-top: 20px;">Фото</h4>';
    const photosControlsDiv = createElement('div', 'photos-controls-div');
    photosContainer.appendChild(photosControlsDiv);

    modalContent.appendChild(photosContainer);

    // -----------------------------------------------------------
    // СЕКЦИЯ 3: КОММЕНТАРИЙ
    // -----------------------------------------------------------
    const commentInput = createElement('textarea', 'comment-input');
    commentInput.placeholder = 'Общий комментарий к изменениям...';
    commentInput.value = reportToEdit.comment || '';
    commentInput.style.marginTop = '20px';
    commentInput.style.minHeight = '80px';
    commentInput.style.width = '100%';

    modalContent.appendChild(createElement('h4', null, 'Комментарий'));
    modalContent.appendChild(commentInput);


    // -----------------------------------------------------------
    // ИНИЦИАЛИЗАЦИЯ И РЕНДЕР
    // -----------------------------------------------------------

    // 🔥 ИСПРАВЛЕНИЕ 2: Добавляем слушатель 'input' на контейнер
    // Это гарантирует, что при любом вводе в любое поле ввода, массив reportToEdit.metrics
    // будет обновлен с актуальными значениями из DOM.
    metricsListDiv.addEventListener('input', (e) => {
        if (e.target.classList.contains('metric-name-input')  || e.target.classList.contains('metric-value-input')) {
            reportToEdit.metrics = collectCurrentMetrics(metricsListDiv);
            // Примечание: renderMetricsList здесь не вызываем, чтобы не сбивать фокус
        }
    });

    // Инициализация списков
    renderMetricsList(reportToEdit.metrics, metricsListDiv, true);
    renderPhotoControls(reportToEdit.photos, photosControlsDiv, reportToEdit.id);
    renderMetricsList(reportToEdit.metrics || [], metricsListDiv);

    // --- КНОПКИ УПРАВЛЕНИЯ ---
    const controls = createElement('div', 'modal-controls', '');
    const cancelBtn = createElement('button', 'btn', 'Отмена');
    cancelBtn.onclick = () => overlay.remove();

    const saveBtn = createElement('button', 'btn btn-primary', '💾 Сохранить Отчет');
    saveBtn.onclick = async () => {
        // 🔥 ИСПРАВЛЕНИЕ 3: Используем collectCurrentMetrics для финального сбора данных
        // Это гарантирует, что даже если пользователь не нажимал "Новый замер",
        // его введенные данные будут сохранены.
        const finalMetrics = collectCurrentMetrics(metricsListDiv);
        let isValid = true;

        // Финальная валидация (проверяем, что нет пустых пар "имя/значение")
        finalMetrics.forEach(m => {
            if (!m.name || !m.value) {
                isValid = false;
            }
        });

        if (!isValid) {
            showToast('Пожалуйста, заполните как название, так и значение для каждого замера.', 'error');
            return;
        }

        if (finalMetrics.length === 0) {
            showToast('Отчет должен содержать хотя бы один замер.', 'error');
            return;
        }

        // 1. Создание объекта для сохранения
        const reportToSave = {
            date: reportToEdit.date || getTodayDateString(),
            comment: commentInput.value.trim(),
            metrics: finalMetrics,
            photos: reportToEdit.photos,
            metricTemplate: finalMetrics.map(m => ({ name: m.name }))
        };

        // 2. Вызов функции сохранения
        await saveProgressReport(reportToSave, reportToEdit.id);
        overlay.remove();
    };


    controls.appendChild(cancelBtn);
    controls.appendChild(saveBtn);
    modalContent.appendChild(controls);
    overlay.appendChild(modalContent);
    root.appendChild(overlay);
}

// ======================================================================
// 🌟 Модалка выбора периода для сводного отчета
// ======================================================================
function openReportsSummaryModal() {
    const overlay = createElement('div', 'modal-overlay');
    overlay.classList.add('active');

    const modal = createElement('div', 'modal-content');
    modal.style.maxWidth = '400px';

    modal.appendChild(createElement('h3', null, 'Выберите период'));

    // Поля дат
    const fromInput = createElement('input');
    fromInput.type = 'date';
    fromInput.style.marginBottom = '10px';
    const toInput = createElement('input');
    toInput.type = 'date';

    modal.appendChild(createElement('label', null, 'С даты:'));
    modal.appendChild(fromInput);
    modal.appendChild(createElement('label', null, 'По дату:'));
    modal.appendChild(toInput);

    // Кнопки
    const controls = createElement('div', 'modal-controls');
    const cancelBtn = createElement('button', 'btn', 'Отмена');
    cancelBtn.onclick = () => overlay.remove();

    const showBtn = createElement('button', 'btn btn-primary', 'Показать');
    showBtn.onclick = () => {
        if (!fromInput.value || !toInput.value) {
            alert('Пожалуйста, выберите обе даты');
            return;
        }
        overlay.remove();
        renderReportsSummaryPage(fromInput.value, toInput.value);
    };

    controls.appendChild(cancelBtn);
    controls.appendChild(showBtn);
    modal.appendChild(controls);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ======================================================================
// 🌟 Страница сводного отчета
// ======================================================================
function renderReportsSummaryPage(startDate, endDate) {
    const root = document.getElementById('root');
    root.innerHTML = '';

    // Заголовок
    const header = createElement('div', 'summary-header');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    header.appendChild(createElement('h3', null, 'Сводный отчет'));

    const printBtn = createElement('button', 'btn btn-primary', '📄 Печать / PDF');
    printBtn.onclick = () => window.print();
    header.appendChild(printBtn);

    root.appendChild(header);

    // Фильтруем отчеты по периоду
    const reports = (state.reports || []).filter(r => {
        const [d, m, y] = r.date.split('.');
        const reportDate = new Date(`${y}-${m}-${d}`);
        return reportDate >= new Date(startDate) && reportDate <= new Date(endDate);
    });

    if (reports.length === 0) {
        root.appendChild(createElement('p', null, 'За выбранный период отчётов нет.'));
        return;
    }

    // --- Собираем уникальные названия замеров ---
    const metricNamesSet = new Set();
    reports.forEach(r => {
        (r.metrics || []).forEach(m => metricNamesSet.add(m.name));
    });
    const metricNames = Array.from(metricNamesSet);

    // --- Создаем таблицу ---
    const table = createElement('table', 'summary-table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    // --- Заголовок таблицы ---
    const thead = createElement('thead');
    const headerRow = createElement('tr');
    headerRow.appendChild(createElement('th', null, 'Дата'));
    metricNames.forEach(name => headerRow.appendChild(createElement('th', null, name)));
    headerRow.appendChild(createElement('th', null, 'Комментарий'));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // --- Тело таблицы ---
    const tbody = createElement('tbody');
    reports.forEach(r => {
        const row = createElement('tr');
        row.appendChild(createElement('td', null, r.date));

        metricNames.forEach(name => {
            const metric = (r.metrics || []).find(m => m.name === name);
            row.appendChild(createElement('td', null, metric ? metric.value : '')); // если замера нет, пусто
        });

        row.appendChild(createElement('td', null, r.comment || ''));
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    root.appendChild(table);

    // --- Стили таблицы для мобильного и PDF ---
    const style = document.createElement('style');
    style.innerHTML = `
        .summary-table th, .summary-table td {
            border: 1px solid #ccc;
            padding: 5px;
            text-align: center;
            font-size: 0.85em;
        }
        .summary-table th {
            background-color: #f0f0f0;
        }
        .summary-table td:first-child {
            font-weight: bold;
        }
        @media print {
            body { font-size: 10pt; }
            .summary-table th, .summary-table td { font-size: 9pt; padding: 3pt; }
        }
    `;
    document.head.appendChild(style);
}






// =================================================================
// 🌟 Сравнение фото между отчётами
// =================================================================


// --- Модальное окно сравнения с выбором фото ---
function openCompareModal() {
    if (!state.reports || state.reports.length < 2) {
        alert('Нужно минимум 2 отчета для сравнения');
        return;
    }

    const overlay = createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '1000';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = createElement('div');
    modal.style.backgroundColor = '#fff';
    modal.style.padding = '20px';
    modal.style.borderRadius = '8px';
    modal.style.maxWidth = '90%';
    modal.style.maxHeight = '80%';
    modal.style.overflowY = 'auto';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '10px';

    modal.appendChild(createElement('h4', null, 'Что сравнивать?'));

    const selectType = createElement('select');
    selectType.style.padding = '10px';
    selectType.style.fontSize = '16px';
    selectType.style.borderRadius = '6px';
    selectType.innerHTML = `
            <option value="photos">Фото</option>
            <option value="metrics">Замеры</option>
        `;
    modal.appendChild(selectType);

    const selectBefore = createElement('select');
    const selectAfter = createElement('select');
    [selectBefore, selectAfter].forEach(s => {
        s.style.padding = '10px';
        s.style.fontSize = '16px';
        s.style.borderRadius = '6px';
        s.style.marginTop = '10px';
    });

    state.reports.forEach(report => {
        const option1 = createElement('option');
        option1.value = report.id;
        option1.textContent = report.date;
        selectBefore.appendChild(option1);

        const option2 = createElement('option');
        option2.value = report.id;
        option2.textContent = report.date;
        selectAfter.appendChild(option2);
    });

    modal.appendChild(createElement('div', null, 'До:'));
    modal.appendChild(selectBefore);
    modal.appendChild(createElement('div', null, 'После:'));
    modal.appendChild(selectAfter);

    // --- Селекты для выбора конкретного фото ---
    const photoBefore = createElement('select');
    const photoAfter = createElement('select');
    [photoBefore, photoAfter].forEach(s => {
        s.style.padding = '8px';
        s.style.fontSize = '14px';
        s.style.borderRadius = '6px';
        s.style.marginTop = '5px';
    });

    function updatePhotoSelect(reportSelect, photoSelect) {
        const report = state.reports.find(r => r.id === reportSelect.value);
        photoSelect.innerHTML = '';
        if (report && report.photos && report.photos.length > 0) {
            report.photos.forEach(p => {
                const opt = createElement('option');
                opt.value = p.number;
                opt.textContent = p.name || `Фото ${p.number}`;
                photoSelect.appendChild(opt);
            });
        } else {
            const opt = createElement('option');
            opt.value = -1;
            opt.textContent = 'Нет фото';
            photoSelect.appendChild(opt);
        }
    }

    selectBefore.addEventListener('change', () => updatePhotoSelect(selectBefore, photoBefore));
    selectAfter.addEventListener('change', () => updatePhotoSelect(selectAfter, photoAfter));
    updatePhotoSelect(selectBefore, photoBefore);
    updatePhotoSelect(selectAfter, photoAfter);

    modal.appendChild(createElement('div', null, 'Фото до:'));
    modal.appendChild(photoBefore);
    modal.appendChild(createElement('div', null, 'Фото после:'));
    modal.appendChild(photoAfter);

    const btnCompare = createElement('button', 'btn btn-primary', 'Сравнить');
    btnCompare.style.marginTop = '10px';
    btnCompare.addEventListener('click', () => {
        const idBefore = selectBefore.value;
        const idAfter = selectAfter.value;
        const numBefore = photoBefore.value;
        const numAfter = photoAfter.value;

        if (idBefore === idAfter && numBefore === numAfter) { alert('Выберите разные фото'); return; }

        if (selectType.value === 'photos') {
            showComparePhotos(idBefore, idAfter, numBefore, numAfter);
        } else {
            showCompareMetrics(idBefore, idAfter);
        }
        overlay.remove();
    });

    modal.appendChild(btnCompare);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// =================================================================
// 🌟 Сравнение метрик (замеров)
// =================================================================
function showCompareMetrics(idBefore, idAfter) {
    const report1 = state.reports.find(r => r.id === idBefore);
    const report2 = state.reports.find(r => r.id === idAfter);
    if (!report1 || !report2) return;

    const overlay = createElement('div');
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center;
        z-index:1000; overflow:auto; padding:20px;
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const container = createElement('div');
    container.style.cssText = `
        background:#fff; padding:20px; border-radius:8px; max-width:90%; overflow-x:auto;
    `;

    container.appendChild(createElement('h4', null, `Сравнение замеров: ${report1.date} ↔ ${report2.date}`));

    const table = createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    const header = createElement('tr');
    header.innerHTML = `<th>Параметр</th><th>${report1.date}</th><th>${report2.date}</th>`;
    table.appendChild(header);

    const metricsSet = new Set([
        ...(report1.metrics || []).map(m => m.name),
        ...(report2.metrics || []).map(m => m.name)
    ]);

    metricsSet.forEach(name => {
        const row = createElement('tr');
        const m1 = (report1.metrics || []).find(m => m.name === name);
        const m2 = (report2.metrics || []).find(m => m.name === name);
        row.innerHTML = `
            <td>${name}</td>
            <td>${m1 ? m1.value : '-'}</td>
            <td>${m2 ? m2.value : '-'}</td>
        `;
        row.style.borderBottom = '1px solid #ccc';
        table.appendChild(row);
    });

    container.appendChild(table);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}


// =================================================================
// 🌟 Сравнение фото
// =================================================================
function showComparePhotos(idBefore, idAfter, numBefore, numAfter) {
    const report1 = state.reports.find(r => r.id === idBefore);
    const report2 = state.reports.find(r => r.id === idAfter);
    if (!report1 || !report2) return;

    const photo1 = (report1.photos || []).find(p => p.number == numBefore);
    const photo2 = (report2.photos || []).find(p => p.number == numAfter);

    const overlay = createElement('div');
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.9); display:flex; justify-content:center; align-items:center;
        z-index:1000; gap:20px; flex-wrap:wrap;
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    if (photo1 && photo1.url) {
        const img1 = createElement('img');
        img1.src = photo1.url;
        img1.style.maxWidth = '45%';
        img1.style.borderRadius = '8px';
        overlay.appendChild(img1);
    }

    if (photo2 && photo2.url) {
        const img2 = createElement('img');
        img2.src = photo2.url;
        img2.style.maxWidth = '45%';
        img2.style.borderRadius = '8px';
        overlay.appendChild(img2);
    }

    document.body.appendChild(overlay);
}

// -----------------------------------------------------------
// 🔥 НОВЫЕ ФУНКЦИИ РЕНДЕРИНГА ЭЛЕМЕНТОВ МОДАЛЬНОГО ОКНА
// -----------------------------------------------------------

export function renderMetricsList(metrics, container, focusLast = false) {
    container.innerHTML = ''; // очищаем список

    metrics.forEach((metric, index) => {
        const row = createElement('div', 'metric-row');

        const nameInput = createElement('input', 'metric-name-input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Название';
        nameInput.value = metric.name || '';

        const separator = createElement('span', 'metric-separator', '-');

        const valueInput = createElement('input', 'metric-value-input');
        valueInput.type = 'text';
        valueInput.placeholder = 'Значение';
        valueInput.value = metric.value || '';

        // кнопка удаления замера
        const removeBtn = createElement('button', 'btn btn-small btn-danger', 'удалить');
        removeBtn.addEventListener('click', () => {
            metrics.splice(index, 1);
            renderMetricsList(metrics, container);
        });

        row.appendChild(nameInput);
        row.appendChild(separator);
        row.appendChild(valueInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    });

    // если нужно поставить фокус на последнюю строку
    if (focusLast && container.lastChild) {
        container.lastChild.querySelector('input')?.focus();
    }
}



function renderPhotoControls(photos, container, reportId) {
    container.innerHTML = '';

    // 1️⃣ Превью фотографий
    const previewContainer = createElement('div', 'photo-previews');
    previewContainer.style.display = 'flex';
    previewContainer.style.flexWrap = 'wrap';
    previewContainer.style.gap = '10px';
    previewContainer.style.marginBottom = '10px';

    photos.forEach((photo, index) => {
        console.log("👉 renderPhotoControls: photo.url =", photo.url, "type:", typeof photo.url);

        // Если url не строка — сразу предупреждаем
        if (typeof photo.url !== "string") {
            console.error("❌ Ошибка: photo.url не строка!", photo);
            return; // пропускаем этот элемент, чтобы не было [object Object]
        }

        const preview = createElement('div', 'photo-preview-item');
        preview.style.position = 'relative';
        preview.style.width = '60px';
        preview.style.height = '60px';
        preview.style.backgroundImage = `url(${photo.url})`; // ✅ уже точно строка
        preview.style.backgroundSize = 'cover';
        preview.style.borderRadius = '5px';
        preview.title = "Нажмите для увеличения";

        // Кнопка удаления
        const deleteBtn = createElement('button', 'btn btn-delete-photo');
        deleteBtn.innerHTML = '×';


        deleteBtn.addEventListener('click', async () => {
            if (!confirm('Вы уверены, что хотите удалить это фото?')) return;
            const url = typeof photo.url === 'string' ? photo.url : '';
            if (url) await deleteUserFirebaseStorageFileByDownloadUrl(url);
            photos.splice(index, 1);
            renderPhotoControls(photos, container, reportId);
        });

        // Клик по превью — открытие полного фото
        preview.addEventListener('click', () => openPhotoFullScreen(photo.url, photo.name));

        preview.append(deleteBtn);
        previewContainer.append(preview);
    });

    container.append(previewContainer);

    // 2️⃣ Кнопка добавления новых фото
    const fileInput = createElement('input', 'photo-file-input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    const addPhotoBtn = createElement('button', 'btn btn-secondary btn-small', '+');
    addPhotoBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            showToast(`Загрузка ${file.name} в Storage...`);
            try {
                const permanentUrl = await uploadUserMediaFileWithProgress(file, 'reports', (pct) => {
                    if (pct >= 99) showToast(`${file.name}: почти готово…`);
                });

                // Проверяем, что Storage вернул строку URL
                if (typeof permanentUrl !== "string") {
                    console.error("❌ Storage вернул не строку:", permanentUrl);
                    showToast(`Ошибка: невалидный URL для ${file.name}`, 'error');
                    continue;
                }

                photos.push({ url: permanentUrl, name: file.name });
                showToast(`Фото ${file.name} загружено!`);
            } catch (error) {
                console.error(error);
                showToast(`Ошибка загрузки ${file.name}`, 'error');
            }
        }
        renderPhotoControls(photos, container, reportId);
        e.target.value = '';
    });

    container.append(addPhotoBtn);
    container.append(fileInput);
}


function collectCurrentMetrics(metricsListDiv) {
    const metrics = [];
    const rows = metricsListDiv.querySelectorAll('.metric-row');
    rows.forEach(row => {
        const nameInput = row.querySelector('.metric-name-input');
        const valueInput = row.querySelector('.metric-value-input');
        metrics.push({
            name: nameInput.value.trim(),
            value: valueInput.value.trim()
        });
    });
    return metrics;
}



// 🔥 НОВАЯ ФУНКЦИЯ: Сохранение / Обновление отчета о прогрессе
async function saveProgressReport(reportData, reportId = null) {
    const reportsCollection = getReportsCollection();
    if (!reportsCollection) {
        showToast('Нет контекста цикла для сохранения отчёта.');
        return;
    }

    try {
        if (reportId) {
            const docRef = doc(reportsCollection, reportId);
            await updateDoc(docRef, reportData);
            showToast('Отчет о прогрессе обновлен!');
        } else {
            await addDoc(reportsCollection, reportData);
            showToast('Отчет о прогрессе сохранен!');
        }
    } catch (error) {
        console.error("Ошибка сохранения отчета:", error);
        showToast('Не удалось сохранить отчет о прогрессе.');
    }
}

// 🔥 НОВАЯ ФУНКЦИЯ: Удаление отчета
async function deleteReport(reportId) {
    if (!confirm('Вы уверены, что хотите удалить этот отчет о прогрессе?')) return;
    const reportsCollection = getReportsCollection();
    if (!reportsCollection) {
        showToast('Нет контекста цикла для удаления.');
        return;
    }
    try {
        // 🔥 В реальном приложении здесь должна быть логика удаления фото из Storage
        await deleteDoc(doc(reportsCollection, reportId));
        showToast('Отчет удален.');
    } catch (error) {
        console.error("Ошибка удаления отчета:", error);
        showToast('Не удалось удалить отчет.');
    }
}
