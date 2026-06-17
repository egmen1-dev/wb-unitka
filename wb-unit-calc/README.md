# Юнитка WB — одностраничный калькулятор

Отдельный сайт для юнит-экономики Wildberries. Не связан с интернет-магазином.

## Запуск локально

```bash
# из корня moi-magazin
npm install
npm run dev:unit
```

Откройте http://127.0.0.1:5174

## Возможности

- Несколько WB API-ключей (кабинеты) — хранятся в браузере
- Загрузка каталога, цен, остатков, комиссий, логистики с WB API
- Ручной ввод / импорт закупочных цен
- Настройки формул (налог, комиссия, логистика)
- **ДРР по артикулу** — средняя доля рекламы за 30 дней из API Продвижения (`/adv/v3/fullstats`)
- **Отзывы WB** — список, AI-черновики с апселлом, ответ через API (см. [FEEDBACKS-API.md](./FEEDBACKS-API.md))
- Пересчёт в реальном времени при изменении закупки или настроек

Токен WB должен включать категорию **«Продвижение»** для подгрузки рекламы.

## Команда

1. Нажмите **«Создать команду»** — получите код (например `A1B2C3D4`)
2. Скопируйте **ссылку для команды** и отправьте коллегам
3. Токен WB, закупки, настройки и таблица — общие для всех

Данные хранятся в облаке (Postgres магазина).

## Продакшен

**https://wb-unitka.vercel.app**

### Автодеплой (рекомендуется)

1. Закоммитьте и запушьте в `main` или `feature/wb-unit-calc`
2. Один раз добавьте секреты GitHub — см. [`.github/DEPLOY-WB-UNITKA.md`](../.github/DEPLOY-WB-UNITKA.md)

### Ручной деплой

```bash
npm run deploy:unit
```

Или по шагам:

```bash
vercel link --project wb-unitka
vercel deploy --prod --local-config vercel.unit.json
vercel link --project moi-magazin   # вернуть линк магазина
```

## Структура

- `src/` — React SPA
- `../lib/unit-economics/` — формулы расчёта
- `../api/unit-calc/sync.js` — прокси к WB API (токен из заголовка)
- `../api/unit-calc/feedbacks.js`, `feedback-draft.js`, `feedbacks-check.js` — отзывы (см. [FEEDBACKS-API.md](./FEEDBACKS-API.md))
