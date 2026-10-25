import { t, type MessageKey } from '../../i18n';
import type { Route } from '../../core/rtc/stats';
import { useStore } from '../../state/store';

const ROUTE: Record<Route, MessageKey> = {
  'direct-lan': 'hud.routeLan',
  'direct-nat': 'hud.routeDirect',
  relay: 'hud.routeRelay',
  unknown: 'hud.routeUnknown',
};

const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dash = '–';

/** Translucent network overlay: route, RTT, bitrates, resolution/fps, loss, codec. */
export function StatsHud() {
  const tel = useStore((s) => s.telemetry);
  const rows: [MessageKey, string][] = [
    ['hud.route', tel ? t(ROUTE[tel.route]) + (tel.ipv6 ? ' · IPv6' : '') : dash],
    ['hud.rtt', tel?.rttMs != null ? `${num.format(tel.rttMs)} ms` : dash],
    ['hud.down', tel?.kbpsIn != null ? `${num.format(tel.kbpsIn)} kbps` : dash],
    ['hud.up', tel?.kbpsOut != null ? `${num.format(tel.kbpsOut)} kbps` : dash],
    [
      'hud.video',
      tel?.video
        ? `${tel.video.width}×${tel.video.height}${tel.video.fps != null ? ` @ ${num.format(tel.video.fps)}` : ''}`
        : dash,
    ],
    ['hud.loss', tel?.lossPct != null ? `${tel.lossPct.toFixed(1)} %` : dash],
    ['hud.codec', tel?.codec ?? dash],
  ];
  return (
    <dl
      data-testid="stats-hud"
      aria-label={t('hud.title')}
      className="pointer-events-none absolute left-3 top-16 z-10 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 rounded-xl bg-black/60 p-3 text-xs text-slate-100 backdrop-blur"
    >
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-slate-300">{t(key)}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const QUALITY: Record<string, string> = {
  good: 'bg-emerald-400',
  fair: 'bg-amber-400',
  poor: 'bg-red-500',
  unknown: 'bg-slate-500',
};

export function QualityDot() {
  const q = useStore((s) => s.telemetry?.quality ?? 'unknown');
  const key: MessageKey = `quality.${q}`;
  return (
    <span
      className="flex items-center gap-1.5"
      role="img"
      aria-label={t(key)}
      data-testid="quality-dot"
      data-quality={q}
    >
      <span aria-hidden="true" className={`h-3 w-3 rounded-full ${QUALITY[q]}`} />
      <span className="text-sm">{t(key)}</span>
    </span>
  );
}
