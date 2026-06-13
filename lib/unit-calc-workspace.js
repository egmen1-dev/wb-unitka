import { randomBytes } from 'crypto';
import { getSql } from './db.js';

let tableReady = false;

export async function initUnitCalcWorkspaceTable() {
  if (tableReady) return;
  const db = getSql();
  await db`
    CREATE TABLE IF NOT EXISTS unit_calc_workspaces (
      team_code VARCHAR(32) PRIMARY KEY,
      name VARCHAR(120) NOT NULL DEFAULT 'Команда',
      password_hash TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  tableReady = true;
}

export function normalizeTeamCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

export function generateTeamCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export function getDefaultTeamCode() {
  return normalizeTeamCode(process.env.UNIT_CALC_DEFAULT_TEAM || '');
}

function normalizeTeamName(name) {
  return String(name || 'КОМАНДА')
    .trim()
    .toUpperCase()
    .slice(0, 120) || 'КОМАНДА';
}

export async function createWorkspace({ name, payload = {} }) {
  await initUnitCalcWorkspaceTable();
  const db = getSql();
  const teamName = normalizeTeamName(name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const teamCode = generateTeamCode();
    try {
      await db`
        INSERT INTO unit_calc_workspaces (team_code, name, password_hash, payload)
        VALUES (${teamCode}, ${teamName}, ${null}, ${db.json(payload)})
      `;
      return { teamCode, name: teamName };
    } catch (error) {
      if (error.code === '23505') continue;
      throw error;
    }
  }

  throw new Error('Не удалось сгенерировать уникальный код команды');
}

export async function loadWorkspace(teamCode) {
  await initUnitCalcWorkspaceTable();
  const db = getSql();
  const code = normalizeTeamCode(teamCode);
  if (!code) return null;

  const [row] = await db`
    SELECT team_code, name, payload, updated_at
    FROM unit_calc_workspaces
    WHERE team_code = ${code}
    LIMIT 1
  `;

  if (!row) return null;

  return {
    teamCode: row.team_code,
    name: row.name,
    payload: row.payload || {},
    updatedAt: row.updated_at,
  };
}

/** @deprecated Используйте loadWorkspace — без подмены кода команды. */
export async function loadWorkspaceOrDefault(teamCode) {
  return loadWorkspace(teamCode);
}

export async function saveWorkspace(teamCode, payload) {
  await initUnitCalcWorkspaceTable();
  const db = getSql();
  const code = normalizeTeamCode(teamCode);
  if (!code) throw new Error('Укажите код команды');

  const existing = await loadWorkspace(code);

  if (!existing) {
    await db`
      INSERT INTO unit_calc_workspaces (team_code, name, password_hash, payload)
      VALUES (${code}, ${'КОМАНДА'}, ${null}, ${db.json(payload)})
    `;
    return { teamCode: code, created: true };
  }

  const [row] = await db`
    UPDATE unit_calc_workspaces
    SET payload = ${db.json(payload)}, updated_at = NOW()
    WHERE team_code = ${code}
    RETURNING updated_at
  `;

  return { teamCode: code, updatedAt: row?.updated_at };
}
