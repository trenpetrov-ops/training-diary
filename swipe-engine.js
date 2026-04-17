/**
 * Общий движок горизонтального свайпа (как food-info-header в meal):
 * ось из gestures.js, резина, скорость по сэмплам, пружина 340ms, подавление клика.
 */
import {
    isPointerOnSwipeExcludedTarget,
    resolveSwipePanAxis,
    suppressClickFollowingSwipeGesture
} from './gestures.js';

export const SWIPE_SPRING_MS = 340;
export const SWIPE_SPRING_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const SWIPE_RUBBER_BAND = 11;

const PULL_PAST_CLOSED = 9;
const PULL_PAST_OPEN = 10;

function suppressNextClickGlobally() {
    const handler = (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        document.removeEventListener('click', handler, true);
    };
    document.addEventListener('click', handler, true);
    setTimeout(() => document.removeEventListener('click', handler, true), 400);
}

export function swipeRubberBand(value, min, max, band = SWIPE_RUBBER_BAND) {
    if (value < min) {
        const over = min - value;
        return min - band * (1 - Math.exp(-over / band));
    }
    if (value > max) {
        const over = value - max;
        return max + band * (1 - Math.exp(-over / band));
    }
    return value;
}

export function resolveSwipeContent(swipeRootEl) {
    if (!swipeRootEl) return null;
    return (
        swipeRootEl.querySelector('.meal-card-header-content') ||
        swipeRootEl.querySelector('.food-info-header-content') ||
        swipeRootEl.querySelector('.swipe-content')
    );
}

/**
 * @param {HTMLElement} swipeRootEl
 * @param {(root: HTMLElement) => void} [onClosedVisual] — бордеры meal/food и т.п.
 */
