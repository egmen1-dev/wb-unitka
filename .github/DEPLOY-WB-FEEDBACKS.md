# Автодеплой wb-feedbacks через GitHub

## Вариант A — GitHub Actions

Workflow: `.github/workflows/deploy-wb-feedbacks.yml`  
Запускается при push в `main`, `feature/wb-unit-calc`, `wb-feedbacks` и вручную (**Actions → Deploy wb-feedbacks → Run workflow**).

### Секреты в GitHub

Репозиторий → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Значение |
|--------|----------|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → **Create Token** (scope: deploy). Не используйте просроченный OAuth-токен из `vercel login` — для CI нужен отдельный token. |
| `VERCEL_ORG_ID` | `team_YX8AH2117J6xq38HdANK9L11` |
| `VERCEL_FEEDBACKS_PROJECT_ID` | Vercel → проект **wb-feedbacks** → **Settings → General → Project ID** (`prj_…`) |

Если любой из секретов пустой или неверный, шаг `npx vercel deploy` падает с ошибкой token / project / `Response Error`.

После добавления секретов push в `main` деплоит на https://wb-feedbacks.vercel.app

### Локально

```bash
# из корня репозитория (используется vercel.feedbacks.json, не vercel.json для unitka)
export VERCEL_ORG_ID=team_YX8AH2117J6xq38HdANK9L11
export VERCEL_PROJECT_ID=<Project ID из Vercel, тот же что VERCEL_FEEDBACKS_PROJECT_ID>
vercel login   # или: export VERCEL_TOKEN=...
npm run deploy:feedbacks
```

Эквивалент:

```bash
npx vercel@54.11.1 deploy --prod --yes --local-config vercel.feedbacks.json --token "$VERCEL_TOKEN"
```

**Важно:** каталог `.vercel/` в этом монорепо может быть привязан к **wb-unitka**. Для feedbacks задавайте `VERCEL_PROJECT_ID` / `VERCEL_FEEDBACKS_PROJECT_ID`, а не полагайтесь на локальный link.

### Проверка продакшена

```bash
# HTML: имя JS-бандла (меняется при каждой сборке)
curl -s https://wb-feedbacks.vercel.app/ | grep -o 'assets/index-[^"]*\.js'

# API: promptVersion и commit
curl -s https://wb-feedbacks.vercel.app/api/feedbacks/ai-config-check

# В бандле должны быть manager-v3 и «менеджер WB v3», не v2 и не «вернём деньги»
curl -s https://wb-feedbacks.vercel.app/assets/index-*.js | grep -oE 'manager-v[0-9]+|менеджер WB v[0-9]+' | sort -u
```

Ожидаемо после деплоя manager-v3:

| Проверка | Ожидание |
|----------|----------|
| Footer `commit …` | 7-символьный SHA текущего коммита (например `ade70ac` или новее) |
| Бейдж в UI | «Промпт: менеджер WB v3» |
| `/api/feedbacks/ai-config-check` | `"promptVersion":"manager-v3"` |
| JS bundle grep | `manager-v3`, без `manager-v2` |

Локально:

```bash
npm run build:feedbacks
ls wb-feedbacks/dist/assets/index-*.js
grep -oE 'manager-v[0-9]+|менеджер WB v[0-9]+' wb-feedbacks/dist/assets/index-*.js | sort -u
```

Имя hashed-бандла на проде должно совпасть с локальной сборкой нужного коммита.

---

## Вариант B — Vercel ↔ GitHub без Actions

1. [vercel.com](https://vercel.com) → проект **wb-feedbacks** → **Settings → Git**
2. Connect **egmen1-dev/wb-feedbacks** (или этот монорепо, если так настроено)
3. Production branch: `main`
4. **Build & Development Settings:**
   - Framework Preset: Other
   - Build Command: `npm run build:feedbacks`
   - Output Directory: `wb-feedbacks/dist`
   - Install Command: `npm install`

---

## Переменные окружения Vercel (проект wb-feedbacks)

API (`/api/feedbacks/*`) использует те же env, что и основной проект (например `POSTGRES_URL`, ключи YandexGPT и т.д.) — проверьте **Project → Settings → Environment Variables**.
