import { APP_BUILD } from '../lib/app-build';
import { forceVersionRefresh } from '../lib/version-check';

export default function VersionBanner({ serverSha, alreadyTried }) {
  if (!serverSha || serverSha === APP_BUILD) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">Доступна новая версия ({serverSha})</p>
      <p className="mt-1 text-xs text-amber-900/80">
        У вас загружена сборка {APP_BUILD}. Обновите страницу, чтобы получить свежий интерфейс и промпт.
        {alreadyTried ? ' Если баннер не исчез — сделайте жёсткое обновление (Cmd+Shift+R / Ctrl+Shift+R).' : null}
      </p>
      <button
        type="button"
        className="btn-primary mt-2 text-xs"
        onClick={() => forceVersionRefresh(serverSha)}
      >
        Обновить сейчас
      </button>
    </div>
  );
}
