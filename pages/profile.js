import {
    createElement,
    showToast,
    render,
    openConfirmModal,
    isOfflineModeActive,
    createAppleHealthImportToken,
    getAppleHealthImportSettings,
    saveCabinetUserProfile,
    refreshUserProfileFromServer,
    buildPublicCodeVisualHTML,
    fetchPendingTrainerInvites,
    acceptTrainerInviteClient,
    rejectTrainerInviteClient,
    fetchLinkedTrainersForClient,
    disconnectLinkedTrainerClient,
    fetchOwnCyclesForClientAccess,
    saveLinkedTrainerCycleAccess
} from '../script.js';

const APPLE_HEALTH_ONLINE_ONLY_MESSAGE = 'Apple Health доступен только онлайн. Подключитесь к интернету и повторите.';
const TRAINER_LINK_ONLINE_ONLY_MESSAGE = 'Связь клиент-тренер доступна только онлайн. Подключитесь к интернету и повторите.';

function formatProfileDateTime(value) {
    if (!value) return '—';
    try {
        const date = typeof value?.toDate === 'function'
            ? value.toDate()
            : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    } catch (_) {
        return '—';
    }
}

function openAppleHealthTokenModal(token) {
    const overlay = createElement('div', 'modal-overlay-cicle modal-overlay-cicle--sheet');
    const modal = createElement('div', 'modal-cicle profile-apple-health-token-modal');
    const title = createElement('h3', 'modal-cicle__title', 'Токен для Apple Health');
    const text = createElement(
        'p',
        'modal-cicle__hint muted',
        'Сохраните этот токен в iPhone Shortcuts. Потом его нельзя будет посмотреть снова — можно только создать новый.'
    );
    const tokenBox = createElement('div', 'profile-apple-health-token-box', token);
    const copyBtn = createElement('button', 'btn btn-primary', 'Скопировать токен');
    const closeBtn = createElement('button', 'btn btn-outline', 'Закрыть');

    copyBtn.type = 'button';
    closeBtn.type = 'button';

    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(token);
            showToast('Токен скопирован');
        } catch (_) {
            showToast('Не удалось скопировать токен');
        }
    };

    closeBtn.onclick = () => overlay.remove();
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });

    modal.append(title, text, tokenBox, copyBtn, closeBtn);
    overlay.append(modal);
    document.body.append(overlay);
}

function formatBirthDateDisplay(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    return `${m[3]}.${m[2]}.${m[1]}`;
}

function getTrainerAccessSummaryText(trainer) {
    const names = Array.isArray(trainer?.allowedCycleNames) ? trainer.allowedCycleNames.filter(Boolean) : [];
    if (trainer?.accessMode === 'full') {
        return names.length
            ? `Разрешен доступ для: ${names.join(', ')}`
            : 'Разрешен полный доступ ко всем циклам';
    }
    if (names.length) {
        return `Разрешен доступ для: ${names.join(', ')}`;
    }
    return 'Доступ к циклам не выдан';
}

