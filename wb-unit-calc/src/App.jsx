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
import { mergeWorkspaceProfiles } from '@lib/workspace-merge.js';
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
  fetchWorkspace,
  getTeamFromUrl,
  loadStoredTeam,
  saveStoredTeam,
  saveWorkspaceRemote,
} from './lib/workspace-api';
import { formatWorkspaceUpdatedAt, workspaceTimestampsEqual } from './lib/workspace-sync';
import {
  applyCatalogToPurchases,
  countCatalogMatches,
  getActiveCatalog,
} from './lib/supplier-catalog';
import {
  loadActiveProfileId,
  loadProfiles,
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
  saveProductOverrides,
  savePurchases,
  saveSettings,
  saveSupplierCatalogs,
  saveWbProductCache,
} from './lib/storage';
import { slimRowsForCache } from '@lib/unit-economics/row-cache.js';
import {
  applyPriceUpdatesToRows,
  buildEffectiveWbCache,
  isPriceDataStale,
  isRealizationStale,
  mergeWorkspaceRowsPreservingLocalPrices,
  resolveRealizationSyncedAt,
  shouldSkipRealizationFetch,
} from '@lib/wb-sync-cache.js';
import { createRecalcRows } from './lib/recalc-rows-cache';
import { useChunkedRecalcRows } from './lib/use-chunked-recalc-rows';
import { setProductOverride, reconcileDraftOverridesAfterPricePatch } from './lib/product-overrides';
import { readJsonResponse } from './lib/http';
import { isAdvertRateLimitMessage } from '@lib/wb-advert-stats.js';

function readBootCache() {
  const team = getTeamFromUrl() || loadStoredTeam() || '';
  const cache = team ? loadWorkspaceCache(team) : null;
  return { team, cache };
}

function saveWorkspaceSnapshot(teamCode, data) {
  if (!teamCode || !data?.payload) return;
  saveWorkspaceCache(teamCode, {
    payload: data.payload,
    updatedAt: data.updatedAt || '',
    teamName: data.name || '',
  });
}

