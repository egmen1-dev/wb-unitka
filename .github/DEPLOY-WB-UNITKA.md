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

---

## Переменные окружения Vercel (проект wb-unitka)

Убедитесь, что в Vercel заданы те же env, что нужны API (`POSTGRES_URL` и др.) — они уже должны быть от ручных деплоев.

Фронт: `VITE_STORAGE_API_BASE=https://moi-magazin.vercel.app` (см. `wb-unit-calc/.env.production`).
