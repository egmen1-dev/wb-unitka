import { useEffect, useRef } from 'react';

/** Сохраняет scrollTop в sessionStorage. Восстановление — только один раз при монтировании. */
export function useScrollRestore(containerRef, storageKey, enabled = true) {
  const restoredRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !storageKey || !enabled) return undefined;

    if (!restoredRef.current) {
      restoredRef.current = true;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = Number(saved) || 0;
            }
          });
        }
      } catch {
        // sessionStorage недоступен
      }
    }

    const onScroll = () => {
      try {
        sessionStorage.setItem(storageKey, String(el.scrollTop));
      } catch {
        // ignore
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, storageKey, enabled]);
}
