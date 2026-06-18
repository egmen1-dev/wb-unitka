# Автодеплой wb-unitka через GitHub

## Вариант A — GitHub Actions (уже настроен в репозитории)

Workflow: `.github/workflows/deploy-wb-unitka.yml`  
Запускается при push в `main` или `feature/wb-unit-calc`.

### Секреты в GitHub

Репозиторий → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Значение |
|--------|----------|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token |
| `VERCEL_ORG_ID` | `team_YX8AH2117J6xq38HdANK9L11` |
| `VERCEL_UNIT_PROJECT_ID` | `prj_zLmXxsah6LjN1QgRUe0v8EeYNmZr` |

После добавления секретов любой `git push` в эти ветки деплоит на https://wb-unitka.vercel.app

### Локально (как раньше)

```bash
npm run deploy:unit
```

---

## Вариант B — Vercel ↔ GitHub без Actions

1. [vercel.com](https://vercel.com) → проект **wb-unitka** → **Settings → Git**
2. Connect **egmen1-dev/wb-unitka**
3. Production branch: `main` (или `feature/wb-unit-calc`)
4. **Build & Development Settings:**
   - Framework Preset: Other
   - Build Command: `node node_modules/vite/bin/vite.js build --config wb-unit-calc/vite.config.js`
   - Output Directory: `wb-unit-calc/dist`
   - Install Command: `npm install`

Если используете вариант B, workflow из варианта A можно отключить или оставить как запасной.

### ⚠️ НИКОГДА не деплоить feedbacks на проект wb-unitka

Проект **wb-unitka** (`wb-unitka.vercel.app`) — только калькулятор (`wb-unit-calc/dist`).

Проект **wb-feedbacks** (`wb-feedbacks.vercel.app`) — только отзывы (`wb-feedbacks/dist`).

| Действие | wb-unitka | wb-feedbacks |
|----------|-----------|--------------|
| `npm run deploy:unit` / `vercel.unit.json` | ✅ | ❌ |
| `npm run deploy:feedbacks` / `vercel.feedbacks.json` | ❌ **НИКОГДА** | ✅ |

На ветках `main` и `feature/wb-unit-calc` корневой `vercel.json` **должен** совпадать с `vercel.unit.json` (сборка `wb-unit-calc`). Конфиг с `build:feedbacks` — только на ветке `wb-feedbacks`.

### Если wb-unitka показывает «Отзывы WB — AI-ответы»

1. **Redeploy калькулятора:** `npm run deploy:unit` (или push в `main` / `feature/wb-unit-calc` — GitHub Actions задеплоит с `vercel.unit.json`).
2. **Проверка:** `curl -sL https://wb-unitka.vercel.app | grep '<title>'` → должно быть `Юнитка WB — калькулятор`.
3. **Если Vercel Git подключён к wb-unitka** (вариант B): [vercel.com](https://vercel.com) → проект **wb-unitka** → **Settings → Git**:
   - Production Branch: `main` или `feature/wb-unit-calc` (не `wb-feedbacks` и не ветки с feedbacks-конfigом).
   - **Build Command:** `node node_modules/vite/bin/vite.js build --config wb-unit-calc/vite.config.js`
   - **Output Directory:** `wb-unit-calc/dist`
   - Отключите автодеплой из Git, если используете только GitHub Actions (вариант A).

---

## Переменные окружения Vercel (проект wb-unitka)

Убедитесь, что в Vercel заданы те же env, что нужны API (`POSTGRES_URL` и др.) — они уже должны быть от ручных деплоев.

Фронт: `VITE_STORAGE_API_BASE=https://moi-magazin.vercel.app` (см. `wb-unit-calc/.env.production`).
