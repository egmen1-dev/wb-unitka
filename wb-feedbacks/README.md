# Отзывы WB — AI-ответы

Отдельный минимальный сервис для ответов на отзывы Wildberries с AI-черновиками (YandexGPT). Не связан с [Юниткой WB](https://wb-unitka.vercel.app) — свой токен и свой деплой, без конфликтов лимитов API.

**Продакшен:** https://wb-feedbacks.vercel.app

## Локальный запуск

```bash
# из корня репозитория
npm install
npm run dev:feedbacks
```

Откроется http://127.0.0.1:5175

## Токен WB

1. ЛК WB → Профиль → Настройки → **Доступ к API**
2. Создайте токен с категориями:

| Категория | Обязательность | Для чего |
|-----------|----------------|----------|
| **Вопросы и отзывы** | обязательно | Список и ответы на отзывы |
| **Контент** | обязательно | Описание и характеристики для AI |
| **Цены и скидки** | рекомендуется | Премиум-апселл с ценой |
| **Статистика** | опционально | Сводный рейтинг SKU |

3. Вставьте токен на странице — он сохранится только в **localStorage** браузера.

## YandexGPT на Vercel

1. [console.yandex.cloud](https://console.yandex.cloud/) → каталог (folder)
2. **Foundation Models** → API-ключ (тип Api-Key)
3. В Vercel → Settings → Environment Variables:

| Переменная | Описание |
|------------|----------|
| `YANDEX_GPT_API_KEY` | API-ключ Yandex Cloud |
| `YANDEX_FOLDER_ID` | ID каталога (`b1g…`) |
| `YANDEX_GPT_MODEL` | опционально: `yandexgpt-lite` (по умолчанию) |

Роль сервисного аккаунта: `ai.languageModels.user`. После добавления переменных — redeploy.

Опционально: `OPENAI_API_KEY` — запасной вариант, если YandexGPT недоступен.

## Деплой

Отдельный Vercel-проект с конфигом `vercel.feedbacks.json`:

```bash
npm run deploy:feedbacks
```

CI: `.github/workflows/deploy-wb-feedbacks.yml` (нужен секрет `VERCEL_FEEDBACKS_PROJECT_ID`).

## API

См. [FEEDBACKS-API.md](./FEEDBACKS-API.md) — эндпоинты `/api/feedbacks/*`.
