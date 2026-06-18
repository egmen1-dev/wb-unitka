import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collectBrandOptions } from '../lib/brand-filter';

const MENU_WIDTH = 288;

export default function BrandFilter({ rows, selected = [], onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState({ left: 0, right: 'auto', maxWidth: 'min(18rem, calc(100vw - 1rem))' });
  const rootRef = useRef(null);

  const options = useMemo(() => collectBrandOptions(rows), [rows]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.name.toLowerCase().includes(q));
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return undefined;

    const anchor = rootRef.current.getBoundingClientRect();
    const gutter = 8;
    const maxWidth = Math.min(MENU_WIDTH, window.innerWidth - gutter * 2);
    const spaceRight = window.innerWidth - anchor.left - gutter;
    const spaceLeft = anchor.right - gutter;
    const alignRight = spaceRight < maxWidth && spaceLeft >= spaceRight;

    setMenuStyle({
      left: alignRight ? 'auto' : 0,
      right: alignRight ? 0 : 'auto',
      width: maxWidth,
      maxWidth,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!options.length) return null;

  const selectedSet = new Set(selected);
  const label =
    selected.length === 0
      ? 'Все бренды'
      : selected.length === 1
        ? selected[0]
        : `Бренды (${selected.length})`;

  function toggleBrand(name) {
    const next = selectedSet.has(name)
      ? selected.filter((item) => item !== name)
      : [...selected, name];
    onChange?.(next);
  }

  function selectAll() {
    onChange?.([]);
    setOpen(false);
  }

  function clearAll() {
    onChange?.([]);
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        className={`btn-secondary text-xs ${selected.length ? 'ring-1 ring-brand-300' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {label} ▾
      </button>

      {open ? (
        <div
          className="absolute z-30 mt-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
          style={menuStyle}
        >
          <div className="mb-2 flex items-center gap-2">
            <input
              className="input py-1 text-xs"
              placeholder="Поиск бренда…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {selected.length ? (
              <button type="button" className="shrink-0 text-xs text-brand-700 underline" onClick={clearAll}>
                Сброс
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50"
            onClick={selectAll}
          >
            <span className="font-medium text-slate-700">Все бренды</span>
            <span className="text-slate-400">{rows.length}</span>
          </button>

          <div className="max-h-56 overflow-auto border-t border-slate-100 pt-1">
            {filteredOptions.map((opt) => (
              <label
                key={opt.name}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(opt.name)}
                  onChange={() => toggleBrand(opt.name)}
                />
                <span className="min-w-0 flex-1 truncate text-slate-700" title={opt.name}>
                  {opt.name}
                </span>
                <span className="shrink-0 text-slate-400">{opt.count}</span>
              </label>
            ))}
            {!filteredOptions.length ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">Ничего не найдено</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