async function openTrainerAccessModal(trainer) {
    const cycles = await fetchOwnCyclesForClientAccess();
    const selectedIds = new Set(Array.isArray(trainer?.allowedCycleIds) ? trainer.allowedCycleIds : []);
    let fullAccess = trainer?.fullCycleAccess === true || trainer?.accessMode === 'full';

    const overlay = createElement('div', 'modal-overlay-cicle modal-overlay-cicle--sheet');
    const modal = createElement('div', 'modal-cicle profile-trainer-access-modal');
    const title = createElement('h3', 'modal-cicle__title', 'Доступ к циклам');
    const intro = createElement(
        'p',
        'modal-cicle__hint muted',
        'Выберите, какие циклы будут доступны тренеру. Старые циклы можно оставить скрытыми.'
    );

    const fullToggle = createElement('button', 'profile-trainer-access-toggle');
    fullToggle.type = 'button';
    const fullToggleText = createElement('span', 'profile-trainer-access-toggle-text', 'Разрешить полный доступ к циклам');
    const fullToggleCheck = createElement('span', 'profile-trainer-access-check');
    fullToggle.append(fullToggleText, fullToggleCheck);

    const partialTitle = createElement('div', 'profile-trainer-access-subtitle', 'Разрешить частичный доступ');
    const pickerWrap = createElement('div', 'profile-trainer-access-picker');
    const pickerField = createElement('button', 'profile-trainer-access-field');
    pickerField.type = 'button';
    const pickerFieldText = createElement('span', 'profile-trainer-access-field-text', 'Выберите циклы');
    const pickerFieldArrow = createElement('span', 'profile-trainer-access-field-arrow', '▾');
    pickerField.append(pickerFieldText, pickerFieldArrow);

    const dropdown = createElement('div', 'profile-trainer-access-dropdown');
    const optionsList = createElement('div', 'profile-trainer-access-options');

    cycles.forEach((cycle) => {
        const option = createElement('button', 'profile-trainer-access-option');
        option.type = 'button';
        option.dataset.id = cycle.id;

        const optionCheck = createElement('span', 'profile-trainer-access-option-check');
        const optionLabel = createElement('span', 'profile-trainer-access-option-label', cycle.name);
        option.append(optionCheck, optionLabel);

        option.addEventListener('click', () => {
            if (selectedIds.has(cycle.id)) {
                selectedIds.delete(cycle.id);
            } else {
                selectedIds.add(cycle.id);
            }
            syncOptionState();
            syncFieldState();
        });

        optionsList.append(option);
    });

    if (!cycles.length) {
        optionsList.append(
            createElement('div', 'muted profile-trainer-access-empty', 'У вас пока нет созданных циклов.')
        );
    }

    const dropdownOk = createElement('button', 'btn btn-primary profile-trainer-access-ok-btn', 'ОК');
    dropdownOk.type = 'button';
    dropdownOk.addEventListener('click', () => {
        dropdown.classList.remove('is-open');
        pickerFieldArrow.classList.remove('is-open');
    });

    dropdown.append(optionsList, dropdownOk);
    pickerWrap.append(pickerField, dropdown);

    const buttons = createElement('div', 'modal-buttons profile-trainer-access-modal-actions');
    const cancelBtn = createElement('button', 'btn btn-outline', 'Отмена');
    cancelBtn.type = 'button';
    const saveBtn = createElement('button', 'btn btn-primary', 'Разрешить доступ');
    saveBtn.type = 'button';
    buttons.append(cancelBtn, saveBtn);

    function syncOptionState() {
        optionsList.querySelectorAll('.profile-trainer-access-option').forEach((option) => {
            option.classList.toggle('is-active', selectedIds.has(option.dataset.id));
        });
    }

    function syncFieldState() {
        const selectedCycles = cycles.filter((cycle) => selectedIds.has(cycle.id));
        pickerFieldText.textContent = fullAccess
            ? 'Все циклы'
            : selectedCycles.length
                ? selectedCycles.map((cycle) => cycle.name).join(', ')
                : 'Выберите циклы';
        pickerField.classList.toggle('is-disabled', fullAccess || !cycles.length);
    }

    function syncFullToggleState() {
        fullToggle.classList.toggle('is-active', fullAccess);
        fullToggleCheck.classList.toggle('is-active', fullAccess);
        partialTitle.classList.toggle('is-disabled', fullAccess);
        dropdown.classList.remove('is-open');
        pickerFieldArrow.classList.remove('is-open');
        syncFieldState();
    }

    fullToggle.addEventListener('click', () => {
        fullAccess = !fullAccess;
        syncFullToggleState();
    });

    pickerField.addEventListener('click', () => {
        if (fullAccess || !cycles.length) return;
        dropdown.classList.toggle('is-open');
        pickerFieldArrow.classList.toggle('is-open');
    });

    cancelBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
            await saveLinkedTrainerCycleAccess(trainer.trainerUid, {
                fullCycleAccess: fullAccess,
                allowedCycleIds: [...selectedIds]
            });
            showToast('Доступ к циклам обновлен');
            overlay.remove();
            render();
        } catch (error) {
            console.error(error);
            showToast(error?.message || 'Не удалось обновить доступ');
            saveBtn.disabled = false;
        }
    });

    syncOptionState();
    syncFullToggleState();

    modal.append(title, intro, fullToggle, partialTitle, pickerWrap, buttons);
    overlay.append(modal);
    document.body.append(overlay);
}

