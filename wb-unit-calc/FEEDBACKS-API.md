# API отзывов WB (unit-calc)

Прокси-эндпоинты для вкладки «Отзывы» в [wb-unitka](https://wb-unitka.vercel.app). Токен WB передаётся в заголовке `Authorization: Bearer <token>` или в теле `{ "token": "…" }`.

## Эндпоинты

### `POST /api/unit-calc/feedbacks`

Прокси к [feedbacks-api.wildberries.ru](https://feedbacks-api.wildberries.ru). Требует категорию токена **«Вопросы и отзывы»**.

| `action` | Тело запроса | Ответ | WB API |
|----------|--------------|-------|--------|
| `list` (по умолчанию) | `{ "take": 50, "skip": 0, "order": "dateDesc" }` | `{ feedbacks[], countUnanswered, countUnansweredToday, countArchive }` | `GET /api/v1/feedbacks?isAnswered=false` |
| `count` | `{ "action": "count" }` | `{ countUnanswered, countUnansweredToday }` | `GET /api/v1/feedbacks/count-unanswered` |
| `get` | `{ "action": "get", "feedbackId": "…" }` | `{ feedback }` | `GET /api/v1/feedback?id=…` |
| `answer` | `{ "action": "answer", "feedbackId": "…", "text": "…" }` | `{ verified, isAnswered, answerText, feedback }` | `POST /api/v1/feedbacks/answer` + проверка через `GET /api/v1/feedback` |

Объект `feedback` (нормализованный):

```json
{
  "id": "string",
  "rating": 5,
  "text": "…",
  "pros": "…",
  "cons": "…",
  "nmId": 12345678,
  "article": "vendor-code",
  "productName": "…",
  "brandName": "…",
  "createdDate": "2025-01-01T12:00:00Z",
  "userName": "…",
  "answer": null,
  "isAnswered": false
}
```

### `POST /api/unit-calc/feedback-draft`

Генерация AI-черновика ответа. Токен WB опционален (для обогащения карточки из Content API).

| Поле | Описание |
|------|----------|
| `feedback` | Объект отзыва (из `list` или `get`) |
| `catalogRows` | Строки каталога из синка (артикул, nmId, цена, subjectId…) |
| `regenerate` | `true` — другая формулировка |
| `variationSeed` | Число для вариативности |

Ответ: `{ draft, source, product, alternative, premiumUpsell, validation }`.

Источники черновика: `openai`, `openai-regen`, `template`, `template-fallback` (если нет `OPENAI_API_KEY` на сервере).

### `POST /api/unit-calc/feedbacks-check`

Проверка категорий токена WB для отзывов. Тело: `{}`.

Ответ:

```json
{
  "action": "check",
  "scopes": [
    { "scopeId": "feedbacks", "label": "Вопросы и отзывы", "ok": true, "required": true },
    { "scopeId": "content", "label": "Контент", "ok": true, "required": true }
  ],
  "allRequiredOk": true,
  "missingRequired": [],
  "missingRecommended": ["Цены и скидки"],
  "summary": "…",
  "categories": [ … ]
}
```

Проверка: `GET /ping` + функциональный запрос на каждый API (count-unanswered, cards/list, prices filter, statistics report).

## Категории токена WB

Создание: ЛК WB → Профиль → Настройки → Доступ к API.

| Категория | Обязательность | Для чего | Без права (degraded) |
|-----------|----------------|----------|----------------------|
| **Вопросы и отзывы** | обязательно | Список, счётчик, просмотр, ответ | Вкладка не работает |
| **Контент** | обязательно | Артикул, характеристики, описание, nmId, subjectId в AI-черновике | Черновик только по названию из каталога синка |
| **Цены и скидки** | рекомендуется | Цена и дельта для премиум-апселла | Апселл по артикулу без суммы «+N ₽» |
| **Статистика** | опционально | Сводный рейтинг SKU в каталоге | Рейтинг в отзыве есть из API отзывов |

## Локальная разработка

Маршруты подключены в `wb-unit-calc/vite.config.js` (dev-сервер на порту 5174).

## Деплой

Функции зарегистрированы в `vercel.unit.json` и `wb-unit-calc/vercel.json` с `maxDuration: 60`.
