# Деплой wb-feedbacks — один надёжный путь

Production: https://wb-feedbacks.vercel.app  
Репозиторий: **egmen1-dev/wb-feedbacks**, ветка **main**

## Почему раньше не обновлялся прод

1. **Vercel Git привязан к чужому репо** — проект `wb-feedbacks` на Vercel был связан с `egmen1-dev/wb-unitka`, а не с `egmen1-dev/wb-feedbacks`. Push в wb-feedbacks не триггерил деплой.
2. **GitHub Actions падал** — в репозитории wb-feedbacks не были заданы секреты `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_FEEDBACKS_PROJECT_ID`.
3. **Лишний workflow** — `deploy-wb-unitka.yml` тоже запускался на push в wb-feedbacks и падал (теперь отключён для этого репо).
4. **Ручной Redeploy в Vercel** — пересобирает **старый** коммит из привязанного репо (wb-unitka), не последний main wb-feedbacks.

Последний успешный прод до фикса: commit `432726d`, prompt `manager-v2`.

---

## Один раз: секреты GitHub

https://github.com/egmen1-dev/wb-feedbacks/settings/secrets/actions

| Secret | Значение |
|--------|----------|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token |
| `VERCEL_ORG_ID` | `team_YX8AH2117J6xq38HdANK9L11` |
| `VERCEL_FEEDBACKS_PROJECT_ID` | `prj_mRHrn2yyNCPZ5xsPZzu3khLRjWnB` |

Без этих трёх секретов Actions **всегда** падает на шаге Deploy.

---

## Надёжный деплой (рекомендуется)

```bash
cd /path/to/wb-feedbacks   # корень репозитория
git checkout main
git pull
git add .
git commit -m "описание изменений"
git push origin main
```

Через 1–3 минуты: https://github.com/egmen1-dev/wb-feedbacks/actions → **Deploy wb-feedbacks** → зелёный.

Workflow: `.github/workflows/deploy-wb-feedbacks.yml`  
- только ветка `main`  
- только репозиторий `egmen1-dev/wb-feedbacks`  
- конфиг `vercel.feedbacks.json`  
- после деплоя проверяет `/api/feedbacks/version`

---

## Локальный деплой (если Actions недоступен)

```bash
export VERCEL_ORG_ID=team_YX8AH2117J6xq38HdANK9L11
export VERCEL_PROJECT_ID=prj_mRHrn2yyNCPZ5xsPZzu3khLRjWnB
export VERCEL_TOKEN=<токен из vercel.com/account/tokens>
export VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD)
export GITHUB_SHA=$VERCEL_GIT_COMMIT_SHA

npm install
npm run deploy:feedbacks
```

**Не используйте** `.vercel/project.json` из монорепо wb-unitka — он привязан к другому проекту. Всегда задавайте `VERCEL_PROJECT_ID` явно.

---

## Проверка продакшена

```bash
# Версия API (commit, prompt, время сборки)
curl -s https://wb-feedbacks.vercel.app/api/feedbacks/version

# Должно быть manager-v3 и актуальный commitSha (7 символов)
curl -s https://wb-feedbacks.vercel.app/api/feedbacks/ai-config-check

# Имя JS-бандла (меняется при каждой сборке)
curl -s https://wb-feedbacks.vercel.app/ | grep -o 'assets/index-[^"]*\.js'
```

| Проверка | Ожидание |
|----------|----------|
| `/api/feedbacks/version` → `commitSha` | совпадает с `git rev-parse --short HEAD` на main |
| `/api/feedbacks/version` → `promptVersion` | `manager-v3` |
| Footer в UI | `commit <sha>` |
| Бейдж промпта | «Промпт: менеджер WB v3» |

---

## Vercel: Git integration (опционально)

Если в Vercel → wb-feedbacks → Settings → Git всё ещё **wb-unitka**:

- либо переподключите **egmen1-dev/wb-feedbacks**, branch `main`, build `npm run build:feedbacks`, output `wb-feedbacks/dist`;
- либо **отключите** Git deploy и полагайтесь только на GitHub Actions (предпочтительно — меньше путаницы).

Ручной **Redeploy** в Vercel без Actions пересоберёт привязанный репо, не обязательно wb-feedbacks main.

---

## Переменные окружения Vercel

Project → Settings → Environment Variables: `YANDEX_GPT_API_KEY`, `YANDEX_FOLDER_ID` и др. для `/api/feedbacks/*`.
