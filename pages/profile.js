import {
    createElement,
    showToast,
    render,
    saveCabinetUserProfile,
    refreshUserProfileFromServer,
    buildPublicCodeVisualHTML,
    fetchPendingTrainerInvites,
    acceptTrainerInviteClient,
    rejectTrainerInviteClient
} from '../script.js';

function formatBirthDateDisplay(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    return `${m[3]}.${m[2]}.${m[1]}`;
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

    const invitesTitle = createElement('h3', 'profile-invites-title');
    invitesTitle.textContent = 'Приглашения от тренеров';
    wrap.appendChild(invitesTitle);

    const invitesHint = createElement('p', 'muted profile-invites-hint');
    invitesHint.textContent =
        'Если тренер добавил вас по личному номеру, здесь появится запрос. Приняв его, вы разрешите тренеру работу с вашими циклами и дневником в персональном режиме.';
    wrap.appendChild(invitesHint);

    const invitesList = createElement('div', 'profile-invites-list');
    wrap.appendChild(invitesList);

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

    root.appendChild(wrap);
}
