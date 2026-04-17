/**
 * Пороги жестов в духе iOS (UIScrollView / UIPanGestureRecognizer):
 * — пока смещение мало, жест «ни чей» — скролл страницы не блокируем;
 * — горизонталь фиксируется только при явном преобладании |dx| над |dy|;
 * — при долгом неоднозначном движении отдаём жест вертикали (список скроллится, свайп не стартует).
 */

export const SWIPE_PAN_MIN_MOVE = 10;
/** Минимальная проекция по доминирующей оси для решения «ещё рано» */
export const SWIPE_PAN_MIN_AXIS = 10;
export const SWIPE_PAN_HORIZONTAL_RATIO = 1.7;
export const SWIPE_PAN_VERTICAL_RATIO = 1.2;
/** После этого смещения без явного лидера — считаем жест вертикальным */
export const SWIPE_PAN_AMBIGUOUS_CEILING = 18;

const SWIPE_EXCLUDE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'option',
    'label',
    '[role="button"]',
    '[contenteditable="true"]',
    '.action-btn',
    '.menu-btn',
    '.meal-add-icon',
    'summary'
].join(',');

export function isPointerOnSwipeExcludedTarget(el) {
    return !!(el && el.closest(SWIPE_EXCLUDE_SELECTOR));
}

/**
 * @param {number} deltaX
 * @param {number} deltaY
 * @param {object} [opt]
 * @returns {'x' | 'y' | null}
 */
export function resolveSwipePanAxis(deltaX, deltaY, opt = {}) {
    const minMove = opt.minMove ?? SWIPE_PAN_MIN_MOVE;
    const minAxis = opt.minAxis ?? SWIPE_PAN_MIN_AXIS;
    const hRatio = opt.horizontalRatio ?? SWIPE_PAN_HORIZONTAL_RATIO;
    const vRatio = opt.verticalRatio ?? SWIPE_PAN_VERTICAL_RATIO;
    const ambiguousCeiling = opt.ambiguousCeiling ?? SWIPE_PAN_AMBIGUOUS_CEILING;

    const ax = Math.abs(deltaX);
    const ay = Math.abs(deltaY);

    if (ax < minMove && ay < minMove) return null;

    if (ax >= minAxis && ax > ay * hRatio) return 'x';
    if (ay >= minAxis && ay > ax * vRatio) return 'y';

    if (Math.max(ax, ay) >= ambiguousCeiling) return 'y';

    return null;
}

/**
 * Блокирует один «фантомный» click после горизонтального пана (как отмена touch в iOS).
 */
export function suppressClickFollowingSwipeGesture(containerEl) {
    if (!containerEl) return;

    const handler = (ev) => {
        if (!containerEl.contains(ev.target)) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        document.removeEventListener('click', handler, true);
    };

    document.addEventListener('click', handler, true);
    setTimeout(() => {
        document.removeEventListener('click', handler, true);
    }, 450);
}
