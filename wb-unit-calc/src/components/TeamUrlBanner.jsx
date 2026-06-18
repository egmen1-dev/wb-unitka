export default function TeamUrlBanner({ teamCode, onRestore }) {
  if (!teamCode) return null;

  return (
    <div
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:px-6"
      role="alert"
    >
      <p>
        Код команды не в URL — ссылка для коллег может не работать.{' '}
        <button type="button" className="font-medium underline" onClick={onRestore}>
          Восстановить ссылку
        </button>
      </p>
    </div>
  );
}