export function closeSwipeRowVisual(swipeRootEl, onClosedVisual) {
    if (!swipeRootEl) return;
    const content = resolveSwipeContent(swipeRootEl);
    if (!content) return;

    swipeRootEl.classList.remove('open');
    swipeRootEl.classList.remove('open-left');
    content.style.transition = `transform ${SWIPE_SPRING_MS}ms ${SWIPE_SPRING_EASE}`;
    content.style.transform = 'translateX(0px)';
    if (typeof onClosedVisual === 'function') {
        onClosedVisual(swipeRootEl);
    }
    setTimeout(() => {
        content.style.transition = '';
    }, SWIPE_SPRING_MS + 40);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.swipeRoot
 * @param {HTMLElement} opts.contentEl
 * @param {number} opts.maxSwipe
 * @param {number} [opts.openAt]
 * @param {number} [opts.velocityThreshold]
 * @param {string} [opts.rootSelectorForSameType] — для закрытия другой открытой строки того же типа
 * @param {(root: HTMLElement) => void} [opts.onSwipeActiveVisual] — при фиксации оси X и при snap open
 * @param {(root: HTMLElement) => void} [opts.onSwipeClosedVisual] — при snap close
 * @param {(target: HTMLElement) => void} [opts.onBeforeOpen] — meal: крест-закрытие meal/food (после same-type)
 * @param {(e: PointerEvent, item: HTMLElement) => void} [opts.onPureTap]
 * @param {(item: HTMLElement) => boolean} [opts.pureTapIf]
 * @param {boolean} [opts.addDocumentClickOutside]
 */
export function attachSwipeRow({
    swipeRoot,
    contentEl,
    maxSwipe,
    openAt = Math.max(26, Math.round(maxSwipe * 0.38)),
    velocityThreshold = 0.28,
    rootSelectorForSameType = null,
    onSwipeActiveVisual = null,
    onSwipeClosedVisual = null,
    onBeforeOpen = null,
    onPureTap = null,
    pureTapIf = null,
    addDocumentClickOutside = true,
    edgeWidth = 0,
    edgeWidthLeft = 0,
    maxSwipeLeft = 0
}) {
    if (!swipeRoot || !contentEl) return;

    const item = swipeRoot;
    const openAtLeft = maxSwipeLeft > 0 ? Math.max(26, Math.round(maxSwipeLeft * 0.38)) : 0;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let lastX = 0;
    let lastTime = 0;
    let isDragging = false;
    let hasMovedHorizontally = false;
    let axisLocked = null;
    let activePointerId = null;
    let swipeDirection = null;
    const velocitySamples = [];

    function transitionSnap() {
        return `transform ${SWIPE_SPRING_MS}ms ${SWIPE_SPRING_EASE}`;
    }

    function applyClosedVisual(root) {
        if (typeof onSwipeClosedVisual === 'function') {
            onSwipeClosedVisual(root);
        }
    }

    function closeSwipe(target = item) {
        closeSwipeRowVisual(target, applyClosedVisual);
        target.classList.remove('open-left');
    }

    function openSwipe(target = item) {
        if (rootSelectorForSameType) {
            document.querySelectorAll(`${rootSelectorForSameType}.open, ${rootSelectorForSameType}.open-left`).forEach((opened) => {
                if (opened !== target) {
                    closeSwipeRowVisual(opened, applyClosedVisual);
                    opened.classList.remove('open-left');
                }
            });
        }

        if (typeof onBeforeOpen === 'function') {
            onBeforeOpen(target);
        }

        const targetContent = target === item ? contentEl : resolveSwipeContent(target);
        if (!targetContent) return;

        target.classList.add('open');
        target.classList.remove('open-left');
        targetContent.style.transition = transitionSnap();
        targetContent.style.transform = `translateX(-${maxSwipe}px)`;
        if (typeof onSwipeActiveVisual === 'function') {
            onSwipeActiveVisual(target);
        }
        setTimeout(() => {
            targetContent.style.transition = '';
        }, SWIPE_SPRING_MS + 40);
    }

    function openSwipeLeft(target = item) {
        if (rootSelectorForSameType) {
            document.querySelectorAll(`${rootSelectorForSameType}.open, ${rootSelectorForSameType}.open-left`).forEach((opened) => {
                if (opened !== target) {
                    closeSwipeRowVisual(opened, applyClosedVisual);
                    opened.classList.remove('open-left');
                }
            });
        }

        if (typeof onBeforeOpen === 'function') {
            onBeforeOpen(target);
        }

        const targetContent = target === item ? contentEl : resolveSwipeContent(target);
        if (!targetContent) return;

        target.classList.add('open-left');
        target.classList.remove('open');
        targetContent.style.transition = transitionSnap();
        targetContent.style.transform = `translateX(${maxSwipeLeft}px)`;
        if (typeof onSwipeActiveVisual === 'function') {
            onSwipeActiveVisual(target);
        }
        setTimeout(() => {
            targetContent.style.transition = '';
        }, SWIPE_SPRING_MS + 40);
    }

    function releasePointerCaptureSafe() {
        if (activePointerId == null) return;
        try {
            if (contentEl.hasPointerCapture(activePointerId)) {
                contentEl.releasePointerCapture(activePointerId);
            }
        } catch {
            /* ignore */
        }
        activePointerId = null;
    }

    function endSwipeTrackingVelocity() {
        if (velocitySamples.length < 2) return 0;
        const a = velocitySamples[0];
        const b = velocitySamples[velocitySamples.length - 1];
        const dt = b.t - a.t;
        if (dt < 1) return 0;
        return (b.x - a.x) / dt;
    }

    let startedInEdge = false;

    function preventTouchScroll(ev) {
        if (ev.cancelable) ev.preventDefault();
    }
    function enableTouchScrollLock() {
        document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    }
    function disableTouchScrollLock() {
        document.removeEventListener('touchmove', preventTouchScroll);
    }

    contentEl.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (isPointerOnSwipeExcludedTarget(e.target)) return;

        startedInEdge = false;
        const isOpen = item.classList.contains('open');
        const isOpenLeft = item.classList.contains('open-left');

        if (isOpen || isOpenLeft) {
            startedInEdge = true;
        } else if (edgeWidth > 0 || edgeWidthLeft > 0) {
            const rect = item.getBoundingClientRect();
            const fromRight = rect.right - e.clientX;
            const fromLeft = e.clientX - rect.left;
            if (edgeWidth > 0 && fromRight <= edgeWidth) startedInEdge = true;
            else if (edgeWidthLeft > 0 && maxSwipeLeft > 0 && fromLeft <= edgeWidthLeft) startedInEdge = true;
        } else {
            startedInEdge = true;
        }

        startX = e.clientX;
        startY = e.clientY;
        currentX = startX;
        lastX = startX;
        lastTime = Date.now();
        velocitySamples.length = 0;
        velocitySamples.push({ t: lastTime, x: startX });

        isDragging = true;
        hasMovedHorizontally = false;
        axisLocked = null;
        activePointerId = null;
        swipeDirection = null;

        if (startedInEdge) enableTouchScrollLock();

        contentEl.style.transition = 'none';
    });

    contentEl.addEventListener(
        'pointermove',
        (e) => {
            if (!isDragging) return;

            currentX = e.clientX;
            const deltaX = currentX - startX;
            const deltaY = e.clientY - startY;

            if (!axisLocked) {
                const panAxis = resolveSwipePanAxis(deltaX, deltaY);
                if (panAxis == null) return;

                if (panAxis === 'y') {
                    axisLocked = 'y';
                    isDragging = false;
                    disableTouchScrollLock();
                    contentEl.style.transition = '';
                    return;
                }

                if (!startedInEdge) {
                    axisLocked = 'y';
                    isDragging = false;
                    disableTouchScrollLock();
                    contentEl.style.transition = '';
                    return;
                }

                if (!swipeDirection) {
                    const isOpen = item.classList.contains('open');
                    const isOpenLeft = item.classList.contains('open-left');
                    if (isOpen) swipeDirection = 'right';
                    else if (isOpenLeft) swipeDirection = 'left';
                    else if (deltaX < 0) swipeDirection = 'right';
                    else if (deltaX > 0 && maxSwipeLeft > 0) swipeDirection = 'left';
                    else {
                        axisLocked = 'y';
                        isDragging = false;
                        disableTouchScrollLock();
                        contentEl.style.transition = '';
                        return;
                    }
                }

                axisLocked = 'x';

                activePointerId = e.pointerId;
                try {
                    contentEl.setPointerCapture(e.pointerId);
                } catch {
                    /* ignore */
                }

                if (rootSelectorForSameType) {
                    document.querySelectorAll(rootSelectorForSameType).forEach((other) => {
                        if (other !== item) {
                            closeSwipeRowVisual(other, applyClosedVisual);
                            other.classList.remove('open-left');
                        }
                    });
                }

                if (typeof onSwipeActiveVisual === 'function') {
                    onSwipeActiveVisual(item);
                }
            }

            if (axisLocked !== 'x') return;

            hasMovedHorizontally = true;

            if (e.cancelable) {
                e.preventDefault();
            }

            const now = Date.now();
            velocitySamples.push({ t: now, x: currentX });
            if (velocitySamples.length > 6) velocitySamples.shift();

            let translate;

            if (swipeDirection === 'right') {
                if (item.classList.contains('open')) {
                    const raw = deltaX - maxSwipe;
                    translate = swipeRubberBand(raw, -maxSwipe - PULL_PAST_OPEN, PULL_PAST_CLOSED, SWIPE_RUBBER_BAND);
                } else {
                    translate = swipeRubberBand(deltaX, -maxSwipe - PULL_PAST_OPEN, PULL_PAST_CLOSED, SWIPE_RUBBER_BAND);
                }
            } else {
                if (item.classList.contains('open-left')) {
                    const raw = deltaX + maxSwipeLeft;
                    translate = swipeRubberBand(raw, -PULL_PAST_CLOSED, maxSwipeLeft + PULL_PAST_OPEN, SWIPE_RUBBER_BAND);
                } else {
                    translate = swipeRubberBand(deltaX, -PULL_PAST_CLOSED, maxSwipeLeft + PULL_PAST_OPEN, SWIPE_RUBBER_BAND);
                }
            }

            contentEl.style.transform = `translateX(${translate}px)`;
        },
        { passive: false }
    );

    function endSwipe(e) {
        disableTouchScrollLock();

        if (activePointerId != null && e.pointerId != null && e.pointerId !== activePointerId) {
            return;
        }

        if (!isDragging && axisLocked !== 'x') return;

        isDragging = false;
        releasePointerCaptureSafe();

        const deltaX = currentX - startX;
        const v = endSwipeTrackingVelocity();

        if (!hasMovedHorizontally) {
            if (item.classList.contains('open') || item.classList.contains('open-left')) {
                closeSwipe(item);
                suppressClickFollowingSwipeGesture(contentEl);
            } else if (typeof onPureTap === 'function' && typeof pureTapIf === 'function' && pureTapIf(item)) {
                onPureTap(e, item);
                suppressNextClickGlobally();
                if (e && typeof e.preventDefault === 'function' && e.cancelable) {
                    e.preventDefault();
                }
            }
            axisLocked = null;
            swipeDirection = null;
            return;
        }

        if (swipeDirection === 'right') {
            const wasOpen = item.classList.contains('open');
            if (!wasOpen) {
                if (v < -velocityThreshold || deltaX <= -openAt) {
                    openSwipe(item);
                } else {
                    closeSwipe(item);
                }
            } else {
                const closeThreshold = Math.max(22, Math.round(maxSwipe * 0.34));
                if (v > velocityThreshold || deltaX >= closeThreshold) {
                    closeSwipe(item);
                } else {
                    openSwipe(item);
                }
            }
        } else if (swipeDirection === 'left' && maxSwipeLeft > 0) {
            const wasOpenLeft = item.classList.contains('open-left');
            if (!wasOpenLeft) {
                if (v > velocityThreshold || deltaX >= openAtLeft) {
                    openSwipeLeft(item);
                } else {
                    closeSwipe(item);
                }
            } else {
                const closeThreshold = Math.max(22, Math.round(maxSwipeLeft * 0.34));
                if (v < -velocityThreshold || deltaX <= -closeThreshold) {
                    closeSwipe(item);
                } else {
                    openSwipeLeft(item);
                }
            }
        } else {
            closeSwipe(item);
        }

        suppressClickFollowingSwipeGesture(contentEl);
        axisLocked = null;
        swipeDirection = null;
    }

    contentEl.addEventListener('pointerup', endSwipe);
    contentEl.addEventListener('pointercancel', endSwipe);

    if (addDocumentClickOutside) {
        document.addEventListener('click', (e) => {
            if ((item.classList.contains('open') || item.classList.contains('open-left')) && !item.contains(e.target)) {
                closeSwipe(item);
            }
        });
    }
}

