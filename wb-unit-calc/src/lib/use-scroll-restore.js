import { useEffect } from 'react';

/** Запоминает scrollTop контейнера между перезагрузками вкладки. */
export function useScrollRestore(containerRef, storageKey, ready = true) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !storageKey || !ready) return undefined;

    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        requestAnimationFrame(() => {
          el.scrollTop = Number(saved) || 0;
        });
      }
    } catch {
      // sessionStorage недоступен
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
  }, [containerRef, storageKey, ready]);
}
