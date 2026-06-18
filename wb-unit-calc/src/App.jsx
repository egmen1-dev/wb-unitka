import { useCallback, useEffect, useMemo, useRef, useState, startTransition, useDeferredValue } from 'react';
import { DEFAULT_UNIT_SETTINGS, mergeUnitSettings } from '@lib/unit-economics/settings.js';
import UpdateBanner from './components/UpdateBanner';
import AppShell from './components/AppShell';
import ApiKeyPanel from './components/ApiKeyPanel';
import ProductsTable from './components/ProductsTable';
import RowDetail from './components/RowDetail';
import SettingsPanel from './components/SettingsPanel';
import SummaryDashboard from './components/SummaryDashboard';
import LogisticsReconcilePanel from './components/LogisticsReconcilePanel';
import ActualPnlPanel from './components/ActualPnlPanel';
import RegionsPanel from './components/RegionsPanel';
import ReturnsPanel from './components/ReturnsPanel';
import FbsAssemblyPanel from './components/FbsAssemblyPanel';
import FeedbacksExternalLink from './components/FeedbacksExternalLink';
import TeamUrlBanner from './components/TeamUrlBanner';
import WbTokenBanner from './components/WbTokenBanner';
import SupplierPricePanel from './components/SupplierPricePanel';
import TeamPanel from './components/TeamPanel';
import TeamPermissionsPanel from './components/TeamPermissionsPanel';
import SyncProgressPanel, { createSyncSteps, patchSyncStep } from './components/SyncProgressPanel';
import {
  isTeamCreator as checkTeamCreator,
  markTeamOwner,
  ownerClientIdForPayload,
  getClientId,
} from './lib/team-access';
import {
  canAccessSection,
  firstAllowedSection,
  normalizeTeamAccess,
  resolveMyPermissions,
  touchTeamMember,
} from '@lib/team-permissions.js';
import { mergeWorkspaceProfiles, reconcileProfilesForPull } from '@lib/workspace-merge.js';
import {
  readSectionFromUrl,
  resolveInitialSection,
  saveStoredSection,
  writeSectionToUrl,
} from './lib/app-navigation';
import {
  buildWorkspacePayload,
  buildShareUrl,
  createWorkspace,
  ensureTeamInUrl,
  fetchWorkspace,
  getTeamFromUrl,
  isTeamInUrl,
  loadStoredTeam,
  removeTeamFromUrl,
  saveStoredTeam,
  saveWorkspaceRemote,
} from './lib/workspace-api';
import {
  applyCatalogToPurchases,
  countCatalogMatches,
  getActiveCatalog,
} from './lib/supplier-catalog';
import {
  loadActiveProfileId,
  loadProfiles,
  loadDeletedProfileIds,
  loadProductOverrides,
  loadPurchases,
  loadSettings,
  loadSupplierCatalogs,
  loadWbProductCache,
  loadWorkspaceCache,
  saveWorkspaceCache,
  clearWorkspaceCache,
  saveActiveProfileId,
  saveProfiles,
  saveDeletedProfileIds,
  addDeletedProfileId,
  pruneDeletedProfileIds,
  normalizeProfiles,
  saveProductOverrides,
  savePurchases,
  saveSettings,
  saveSupplierCatalogs,
  saveWbProductCache,
  purgeLegacyStorageKeys,
} from './lib/storage';
import { slimRowsForCache } from '@lib/unit-economics/row-cache.js';
import { buildEffectiveWbCache } from '@lib/wb-sync-cache.js';
import { createRecalcRows } from './lib/recalc-rows-cache';
import { setProductOverride } from './lib/product-overrides';
import { readJsonResponse } from './lib/http';
import { isAdvertRateLimitMessage } from '@lib/wb-advert-stats.js';
import { parseWbAuthErrorFromMessage } from '@lib/wb-auth-error.js';

function applyWbAuthError(err, { setError, setTokenInvalid }) {
  const authError = parseWbAuthErrorFromMessage(err?.message);
  const message = authError?.message || err?.message || 'Ошибка';
  if (authError) setTokenInvalid(true);
  setError(message);
  return authError;
}

function formatCloudSaveError(err) {
  const msg = String(err?.message || 'неизвестная ошибка');
  if (err?.needsTeam || /код команды|команда не найдена/i.test(msg)) {
    return 'Нет команды в облаке — создайте или войдите по коду';
  }
  if (/30 с|не ответило/i.test(msg)) {
    return 'Облако не ответило вовремя — данные на устройстве, повторим позже';
  }
  if (/связи с облаком|failed to fetch/i.test(msg)) {
    return 'Нет связи с облаком — данные на устройстве';
  }
  if (/недоступн|503|postgres/i.test(msg)) {
    return msg;
  }
  return `Не удалось сохранить: ${msg}`;
}

const CLOUD_SAVE_DEBOUNCE_MS = 3500;
const CLOUD_SAVE_RETRY_MS = 2000;
const CLOUD_SAVE_MAX_ATTEMPTS = 3;

function readBootCache() {
  const urlTeam = getTeamFromUrl();
  const storedTeam = loadStoredTeam() || '';
  const team = urlTeam || storedTeam;
  const teamWasMissingFromUrl = Boolean(team && !urlTeam);
  if (teamWasMissingFromUrl) {
    ensureTeamInUrl(team);
  }
  const cache = team ? loadWorkspaceCache(team) : null;
  return { team, cache, teamWasMissingFromUrl };
}

function profileHasLocalToken(profileId) {
  if (!profileId) return false;
  return loadProfiles().some(
    (profile) => profile.id === profileId && String(profile.token || '').trim()
  );
}

/** Участник без своего ключа не должен запускать авто-синхронизацию WB при открытии. */
function shouldPreferLocalTokens(teamCode, ownerClientId, bootUrlMissing) {
  return (
    Boolean(teamCode && !isTeamInUrl(teamCode)) ||
    bootUrlMissing ||
    (ownerClientId != null && ownerClientId !== getClientId())
  );
}

function saveWorkspaceSnapshot(teamCode, data) {
  if (!teamCode || !data?.payload) return;
  saveWorkspaceCache(teamCode, {
    payload: data.payload,
    updatedAt: data.updatedAt || '',
    teamName: data.name || '',
  });
}

async function syncFromWb({
  token,
  purchases,
  settings,
  mode = 'quick',
  phase = 'data',
  wbCache = null,
  catalogCursor = null,
  skipRealization = false,
}) {
  const authToken = String(token || '')
    .trim()
    .replace(/^Bearer\s+/i, '');
  if (!authToken) {
    throw new Error('Сначала добавьте WB API токен');
  }

  const controller = new AbortController();
  const timeoutMs = phase === 'catalog' ? 90_000 : 150_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/unit-calc/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        purchaseOverrides: purchases,
        settings,
        mode,
        phase,
        wbCache,
        catalogCursor,
        catalogMaxPages: 5,
        skipRealization,
      }),
      signal: controller.signal,
    });

    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      const err = new Error(data.error || `Ошибка ${response.status}`);
      err.code = data.code;
      throw err;
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        'Синхронизация WB заняла слишком долго. Данные из кэша сохранены — повторите «Быстро» через минуту.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const recalcRowsCached = createRecalcRows();

function mergeRowAdFields(prevRows, nextRows) {
  if (!prevRows?.length) return nextRows;
  const adByNm = new Map();
  const adByVendor = new Map();
  for (const row of prevRows) {
    const spend = Number(row.adSpend) || 0;
    const drr = Number(row.advertisingDrr) || 0;
    if (spend <= 0 && drr <= 0) continue;
    const pack = { adSpend: row.adSpend ?? null, advertisingDrr: row.advertisingDrr ?? null };
    if (row.nmId) adByNm.set(Number(row.nmId), pack);
    if (row.vendorCode) adByVendor.set(String(row.vendorCode), pack);
  }
  return nextRows.map((row) => {
    const spend = Number(row.adSpend) || 0;
    const drr = Number(row.advertisingDrr) || 0;
    if (spend > 0 || drr > 0) return row;
    const ad = (row.nmId && adByNm.get(Number(row.nmId))) || (row.vendorCode && adByVendor.get(String(row.vendorCode)));
    return ad ? { ...row, ...ad } : row;
  });
}

function bootProfiles(bootPayload) {
  const deletedIds = new Set(loadDeletedProfileIds());
  const teamProfiles = bootPayload?.profiles;
  const localProfiles = loadProfiles();
  let merged;
  if (teamProfiles?.length || localProfiles?.length) {
    merged = mergeWorkspaceProfiles(localProfiles, teamProfiles);
  } else {
    merged = [];
  }
  return normalizeProfiles(merged)
    .profiles.filter((profile) => !deletedIds.has(profile?.id));
}

function bootActiveProfileId(bootPayload, profiles) {
  const candidates = [bootPayload?.activeProfileId, loadActiveProfileId(), profiles[0]?.id].filter(
    Boolean
  );
  for (const id of candidates) {
    if (profiles.some((profile) => profile.id === id)) return id;
  }
  return '';
}

