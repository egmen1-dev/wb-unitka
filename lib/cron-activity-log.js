/** Server-side log of cron / auto-reply-batch runs (last 10). */

const MAX_ENTRIES = 10;
const CRON_SCHEDULE = '*/6 * * * *';
const RECENT_ACTIVE_MS = 20 * 60 * 1000;
const STALE_MS = 25 * 60 * 1000;

function memoryLog() {
  if (!globalThis.__wbCronActivityLog) globalThis.__wbCronActivityLog = [];
  return globalThis.__wbCronActivityLog;
}

function normalizeEntry(entry) {
  return {
    at: entry.at || new Date().toISOString(),
    source: entry.source || 'cron',
    statusCode: entry.statusCode ?? 200,
    action: entry.action || 'unknown',
    ok: entry.ok ?? true,
    error: entry.error || entry.reason || entry.message || null,
    feedbackId: entry.feedbackId || null,
    productName: entry.productName || null,
    authMode: entry.authMode || null,
  };
}

async function persistToPostgres(entry) {
  if (!process.env.POSTGRES_URL?.trim()) return false;
  try {
    const { sql } = await import('@vercel/postgres');
    await sql`
      CREATE TABLE IF NOT EXISTS wb_cron_activity (
        id SERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        payload JSONB NOT NULL
      )
    `;
    await sql`INSERT INTO wb_cron_activity (at, payload) VALUES (${entry.at}::timestamptz, ${JSON.stringify(entry)}::jsonb)`;
    await sql`
      DELETE FROM wb_cron_activity
      WHERE id NOT IN (
        SELECT id FROM wb_cron_activity ORDER BY at DESC LIMIT ${MAX_ENTRIES}
      )
    `;
    return true;
  } catch (error) {
    console.warn('[cron-activity-log] postgres persist failed:', error.message);
    return false;
  }
}

async function loadFromPostgres() {
  if (!process.env.POSTGRES_URL?.trim()) return null;
  try {
    const { sql } = await import('@vercel/postgres');
    const { rows } = await sql`
      SELECT payload FROM wb_cron_activity ORDER BY at DESC LIMIT ${MAX_ENTRIES}
    `;
    return rows.map((row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload));
  } catch {
    return null;
  }
}

export async function appendCronActivity(rawEntry) {
  const entry = normalizeEntry(rawEntry);
  const log = memoryLog();
  log.unshift(entry);
  log.length = Math.min(log.length, MAX_ENTRIES);
  await persistToPostgres(entry);
  return entry;
}

export async function getCronActivityLog() {
  const fromDb = await loadFromPostgres();
  if (fromDb?.length) return fromDb;
  return [...memoryLog()];
}

export function getLastCronRun(log = memoryLog()) {
  return log[0] || null;
}

/** Only successful cron outcomes block the browser scheduler (avoid 429/error false positives). */
const CRON_HEALTHY_ACTIONS = new Set(['sent', 'idle']);

export function isCronRecentlyActive(log, maxAgeMs = RECENT_ACTIVE_MS) {
  const last = getLastCronRun(log);
  if (!last) return false;
  if (!CRON_HEALTHY_ACTIONS.has(last.action)) return false;
  const age = Date.now() - new Date(last.at).getTime();
  return age <= maxAgeMs;
}

export function getCronDiagnosis({ serverCronEnabled, serverCronReady, log = [] } = {}) {
  const last = getLastCronRun(log);
  const lastAgeMs = last ? Date.now() - new Date(last.at).getTime() : null;

  if (!serverCronEnabled) {
    return {
      status: 'disabled',
      message: 'WB_API_TOKEN не задан — серверный cron выключен.',
      recentlyActive: false,
      stale: false,
    };
  }

  if (!serverCronReady) {
    return {
      status: 'not-ready',
      message: 'WB_API_TOKEN задан, но нет YandexGPT/OpenAI — cron не сгенерирует черновики.',
      recentlyActive: false,
      stale: false,
    };
  }

  if (last?.action === 'auth-failed') {
    return {
      status: 'auth-failed',
      message:
        'Последний cron: 401 Unauthorized. Проверьте CRON_SECRET и сделайте Redeploy production.',
      recentlyActive: false,
      stale: true,
      lastRun: last,
      hobbyLimitHint: true,
    };
  }

  if (
    last &&
    lastAgeMs != null &&
    lastAgeMs <= STALE_MS &&
    !CRON_HEALTHY_ACTIONS.has(last.action)
  ) {
    return {
      status: last.action || 'error',
      message:
        last.error ||
        `Последний cron: ${last.action}. Ответы не ушли — включите браузерный автоответчик «Вкл».`,
      recentlyActive: false,
      stale: true,
      lastRun: last,
      hobbyLimitHint: true,
    };
  }

  if (!last || (lastAgeMs != null && lastAgeMs > STALE_MS)) {
    const hours = lastAgeMs != null ? Math.round(lastAgeMs / 3_600_000) : null;
    return {
      status: 'stale',
      message:
        hours != null && hours >= 1
          ? `Cron не запускался ${hours} ч. На Vercel Hobby расписание */6 не работает (нужен Pro). Включите клиентский автоответчик или внешний cron.`
          : 'cron не работает (Hobby?) — включите браузерный автоответчик переключателем «Вкл» или перейдите на Vercel Pro.',
      recentlyActive: false,
      stale: true,
      lastRun: last,
      hobbyLimitHint: true,
    };
  }

  return {
    status: 'active',
    message: `Последний cron: ${last.action}${last.error ? ` — ${last.error}` : ''}`,
    recentlyActive: isCronRecentlyActive(log),
    stale: false,
    lastRun: last,
  };
}

export async function getCronStatusSummary({ serverCronEnabled = false, serverCronReady = false } = {}) {
  const runs = await getCronActivityLog();
  const diagnosis = getCronDiagnosis({ serverCronEnabled, serverCronReady, log: runs });
  return {
    schedule: CRON_SCHEDULE,
    runs,
    lastRun: getLastCronRun(runs),
    recentlyActive: diagnosis.recentlyActive,
    stale: diagnosis.stale,
    status: diagnosis.status,
    message: diagnosis.message,
    hobbyLimitHint: diagnosis.hobbyLimitHint || false,
  };
}
