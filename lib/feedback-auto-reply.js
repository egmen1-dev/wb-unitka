/** Shared auto-reply validation (client + server). */

export const AUTO_REPLY_MAX_PER_HOUR = 10;
export const AUTO_REPLY_INTERVAL_MS = Math.ceil(3_600_000 / AUTO_REPLY_MAX_PER_HOUR);

export function isDraftSafeForAutoSend(payload) {
  if (!payload?.draft?.trim()) {
    return { ok: false, reason: 'Пустой черновик' };
  }
  if (payload.provider === 'template' || payload.source?.startsWith?.('template')) {
    return { ok: false, reason: 'Шаблон вместо AI' };
  }
  if (payload.validation && !payload.validation.ok) {
    return {
      ok: false,
      reason: payload.validation.errors?.join('; ') || 'Не прошла валидацию WB',
    };
  }
  if (payload.quality && !payload.quality.ok) {
    return {
      ok: false,
      reason: payload.quality.issues?.slice(0, 2).join('; ') || 'Низкое качество',
    };
  }
  if (payload.quality?.templateLike) {
    return { ok: false, reason: 'Шаблонные фразы' };
  }
  return { ok: true };
}