export function renderProfilePage() {
    const state = window.state;
    const root = document.getElementById('root');
    const wrap = createElement('div', 'profile-cabinet-page');

    const title = createElement('h2', 'profile-cabinet-title', 'Личный кабинет');
    wrap.appendChild(title);

    const p = state.userProfile;
    const hasCore = !!(p && p.firstName && p.lastName && p.birthDate);
    const hasCode = !!(p && p.publicCode);
    const showForm = !hasCode || !hasCore || state.profileCabinetEditing;
    const isOffline = isOfflineModeActive();

    if (showForm) {
        const hint = createElement('p', 'muted profile-cabinet-hint');
        hint.textContent = hasCode
            ? 'Измените данные и нажмите «Сохранить».'
            : 'Заполните профиль. После первого сохранения вам будет присвоен постоянный личный номер.';
        wrap.appendChild(hint);

        const form = createElement('div', 'profile-cabinet-form');

        const mkField = (id, labelText, inputEl) => {
            const g = createElement('div', 'profile-field-group');
            const lab = createElement('label', 'profile-field-label', labelText);
            lab.htmlFor = id;
            g.append(lab, inputEl);
            return g;
        };

        const fn = createElement('input', 'modal-input profile-input');
        fn.id = 'cabinet-first-name';
        fn.placeholder = 'Иван';
        fn.value = p?.firstName || '';

        const ln = createElement('input', 'modal-input profile-input');
        ln.id = 'cabinet-last-name';
        ln.placeholder = 'Иванов';
        ln.value = p?.lastName || '';

        const pat = createElement('input', 'modal-input profile-input');
        pat.id = 'cabinet-patronymic';
        pat.placeholder = 'Необязательно';
        pat.value = p?.patronymic || '';

        const bd = createElement('input', 'modal-input profile-input');
        bd.type = 'date';
        bd.id = 'cabinet-birth-date';
        bd.value = p?.birthDate || '';

        form.append(
            mkField('cabinet-first-name', 'Имя', fn),
            mkField('cabinet-last-name', 'Фамилия', ln),
            mkField('cabinet-patronymic', 'Отчество', pat),
            mkField('cabinet-birth-date', 'Дата рождения', bd)
        );
        wrap.appendChild(form);

        const save = createElement('button', 'btn btn-primary profile-save-btn', 'Сохранить');
        save.onclick = async () => {
            const firstName = document.getElementById('cabinet-first-name').value.trim();
            const lastName = document.getElementById('cabinet-last-name').value.trim();
            const patronymic = document.getElementById('cabinet-patronymic').value.trim();
            const birthDate = document.getElementById('cabinet-birth-date').value;

            if (!firstName || !lastName || !birthDate) {
                showToast('Укажите имя, фамилию и дату рождения.');
                return;
            }

            save.disabled = true;
            try {
                const result = await saveCabinetUserProfile({
                    firstName,
                    lastName,
                    patronymic,
                    birthDate
                });
                state.profileCabinetEditing = false;
                if (result.wasNewCode) {
                    showToast('Профиль сохранён. Вам присвоен личный номер.');
                } else {
                    showToast('Данные обновлены.');
                }
                render();
            } catch (e) {
                console.error(e);
                showToast('Не удалось сохранить. Проверьте правила Firestore и подключение.');
            } finally {
                save.disabled = false;
            }
        };
        wrap.appendChild(save);

        if (hasCode) {
            const cancel = createElement('button', 'btn btn-outline profile-cancel-btn', 'Отмена');
            cancel.onclick = () => {
                state.profileCabinetEditing = false;
                render();
            };
            wrap.appendChild(cancel);
        }
    } else {
        const card = createElement('div', 'profile-cabinet-card');

        const row = (label, value) => {
            const r = createElement('div', 'profile-cabinet-row');
            r.appendChild(createElement('span', 'profile-cabinet-label', label));
            r.appendChild(createElement('span', 'profile-cabinet-value', value || '—'));
            return r;
        };

        card.appendChild(row('Имя', p.firstName));
        card.appendChild(row('Фамилия', p.lastName));
        card.appendChild(row('Отчество', p.patronymic || '—'));
        card.appendChild(row('Дата рождения', formatBirthDateDisplay(p.birthDate)));

        const codeWrap = createElement('div', 'profile-cabinet-code-block');
        codeWrap.appendChild(createElement('div', 'profile-cabinet-label', 'Ваш личный номер'));
        const codeEl = document.createElement('div');
        codeEl.className = 'public-user-code-host profile-cabinet-code';
        codeEl.innerHTML = buildPublicCodeVisualHTML(p.publicCode);
        codeWrap.appendChild(codeEl);

        const copyBtn = createElement('button', 'btn btn-secondary profile-copy-btn', 'Скопировать номер');
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(p.publicCode);
                showToast('Номер скопирован');
            } catch (_) {
                showToast('Не удалось скопировать');
            }
        };
        codeWrap.appendChild(copyBtn);
        card.appendChild(codeWrap);

        const edit = createElement('button', 'btn btn-primary profile-edit-btn', 'Редактировать');
        edit.onclick = () => {
            state.profileCabinetEditing = true;
            render();
        };
        card.appendChild(edit);

        wrap.appendChild(card);
    }

    const refresh = createElement('button', 'btn btn-outline profile-refresh-btn', 'Обновить данные');
    refresh.onclick = async () => {
        try {
            await refreshUserProfileFromServer();
            showToast('Данные обновлены с сервера');
            render();
        } catch (_) {
            showToast('Не удалось обновить');
        }
    };
    wrap.appendChild(refresh);

    const appleHealthCard = createElement('div', 'profile-apple-health-card');
    const appleHealthTitle = createElement('h3', 'profile-apple-health-title', 'Apple Health / Apple Watch');
    const appleHealthText = createElement(
        'p',
        'profile-apple-health-text muted',
        'Создайте токен для iPhone Shortcuts, чтобы команда могла безопасно передавать шаги, калории и активность в приложение.'
    );
    const appleHealthStatus = createElement('p', 'profile-apple-health-status muted', 'Проверяю настройки синхронизации…');
    const appleHealthHint = createElement(
        'p',
        'profile-apple-health-hint',
        'Токен показывается только один раз. После создания сохраните его в Shortcut “Sync Training Diary”.'
    );
    const appleHealthActions = createElement('div', 'profile-apple-health-actions');
    const createAppleHealthTokenBtn = createElement('button', 'btn btn-primary profile-apple-health-create-btn', 'Создать токен для Apple Health');
    createAppleHealthTokenBtn.type = 'button';
    createAppleHealthTokenBtn.onclick = async () => {
        if (isOffline) {
            showToast(APPLE_HEALTH_ONLINE_ONLY_MESSAGE);
            return;
        }
        createAppleHealthTokenBtn.disabled = true;
        try {
            const result = await createAppleHealthImportToken();
            appleHealthStatus.textContent = `Токен обновлён: ${formatProfileDateTime(result.updatedAt)}`;
            showToast('Новый токен создан');
            openAppleHealthTokenModal(result.token);
        } catch (error) {
            console.error(error);
            showToast(error?.message || 'Не удалось создать токен');
        } finally {
            createAppleHealthTokenBtn.disabled = false;
        }
    };

    if (isOffline) {
        createAppleHealthTokenBtn.disabled = true;
    }

    appleHealthActions.append(createAppleHealthTokenBtn);
    appleHealthCard.append(
        appleHealthTitle,
        appleHealthText,
        appleHealthStatus,
        appleHealthHint,
        appleHealthActions
    );
    wrap.appendChild(appleHealthCard);

    if (isOffline) {
        appleHealthStatus.textContent = APPLE_HEALTH_ONLINE_ONLY_MESSAGE;
    } else {
        getAppleHealthImportSettings()
        .then((settings) => {
            appleHealthStatus.textContent = settings?.tokenHash
                ? `Токен настроен: ${formatProfileDateTime(settings.updatedAt)}`
                : 'Токен ещё не создан.';
        })
        .catch((error) => {
            console.error(error);
            appleHealthStatus.textContent = 'Не удалось проверить настройки Apple Health.';
        });

    }

    const linkedTrainersBlock = createElement('div', 'profile-linked-trainers-block');
    const linkedTrainersTitle = createElement('h3', 'profile-linked-trainers-title', 'Тренер');
    const linkedTrainersList = createElement('div', 'profile-linked-trainers-list');
    linkedTrainersBlock.append(linkedTrainersTitle, linkedTrainersList);
    wrap.appendChild(linkedTrainersBlock);

    if (isOffline) {
        linkedTrainersList.replaceChildren(
            createElement('p', 'muted profile-linked-trainers-empty', TRAINER_LINK_ONLINE_ONLY_MESSAGE)
        );
    } else {
        fetchLinkedTrainersForClient()
        .then((trainers) => {
            linkedTrainersList.replaceChildren();
            linkedTrainersTitle.textContent = trainers.length > 1 ? 'Тренеры' : 'Тренер';

            if (!trainers.length) {
                linkedTrainersList.appendChild(
                    createElement('p', 'muted profile-linked-trainers-empty', 'Связь с тренером не установлена.')
                );
                return;
            }

            trainers.forEach((trainer) => {
                const trainerCard = createElement('div', 'profile-linked-trainer-card');

                const trainerHead = createElement('div', 'profile-linked-trainer-head');
                const trainerCaption = createElement('div', 'profile-linked-trainer-caption', 'Данные тренера');
                const disconnectBtn = createElement(
                    'button',
                    'btn btn-outline profile-linked-trainer-disconnect-btn',
                    'Разорвать связь'
                );

                const trainerActions = createElement('div', 'profile-linked-trainer-actions');
                const accessBtn = createElement(
                    'button',
                    'btn btn-primary profile-linked-trainer-access-btn',
                    'Доступ'
                );

                accessBtn.onclick = async () => {
                    try {
                        await openTrainerAccessModal(trainer);
                    } catch (e) {
                        console.error(e);
                        showToast(e?.message || 'Не удалось открыть настройки доступа');
                    }
                };

                disconnectBtn.onclick = () => {
                    openConfirmModal('Разорвать связь с тренером?', async () => {
                        disconnectBtn.disabled = true;
                        try {
                            await disconnectLinkedTrainerClient(trainer.trainerUid);
                            showToast('Связь с тренером разорвана');
                            render();
                        } catch (e) {
                            console.error(e);
                            showToast(e?.message || 'Не удалось разорвать связь');
                            disconnectBtn.disabled = false;
                        }
                    });
                };

                trainerActions.append(accessBtn, disconnectBtn);
                trainerHead.append(trainerCaption);

                const row = (label, value) => {
                    const item = createElement('div', 'profile-cabinet-row profile-linked-trainer-row');
                    item.appendChild(createElement('span', 'profile-cabinet-label', label));
                    item.appendChild(createElement('span', 'profile-cabinet-value', value || '—'));
                    return item;
                };

                const accessNote = createElement(
                    'p',
                    'profile-linked-trainer-access-note',
                    getTrainerAccessSummaryText(trainer)
                );

                trainerCard.append(
                    trainerHead,
                    row('Имя', trainer.firstName || '—'),
                    row('Фамилия', trainer.lastName || '—')
                );

                trainerCard.append(accessNote, trainerActions);
                linkedTrainersList.appendChild(trainerCard);
            });
        })
        .catch((e) => {
            console.error(e);
            linkedTrainersList.replaceChildren(
                createElement('p', 'muted profile-linked-trainers-empty', 'Не удалось загрузить данные тренера.')
            );
        });
    }

    const invitesTitle = createElement('h3', 'profile-invites-title');
    invitesTitle.textContent = 'Приглашения от тренеров';
    wrap.appendChild(invitesTitle);

    const invitesHint = createElement('p', 'muted profile-invites-hint');
    invitesHint.textContent =
        'Если тренер добавил вас по личному номеру, здесь появится запрос. Приняв его, вы разрешите тренеру работу с вашими циклами и дневником в персональном режиме.';
    wrap.appendChild(invitesHint);

    const invitesList = createElement('div', 'profile-invites-list');
    wrap.appendChild(invitesList);

    if (isOffline) {
        invitesList.replaceChildren(createElement('p', 'muted', TRAINER_LINK_ONLINE_ONLY_MESSAGE));
    } else {
        fetchPendingTrainerInvites()
        .then((invites) => {
            invitesList.replaceChildren();
            if (!invites.length) {
                invitesList.appendChild(createElement('p', 'muted', 'Нет ожидающих приглашений.'));
                return;
            }
            for (const inv of invites) {
                const row = createElement('div', 'profile-invite-row');

                const text = createElement('div', 'profile-invite-row__text', 'Запрос на связь аккаунтов с тренером.');

                const actions = createElement('div', 'profile-invite-row__actions');
                const accept = createElement('button', 'btn btn-primary profile-invite-btn', 'Принять');
                const reject = createElement('button', 'btn btn-outline profile-invite-btn', 'Отклонить');

                accept.onclick = async () => {
                    accept.disabled = true;
                    reject.disabled = true;
                    try {
                        await acceptTrainerInviteClient(inv.id);
                        showToast('Связь с тренером установлена');
                        render();
                    } catch (e) {
                        console.error(e);
                        showToast(e?.message || 'Не удалось принять приглашение');
                        accept.disabled = false;
                        reject.disabled = false;
                    }
                };
                reject.onclick = async () => {
                    accept.disabled = true;
                    reject.disabled = true;
                    try {
                        await rejectTrainerInviteClient(inv.id);
                        showToast('Приглашение отклонено');
                        render();
                    } catch (e) {
                        console.error(e);
                        showToast(e?.message || 'Не удалось отклонить');
                        accept.disabled = false;
                        reject.disabled = false;
                    }
                };

                actions.append(accept, reject);
                row.append(text, actions);
                invitesList.appendChild(row);
            }
        })
        .catch((e) => {
            console.error(e);
            invitesList.replaceChildren(
                createElement('p', 'muted', 'Не удалось загрузить приглашения. Проверьте правила Firestore.')
            );
        });
    }

    root.appendChild(wrap);
}
