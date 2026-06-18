import { parseWbAuthError } from '../../lib/wb-auth-error.js';
import { readWbRequestToken } from '../../lib/wb-request-token.js';
import {
  probeWbUnitCalcTokenScopes,
  WB_UNIT_CALC_TOKEN_SCOPES,
} from '../../lib/wb-token-scopes.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Используйте POST' });
  }

  const token = readWbRequestToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Укажите WB API токен в заголовке Authorization: Bearer …' });
  }

  try {
    const result = await probeWbUnitCalcTokenScopes(token);

    const tariffsScope = result.scopes.find((s) => s.scopeId === 'tariffs');
    const tariffsFunctional = tariffsScope?.functional;
    if (tariffsFunctional && !tariffsFunctional.ok) {
      const authError = parseWbAuthError(tariffsFunctional.status, tariffsFunctional.detail || '', {
        path: '/api/v1/tariffs/commission',
      });
      if (authError) {
        return res.status(401).json({
          error: authError.message,
          code: authError.code,
          kind: authError.kind,
          ...result,
          categories: WB_UNIT_CALC_TOKEN_SCOPES,
        });
      }
    }

    if (!result.allRequiredOk) {
      return res.status(403).json({
        error: result.summary,
        code: 'WB_TOKEN_SCOPE',
        kind: 'scope',
        ...result,
        categories: WB_UNIT_CALC_TOKEN_SCOPES,
      });
    }

    return res.status(200).json({
      action: 'validate',
      ok: true,
      ...result,
      categories: WB_UNIT_CALC_TOKEN_SCOPES,
    });
  } catch (error) {
    console.error('[unit-calc/validate-token]', error);
    return res.status(500).json({
      error: error.message || 'Не удалось проверить токен',
    });
  }
}
