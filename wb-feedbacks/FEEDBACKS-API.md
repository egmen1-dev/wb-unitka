# API отзывов WB (wb-feedbacks)

Прокси для standalone-сервиса [wb-feedbacks](https://wb-feedbacks.vercel.app). Токен WB в заголовке `Authorization: Bearer <token>`.

## Эндпоинты

### `POST /api/feedbacks/feedbacks`

| `action` | Описание |
|----------|----------|
| `list` | Неотвеченные отзывы |
| `count` | Счётчик без ответа |
| `get` | Один отзыв по `feedbackId` |
| `answer` | Отправить ответ (`feedbackId`, `text`) |

### `POST /api/feedbacks/feedback-draft`

Генерация AI-черновика: `{ feedback, catalogRows?, regenerate?, variationSeed? }`.

Приоритет: YandexGPT → OpenAI → шаблон.

### `GET|POST /api/feedbacks/ai-config-check`

Проверка AI-ключей на сервере: `{ yandexConfigured, openaiConfigured }` (без значений ключей).

### `POST /api/feedbacks/feedbacks-check`

Проверка категорий токена WB.

### `GET|POST /api/feedbacks/auto-reply-batch`

Один цикл автоответа на сервере (для cron). Требует `WB_API_TOKEN` в env.

### `GET /api/cron/auto-reply`

Vercel Cron: вызывает `auto-reply-batch` каждые 6 минут, если задан `WB_API_TOKEN`.

## Локальная разработка

Маршруты в `wb-feedbacks/vite.config.js`, порт **5175**.

## Деплой

`vercel.feedbacks.json` — `maxDuration: 60` для serverless-функций.
