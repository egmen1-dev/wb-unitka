export default function Logo({ compact = false }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : ''}`}>
      <div
        className={`flex shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 ${
          compact ? 'h-9 w-9' : 'h-11 w-11'
        }`}
        aria-hidden
      >
        <svg viewBox="0 0 32 32" className={compact ? 'h-5 w-5' : 'h-6 w-6'} fill="none">
          <rect x="4" y="6" width="24" height="20" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M9 14h6M9 18h10M9 22h8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="22" cy="12" r="3" fill="currentColor" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className={`font-semibold leading-tight text-white ${compact ? 'text-sm' : 'text-lg'}`}>
          Юнитка
        </p>
        {!compact ? (
          <p className="text-xs text-brand-100">Калькулятор юнит-экономики WB</p>
        ) : null}
      </div>
    </div>
  );
}