function applyWorkspacePayload(
  payload,
  setters,
  { keepRows = [], keepProfiles = [], deletedProfileIds = [], preferLocalTokens = false } = {}
) {
  if (!payload) return;
  if (payload.ownerClientId != null) setters.setOwnerClientId(payload.ownerClientId);

  const deletedIds = new Set(deletedProfileIds);
  const mergedProfiles = keepProfiles?.length
    ? reconcileProfilesForPull(keepProfiles, payload.profiles, { deletedIds, preferLocalTokens })
    : mergeWorkspaceProfiles([], payload.profiles).filter((profile) => !deletedIds.has(profile?.id));

  if (keepProfiles?.length || mergedProfiles.length) {
    setters.setProfiles(mergedProfiles);
    const activeId =
      [payload.activeProfileId, keepProfiles.find((p) => p.token)?.id, mergedProfiles[0]?.id].find(
        (id) => id && mergedProfiles.some((profile) => profile.id === id)
      ) || '';
    if (activeId) setters.setActiveProfileId(activeId);
    else if (!mergedProfiles.length) setters.setActiveProfileId('');
  } else if (Array.isArray(payload.profiles)) {
    setters.setProfiles(mergedProfiles);
    setters.setActiveProfileId('');
  }

  if (payload.purchases !== undefined) {
    setters.setPurchases({ ...payload.purchases });
  }
  if (payload.supplierCatalogs?.items?.length) {
    setters.setSupplierCatalogs(payload.supplierCatalogs);
  }
  if (payload.productOverrides !== undefined) {
    setters.setProductOverrides(payload.productOverrides);
  }

  if (payload.settings != null) {
    setters.setSettings(mergeUnitSettings(payload.settings));
  }
  if (payload.settingsUpdatedAt !== undefined) {
    setters.setSettingsUpdatedAt(payload.settingsUpdatedAt || '');
  }

  if (payload.teamAccess !== undefined) {
    setters.setTeamAccess(normalizeTeamAccess(payload.teamAccess));
  }

  const cloudRows = payload.cache?.rows;
  if (cloudRows?.length) {
    setters.setBaseRows(slimRowsForCache(cloudRows));
    setters.setSyncedAt(payload.cache.syncedAt || '');
    setters.setMeta(payload.cache.meta || {});
    if (payload.cache.wbProductCache?.products?.length) {
      setters.setWbProductCache(payload.cache.wbProductCache);
    } else {
      const bootstrapped = buildEffectiveWbCache(
        payload.cache.wbProductCache?.tariffCache || payload.cache.wbProductCache?.realizationSnapshot
          ? payload.cache.wbProductCache
          : null,
        cloudRows,
        payload.cache.syncedAt
      );
      setters.setWbProductCache(bootstrapped);
    }
  } else if (!keepRows?.length && payload.cache === null) {
    setters.setBaseRows([]);
    setters.setSyncedAt('');
    setters.setMeta({});
    setters.setWbProductCache(null);
  }
}

function SectionAccessDenied({ title, onBack }) {
  return (
    <section className="panel py-12 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-500">Создатель команды ограничил доступ к этому разделу.</p>
      <button type="button" className="btn-secondary mt-4" onClick={onBack}>
        К доступным разделам
      </button>
    </section>
  );
}

