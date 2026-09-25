/* Lightweight SVG charts — no dependency, GPU-safe (transform/opacity only). */

function buildPath(values, w, h, pad = 3) {
  if (!values || values.length === 0) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

/* Mini trend line (sparkline) for cards — reference uses 90x24 polylines. */
export function Sparkline({ values, color = '#C47F3D', width = 88, height = 26, dash = null }) {
  if (!values || values.length < 2) return null
  const d = buildPath(values, width, height, 3)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
      />
    </svg>
  )
}

/* Full trend chart: actual (solid) + forecast (dashed) + threshold (dotted).
   values = [{ label, actual|null, forecast|null }], threshold numeric or null. */
export function TrendChart({ data, threshold = null, width = 600, height = 200, pad = { t: 14, r: 10, b: 22, l: 6 } }) {
  if (!data || data.length === 0) return null

  const actuals = data.map((d) => d.actual)
  const forecasts = data.map((d) => d.forecast)
  const allNums = [...actuals.filter((v) => v != null), ...forecasts.filter((v) => v != null), threshold]
  const max = Math.max(...allNums, 1)
  const min = Math.min(...allNums, 0)
  const span = max - min || 1
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const step = innerW / (data.length - 1)

  const xOf = (i) => pad.l + i * step
  const yOf = (v) => pad.t + innerH - ((v - min) / span) * innerH

  const pts = (vals) => vals
    .map((v, i) => (v == null ? null : `${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`))
    .filter(Boolean)
    .join(' ')

  const gridYs = [0.25, 0.5, 0.75].map((f) => pad.t + innerH * f)
  const labels = Math.min(data.length, 7)

  return (
    <svg role="img" viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      {/* grid */}
      {gridYs.map((y, i) => (
        <line key={i} x1={pad.l} x2={width - pad.r} y1={y} y2={y} className="cc-guide" />
      ))}
      {/* x labels */}
      {data.map((d, i) =>
        i % Math.ceil(data.length / labels) === 0 || i === data.length - 1 ? (
          <text key={i} x={xOf(i)} y={height - 6} textAnchor="middle" fontSize="9" fill="#B5AA96">
            {d.label}
          </text>
        ) : null
      )}
      {/* threshold */}
      {threshold != null && (
        <line
          x1={pad.l} x2={width - pad.r} y1={yOf(threshold)} y2={yOf(threshold)}
          stroke="#C0504D" strokeWidth="1" strokeDasharray="3 3"
        />
      )}
      {/* forecast */}
      <polyline points={pts(forecasts)} fill="none" stroke="#C7A876" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
      {/* actual */}
      <polyline points={pts(actuals)} fill="none" stroke="#BC7A3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* Status pill — matches the reference ANGALIA / HATARINI / SALAMA chips. */
const STATUS_STYLES = {
  watch: 'bg-[#FAEEDA] text-[#854F0B]',
  danger: 'bg-[#FCEBEB] text-[#A32D2D]',
  safe: 'bg-[#EAF3DE] text-[#3B6D11]',
  neutral: 'bg-espresso/[0.05] text-espresso-muted',
  copper: 'bg-copper/[0.1] text-copper-deep',
}

export function StatusPill({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] ${STATUS_STYLES[tone]} ${className}`}>
      {children}
    </span>
  )
}

/* Style map helper to translate forecast states to pills. */
export function pillToneFor(hali, daysLeft) {
  if (hali === 'imeisha' || daysLeft <= 2) return 'danger'
  if (daysLeft <= 7) return 'watch'
  return 'safe'
}

export function pillLabelFor(hali, daysLeft) {
  if (hali === 'imeisha') return 'Imeisha'
  if (daysLeft <= 2) return 'Hatari'
  if (daysLeft <= 7) return 'Angalia'
  return 'Salama'
}