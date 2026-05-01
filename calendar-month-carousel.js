/**
 * Горизонтальный свайп «три месяца» для календаря (как на странице БАДов).
 */
import { resolveSwipePanAxis } from './gestures.js';

/**
 * @param {HTMLElement} viewport
 * @param {HTMLElement} track
 * @param {object} options
 * @param {() => void} options.onCommitNext — после анимации сменить месяц на +1
 * @param {() => void} options.onCommitPrev — после анимации сменить месяц на −1
 * @param {number} [options.animationDuration]
 * @param {number} [options.swipeThreshold]
 * @param {() => void} [options.onHorizontalSwipeEnd] — после горизонтального жеста (например подавление ложного tap)
 */
export function attachMonthCarouselSwipe(viewport, track, options = {}) {
    const {
        onCommitNext,
        onCommitPrev,
        animationDuration = 220,
        swipeThreshold = 40,
        onHorizontalSwipeEnd = null
    } = options;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let panAxis = null;
    let isDragging = false;
    let isAnimating = false;

    const animateTo = (direction) => {
        if (isAnimating) return;
        isAnimating = true;

        track.style.transition = `transform ${animationDuration}ms ease`;

        if (direction === 'next') {
            track.style.transform = 'translate3d(-200%, 0, 0)';
            navigator.vibrate?.(8);
            setTimeout(() => {
                try {
                    onCommitNext?.();
                } finally {
                    isAnimating = false;
                }
            }, animationDuration);
            return;
        }

        if (direction === 'prev') {
            track.style.transform = 'translate3d(0%, 0, 0)';
            navigator.vibrate?.(8);
            setTimeout(() => {
                try {
                    onCommitPrev?.();
                } finally {
                    isAnimating = false;
                }
            }, animationDuration);
            return;
        }

        // Откат без «доезда» в противоположную сторону — фиксируем центр сразу.
        track.style.transition = 'none';
        track.style.transform = 'translate3d(-100%, 0, 0)';
        requestAnimationFrame(() => {
            track.style.transition = `transform ${animationDuration}ms ease`;
            isAnimating = false;
        });
    };

    viewport.addEventListener('touchstart', (event) => {
        if (isAnimating || !event.touches?.length) return;
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = startX;
        currentY = startY;
        panAxis = null;
        isDragging = true;
        track.style.transition = 'none';
    }, { passive: true });

    viewport.addEventListener('touchmove', (event) => {
        if (!isDragging || isAnimating || !event.touches?.length) return;

        const touch = event.touches[0];
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;
        currentX = touch.clientX;
        currentY = touch.clientY;

        if (!panAxis) {
            panAxis = resolveSwipePanAxis(diffX, diffY);
            if (panAxis == null) return;
            if (panAxis === 'y') {
                isDragging = false;
                track.style.transition = 'none';
                track.style.transform = 'translate3d(-100%, 0, 0)';
                requestAnimationFrame(() => {
                    track.style.transition = `transform ${animationDuration}ms ease`;
                });
                return;
            }
        }

        if (panAxis !== 'x') return;
        if (event.cancelable) event.preventDefault();

        const width = viewport.offsetWidth || 1;
        const percent = (diffX / width) * 100;
        track.style.transform = `translate3d(calc(-100% + ${percent}%), 0, 0)`;
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
        const wasHorizontalSwipe = panAxis === 'x';
        panAxis = null;
        if (!isDragging || isAnimating) return;
        isDragging = false;

        if (wasHorizontalSwipe && typeof onHorizontalSwipeEnd === 'function') {
            onHorizontalSwipeEnd();
        }

        const diffX = currentX - startX;

        if (diffX <= -swipeThreshold) {
            animateTo('next');
            return;
        }

        if (diffX >= swipeThreshold) {
            animateTo('prev');
            return;
        }

        animateTo('current');
    });

    viewport.addEventListener('touchcancel', () => {
        panAxis = null;
        isDragging = false;
        if (!isAnimating) {
            track.style.transition = 'none';
            track.style.transform = 'translate3d(-100%, 0, 0)';
            requestAnimationFrame(() => {
                track.style.transition = `transform ${animationDuration}ms ease`;
            });
        }
    });
}