/**
 * @param {object} opts
 * @param {string} opts.rootSelector
 * @param {string} opts.contentSelector
 * @param {number} opts.maxSwipe
 * @param {number} [opts.openAt]
 * @param {number} [opts.velocityThreshold]
 * @param {(target: HTMLElement) => void} [opts.onSwipeActiveVisual]
 * @param {(target: HTMLElement) => void} [opts.onSwipeClosedVisual]
 * @param {(target: HTMLElement) => void} [opts.onBeforeOpen] — после закрытия same-type; meal: крест meal/food
 * @param {(e: PointerEvent, item: HTMLElement) => void} [opts.onPureTap]
 * @param {(item: HTMLElement) => boolean} [opts.pureTapIf]
 */
export function bindSwipeBlock({
    rootSelector,
    contentSelector,
    maxSwipe,
    openAt = Math.max(26, Math.round(maxSwipe * 0.38)),
    velocityThreshold = 0.28,
    onSwipeActiveVisual = null,
    onSwipeClosedVisual = null,
    onBeforeOpen = null,
    onPureTap = null,
    pureTapIf = null,
    edgeWidth = 0,
    edgeWidthLeft = 0,
    maxSwipeLeft = 0
}) {
    const swipeItems = document.querySelectorAll(rootSelector);

    swipeItems.forEach((item) => {
        const content = item.querySelector(contentSelector);
        if (!content) return;

        const bindKey = `swipeBound_${contentSelector.replace(/[^a-z0-9]/gi, '_')}`;
        if (item.dataset[bindKey] === '1') return;
        item.dataset[bindKey] = '1';

        attachSwipeRow({
            swipeRoot: item,
            contentEl: content,
            maxSwipe,
            openAt,
            velocityThreshold,
            rootSelectorForSameType: rootSelector,
            onSwipeActiveVisual,
            onSwipeClosedVisual,
            onBeforeOpen,
            onPureTap,
            pureTapIf,
            addDocumentClickOutside: true,
            edgeWidth,
            edgeWidthLeft,
            maxSwipeLeft
        });
    });
}
