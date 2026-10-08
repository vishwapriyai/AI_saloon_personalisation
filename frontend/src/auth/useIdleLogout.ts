import { useEffect } from 'react';

const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Calls onIdle after `minutes` without any touch, click, key or scroll. Used on shared salon tablets so the
 * next person does not find the previous customer still logged in.
 */
export function useIdleLogout(enabled: boolean, minutes: number, onIdle: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, minutes * 60_000);
    };
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [enabled, minutes, onIdle]);
}