export default function App() {
  const [boot] = useState(() => readBootCache());
  const bootPayload = boot.cache?.payload;
  const bootHadRows = useRef(Boolean(bootPayload?.cache?.rows?.length));
  const suppressAutoSyncRef = useRef(
    Boolean(bootPayload?.cache?.rows?.length || bootPayload?.cache?.syncedAt)
  );

  const [team, setTeam] = useState(boot.team);
  const [teamName, setTeamName] = useState(boot.cache?.teamName || '');
  const [teamUrlMissing, setTeamUrlMissing] = useState(false);
  const bootTeamUrlMissing = useRef(boot.teamWasMissingFromUrl);
  const [ownerClientId, setOwnerClientId] = useState(bootPayload?.ownerClientId ?? null);
  const [workspaceUpdatedAt, setWorkspaceUpdatedAt] = useState(boot.cache?.updatedAt || '');
  const [cloudStatus, setCloudStatus] = useState('');
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudRefreshing, setCloudRefreshing] = useState(false);
  const [cloudPullError, setCloudPullError] = useState('');

  useEffect(() => {
    if (!cloudStatus) return undefined;
    const timer = setTimeout(() => setCloudStatus(''), 5000);
    return () => clearTimeout(timer);
  }, [cloudStatus]);

  const [profiles, setProfiles] = useState(() => bootProfiles(bootPayload));
  const [activeProfileId, setActiveProfileId] = useState(() => {
    const initialProfiles = bootProfiles(bootPayload);
    return bootActiveProfileId(bootPayload, initialProfiles);
  });
  const [purchases, setPurchases] = useState(() => {
    const team = bootPayload?.purchases;
    const local = loadPurchases();
    return team && Object.keys(team).length ? { ...local, ...team } : local;
  });
  const [supplierCatalogs, setSupplierCatalogs] = useState(() => {
    const team = bootPayload?.supplierCatalogs;
    const local = loadSupplierCatalogs();
    if (team?.items?.length) return team;
    return local?.items?.length ? local : team ?? local;
  });
  const [productOverrides, setProductOverrides] = useState(
    () => bootPayload?.productOverrides ?? loadProductOverrides()
  );
  const [settings, setSettings] = useState(() =>
    mergeUnitSettings(bootPayload?.settings ?? loadSettings() ?? {})
  );
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState(() => bootPayload?.settingsUpdatedAt || '');
  const [section, setSectionState] = useState(() => resolveInitialSection());
  const [teamAccess, setTeamAccess] = useState(() =>
    normalizeTeamAccess(bootPayload?.teamAccess ?? null)
  );

  const changeSectionRaw = useCallback((id) => {
    setSectionState(id);
    writeSectionToUrl(id, { teamCode: team });
    saveStoredSection(id);
  }, [team]);

  const [baseRows, setBaseRows] = useState(() => {
    const rows = bootPayload?.cache?.rows;
    return rows?.length ? slimRowsForCache(rows) : [];
  });
  const [syncedAt, setSyncedAt] = useState(() => bootPayload?.cache?.syncedAt || '');
  const [meta, setMeta] = useState(() => bootPayload?.cache?.meta || {});
  const [wbProductCache, setWbProductCache] = useState(() => {
    const bootWb = bootPayload?.cache?.wbProductCache;
    if (bootWb?.products?.length) return bootWb;
    const rows = bootPayload?.cache?.rows;
    const local = loadWbProductCache();
    const liteOrLocal =
      bootWb?.tariffCache || bootWb?.realizationSnapshot
        ? bootWb
        : local?.products?.length || local?.tariffCache
          ? local
          : null;
    if (liteOrLocal || rows?.length) {
      return buildEffectiveWbCache(liteOrLocal, rows, bootPayload?.cache?.syncedAt);
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [syncSteps, setSyncSteps] = useState(null);
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [syncPartialReady, setSyncPartialReady] = useState(false);
  const [syncHint, setSyncHint] = useState('');
  const [error, setError] = useState('');
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [marginFilter, setMarginFilter] = useState(null);
  const [brandFilter, setBrandFilter] = useState([]);
  const [highlightNmId, setHighlightNmId] = useState(null);
  const [dashboardQuery, setDashboardQuery] = useState('');
  const skipCloudSave = useRef(true);
  const cloudBootstrappedRef = useRef(false);
  const cloudSaveGenRef = useRef(0);
  const syncRunId = useRef(0);
  const persistTimer = useRef(null);
  const baseRowsRef = useRef(baseRows);
  baseRowsRef.current = baseRows;
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const deletedProfileIdsRef = useRef(loadDeletedProfileIds());

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId]
  );

  const activeCatalog = useMemo(() => getActiveCatalog(supplierCatalogs), [supplierCatalogs]);

  const vendorCodes = useMemo(
    () => baseRows.map((row) => String(row.vendorCode || '')).filter(Boolean),
    [baseRows]
  );

  const deferredBaseRows = useDeferredValue(baseRows);

  const rows = useMemo(
    () => recalcRowsCached(deferredBaseRows, purchases, settings, productOverrides),
    [deferredBaseRows, purchases, settings, productOverrides]
  );

  const isTeamCreator = useMemo(
    () => checkTeamCreator({ team, ownerClientId }),
    [team, ownerClientId]
  );

  const hasOwnWbToken = useMemo(() => {
    const token = String(activeProfile?.token || '').trim();
    if (!token) return false;
    if (!team || isTeamCreator) return true;
    return profileHasLocalToken(activeProfileId);
  }, [activeProfile?.token, activeProfileId, team, isTeamCreator]);

  const myPermissions = useMemo(
    () =>
      resolveMyPermissions({
        team,
        teamAccess,
        isTeamCreator,
        clientId: getClientId(),
      }),
    [team, teamAccess, isTeamCreator]
  );

  const canSyncWb = !team || myPermissions.data || myPermissions.calc;

  const changeSection = useCallback(
    (id) => {
      if (id === 'admin' && !isTeamCreator) return;
      if (id !== 'team' && id !== 'admin' && team && !canAccessSection(id, myPermissions)) return;
      changeSectionRaw(id);
    },
    [team, myPermissions, isTeamCreator, changeSectionRaw]
  );

  const handleTeamAccessChange = useCallback(
    (next) => {
      if (!isTeamCreator) return;
      setTeamAccess(normalizeTeamAccess(next));
    },
    [isTeamCreator]
  );

  useEffect(() => {
    if (!team || cloudSyncing) return;
    setTeamAccess((prev) => touchTeamMember(prev, getClientId()));
  }, [team, cloudSyncing]);

  useEffect(() => {
    if (cloudSyncing) return;
    if (section === 'admin' && !isTeamCreator) {
      changeSectionRaw(firstAllowedSection(myPermissions));
      return;
    }
    if (section !== 'team' && section !== 'admin' && team && !canAccessSection(section, myPermissions)) {
      changeSectionRaw(firstAllowedSection(myPermissions));
    }
  }, [cloudSyncing, section, team, myPermissions, isTeamCreator, changeSectionRaw]);

  useEffect(() => {
    if (!team) {
      setTeamUrlMissing(false);
      return;
    }
    if (!isTeamInUrl(team)) {
      ensureTeamInUrl(team);
    }
    setTeamUrlMissing(!isTeamInUrl(team));
  }, [team]);

  useEffect(() => {
    writeSectionToUrl(section, { teamCode: team });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setSectionState(readSectionFromUrl() || resolveInitialSection());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const pushToCloud = useCallback(async (overrides = {}) => {
    const { notify = 'none', ...payloadOverrides } = overrides;
    if (!team || skipCloudSave.current) return;

    const accessForCloud = isTeamCreator
      ? teamAccess
      : touchTeamMember(teamAccess, getClientId());

    if (!isTeamCreator && accessForCloud !== teamAccess) {
      setTeamAccess(accessForCloud);
    }

    const profilesForCloud = payloadOverrides.profiles ?? profiles;
    const activeForCloud = payloadOverrides.activeProfileId ?? activeProfileId;

    const payload = buildWorkspacePayload({
      profiles: profilesForCloud,
      activeProfileId: activeForCloud,
      purchases,
      settings,
      settingsUpdatedAt,
      supplierCatalogs,
      productOverrides,
      baseRows,
      meta,
      syncedAt,
      wbProductCache,
      ownerClientId: ownerClientIdForPayload(ownerClientId),
      teamAccess: accessForCloud,
    });

    setCloudSyncing(true);
    try {
      await saveWorkspaceRemote(team, payload);
      const updatedAt = new Date().toISOString();
      setWorkspaceUpdatedAt(updatedAt);
      saveWorkspaceSnapshot(team, { payload, updatedAt, name: teamName });
      if (notify !== 'none') {
        setCloudStatus('Сохранено в облако');
      }
    } catch (err) {
      if (notify === 'all') {
        setCloudStatus(formatCloudSaveError(err));
      }
      throw err;
    } finally {
      setCloudSyncing(false);
    }
  }, [
    team,
    teamName,
    isTeamCreator,
    teamAccess,
    ownerClientId,
    profiles,
    activeProfileId,
    purchases,
    settings,
    settingsUpdatedAt,
    supplierCatalogs,
    productOverrides,
    baseRows,
    meta,
    syncedAt,
    wbProductCache,
  ]);

  const refreshTeamWorkspace = useCallback(async (teamCode, { ifUnchangedSince = '' } = {}) => {
    const data = await fetchWorkspace(teamCode);
    const unchanged = Boolean(ifUnchangedSince && data.updatedAt === ifUnchangedSince);
    if (!unchanged) {
      const hadLocalRows = baseRowsRef.current.length > 0;
      const cloudEmpty = !data.payload?.cache?.rows?.length;
      const preferLocalTokens = shouldPreferLocalTokens(
        teamCode,
        data.payload?.ownerClientId,
        bootTeamUrlMissing.current
      );
      applyWorkspacePayload(
        data.payload,
        {
          setOwnerClientId,
          setTeamAccess,
          setProfiles,
          setActiveProfileId,
          setPurchases,
          setSettings,
          setSettingsUpdatedAt,
          setSupplierCatalogs,
          setProductOverrides,
          setBaseRows,
          setSyncedAt,
          setMeta,
          setWbProductCache,
        },
        {
          keepRows: baseRowsRef.current,
          keepProfiles: profilesRef.current,
          deletedProfileIds: deletedProfileIdsRef.current,
          preferLocalTokens,
        }
      );
      if (preferLocalTokens) bootTeamUrlMissing.current = false;
      if (hadLocalRows && cloudEmpty) {
        setCloudStatus('В облаке нет таблицы — нажмите «Быстро», чтобы загрузить данные с WB.');
      }
      setWorkspaceUpdatedAt(data.updatedAt || '');
      saveWorkspaceSnapshot(teamCode, data);
      if (data.payload?.cache?.syncedAt || data.payload?.cache?.rows?.length) {
        suppressAutoSyncRef.current = true;
      }
      if (
        data.payload?.ownerClientId &&
        data.payload.ownerClientId !== getClientId() &&
        data.payload?.cache?.rows?.length
      ) {
        suppressAutoSyncRef.current = true;
      }
    }
    return data;
  }, []);

  const loadTeamWorkspace = useCallback(async (teamCode) => {
    const normalized = String(teamCode || '').trim().toUpperCase();
    const data = await refreshTeamWorkspace(normalized, {
      ifUnchangedSince: workspaceUpdatedAt || boot.cache?.updatedAt || '',
    });
    if (data.teamCode !== normalized) {
      throw new Error(`Ожидалась команда ${normalized}, получена ${data.teamCode}`);
    }
    setTeam(data.teamCode);
    setTeamName(data.name || '');
    setWorkspaceUpdatedAt(data.updatedAt || '');
    saveStoredTeam(data.teamCode);
    const ownerId = data.payload?.ownerClientId;
    if (ownerId && ownerId === getClientId()) {
      markTeamOwner(data.teamCode, ownerId);
    }
    ensureTeamInUrl(data.teamCode);
    setTeamUrlMissing(false);
    cloudBootstrappedRef.current = true;
    skipCloudSave.current = false;
    setCloudStatus(`Команда «${data.name || data.teamCode}»`);
  }, [refreshTeamWorkspace, workspaceUpdatedAt]);

  const retryCloudPull = useCallback(() => {
    const candidate = team || getTeamFromUrl() || loadStoredTeam();
    if (!candidate) return;
    setCloudPullError('');
    setCloudRefreshing(true);
    loadTeamWorkspace(candidate)
      .catch((err) => {
        if (!err.needsTeam) {
          setCloudPullError(err.message || 'Не удалось загрузить облако');
        }
      })
      .finally(() => setCloudRefreshing(false));
  }, [team, loadTeamWorkspace]);

  useEffect(() => {
    if (!team || cloudSyncing || loading || enriching) return undefined;

    async function pullRemote() {
      if (skipCloudSave.current) return;
      try {
        const data = await fetchWorkspace(team);
        if (!data.updatedAt || data.updatedAt === workspaceUpdatedAt) return;
        const hadLocalRows = baseRowsRef.current.length > 0;
        const cloudEmpty = !data.payload?.cache?.rows?.length;
        const preferLocalTokens = shouldPreferLocalTokens(
          team,
          data.payload?.ownerClientId,
          bootTeamUrlMissing.current
        );
        applyWorkspacePayload(
          data.payload,
          {
            setOwnerClientId,
            setTeamAccess,
            setProfiles,
            setActiveProfileId,
            setPurchases,
            setSettings,
            setSettingsUpdatedAt,
            setSupplierCatalogs,
            setProductOverrides,
            setBaseRows,
            setSyncedAt,
            setMeta,
            setWbProductCache,
          },
          {
            keepRows: baseRowsRef.current,
            keepProfiles: profilesRef.current,
            deletedProfileIds: deletedProfileIdsRef.current,
            preferLocalTokens,
          }
        );
        if (preferLocalTokens) bootTeamUrlMissing.current = false;
        if (hadLocalRows && cloudEmpty) {
          setCloudStatus('В облаке нет таблицы — нажмите «Быстро», чтобы загрузить данные с WB.');
        }
        setWorkspaceUpdatedAt(data.updatedAt);
        saveWorkspaceSnapshot(team, data);
      } catch {
        // ignore background refresh errors
      }
    }

    const onFocus = () => pullRemote();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(pullRemote, 60000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [team, cloudSyncing, loading, enriching, workspaceUpdatedAt]);

  useEffect(() => {
    purgeLegacyStorageKeys();
    const { profiles: normalized, changed } = normalizeProfiles(profiles);
    if (changed && normalized.length) {
      setProfiles(normalized);
      saveProfiles(normalized);
      return;
    }
    if (profiles.length) return;
    const localProfiles = loadProfiles();
    if (!localProfiles.length) return;
    const restored = normalizeProfiles(localProfiles).profiles;
    setProfiles(restored);
    setActiveProfileId(bootActiveProfileId({}, restored));
    setCloudStatus('API-ключ восстановлен из локального хранилища браузера');
  }, []);

  useEffect(() => {
    async function syncCloud() {
      const candidate = getTeamFromUrl() || loadStoredTeam();
      if (!candidate) {
        cloudBootstrappedRef.current = true;
        skipCloudSave.current = false;
        return;
      }

      setTeam(candidate);
      ensureTeamInUrl(candidate);

      const hasCachedRows = Boolean(bootPayload?.cache?.rows?.length);
      skipCloudSave.current = true;
      if (hasCachedRows || bootPayload?.cache?.syncedAt) {
        suppressAutoSyncRef.current = true;
      }

      const runCloudPull = () => {
        setCloudRefreshing(true);
        setCloudPullError('');
        loadTeamWorkspace(candidate)
          .catch((err) => {
            if (!err.needsTeam) {
              setCloudPullError(err.message || 'Не удалось загрузить облако');
              if (!hasCachedRows) {
                setCloudStatus('Не удалось загрузить облако — показаны локальные данные');
              }
            }
          })
          .finally(() => {
            setCloudRefreshing(false);
            cloudBootstrappedRef.current = true;
            skipCloudSave.current = false;
          });
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(runCloudPull, { timeout: hasCachedRows ? 4000 : 100 });
      } else {
        setTimeout(runCloudPull, hasCachedRows ? 300 : 0);
      }
    }
    syncCloud();
  }, []);

  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      saveProfiles(profiles);
      saveActiveProfileId(activeProfileId);
      savePurchases(purchases);
      saveSettings(settings);
      saveSupplierCatalogs(supplierCatalogs);
      saveProductOverrides(productOverrides);
    }, 1200);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [
    profiles,
    activeProfileId,
    purchases,
    settings,
    supplierCatalogs,
    productOverrides,
  ]);

  useEffect(() => {
    if (loading || enriching || !wbProductCache?.products?.length) return undefined;
    const timer = setTimeout(() => saveWbProductCache(wbProductCache), 2500);
    return () => clearTimeout(timer);
  }, [loading, enriching, wbProductCache]);

  useEffect(() => {
    if (!team || loading || enriching || cloudSyncing || cloudRefreshing) return undefined;
    if (!cloudBootstrappedRef.current || skipCloudSave.current) return undefined;

    const generation = ++cloudSaveGenRef.current;
    const timer = setTimeout(async () => {
      if (generation !== cloudSaveGenRef.current) return;

      for (let attempt = 0; attempt < CLOUD_SAVE_MAX_ATTEMPTS; attempt += 1) {
        if (generation !== cloudSaveGenRef.current) return;
        try {
          await pushToCloud({ notify: 'success' });
          return;
        } catch {
          if (attempt < CLOUD_SAVE_MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, CLOUD_SAVE_RETRY_MS * (attempt + 1)));
          }
        }
      }
    }, CLOUD_SAVE_DEBOUNCE_MS);

    return () => {
      cloudSaveGenRef.current += 1;
      clearTimeout(timer);
    };
  }, [
    team,
    loading,
    enriching,
    cloudSyncing,
    cloudRefreshing,
    pushToCloud,
  ]);

  const applySyncResult = useCallback(
    (data, { urgent = false } = {}) => {
      const commit = () => {
      setBaseRows((prev) => mergeRowAdFields(prev, slimRowsForCache(data.rows)));
      setSyncedAt(data.syncedAt);
      if (data.productCache?.length || data.tariffCache || data.realizationSnapshot) {
        setWbProductCache((prev) => ({
          products: data.productCache?.length ? data.productCache : prev?.products || [],
          fullCatalogAt: data.fullCatalogAt || prev?.fullCatalogAt || data.syncedAt,
          cardsSyncedAt: data.cardsSyncedAt || prev?.cardsSyncedAt || data.syncedAt,
          tariffCache: data.tariffCache || prev?.tariffCache || null,
          realizationSnapshot: data.realizationSnapshot || prev?.realizationSnapshot || null,
        }));
      }
      if (activeCatalog?.byDigitKey) {
        const vendors = data.rows.map((row) => String(row.vendorCode || '')).filter(Boolean);
        const { purchases: nextPurchases, matched } = applyCatalogToPurchases(
          vendors,
          activeCatalog.byDigitKey,
          purchases
        );
        setPurchases(nextPurchases);
        setCloudStatus(
          `WB: ${data.total} товаров · прайс «${activeCatalog.fileName}» совпало ${matched}`
        );
      } else {
        const modeLabel =
          data.syncMode === 'full' ? 'полная' : data.syncMode === 'bootstrap' ? 'первая' : 'быстрая';
        const delta =
          data.cardsDeltaCount > 0 ? ` · карточек ±${data.cardsDeltaCount}` : '';
        setCloudStatus(`${modeLabel} синхронизация · ${data.total} товаров${delta}`);
      }
      setMeta((prev) => {
        const advertPatch = data.advertSynced
          ? {
              globalAdvertisingDrr: data.globalAdvertisingDrr ?? null,
              totalAdSpend: data.totalAdSpend ?? 0,
              advertPeriod: data.advertPeriod ?? null,
              advertError: data.advertError ?? null,
              advertByNmId: data.advertByNmId ?? null,
              advertByVendor: data.advertByVendor ?? null,
              advertCampaigns: data.advertCampaigns ?? 0,
              advertCampaignsTotal: data.advertCampaignsTotal ?? data.advertCampaigns ?? 0,
              advertCampaignsFetched: data.advertCampaignsFetched ?? data.advertCampaigns ?? 0,
            }
          : {
              globalAdvertisingDrr: data.globalAdvertisingDrr ?? prev.globalAdvertisingDrr,
              totalAdSpend: data.totalAdSpend ?? prev.totalAdSpend,
              advertPeriod: data.advertPeriod ?? prev.advertPeriod,
              advertError: data.advertError ?? prev.advertError,
              advertByNmId: data.advertByNmId ?? prev.advertByNmId,
              advertByVendor: data.advertByVendor ?? prev.advertByVendor,
              advertCampaigns: data.advertCampaigns ?? prev.advertCampaigns,
              advertCampaignsTotal: data.advertCampaignsTotal ?? prev.advertCampaignsTotal,
              advertCampaignsFetched: data.advertCampaignsFetched ?? prev.advertCampaignsFetched,
            };

        return {
          ...prev,
          ...advertPatch,
          globalAcquiringRate: data.globalAcquiringRate ?? prev.globalAcquiringRate,
          realizationPeriod: data.realizationPeriod ?? prev.realizationPeriod,
        realizationError: data.realizationError ?? prev.realizationError,
        realizationFinanceWarning: data.realizationFinanceWarning ?? prev.realizationFinanceWarning,
        realizationVendorSales: data.realizationVendorSales ?? prev.realizationVendorSales,
        realizationSource: data.realizationSource ?? prev.realizationSource,
        realizationRowCount: data.realizationRowCount ?? prev.realizationRowCount,
        realizationSkuWithSales: data.realizationSkuWithSales ?? prev.realizationSkuWithSales,
        realizationTotalSales: data.realizationTotalSales ?? prev.realizationTotalSales,
        realizationCatalogNmWithSales:
          data.realizationCatalogNmWithSales ?? prev.realizationCatalogNmWithSales,
        realizationCatalogVendorWithSales:
          data.realizationCatalogVendorWithSales ?? prev.realizationCatalogVendorWithSales,
        realizationCatalogNmInReport:
          data.realizationCatalogNmInReport ?? prev.realizationCatalogNmInReport,
        realizationCatalogVendorInReport:
          data.realizationCatalogVendorInReport ?? prev.realizationCatalogVendorInReport,
        realizationCatalogMismatch: data.realizationCatalogMismatch ?? prev.realizationCatalogMismatch,
        catalogPricesOverlapPct: data.catalogPricesOverlapPct ?? prev.catalogPricesOverlapPct,
        realizationLoaded: data.realizationLoaded ?? prev.realizationLoaded ?? data.syncMode !== 'bootstrap',
        sellerAvgDeliveryHours: data.sellerAvgDeliveryHours ?? prev.sellerAvgDeliveryHours,
        deliveryPeriod: data.deliveryPeriod ?? prev.deliveryPeriod,
        deliveryError: data.deliveryError ?? prev.deliveryError,
        ordersPeriod: data.ordersPeriod ?? prev.ordersPeriod,
        ordersTotal: data.ordersTotal ?? prev.ordersTotal,
        ordersWithData: data.ordersWithData ?? prev.ordersWithData,
        ordersError: data.ordersError ?? prev.ordersError,
        tariffsWarehouseCount: data.tariffsWarehouseCount ?? prev.tariffsWarehouseCount,
        tariffsDefaultWarehouse: data.tariffsDefaultWarehouse ?? prev.tariffsDefaultWarehouse,
        matrixCargoType: data.matrixCargoType ?? prev.matrixCargoType,
        tariffSource: data.tariffSource ?? prev.tariffSource,
        fbsShipmentWarehouse: data.fbsShipmentWarehouse ?? prev.fbsShipmentWarehouse,
        fbsShipmentSource: data.fbsShipmentSource ?? prev.fbsShipmentSource,
        fbsShipmentOrders: data.fbsShipmentOrders ?? prev.fbsShipmentOrders,
        fbsShipmentTotal: data.fbsShipmentTotal ?? prev.fbsShipmentTotal,
        fbsShipmentError: data.fbsShipmentError ?? prev.fbsShipmentError,
        regionSalesPeriod: data.regionSalesSynced
          ? data.regionSalesPeriod ?? prev.regionSalesPeriod
          : prev.regionSalesPeriod,
        regionSalesError: data.regionSalesSynced
          ? data.regionSalesError ?? prev.regionSalesError
          : prev.regionSalesError,
        regionSalesSource: data.regionSalesSynced
          ? data.regionSalesSource ?? prev.regionSalesSource
          : prev.regionSalesSource,
        regionSalesRawRows: data.regionSalesSynced
          ? data.regionSalesRawRows ?? prev.regionSalesRawRows
          : prev.regionSalesRawRows,
        regionSalesSnapshot: data.regionSalesSynced
          ? data.regionSalesSnapshot ?? prev.regionSalesSnapshot
          : prev.regionSalesSnapshot,
        regionSalesTotalQty: data.regionSalesSynced
          ? data.regionSalesTotalQty ?? prev.regionSalesTotalQty
          : prev.regionSalesTotalQty,
        regionSalesSnapshotHash: data.regionSalesSynced
          ? data.regionSalesSnapshotHash ?? prev.regionSalesSnapshotHash
          : prev.regionSalesSnapshotHash,
        supplierMeta: data.supplierMeta ?? prev.supplierMeta,
        syncMode: data.syncMode ?? prev.syncMode,
        fullCatalogAt: data.fullCatalogAt ?? prev.fullCatalogAt,
        cardsDeltaCount: data.cardsDeltaCount ?? prev.cardsDeltaCount,
        localizationIndex: data.localizationIndex ?? prev.localizationIndex,
        salesDistributionIndex: data.salesDistributionIndex ?? prev.salesDistributionIndex,
        localizationIndexSource: data.localizationIndexSource ?? prev.localizationIndexSource,
        salesDistributionIndexSource:
          data.salesDistributionIndexSource ?? prev.salesDistributionIndexSource,
        logisticsIndicesComputedAt: data.logisticsIndicesComputedAt ?? prev.logisticsIndicesComputedAt,
        logisticsIndicesPeriodDays: data.logisticsIndicesPeriodDays ?? prev.logisticsIndicesPeriodDays,
        logisticsIndicesOrderCount: data.logisticsIndicesOrderCount ?? prev.logisticsIndicesOrderCount,
        logisticsIndicesSkuCount: data.logisticsIndicesSkuCount ?? prev.logisticsIndicesSkuCount,
        logisticsIndicesError: data.logisticsIndicesError ?? prev.logisticsIndicesError,
        avgLocalizationSharePct: data.avgLocalizationSharePct ?? prev.avgLocalizationSharePct,
        localizationByNmId: data.localizationByNmId ?? prev.localizationByNmId,
        };
      });
      if (data.localizationIndex != null) {
        setSettings((prev) => {
          if (prev.autoSyncLogisticsIndices === false) return prev;
          return mergeUnitSettings({
            ...prev,
            localizationIndex: data.localizationIndex,
            salesDistributionIndex: data.salesDistributionIndex ?? 0,
          });
        });
      }
      if (!activeCatalog?.byDigitKey && data.supplierPurchases && Object.keys(data.supplierPurchases).length > 0) {
        setPurchases((prev) => {
          const next = { ...prev };
          for (const [vendor, price] of Object.entries(data.supplierPurchases)) {
            if (next[vendor] == null || next[vendor] === '') {
              next[vendor] = price;
            }
          }
          return next;
        });
        setCloudStatus(`Закупки из прайса: ${Object.keys(data.supplierPurchases).length} из ${data.total}`);
      }
      };
      if (urgent) commit();
      else startTransition(commit);
    },
    [activeCatalog, purchases]
  );

  const runSync = useCallback(
    async (mode) => {
      if (!activeProfile?.token) {
        setError('Сначала добавьте WB API токен');
        return;
      }

      const runId = syncRunId.current + 1;
      syncRunId.current = runId;
      const isStale = () => syncRunId.current !== runId;

      setLoading(true);
      setEnriching(false);
      setError('');
      setTokenInvalid(false);
      setSyncPartialReady(false);
      setSyncStartedAt(Date.now());
      let steps = createSyncSteps();
      setSyncSteps(steps);

      let lastSyncUiAt = 0;
      let pendingHint = '';
      let pendingStep = null;
      const flushSyncUi = (force = false) => {
        const now = Date.now();
        if (!force && now - lastSyncUiAt < 400) return;
        lastSyncUiAt = now;
        if (pendingHint) {
          setSyncHint(pendingHint);
          pendingHint = '';
        }
        if (pendingStep) {
          const { id, patch } = pendingStep;
          steps = patchSyncStep(steps, id, patch);
          setSyncSteps([...steps]);
          pendingStep = null;
        }
      };

      const setStep = (id, patch, { force = false } = {}) => {
        if (isStale()) return;
        pendingStep = { id, patch };
        flushSyncUi(force);
      };

      const setHint = (hint, { force = false } = {}) => {
        if (isStale()) return;
        pendingHint = hint;
        flushSyncUi(force);
      };

      let cache = buildEffectiveWbCache(wbProductCache, baseRows, syncedAt);
      const needsCatalog = mode === 'full' || !cache?.products?.length;
      const needsBootstrap = needsCatalog || !baseRows.length;
      let partialReady = false;

      try {
        if (needsCatalog) {
          setStep('catalog', { status: 'running', detail: 'Запрос карточек…' }, { force: true });
          let cursor = null;
          do {
            if (isStale()) return;
            setHint(
              cursor
                ? `Каталог WB… ${cache?.products?.length || 0} товаров`
                : 'Каталог WB, страница 1…'
            );
            const chunk = await syncFromWb({
              token: activeProfile.token,
              purchases,
              settings,
              mode: 'full',
              phase: 'catalog',
              wbCache: cache,
              catalogCursor: cursor,
            });
            if (isStale()) return;
            cache = {
              products: chunk.productCache,
              fullCatalogAt: chunk.fullCatalogAt || chunk.syncedAt,
              cardsSyncedAt: chunk.cardsSyncedAt || chunk.syncedAt,
              tariffCache: cache?.tariffCache || null,
            };
            cursor = chunk.catalogNextCursor;
            setStep('catalog', {
              status: 'running',
              detail: `${chunk.catalogLoaded || cache.products?.length || 0} карточек${
                cursor ? ' — ещё страницы…' : ''
              }`,
            });
          } while (cursor);
          flushSyncUi(true);
          setStep('catalog', {
            status: 'done',
            detail: `${cache.products?.length || 0} карточек`,
          }, { force: true });
        } else {
          setStep('catalog', { status: 'done', detail: 'Из кэша' }, { force: true });
        }

        if (needsBootstrap) {
          setStep('bootstrap', { status: 'running', detail: 'Цены и тарифы WB…' }, { force: true });
          setHint('Цены и тарифы…', { force: true });
          const bootstrap = await syncFromWb({
            token: activeProfile.token,
            purchases,
            settings,
            mode: 'bootstrap',
            phase: 'data',
            wbCache: cache,
          });
          if (isStale()) return;
          cache = {
            products: bootstrap.productCache,
            fullCatalogAt: bootstrap.fullCatalogAt || bootstrap.syncedAt,
            cardsSyncedAt: bootstrap.cardsSyncedAt || bootstrap.syncedAt,
            tariffCache: bootstrap.tariffCache || cache?.tariffCache || null,
          };
          applySyncResult(bootstrap, { urgent: true });
          partialReady = true;
          setSyncPartialReady(true);
          setStep('bootstrap', {
            status: 'done',
            detail: `${bootstrap.total || bootstrap.rows?.length || 0} товаров в таблице`,
          }, { force: true });
          setLoading(false);
          setHint('', { force: true });
        } else {
          setStep('bootstrap', { status: 'done', detail: 'Уже загружено' }, { force: true });
        }

        setEnriching(true);
        setStep('realization', { status: 'running', detail: 'Еженедельный отчёт WB…' }, { force: true });
        setHint('Отчёт реализации…', { force: true });
        const realizationData = await syncFromWb({
          token: activeProfile.token,
          purchases,
          settings,
          mode: needsCatalog ? 'full' : 'quick',
          phase: 'realization',
          wbCache: cache,
        });
        if (isStale()) return;
        cache = {
          products: realizationData.productCache?.length ? realizationData.productCache : cache.products,
          fullCatalogAt: realizationData.fullCatalogAt || cache.fullCatalogAt,
          cardsSyncedAt: realizationData.cardsSyncedAt || cache.cardsSyncedAt,
          tariffCache: realizationData.tariffCache || cache.tariffCache || null,
          realizationSnapshot: realizationData.realizationSnapshot || cache.realizationSnapshot || null,
        };
        applySyncResult(realizationData);
        partialReady = true;
        setSyncPartialReady(true);
        setLoading(false);
        const realizationDetail = realizationData.realizationError
          ? realizationData.realizationTotalSales > 0
            ? `${realizationData.realizationTotalSales} продаж · Statistics`
            : 'ошибка доступа'
          : realizationData.realizationPeriod
            ? `${realizationData.realizationTotalSales || 0} продаж`
            : 'нет строк';
        setStep('realization', {
          status:
            realizationData.realizationError && !realizationData.realizationTotalSales
              ? 'error'
              : 'done',
          detail: realizationDetail,
        }, { force: true });
        setHint('', { force: true });

        setStep('enrich', { status: 'running', detail: 'Остатки, заказы, реклама…' }, { force: true });
        setHint('Остатки и реклама…', { force: true });
        const data = await syncFromWb({
          token: activeProfile.token,
          purchases,
          settings,
          mode: needsCatalog ? 'full' : 'quick',
          phase: 'data',
          wbCache: cache,
          skipRealization: true,
        });
        if (isStale()) return;
        applySyncResult(data);
        const enrichDetail = [
          data.realizationPeriod ? 'отчёт' : null,
          data.ordersWithData ? 'заказы' : null,
          data.regionSalesError
            ? 'регионы: ошибка'
            : data.regionSalesSynced && data.regionSalesTotalQty > 0
              ? `регионы ${Math.round(data.regionSalesTotalQty).toLocaleString('ru-RU')}`
              : data.regionSalesSynced
                ? 'регионы: 0'
                : null,
          data.advertError
            ? 'реклама: ошибка'
            : data.advertSynced && data.totalAdSpend > 0
              ? `реклама ${Math.round(data.totalAdSpend).toLocaleString('ru-RU')} ₽`
              : data.advertSynced && data.advertCampaignsTotal > 0
                ? `реклама: ${data.advertCampaignsTotal} камп.`
                : data.advertSynced
                  ? 'реклама: 0'
                  : null,
        ]
          .filter(Boolean)
          .join(', ');
        setStep('enrich', {
          status: 'done',
          detail: enrichDetail || `${data.total} товаров обновлено`,
        }, { force: true });
        setTokenInvalid(false);
        setError('');
      } catch (err) {
        if (isStale()) return;
        const failedStep = steps.find((s) => s.status === 'running')?.id || 'enrich';
        setStep(failedStep, {
          status: 'error',
          detail: err.message || 'Ошибка загрузки',
        }, { force: true });
        if (partialReady || baseRows.length > 0) {
          setCloudStatus(`Частичная загрузка: ${err.message}. Нажмите «Быстро» для повтора.`);
          applyWbAuthError(err, { setError, setTokenInvalid });
        } else {
          applyWbAuthError(err, { setError, setTokenInvalid });
        }
      } finally {
        flushSyncUi(true);
        if (syncRunId.current === runId) {
          setLoading(false);
          setEnriching(false);
          setHint('', { force: true });
        }
      }
    },
    [activeProfile, purchases, settings, wbProductCache, baseRows, syncedAt, applySyncResult]
  );

  const handleSync = useCallback(() => runSync('quick'), [runSync]);
  const handleFullSync = useCallback(() => runSync('full'), [runSync]);

  const handleProfileAdded = useCallback(() => {
    setTokenInvalid(false);
    setError('');
    changeSection('data');
    runSync('quick');
  }, [runSync]);

  const handleProfileRemove = useCallback(
    async (id) => {
      const target = profiles.find((p) => p.id === id);
      if (!target) return;
      if (profiles.length <= 1) {
        setCloudStatus('Нельзя удалить единственный ключ — замените токен через «Заменить токен»');
        return;
      }
      if (!window.confirm(`Удалить ключ «${target.name}»?`)) return;

      deletedProfileIdsRef.current = addDeletedProfileId(id);

      const nextProfiles = profiles.filter((p) => p.id !== id);
      const nextActive = activeProfileId === id ? nextProfiles[0]?.id || '' : activeProfileId;

      profilesRef.current = nextProfiles;
      setProfiles(nextProfiles);
      if (nextActive !== activeProfileId) setActiveProfileId(nextActive);

      saveProfiles(nextProfiles);
      saveActiveProfileId(nextActive);
      setCloudStatus('Профиль удалён');

      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }

      if (team) {
        const snapshotPayload = buildWorkspacePayload({
          profiles: nextProfiles,
          activeProfileId: nextActive,
          purchases,
          settings,
          settingsUpdatedAt,
          supplierCatalogs,
          productOverrides,
          baseRows,
          meta,
          syncedAt,
          wbProductCache,
          ownerClientId: ownerClientIdForPayload(ownerClientId),
          teamAccess,
        });
        saveWorkspaceSnapshot(team, {
          payload: snapshotPayload,
          updatedAt: new Date().toISOString(),
          name: teamName,
        });
      }

      if (team && !skipCloudSave.current) {
        try {
          await pushToCloud({
            profiles: nextProfiles,
            activeProfileId: nextActive,
            notify: 'none',
          });
          deletedProfileIdsRef.current = pruneDeletedProfileIds(
            deletedProfileIdsRef.current,
            nextProfiles.map((p) => p.id)
          );
        } catch (err) {
          setCloudStatus(`Профиль удалён локально; ${formatCloudSaveError(err)}`);
        }
      }
    },
    [
      profiles,
      activeProfileId,
      team,
      teamName,
      pushToCloud,
      purchases,
      settings,
      settingsUpdatedAt,
      supplierCatalogs,
      productOverrides,
      baseRows,
      meta,
      syncedAt,
      wbProductCache,
      ownerClientId,
      teamAccess,
    ]
  );

  useEffect(() => {
    if (cloudSyncing || suppressAutoSyncRef.current || loading || enriching || !hasOwnWbToken) {
      return;
    }
    if (!baseRows.length) return;
    if (syncedAt) {
      suppressAutoSyncRef.current = true;
      return;
    }
    if (bootHadRows.current) return;

    const reportSalesCount = baseRows.filter((row) => Number(row.reportSales) > 0).length;
    const needsReport =
      meta?.syncMode === 'bootstrap' ||
      meta?.realizationLoaded === false ||
      meta?.realizationCatalogMismatch === true ||
      (meta?.catalogPricesOverlapPct != null && meta.catalogPricesOverlapPct < 0.85) ||
      (meta?.realizationLoaded == null &&
        !meta?.realizationPeriod &&
        !meta?.realizationError &&
        reportSalesCount === 0);

    if (!needsReport) return;

    suppressAutoSyncRef.current = true;
    runSync(
      meta?.realizationCatalogMismatch || (meta?.catalogPricesOverlapPct != null && meta.catalogPricesOverlapPct < 0.85)
        ? 'full'
        : 'quick'
    );
  }, [cloudSyncing, loading, enriching, hasOwnWbToken, baseRows, meta, runSync]);

  const syncActive = loading || enriching;
  const showSyncProgress = Boolean(syncSteps?.length && (syncActive || syncSteps.some((s) => s.status === 'error')));

  useEffect(() => {
    if (!syncSteps?.length) return undefined;
    const allDone = syncSteps.every((step) => step.status === 'done');
    if (!allDone) return undefined;
    const timer = setTimeout(() => setSyncSteps(null), 8000);
    return () => clearTimeout(timer);
  }, [syncSteps]);

  function clearTeamSession() {
    const previousTeam = team;
    skipCloudSave.current = true;
    setTeam('');
    setTeamName('');
    setOwnerClientId(null);
    setTeamAccess(normalizeTeamAccess(null));
    setWorkspaceUpdatedAt('');
    setTeamUrlMissing(false);
    saveStoredTeam('');
    clearWorkspaceCache(previousTeam);
    removeTeamFromUrl();
  }

  function handleRestoreTeamUrl() {
    if (!team) return;
    ensureTeamInUrl(team);
    writeSectionToUrl(section, { teamCode: team });
    setTeamUrlMissing(!isTeamInUrl(team));
    if (isTeamInUrl(team)) {
      setCloudStatus(`Ссылка восстановлена · код ${team}`);
    }
  }

  async function handleCreateTeam({ name, fresh = false }) {
    clearTeamSession();

    const newOwnerId = ownerClientIdForPayload(null);
    setOwnerClientId(newOwnerId);

    const initialAccess = touchTeamMember(normalizeTeamAccess(null), newOwnerId);
    setTeamAccess(initialAccess);

    const payload = fresh
      ? {
          ownerClientId: newOwnerId,
          teamAccess: initialAccess,
          profiles: [],
          activeProfileId: '',
          purchases: {},
          settings: mergeUnitSettings({}),
          settingsUpdatedAt: new Date().toISOString(),
          supplierCatalogs: {},
          productOverrides: {},
          cache: null,
        }
      : buildWorkspacePayload({
          profiles,
          activeProfileId,
          purchases,
          settings,
          settingsUpdatedAt: settingsUpdatedAt || new Date().toISOString(),
          supplierCatalogs,
          productOverrides,
          baseRows,
          meta,
          syncedAt,
          wbProductCache,
          ownerClientId: newOwnerId,
          teamAccess: initialAccess,
        });

    const created = await createWorkspace({ name, payload });
    if (!created?.teamCode) {
      skipCloudSave.current = false;
      throw new Error('Сервер не вернул код команды');
    }

    setTeam(created.teamCode);
    setTeamName(created.name || name || 'КОМАНДА');
    saveStoredTeam(created.teamCode);
    markTeamOwner(created.teamCode, newOwnerId);
    ensureTeamInUrl(created.teamCode);
    setTeamUrlMissing(false);
    cloudBootstrappedRef.current = true;
    skipCloudSave.current = false;
    setCloudStatus(`Новая команда «${created.name || name}» · код ${created.teamCode}`);

    if (fresh) {
      setProfiles([]);
      setActiveProfileId('');
      setPurchases({});
      setProductOverrides({});
      setSupplierCatalogs({});
      setBaseRows([]);
      setSyncedAt('');
      setMeta({});
      setWbProductCache(null);
    } else {
      applyWorkspacePayload(payload, {
        setOwnerClientId,
        setTeamAccess,
        setProfiles,
        setActiveProfileId,
        setPurchases,
        setSettings,
        setSettingsUpdatedAt,
        setSupplierCatalogs,
        setProductOverrides,
        setBaseRows,
        setSyncedAt,
        setMeta,
        setWbProductCache,
      });
    }

    return created;
  }

  async function handleJoinTeam(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) throw new Error('Введите код команды');
    await loadTeamWorkspace(normalized);
  }

  function handleTeamExit() {
    clearTeamSession();
    setCloudStatus('Вы вышли из команды');
  }

  function handleStartNewTeam() {
    clearTeamSession();
    setCloudStatus('');
  }

  function handleSettingsChange(nextSettings) {
    setSettings(nextSettings);
    setSettingsUpdatedAt(new Date().toISOString());
  }

  function handleApplyPurchases(updater) {
    setPurchases((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }

  function handleCatalogStateChange(nextState) {
    setSupplierCatalogs(nextState);
  }

  function handleProductOverrideChange(vendorCode, field, value) {
    if (!vendorCode) return;
    setProductOverrides((prev) => setProductOverride(prev, vendorCode, field, value));
  }

  function handlePurchaseChange(vendorCode, value) {
    if (!vendorCode) return;
    setPurchases((prev) => {
      const next = { ...prev };
      if (value === '' || value == null) {
        delete next[vendorCode];
      } else {
        next[vendorCode] = value;
      }
      return next;
    });
  }

  function exportPurchases() {
    const blob = new Blob([JSON.stringify(purchases, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wb-purchases-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importPurchases(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed && typeof parsed === 'object') {
          setPurchases((prev) => ({ ...prev, ...parsed }));
        }
      } catch {
        setError('Не удалось прочитать JSON с закупками');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function openRowInCalc(row) {
    changeSection('calc');
    setMarginFilter(null);
    setHighlightNmId(row.nmId);
    if (row.vendorCode) setDashboardQuery(String(row.vendorCode));
  }

  async function copyTeamLink() {
    if (!team) return;
    try {
      await navigator.clipboard.writeText(buildShareUrl(team));
      setCloudStatus('Ссылка команды скопирована');
    } catch {
      setCloudStatus('Не удалось скопировать ссылку');
    }
  }

  return (
    <AppShell
      section={section}
      onSectionChange={changeSection}
      permissions={myPermissions}
      isTeamCreator={isTeamCreator}
      hasTeam={Boolean(team)}
      headerActions={
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn-header-primary min-w-[7.5rem]"
            disabled={syncActive || !canSyncWb}
            onClick={handleSync}
            title={
              canSyncWb
                ? 'Цены, остатки, изменённые карточки (~20–40 сек)'
                : 'Синхронизация WB доступна участникам с правом «Данные»'
            }
          >
            {loading ? syncHint || 'Загрузка…' : enriching ? 'Догрузка…' : 'Быстро'}
          </button>
          <button
            type="button"
            className="btn-header-secondary min-w-[7.5rem]"
            disabled={syncActive || !canSyncWb}
            onClick={handleFullSync}
            title={canSyncWb ? 'Весь каталог карточек (~1–2 мин)' : 'Нужно право «Данные»'}
          >
            Полностью
          </button>
        </div>
      }
      syncBar={
        syncedAt ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600">
            {team ? (
              <>
                <span className="font-mono text-xs font-semibold tracking-wide text-brand-700">{team}</span>
                <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={copyTeamLink}>
                  Ссылка
                </button>
                <span aria-hidden>·</span>
              </>
            ) : null}
            {teamName ? (
              <>
                <span className="font-medium text-slate-800">{teamName}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            {meta.syncMode === 'full' ? 'Полная' : meta.syncMode === 'bootstrap' ? 'Первая' : 'Быстрая'} синхронизация:{' '}
            {new Date(syncedAt).toLocaleString('ru-RU')}
            {cloudSyncing ? ' · облако…' : cloudRefreshing ? ' · обновление…' : ''}
            {enriching ? ' · догружаем отчёты…' : ''}
            {activeProfile ? ` · кабинет ${activeProfile.name}` : ''}
            {meta.fullCatalogAt ? (
              <>
                {' '}
                · каталог от {new Date(meta.fullCatalogAt).toLocaleDateString('ru-RU')}
              </>
            ) : null}
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600">
            {team ? (
              <>
                <span className="font-mono text-xs font-semibold tracking-wide text-brand-700">{team}</span>
                <button type="button" className="text-xs font-medium text-brand-700 underline" onClick={copyTeamLink}>
                  Ссылка
                </button>
                <span aria-hidden>·</span>
              </>
            ) : null}
            {teamName ? (
              <>
                Команда <span className="font-medium text-slate-800">{teamName}</span>
                {activeProfile ? ` · кабинет ${activeProfile.name}` : ''}
                <span aria-hidden>·</span>
              </>
            ) : null}
            {cloudSyncing ? 'Обновляем облако… · ' : cloudRefreshing ? 'Сверяем облако… · ' : ''}
            Загрузите данные с WB или прайс поставщика — таблица расчётов появится ниже.
          </span>
        )
      }
    >
      <UpdateBanner />
      {cloudStatus ? (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-lg"
          role="status"
        >
          {cloudStatus}
        </div>
      ) : null}
      {teamUrlMissing ? <TeamUrlBanner teamCode={team} onRestore={handleRestoreTeamUrl} /> : null}
      {cloudPullError ? (
        <div
          className="border-b border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 lg:px-6"
          role="alert"
        >
          {cloudPullError}
          <button
            type="button"
            className="ml-2 font-medium underline"
            onClick={retryCloudPull}
            disabled={cloudRefreshing}
          >
            {cloudRefreshing ? 'Загрузка…' : 'Повторить'}
          </button>
        </div>
      ) : null}
      {error ? (
        <WbTokenBanner message={error} onOpenData={() => changeSection('data')} />
      ) : null}
      {meta?.advertError ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:px-6">
          {meta.advertError}
          {isAdvertRateLimitMessage(meta.advertError)
            ? ' Данные рекламы не перезаписываем — повторите «Быстро» через 1–2 мин.'
            : ' — колонка ДРР может быть пустой. Проверьте категорию «Продвижение» в токене WB.'}
        </div>
      ) : null}
      {showSyncProgress ? (
        <div className="mb-4">
          <SyncProgressPanel
            steps={syncSteps}
            startedAt={syncStartedAt}
            partialReady={syncPartialReady}
          />
        </div>
      ) : null}
      {section === 'calc' ? (
        canAccessSection('calc', myPermissions) || !team ? (
        <div className="flex flex-col gap-4">
          {activeCatalog ? (
            <p className="text-xs text-slate-500">
              Прайс: {activeCatalog.fileName} ·{' '}
              {countCatalogMatches(vendorCodes, activeCatalog.byDigitKey)} совпадений ·{' '}
              <button type="button" className="text-brand-700 underline" onClick={() => changeSection('data')}>
                сменить
              </button>
            </p>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Загрузите прайс поставщика в разделе{' '}
              <button type="button" className="font-medium underline" onClick={() => changeSection('data')}>
                Данные
              </button>{' '}
              — закупочные цены подставятся автоматически.
            </div>
          )}
          {rows.length > 0 ? (
            <>
              <SummaryDashboard
                rows={rows}
                settings={settings}
                meta={meta}
                marginFilter={marginFilter}
                onMarginFilter={setMarginFilter}
                brandFilter={brandFilter}
                onBrandFilter={setBrandFilter}
                onOpenLogistics={() => changeSection('logistics')}
                onSelectRow={(row) => {
                  setMarginFilter('attention');
                  setHighlightNmId(row.nmId);
                  if (row.vendorCode) setDashboardQuery(String(row.vendorCode));
                }}
              />
              <ProductsTable
                rows={rows}
                settings={settings}
                purchases={purchases}
                productOverrides={productOverrides}
                onPurchaseChange={handlePurchaseChange}
                onProductOverrideChange={handleProductOverrideChange}
                onRowClick={setDetailRow}
                marginFilter={marginFilter}
                onMarginFilterClear={() => setMarginFilter(null)}
                brandFilter={brandFilter}
                onBrandFilterChange={setBrandFilter}
                highlightNmId={highlightNmId}
                onHighlightConsumed={() => setHighlightNmId(null)}
                dashboardQuery={dashboardQuery}
                onDashboardQueryConsumed={() => setDashboardQuery('')}
              />
            </>
          ) : (
            <section className="panel py-12 text-center">
              <p className="text-sm font-medium text-slate-700">Нет данных для расчёта</p>
              <p className="mt-2 text-sm text-slate-500">
                {activeProfile?.token
                  ? 'Нажмите «Быстро» в шапке — подтянем товары с WB (нужен токен с доступом к Content и Prices).'
                  : 'Перейдите в раздел «Данные», добавьте API-ключ и нажмите «Обновить с WB».'}
              </p>
              {activeProfile?.token && canSyncWb ? (
                <button type="button" className="btn-primary mt-4" disabled={syncActive} onClick={handleSync}>
                  {loading ? syncHint || 'Загрузка…' : enriching ? 'Догрузка…' : 'Быстро — загрузить с WB'}
                </button>
              ) : canAccessSection('data', myPermissions) || !team ? (
                <button type="button" className="btn-primary mt-4" onClick={() => changeSection('data')}>
                  Перейти к данным
                </button>
              ) : (
                <p className="mt-4 text-xs text-slate-500">
                  Попросите создателя команды добавить API-ключ или выдать доступ к разделу «Данные».
                </p>
              )}
            </section>
          )}
        </div>
        ) : (
          <SectionAccessDenied
            title="Раздел «Расчёты» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'fbs' ? (
        canAccessSection('fbs', myPermissions) || !team ? (
          <FbsAssemblyPanel
            token={activeProfile?.token}
            rows={rows}
            activeCatalog={activeCatalog}
            hasApiKey={Boolean(activeProfile?.token)}
          />
        ) : (
          <SectionAccessDenied
            title="Раздел «FBS» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'feedbacks' ? <FeedbacksExternalLink /> : null}

      {section === 'regions' ? (
        canAccessSection('regions', myPermissions) || !team ? (
          <RegionsPanel
            rows={rows}
            meta={meta}
            settings={settings}
            tariffCache={wbProductCache?.tariffCache || null}
            onSettingsChange={handleSettingsChange}
            syncedAt={syncedAt}
          />
        ) : (
          <SectionAccessDenied
            title="Раздел «Регионы» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'returns' ? (
        canAccessSection('returns', myPermissions) || !team ? (
          <ReturnsPanel
            rows={rows}
            meta={meta}
            realizationSnapshot={wbProductCache?.realizationSnapshot || null}
          />
        ) : (
          <SectionAccessDenied
            title="Раздел «Возвраты» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'logistics' ? (
        canAccessSection('logistics', myPermissions) || !team ? (
        <LogisticsReconcilePanel
          rows={rows}
          settings={settings}
          meta={meta}
          onSelectRow={openRowInCalc}
        />
        ) : (
          <SectionAccessDenied
            title="Раздел «Логистика» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'pnl' ? (
        canAccessSection('pnl', myPermissions) || !team ? (
        <ActualPnlPanel
          rows={rows}
          settings={settings}
          meta={meta}
          syncActive={loading || enriching}
          onSelectRow={openRowInCalc}
        />
        ) : (
          <SectionAccessDenied
            title="Раздел «Факт P&L» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'data' ? (
        canAccessSection('data', myPermissions) || !team ? (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {team ? (
            <section className="panel border-brand-200 bg-brand-50/40">
              <h2 className="text-sm font-semibold text-slate-800">Команда</h2>
              <p className="mt-1 text-xs text-slate-500">
                {teamName ? `${teamName} · ` : ''}
                код для входа коллег
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xl font-bold tracking-widest text-brand-700">{team}</span>
                <button type="button" className="btn-secondary text-xs" onClick={copyTeamLink}>
                  Ссылка для команды
                </button>
              </div>
            </section>
          ) : null}
          <section className="panel">
            <h2 className="text-sm font-semibold text-slate-800">Синхронизация с WB</h2>
            <p className="mt-1 text-xs text-slate-500">
              <strong>Быстро</strong> — цены, остатки, новые и изменённые карточки.{' '}
              <strong>Полностью</strong> — весь каталог (~660 SKU), если что-то не подтянулось.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={syncActive} onClick={handleSync}>
                {loading ? syncHint || 'Загрузка…' : enriching ? 'Догрузка…' : 'Быстро'}
              </button>
              <button type="button" className="btn-secondary" disabled={syncActive} onClick={handleFullSync}>
                Полностью
              </button>
            </div>
            {syncedAt ? (
              <p className="mt-2 text-xs text-slate-500">
                Последняя: {meta.syncMode === 'full' ? 'полная' : 'быстрая'},{' '}
                {new Date(syncedAt).toLocaleString('ru-RU')}
              </p>
            ) : null}
          </section>
          <ApiKeyPanel
            profiles={profiles}
            activeProfileId={activeProfileId}
            onProfilesChange={setProfiles}
            onActiveChange={setActiveProfileId}
            onProfileAdded={handleProfileAdded}
            onProfileRemove={handleProfileRemove}
            teamMode={Boolean(team)}
            tokenInvalid={tokenInvalid}
            tokenInvalidMessage={error}
          />
          <SupplierPricePanel
            catalogState={supplierCatalogs}
            onCatalogStateChange={handleCatalogStateChange}
            vendorCodes={vendorCodes}
            productCount={baseRows.length}
            onApplyPurchases={handleApplyPurchases}
            onStatus={setCloudStatus}
          />
          <section className="panel">
            <h2 className="text-sm font-semibold text-slate-800">Закупки</h2>
            <p className="mt-1 text-xs text-slate-500">Экспорт и импорт ручных цен закупки (JSON).</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={exportPurchases}>
                Экспорт
              </button>
              <label className="btn-secondary cursor-pointer">
                Импорт
                <input type="file" accept="application/json" className="hidden" onChange={importPurchases} />
              </label>
            </div>
          </section>
        </div>
        ) : (
          <SectionAccessDenied
            title="Раздел «Данные» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      {section === 'team' ? (
        <div className="mx-auto max-w-3xl">
          <TeamPanel
            team={team}
            teamName={teamName}
            isOwner={isTeamCreator}
            onTeamChange={handleTeamExit}
            onStartNewTeam={handleStartNewTeam}
            onCreateTeam={handleCreateTeam}
            onJoinTeam={handleJoinTeam}
            cloudStatus={cloudStatus}
            updatedAt={workspaceUpdatedAt}
          />
          {!team ? (
            <p className="mt-4 text-sm text-slate-600">
              Команда нужна, чтобы коллеги видели общие ключи, настройки и таблицу по ссылке.
            </p>
          ) : (
            <>
              <p className="mt-4 text-xs text-slate-500">
                Ссылка:{' '}
                <a className="font-mono text-brand-700 underline" href={buildShareUrl(team)}>
                  {buildShareUrl(team)}
                </a>
              </p>
              {!isTeamCreator ? (
                <div className="mt-4">
                  <TeamPermissionsPanel
                    teamAccess={teamAccess}
                    ownerClientId={ownerClientId}
                    isTeamCreator={false}
                    onTeamAccessChange={handleTeamAccessChange}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {section === 'admin' && isTeamCreator ? (
        <div className="mx-auto max-w-5xl">
          <TeamPermissionsPanel
            teamAccess={teamAccess}
            ownerClientId={ownerClientId}
            isTeamCreator
            onTeamAccessChange={handleTeamAccessChange}
          />
        </div>
      ) : null}

      {section === 'settings' ? (
        canAccessSection('settings', myPermissions) || !team ? (
        <div className="mx-auto max-w-5xl">
          <SettingsPanel
            settings={settings}
            onChange={handleSettingsChange}
            open
            embedded
            onToggle={() => {}}
            teamMode={Boolean(team)}
            settingsUpdatedAt={settingsUpdatedAt}
            workspaceUpdatedAt={workspaceUpdatedAt}
          />
        </div>
        ) : (
          <SectionAccessDenied
            title="Раздел «Настройки» недоступен"
            onBack={() => changeSection(firstAllowedSection(myPermissions))}
          />
        )
      ) : null}

      <RowDetail row={detailRow} onClose={() => setDetailRow(null)} />
    </AppShell>
  );
}
