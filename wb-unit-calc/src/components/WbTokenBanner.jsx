import {
  WB_SELLER_TOKEN_URL,
  isWbTokenScopeError,
  isWbTokenWithdrawnError,
} from '@lib/wb-auth-error.js';

export default function WbTokenBanner({ message, onOpenData }) {
  if (!message) return null;

  const withdrawn = isWbTokenWithdrawnError(message);
  const scope = isWbTokenScopeError(message);
  const alert = withdrawn || scope;

  return (
    <div
      className={`border-b px-4 py-3 text-sm lg:px-6 ${
        alert
          ? 'border-rose-300 bg-rose-50 text-rose-900'
          : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
      role="alert"
    >
      <p className="font-medium">{message}</p>
      {alert ? (
        <p className="mt-1 text-xs">
          <a
            href={WB_SELLER_TOKEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Управление токенами WB
          </a>
          {' · '}
          {onOpenData ? (
            <button type="button" className="font-medium underline" onClick={onOpenData}>
              Раздел «Данные»
            </button>
          ) : (
            'Вставьте новый токен в разделе «Данные»'
          )}
          {scope || withdrawn ? (
            <>
              {' · '}
              При сохранении токена проверяются категории Контент, Цены, Маркетплейс и Тарифы
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
