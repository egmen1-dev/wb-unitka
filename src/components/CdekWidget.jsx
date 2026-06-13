import { useEffect, useId, useRef, useState } from 'react';
import { buildCdekParcels } from '../utils/cdekParcels';
import { loadYmaps3 } from '../utils/yandexMaps';

const SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@cdek-it/widget@3';

const SENDER = {
  country_code: 'RU',
  city: 'Екатеринбург',
  code: 250,
  address: 'ул. Бакинских комиссаров, 97',
};

const MAP_REFERRER_HINT =
  'Для обоих ключей в кабинете Яндекс.Разработчика укажите домен без https:// — например moi-magazin.vercel.app. Изменения применяются до 15 минут.';

function loadCdekScript() {
  if (window.CDEKWidget) {
    return Promise.resolve();
  }

  const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.charset = 'utf-8';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function CdekWidget({
  items = [],
  defaultLocation = 'Екатеринбург',
  onSelect,
  onReady,
}) {
  const reactId = useId().replace(/:/g, '');
  const rootId = `cdek-map-${reactId}`;
  const widgetRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const mapCheckTimer = useRef(null);

  const mapsApiKey = import.meta.env.VITE_YANDEX_MAPS_API_KEY?.trim();
  const geocoderApiKey =
    import.meta.env.VITE_YANDEX_GEOCODER_API_KEY?.trim() || mapsApiKey;

  onSelectRef.current = onSelect;
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!mapsApiKey) {
      setStatus('error');
      setError('Добавьте VITE_YANDEX_MAPS_API_KEY (JavaScript API 3.0) для карты СДЭК.');
      return undefined;
    }

    if (!geocoderApiKey) {
      setStatus('error');
      setError('Добавьте VITE_YANDEX_GEOCODER_API_KEY (HTTP Геокодер) для поиска адресов.');
      return undefined;
    }

    let cancelled = false;

    const init = async () => {
      setStatus('loading');
      setError('');

      try {
        // Виджет СДЭК передаёт apiKey и в карту, и в HTTP Геокодер — ключи разные.
        // Карту грузим заранее с mapsApiKey; в виджет отдаём geocoderApiKey.
        await loadYmaps3(mapsApiKey);
        await loadCdekScript();
        if (cancelled || !window.CDEKWidget) return;

        const servicePath = `${window.location.origin}/api/cdek/service`;
        const parcels = buildCdekParcels(items);

        widgetRef.current = new window.CDEKWidget({
          from: SENDER,
          root: rootId,
          apiKey: geocoderApiKey,
          canChoose: true,
          servicePath,
          hideFilters: {
            have_cashless: false,
            have_cash: false,
            is_dressing_room: false,
            type: false,
          },
          hideDeliveryOptions: {
            office: false,
            door: false,
          },
          goods: parcels,
          defaultLocation,
          lang: 'rus',
          currency: 'RUB',
          tariffs: {
            office: [136, 138, 234],
            door: [137, 139, 233],
          },
          onReady() {
            if (!cancelled) {
              setStatus('ready');
              onReadyRef.current?.();

              if (mapCheckTimer.current) {
                clearTimeout(mapCheckTimer.current);
              }
              mapCheckTimer.current = setTimeout(() => {
                const root = document.getElementById(rootId);
                const hasMap =
                  root &&
                  (root.querySelector('canvas') ||
                    root.querySelector('iframe') ||
                    root.querySelector('[class*="ymaps"]'));
                if (!hasMap) {
                  setStatus('error');
                  setError(
                    `Карта не загрузилась (ошибка 403 от Яндекс.Карт). ${MAP_REFERRER_HINT}`
                  );
                }
              }, 8000);
            }
          },
          onChoose(mode, tariff, address) {
            const deliveryPrice = Math.max(0, Math.round(Number(tariff?.delivery_sum) || 0));
            const period =
              tariff?.period_min && tariff?.period_max
                ? `${tariff.period_min}–${tariff.period_max} дн.`
                : '';

            if (mode === 'office') {
              const label = `${address.name}, ${address.address}, ${address.city}`;
              onSelectRef.current?.({
                mode: 'office',
                deliveryMethod: 'cdek_pvz',
                pickupPoint: `СДЭК ПВЗ: ${label} (код ${address.code})`,
                deliveryAddress: '',
                addressLabel: label,
                tariffCode: tariff.tariff_code,
                tariffName: tariff.tariff_name,
                deliveryPrice,
                period,
                pvzCode: address.code,
              });
              return;
            }

            const label = address.formatted || address.name || '';
            onSelectRef.current?.({
              mode: 'door',
              deliveryMethod: 'cdek_door',
              pickupPoint: '',
              deliveryAddress: label,
              addressLabel: label,
              tariffCode: tariff.tariff_code,
              tariffName: tariff.tariff_name,
              deliveryPrice,
              period,
            });
          },
        });
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError('Не удалось загрузить виджет СДЭК. Обновите страницу.');
          console.error('CDEK widget init error', err);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (mapCheckTimer.current) {
        clearTimeout(mapCheckTimer.current);
      }
      widgetRef.current = null;
    };
  }, [mapsApiKey, geocoderApiKey, defaultLocation, rootId]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || status !== 'ready') return;

    const parcels = buildCdekParcels(items);
    widget.resetParcels?.();
    widget.addParcel?.(parcels);
  }, [items, status]);

  return (
    <div className="space-y-3">
      {status === 'loading' ? (
        <p className="text-sm text-gray-500">Загрузка карты СДЭК…</p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </p>
      ) : null}
      <div
        id={rootId}
        className="cdek-widget-root h-[560px] w-full rounded-xl border border-gray-200 bg-gray-50"
      />
      <p className="text-xs text-gray-500">
        Выберите город, тариф и пункт выдачи или доставку до двери, затем нажмите «Выбрать» в виджете.
      </p>
    </div>
  );
}