/** localStorage-снимок с учётом свежих локальных цен (не затираем WB Prices патч). */
function saveWorkspaceSnapshotMerged(teamCode, data, localRows, localMeta) {
  if (!teamCode || !data?.payload?.cache?.rows?.length) {
    saveWorkspaceSnapshot(teamCode, data);
    return;
  }
  const cloudMeta = data.payload.cache.meta || {};
  const mergedRows = mergeWorkspaceRowsPreservingLocalPrices(
    slimRowsForCache(data.payload.cache.rows),
    localRows,
    localMeta?.pricesSyncedAt,
    cloudMeta.pricesSyncedAt
  );
  const mergedMeta =
    localMeta?.pricesSyncedAt &&
    (!cloudMeta.pricesSyncedAt || new Date(localMeta.pricesSyncedAt) > new Date(cloudMeta.pricesSyncedAt))
      ? { ...cloudMeta, pricesSyncedAt: localMeta.pricesSyncedAt }
      : cloudMeta;
  saveWorkspaceSnapshot(teamCode, {
    ...data,
    payload: {
      ...data.payload,
      cache: {
        ...data.payload.cache,
        rows: mergedRows,
        meta: mergedMeta,
      },
    },
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
  const controller = new AbortController();
  const timeoutMs = phase === 'catalog' ? 90_000 : 150_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/unit-calc/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
      throw new Error(data.error || `Ошибка ${response.status}`);
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
  const teamProfiles = bootPayload?.profiles;
  const localProfiles = loadProfiles();
  if (teamProfiles?.length || localProfiles?.length) {
    return mergeWorkspaceProfiles(localProfiles, teamProfiles);
  }
  return [];
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

function applyWorkspacePayload(payload, setters, { keepRows = [], keepProfiles = [], keepMeta = {}, localSettingsUpdatedAt = '' } = {}) {
  if (!payload) return;
  if (payload.ownerClientId != null) setters.setOwnerClientId(payload.ownerClientId);

  const mergedProfiles = mergeWorkspaceProfiles(keepProfiles, payload.profiles);
  if (mergedProfiles.length) {
    setters.setProfiles(mergedProfiles);
    const activeId =
      [payload.activeProfileId, keepProfiles.find((p) => p.token)?.id, mergedProfiles[0]?.id].find(
        (id) => id && mergedProfiles.some((profile) => profile.id === id)
      ) || '';
    if (activeId) setters.setActiveProfileId(activeId);
  }

  if (payload.purchases !== undefined) {
    setters.setPurchases((prev) => ({ ...payload.purchases, ...prev }));
  }
  if (payload.supplierCatalogs?.items?.length) {
    setters.setSupplierCatalogs(payload.supplierCatalogs);
  }
  if (payload.productOverrides !== undefined) {
    setters.setProductOverrides((prev) => ({ ...payload.productOverrides, ...prev }));
  }

  if (payload.settings != null) {
    const remoteTs = payload.settingsUpdatedAt || '';
    const localTs = localSettingsUpdatedAt || '';
    if (!localTs || !remoteTs || remoteTs >= localTs) {
      setters.setSettings(mergeUnitSettings(payload.settings));
      if (payload.settingsUpdatedAt !== undefined) {
        setters.setSettingsUpdatedAt(payload.settingsUpdatedAt || '');
      }
    }
  } else if (payload.settingsUpdatedAt !== undefined) {
    setters.setSettingsUpdatedAt(payload.settingsUpdatedAt || '');
  }

  if (payload.teamAccess !== undefined) {
    setters.setTeamAccess(normalizeTeamAccess(payload.teamAccess));
  }

  const cloudRows = payload.cache?.rows;
  if (cloudRows?.length) {
    const cloudMeta = payload.cache.meta || {};
    const slimCloud = slimRowsForCache(cloudRows);
    const mergedRows = mergeWorkspaceRowsPreservingLocalPrices(
      slimCloud,
      keepRows,
      keepMeta?.pricesSyncedAt,
      cloudMeta.pricesSyncedAt
    );
    setters.setBaseRows(mergedRows);
    setters.setSyncedAt(payload.cache.syncedAt || '');
    setters.setMeta(
      keepMeta?.pricesSyncedAt &&
        (!cloudMeta.pricesSyncedAt ||
          new Date(keepMeta.pricesSyncedAt) > new Date(cloudMeta.pricesSyncedAt))
        ? { ...cloudMeta, pricesSyncedAt: keepMeta.pricesSyncedAt }
        : cloudMeta
    );
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
  const [ownerClientId, setOwnerClientId] = useState(bootPayload?.ownerClientId ?? null);
  const [workspaceUpdatedAt, setWorkspaceUpdatedAt] = useState(boot.cache?.updatedAt || '');
  const [cloudStatus, setCloudStatus] = useState('');
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudRefreshing, setCloudRefreshing] = useState(false);

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
    writeSectionToUrl(id);
    saveStoredSection(id);
  }, []);

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
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [syncSteps, setSyncSteps] = useState(null);
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [syncPartialReady, setSyncPartialReady] = useState(false);
  const [syncHint, setSyncHint] = useState('');
  const [error, setError] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [marginFilter, setMarginFilter] = useState(null);
  const [brandFilter, setBrandFilter] = useState([]);
  const [highlightNmId, setHighlightNmId] = useState(null);
  const [dashboardQuery, setDashboardQuery] = useState('');
  const skipCloudSave = useRef(true);
  const syncRunId = useRef(0);
  const priceRefreshStartedRef = useRef(false);
  const priceRefreshFailedAtRef = useRef(0);
  const priceRefreshingRef = useRef(false);
  const realizationRefreshStartedRef = useRef(false);
  const persistTimer = useRef(null);
  const pushToCloudRef = useRef(async () => {});
  const cloudPushInFlightRef = useRef(false);
  const workspaceUpdatedAtRef = useRef(workspaceUpdatedAt);
  const settingsUpdatedAtRef = useRef(settingsUpdatedAt);
  const lastLocalPushAtRef = useRef(0);
  const lastLocalPriceRefreshAtRef = useRef(0);
  const lastFocusPullAtRef = useRef(0);
  priceRefreshingRef.current = priceRefreshing;
  workspaceUpdatedAtRef.current = workspaceUpdatedAt;
  settingsUpdatedAtRef.current = settingsUpdatedAt;
  const baseRowsRef = useRef(baseRows);
  baseRowsRef.current = baseRows;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

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
  const deferredPurchases = useDeferredValue(purchases);
  const deferredProductOverrides = useDeferredValue(productOverrides);
  const deferredSettings = useDeferredValue(settings);

  const { rows, recalcPending, recalcProgress } = useChunkedRecalcRows(
    recalcRowsCached,
    deferredBaseRows,
    deferredPurchases,
    deferredSettings,
    deferredProductOverrides
  );

  const isTeamCreator = useMemo(
    () => checkTeamCreator({ team, ownerClientId }),
    [team, ownerClientId]
  );

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
    writeSectionToUrl(section);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setSectionState(readSectionFromUrl() || resolveInitialSection());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const pushToCloud = useCallback(async () => {
    if (!team || skipCloudSave.current || cloudPushInFlightRef.current) return;
    if (priceRefreshingRef.current) return;

    cloudPushInFlightRef.current = true;
    const accessForCloud = isTeamCreator
      ? teamAccess
      : touchTeamMember(teamAccess, getClientId());

    if (!isTeamCreator && accessForCloud !== teamAccess) {
      setTeamAccess(accessForCloud);
    }

    const payload = buildWorkspacePayload({
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
      ownerClientId: ownerClientIdForPayload(ownerClientId),
      teamAccess: accessForCloud,
    });
    try {
      const result = await saveWorkspaceRemote(team, payload);
      lastLocalPushAtRef.current = Date.now();
      const serverUpdatedAt = formatWorkspaceUpdatedAt(result?.updatedAt);
      const updatedAt = serverUpdatedAt || new Date().toISOString();
      setWorkspaceUpdatedAt(updatedAt);
      workspaceUpdatedAtRef.current = updatedAt;
      saveWorkspaceSnapshot(team, { payload, updatedAt, name: teamName });
    } finally {
      cloudPushInFlightRef.current = false;
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
    const unchanged = Boolean(
      ifUnchangedSince && workspaceTimestampsEqual(data.updatedAt, ifUnchangedSince)
    );
    if (!unchanged && priceRefreshingRef.current) {
      return data;
    }
    if (!unchanged) {
      const hadLocalRows = baseRowsRef.current.length > 0;
      const cloudEmpty = !data.payload?.cache?.rows?.length;
      startTransition(() => {
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
              keepMeta: metaRef.current,
              localSettingsUpdatedAt: settingsUpdatedAtRef.current,
            }
          );
      });
      if (hadLocalRows && cloudEmpty) {
        setCloudStatus('В облаке нет таблицы — нажмите «Быстро», чтобы загрузить данные с WB.');
      }
      const remoteUpdatedAt = formatWorkspaceUpdatedAt(data.updatedAt);
      setWorkspaceUpdatedAt(remoteUpdatedAt);
      workspaceUpdatedAtRef.current = remoteUpdatedAt;
      saveWorkspaceSnapshotMerged(teamCode, data, baseRowsRef.current, metaRef.current);
      if (data.payload?.cache?.syncedAt || data.payload?.cache?.rows?.length) {
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
    const url = new URL(window.location.href);
    url.searchParams.set('team', data.teamCode);
    window.history.replaceState({}, '', url);
    skipCloudSave.current = false;
    setCloudStatus(`Команда «${data.name || data.teamCode}»`);
  }, [refreshTeamWorkspace, workspaceUpdatedAt]);

  useEffect(() => {
    pushToCloudRef.current = pushToCloud;
  }, [pushToCloud]);

  useEffect(() => {
    if (!team || cloudSyncing || loading || enriching) return undefined;

    async function pullRemote() {
      if (skipCloudSave.current) return;
      if (priceRefreshingRef.current || cloudPushInFlightRef.current) return;
      if (Date.now() - lastLocalPushAtRef.current < 15000) return;
      if (Date.now() - lastLocalPriceRefreshAtRef.current < 60000) return;
      try {
        const data = await fetchWorkspace(team);
        if (
          !data.updatedAt ||
          workspaceTimestampsEqual(data.updatedAt, workspaceUpdatedAtRef.current)
        ) {
          return;
        }
        const hadLocalRows = baseRowsRef.current.length > 0;
        const cloudEmpty = !data.payload?.cache?.rows?.length;
        startTransition(() => {
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
              keepMeta: metaRef.current,
              localSettingsUpdatedAt: settingsUpdatedAtRef.current,
            }
          );
        });
        if (hadLocalRows && cloudEmpty) {
          setCloudStatus('В облаке нет таблицы — нажмите «Быстро», чтобы загрузить данные с WB.');
        }
        const remoteUpdatedAt = formatWorkspaceUpdatedAt(data.updatedAt);
        setWorkspaceUpdatedAt(remoteUpdatedAt);
        workspaceUpdatedAtRef.current = remoteUpdatedAt;
        saveWorkspaceSnapshotMerged(team, data, baseRowsRef.current, metaRef.current);
      } catch {
        // ignore background refresh errors
      }
    }

    const onFocus = () => {
      if (Date.now() - lastFocusPullAtRef.current < 30000) return;
      lastFocusPullAtRef.current = Date.now();
      pullRemote();
    };
    window.addEventListener('focus', onFocus);
    const timer = setInterval(pullRemote, 120000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [team, cloudSyncing, loading, enriching]);

  useEffect(() => {
    if (!team || loading || enriching || cloudSyncing || priceRefreshing || cloudRefreshing) {
      return undefined;
    }
    const timer = setTimeout(() => {
      pushToCloudRef.current().catch((err) => setCloudStatus(`Ошибка сохранения: ${err.message}`));
    }, 4000);
    return () => clearTimeout(timer);
  }, [
    team,
    loading,
    enriching,
    cloudSyncing,
    priceRefreshing,
    cloudRefreshing,
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
    teamAccess,
    ownerClientId,
  ]);

  useEffect(() => {
    if (profiles.length) return;
    const localProfiles = loadProfiles();
    if (!localProfiles.length) return;
    setProfiles(localProfiles);
    setActiveProfileId(bootActiveProfileId({}, localProfiles));
    setCloudStatus('API-ключ восстановлен из локального хранилища браузера');
  }, []);

  useEffect(() => {
    async function syncCloud() {
      const candidate = getTeamFromUrl() || loadStoredTeam();
      if (!candidate) {
        skipCloudSave.current = false;
        return;
      }

      setTeam(candidate);

      if (bootPayload?.cache?.rows?.length) {
        skipCloudSave.current = false;
        suppressAutoSyncRef.current = true;
        const bootUpdatedAt = boot.cache?.updatedAt || '';
        const runCloudRefresh = () => {
          refreshTeamWorkspace(candidate, { ifUnchangedSince: bootUpdatedAt })
            .then((data) => {
              if (
                bootUpdatedAt &&
                workspaceTimestampsEqual(data.updatedAt, bootUpdatedAt)
              ) {
                return;
              }
              setCloudStatus('Данные обновлены из облака');
            })
            .catch((err) => {
              if (!err.needsTeam) {
                setCloudStatus('Облако недоступно — показаны локальные данные');
              }
            });
        };
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(runCloudRefresh, { timeout: 12000 });
        } else {
          setTimeout(runCloudRefresh, 2000);
        }
        return;
      }

      setCloudSyncing(true);
      setError('');
      try {
        await loadTeamWorkspace(candidate);
      } catch (err) {
        if (!err.needsTeam) {
          setError(err.message);
        }
        if (!bootPayload?.cache) {
          setCloudStatus('Не удалось загрузить облако — показаны локальные данные');
        }
        skipCloudSave.current = false;
      } finally {
        setCloudSyncing(false);
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
          realizationSyncedAt: data.realizationSyncedAt || prev?.realizationSyncedAt || null,
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
        realizationSyncedAt: data.realizationSyncedAt ?? prev.realizationSyncedAt,
        realizationSkippedDuringSync: data.realizationSkipped ?? prev.realizationSkippedDuringSync,
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

  const refreshPrices = useCallback(async ({ manual = false } = {}) => {
    if (!activeProfile?.token) {
      const msg = 'Нет WB API токена — добавьте ключ в разделе «Данные»';
      setCloudStatus(msg);
      setMeta((prev) => ({ ...prev, pricesSyncError: msg }));
      return false;
    }
    if (!baseRows.length) {
      const msg = 'Нет строк в таблице — сначала нажмите «Быстро»';
      setCloudStatus(msg);
      setMeta((prev) => ({ ...prev, pricesSyncError: msg }));
      return false;
    }
    if (loading || enriching || priceRefreshingRef.current) {
      return false;
    }

    const cache = buildEffectiveWbCache(wbProductCache, baseRows, syncedAt);
    if (!cache?.products?.length) {
      const msg = 'Нет кэша карточек — нажмите «Быстро» или «Полностью»';
      setCloudStatus(msg);
      setMeta((prev) => ({ ...prev, pricesSyncError: msg }));
      return false;
    }

    setPriceRefreshing(true);
    setMeta((prev) => ({ ...prev, pricesSyncError: null }));
    try {
      const priceRows = baseRowsRef.current.map((row) => ({
        nmId: row.nmId,
        vendorCode: row.vendorCode,
        salePrice: row.salePrice,
        basePrice: row.basePrice,
        ourPrice: row.ourPrice,
      }));
      const response = await fetch('/api/unit-calc/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeProfile.token}`,
        },
        body: JSON.stringify({
          phase: 'prices',
          wbCache: {
            products: cache.products,
            realizationSnapshot: cache.realizationSnapshot || null,
            realizationSyncedAt: cache.realizationSyncedAt || null,
          },
          rows: priceRows,
        }),
      });
      const { data } = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.error || `Ошибка ${response.status}`);
      }

      const matched = Number(data.pricesMatched) || 0;
      const pricesUpdated = Number(data.pricesUpdated) || 0;
      const pricesUnchanged = Number(data.pricesUnchanged) || 0;
      const pricesMissing = Number(data.pricesMissing) || 0;

      if (matched > 0) {
        lastLocalPriceRefreshAtRef.current = Date.now();

        if (pricesUpdated > 0 && data.priceUpdates && Object.keys(data.priceUpdates).length > 0) {
          const prevRows = baseRowsRef.current;
          const { rows: nextRows } = applyPriceUpdatesToRows(prevRows, data.priceUpdates);
          const pricesSyncedAt = data.pricesSyncedAt || data.syncedAt || new Date().toISOString();
          baseRowsRef.current = nextRows;
          metaRef.current = {
            ...metaRef.current,
            pricesSyncedAt,
            pricesLastUpdated: pricesUpdated,
            pricesLastUnchanged: pricesUnchanged,
            pricesLastMissing: pricesMissing,
            pricesSyncError: null,
          };
          startTransition(() => {
            setBaseRows(nextRows);
            setProductOverrides((prev) =>
              reconcileDraftOverridesAfterPricePatch(prevRows, data.priceUpdates, prev)
            );
            setSyncedAt(data.syncedAt || pricesSyncedAt);
            setMeta((prev) => ({
              ...prev,
              pricesSyncedAt,
              pricesLastUpdated: pricesUpdated,
              pricesLastUnchanged: pricesUnchanged,
              pricesLastMissing: pricesMissing,
              pricesSyncError: null,
            }));
          });
          setCloudStatus(
            `Обновлено ${pricesUpdated} цен WB · проверено ${matched}` +
              (pricesUnchanged > 0 ? ` · без изменений ${pricesUnchanged}` : '') +
              (pricesMissing > 0 ? ` · не найдено ${pricesMissing}` : '')
          );
          return true;
        }

        const unchangedMsg =
          `Проверено ${matched} цен WB · без изменений` +
          (pricesUnchanged > 0 ? ` (${pricesUnchanged})` : '') +
          (pricesMissing > 0 ? ` · не найдено в API ${pricesMissing}` : '');
        const checkedAt = data.pricesSyncedAt || data.syncedAt || new Date().toISOString();
        setCloudStatus(unchangedMsg);
        startTransition(() => {
          setMeta((prev) => ({
            ...prev,
            pricesLastChecked: checkedAt,
            pricesLastUnchanged: pricesUnchanged,
            pricesLastMissing: pricesMissing,
            pricesSyncError: null,
          }));
        });
        return true;
      }

      const failMsg =
        pricesMissing > 0
          ? `WB Prices API: не найдено цен для ${pricesMissing} товаров — проверьте токен (Prices)`
          : 'WB Prices API не вернул цены — проверьте токен (Prices) и нажмите «Обновить цены»';
      setCloudStatus(failMsg);
      setMeta((prev) => ({ ...prev, pricesSyncError: failMsg }));
      return false;
    } catch (err) {
      const msg = `Не удалось обновить цены: ${err.message}`;
      setCloudStatus(msg);
      setMeta((prev) => ({ ...prev, pricesSyncError: msg }));
      priceRefreshFailedAtRef.current = Date.now();
      if (manual) console.warn('[unit-calc] price refresh failed:', err.message);
      return false;
    } finally {
      setPriceRefreshing(false);
    }
  }, [
    activeProfile,
    baseRows.length,
    loading,
    enriching,
    wbProductCache,
    syncedAt,
  ]);

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
        const skipRealizationPhase = shouldSkipRealizationFetch({
          mode,
          wbCache: cache,
          fallbackSyncedAt: syncedAt,
        });
        if (skipRealizationPhase) {
          const cachedDetail = meta?.realizationPeriod
            ? `${meta.realizationTotalSales || 0} продаж · из кэша`
            : 'из кэша · актуален';
          setStep('realization', { status: 'done', detail: cachedDetail }, { force: true });
        } else {
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
            realizationSyncedAt:
              realizationData.realizationSyncedAt || cache.realizationSyncedAt || realizationData.syncedAt,
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
        }

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
      } catch (err) {
        if (isStale()) return;
        const failedStep = steps.find((s) => s.status === 'running')?.id || 'enrich';
        setStep(failedStep, {
          status: 'error',
          detail: err.message || 'Ошибка загрузки',
        }, { force: true });
        if (partialReady || baseRows.length > 0) {
          setCloudStatus(`Частичная загрузка: ${err.message}. Нажмите «Быстро» для повтора.`);
        } else {
          setError(err.message || 'Не удалось загрузить данные');
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
    [activeProfile, purchases, settings, wbProductCache, baseRows, syncedAt, meta, applySyncResult]
  );

  const handleSync = useCallback(() => runSync('quick'), [runSync]);
  const handleFullSync = useCallback(() => runSync('full'), [runSync]);
  const handleRefreshPrices = useCallback(() => {
    priceRefreshStartedRef.current = false;
    priceRefreshFailedAtRef.current = 0;
    return refreshPrices({ manual: true });
  }, [refreshPrices]);

  const handleProfileAdded = useCallback(() => {
    changeSection('data');
    runSync('quick');
  }, [runSync]);

  useEffect(() => {
    if (cloudSyncing || suppressAutoSyncRef.current || loading || enriching || !activeProfile?.token) {
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
  }, [cloudSyncing, loading, enriching, activeProfile?.token, baseRows, meta, runSync]);

  useEffect(() => {
    if (cloudSyncing || loading || enriching) return undefined;
    if (!activeProfile?.token || !canSyncWb || !baseRows.length) return undefined;
    if (priceRefreshStartedRef.current || priceRefreshingRef.current) return undefined;

    const lastPriceCheck = metaRef.current?.pricesSyncedAt || metaRef.current?.pricesLastChecked;
    if (lastPriceCheck && !isPriceDataStale(lastPriceCheck)) {
      priceRefreshStartedRef.current = true;
      return undefined;
    }

    if (Date.now() - priceRefreshFailedAtRef.current < 5 * 60 * 1000) {
      priceRefreshStartedRef.current = true;
      return undefined;
    }

    priceRefreshStartedRef.current = true;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      refreshPrices().catch(() => {});
    };

    let idleId;
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(run, { timeout: 1500 });
    } else {
      idleId = setTimeout(run, 400);
    }

    return () => {
      cancelled = true;
      if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId);
      }
    };
  }, [
    cloudSyncing,
    loading,
    enriching,
    activeProfile?.token,
    canSyncWb,
    baseRows.length,
    refreshPrices,
  ]);

  useEffect(() => {
    if (cloudSyncing || loading || enriching || priceRefreshing) return;
    if (!activeProfile?.token || !canSyncWb || !baseRows.length || !syncedAt) return;
    if (realizationRefreshStartedRef.current) return;

    const cache = buildEffectiveWbCache(wbProductCache, baseRows, syncedAt);
    if (!cache?.realizationSnapshot) return;

    const realizationAt = resolveRealizationSyncedAt(cache, syncedAt);
    if (!isRealizationStale(realizationAt)) return;

    realizationRefreshStartedRef.current = true;
    (async () => {
      try {
        const data = await syncFromWb({
          token: activeProfile.token,
          purchases,
          settings,
          mode: 'quick',
          phase: 'realization',
          wbCache: cache,
        });
        applySyncResult(data);
      } catch (err) {
        setCloudStatus(`Не удалось обновить отчёт реализации: ${err.message}`);
      }
    })();
  }, [
    cloudSyncing,
    loading,
    enriching,
    priceRefreshing,
    activeProfile?.token,
    canSyncWb,
    baseRows.length,
    syncedAt,
    wbProductCache,
    purchases,
    settings,
    applySyncResult,
  ]);

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
    saveStoredTeam('');
    clearWorkspaceCache(previousTeam);
    const url = new URL(window.location.href);
    url.searchParams.delete('team');
    window.history.replaceState({}, '', url);
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
    const url = new URL(window.location.href);
    url.searchParams.set('team', created.teamCode);
    window.history.replaceState({}, '', url);
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
                ? 'Цены, остатки, комиссии WB, изменённые карточки (~20–40 сек)'
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
            title={
              canSyncWb
                ? 'Весь каталог + свежие комиссии и тарифы логистики (~1–2 мин)'
                : 'Нужно право «Данные»'
            }
          >
            Полностью
          </button>
        </div>
      }
      syncBar={
        syncedAt ? (
          <span className="text-slate-600">
            {teamName ? (
              <>
                <span className="font-medium text-slate-800">{teamName}</span>
                {' · '}
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
            {meta.realizationSyncedAt && !isRealizationStale(meta.realizationSyncedAt) ? (
              <>
                {' '}
                · <span className="text-slate-500">отчёт актуален</span>
              </>
            ) : null}
            {priceRefreshing ? ' · обновление цен…' : null}
            {meta.pricesSyncedAt ? (
              <>
                {' '}
                · цены WB{' '}
                {new Date(meta.pricesSyncedAt).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </>
            ) : null}
            {cloudStatus ? (
              <>
                {' '}
                ·{' '}
                <span className={meta.pricesSyncError ? 'text-rose-700' : 'text-emerald-700'}>
                  {cloudStatus}
                </span>
              </>
            ) : meta.pricesSyncError ? (
              <>
                {' '}
                · <span className="text-rose-700">{meta.pricesSyncError}</span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-slate-600">
            {teamName ? (
              <>
                Команда <span className="font-medium text-slate-800">{teamName}</span>
                {activeProfile ? ` · кабинет ${activeProfile.name}` : ''}
                {' · '}
              </>
            ) : null}
            {cloudSyncing ? 'Обновляем облако… · ' : cloudRefreshing ? 'Сверяем облако… · ' : ''}
            Загрузите данные с WB или прайс поставщика — таблица расчётов появится ниже.
          </span>
        )
      }
    >
      <UpdateBanner />
      {error ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800 lg:px-6">
          {error}
        </div>
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
              {recalcPending ? (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600"
                  role="status"
                  aria-live="polite"
                >
                  Пересчёт маржи: {recalcProgress}%
                  <span
                    className="ml-2 inline-block h-1.5 w-24 align-middle rounded-full bg-slate-200"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-brand-600 transition-[width] duration-150"
                      style={{ width: `${recalcProgress}%` }}
                    />
                  </span>
                </div>
              ) : null}
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
          ) : recalcPending ? (
            <section className="panel py-12 text-center">
              <p className="text-sm text-slate-500">Пересчёт маржи…</p>
            </section>
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
          <section className="panel">
            <h2 className="text-sm font-semibold text-slate-800">Синхронизация с WB</h2>
            <p className="mt-1 text-xs text-slate-500">
              <strong>Быстро</strong> — цены, остатки, комиссии категорий WB, новые и изменённые
              карточки. <strong>Полностью</strong> — весь каталог (~660 SKU) и тарифы логистики
              заново. <strong>Обновить цены</strong> — только колонка «Продажа» с WB (~5–15 сек).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={syncActive} onClick={handleSync}>
                {loading ? syncHint || 'Загрузка…' : enriching ? 'Догрузка…' : 'Быстро'}
              </button>
              <button type="button" className="btn-secondary" disabled={syncActive} onClick={handleFullSync}>
                Полностью
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={syncActive || !baseRows.length || !activeProfile?.token}
                onClick={handleRefreshPrices}
                title="Подтянуть актуальные цены продажи с WB Prices API"
              >
                {priceRefreshing ? 'Цены…' : 'Обновить цены'}
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
            teamMode={Boolean(team)}
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
