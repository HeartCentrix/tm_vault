import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Selector matches both the initial `[title]` form AND the `[data-orig-title]`
// form we set while showing. Without the second clause `closest()` would fail
// to resolve the icon on mouseout (because we stripped `title` to suppress the
// OS tooltip), so the tooltip would stick.
const SELECTOR = [
  '.wiz-info[title]', '.wiz-info[data-orig-title]',
  '.info-icon[title]', '.info-icon[data-orig-title]',
  '.secrets-info-icon[title]', '.secrets-info-icon[data-orig-title]',
].join(', ');

// Material Design / Apple HIG converge on 150–300ms before showing tooltips —
// short enough to feel responsive, long enough to filter cursor pass-throughs.
// Pick 150ms (more responsive end). Leave is instant per user request and
// matches `exit-faster-than-enter` UX rule.
const SHOW_DELAY_MS = 150;

interface TipState {
  x: number;
  y: number;
  text: string;
  side: 'top' | 'bottom';
}

export default function GlobalTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  // The active icon element. Tracked by reference so we don't depend on the
  // selector matching after we've stripped `title` from it.
  const activeRef = useRef<HTMLElement | null>(null);
  const showTimer = useRef<number | null>(null);

  useEffect(() => {
    function clearShowTimer() {
      if (showTimer.current != null) {
        window.clearTimeout(showTimer.current);
        showTimer.current = null;
      }
    }

    function findIcon(node: EventTarget | null): HTMLElement | null {
      const el = node as HTMLElement | null;
      if (!el || !el.closest) return null;
      return el.closest(SELECTOR) as HTMLElement | null;
    }

    function show(el: HTMLElement) {
      // Source of truth for the text — `title` first, then the stash if we
      // already stripped it during a prior show.
      const text = el.getAttribute('title') || el.getAttribute('data-orig-title') || '';
      if (!text) return;

      // Move `title` out of the way so the OS tooltip doesn't duplicate over
      // ours after its 700ms delay. Stashed on `data-orig-title` so we can
      // restore it on hide and so the selector still resolves the icon.
      if (el.hasAttribute('title')) {
        el.setAttribute('data-orig-title', text);
        el.removeAttribute('title');
      }

      const rect = el.getBoundingClientRect();
      // Flip below if the icon is in the upper third of the viewport — tip
      // would otherwise clip off the top of the screen.
      const side: 'top' | 'bottom' =
        rect.top < window.innerHeight * 0.33 ? 'bottom' : 'top';

      activeRef.current = el;
      setTip({
        x: rect.left + rect.width / 2,
        y: side === 'top' ? rect.top : rect.bottom,
        text,
        side,
      });
    }

    function hide() {
      const el = activeRef.current;
      if (el) {
        const orig = el.getAttribute('data-orig-title');
        if (orig != null) {
          el.setAttribute('title', orig);
          el.removeAttribute('data-orig-title');
        }
      }
      activeRef.current = null;
      clearShowTimer();
      setTip(null);
    }

    function onOver(e: MouseEvent) {
      const t = findIcon(e.target);
      if (!t) return;
      if (t === activeRef.current) return; // already showing for this icon
      // Reset any pending show on a different icon, then schedule for this one.
      clearShowTimer();
      showTimer.current = window.setTimeout(() => show(t), SHOW_DELAY_MS);
    }

    function onOut(e: MouseEvent) {
      const t = findIcon(e.target);
      if (!t) return;
      // mouseout fires when moving between child elements of the icon too.
      // Only treat it as "leave" when relatedTarget is outside the icon.
      const dest = e.relatedTarget as Node | null;
      if (dest && t.contains(dest)) return;
      clearShowTimer();
      // Hide if we're leaving the active icon, OR if we never showed (the
      // delayed timer fired between mouseover and mouseout).
      if (activeRef.current === t || activeRef.current == null) {
        hide();
      }
    }

    // Keyboard users — show immediately on focus (no delay), hide on blur.
    // Industry convention: focus skips the hover delay.
    function onFocusIn(e: FocusEvent) {
      const t = findIcon(e.target);
      if (t && t !== activeRef.current) {
        clearShowTimer();
        show(t);
      }
    }
    function onFocusOut(e: FocusEvent) {
      const t = findIcon(e.target);
      if (t === activeRef.current) hide();
    }

    // Stale-position guards: scrolling moves the icon, but our portal is
    // viewport-anchored — easier to dismiss and let user re-hover than to
    // recompute. Also clear on tab/window blur.
    function onScroll() { hide(); }
    function onKeyDown(e: KeyboardEvent) {
      // Apple HIG escape-routes: ESC dismisses tooltips/popovers.
      if (e.key === 'Escape' && activeRef.current) hide();
    }

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onScroll);

    return () => {
      clearShowTimer();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onScroll);
    };
  }, []);

  if (!tip) return null;

  // Clamp x so the tooltip never overflows the viewport edges.
  // 140 = half of max-width 280 in the CSS.
  const HALF = 140;
  const PADDING = 8;
  const clampedX = Math.max(
    HALF + PADDING,
    Math.min(tip.x, window.innerWidth - HALF - PADDING),
  );

  return createPortal(
    <div
      className={`gl-tooltip gl-tooltip--${tip.side}`}
      role="tooltip"
      style={{
        position: 'fixed',
        left: clampedX,
        top: tip.side === 'top' ? tip.y - 8 : tip.y + 8,
        transform:
          tip.side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
