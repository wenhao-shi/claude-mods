// Based on Token Weather, Copyright 2026 Anthropic PBC, Apache-2.0.
// Changed in 2026 by wenhao-shi: neon SVG pills, 5h and 7d limits, cost,
// and the line layout. See README.md for the full list of changes.
//
// Token Weather + limits: one band above the prompt, drawn as round pills
//   weather  the original forecast: icon and word, last-turns chart, trend
//   CTX      context window used: badge on a track, then tokens / window
//   cost     tokens in context and the session cost in US dollars
//   5h       5-hour limit used: badge on a track, then time to reset
//   7d       7-day (weekly) limit used, the same way
//
// The pills form two groups, each with a fixed gap: context (weather, CTX, cost)
// and limits (5h, 7d). When all five fit on one line, the context group sits
// at the left and the limit group at the right. Otherwise each group starts a
// new line and fills lines from the left: two lines, or up to five when narrow.
//
// A limit pill turns red at 80% used; the CTX pill at 90% used.
//
// The desktop app draws each pill as an SVG (round shapes need vector drawing).
// The terminal draws the same pills as coloured text.
//
// Figures come from $.session.usage(), the same source as the status line.
// Limits exist only on a subscription, after the first response.

import type { Register } from 'claude-code'

type Reading = { tokens: number; window: number; percent: number }
type Limit = { kind: string; percentUsed: number; resetsAt?: string }

type Accent = { badge: string; edge: string; track: string; text: string }
type MeterPill = {
  kind: 'meter'
  label: string
  fraction: number
  value: string
  tail: string
  accent: Accent
}
type WeatherPill = {
  kind: 'weather'
  icon: string
  word: string
  color: string
  chart: number[]
  trend: string
}
type CostPill = { kind: 'cost'; tokens: string; usd: string }
type Pill = MeterPill | WeatherPill | CostPill
// A drawn pill and its width: cells on the terminal, CSS pixels elsewhere.
type Drawn = { el: unknown; width: number }

const HISTORY = 12
const BARS = '▁▂▃▄▅▆▇█'

// Forecast bands, by percent of the context window used (unchanged from Token Weather).
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Clear', color: '#facc15' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: '#22d3ee' },
  { upTo: 75, icon: '☂', word: 'Showers', color: '#60a5fa' },
  { upTo: 90, icon: '☇', word: 'Storm', color: '#e879f9' },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: '#f87171' },
]

const BLUE: Accent = { badge: '#2563eb', edge: '#60a5fa', track: '#3b82f6', text: '#60a5fa' }
const PURPLE: Accent = { badge: '#7c3aed', edge: '#a78bfa', track: '#8b5cf6', text: '#a78bfa' }
const TEAL: Accent = { badge: '#0d9488', edge: '#2dd4bf', track: '#14b8a6', text: '#2dd4bf' }
const RED: Accent = { badge: '#dc2626', edge: '#f87171', track: '#ef4444', text: '#f87171' }

const WINDOWS = [
  { kind: 'five_hour', label: '5h', accent: BLUE },
  { kind: 'seven_day', label: '7d', accent: PURPLE },
]

let readings: Reading[] = []
let limits: Limit[] = []
let costUsd: number | undefined
let stopTimer: (() => void) | undefined

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    readings = []
    await takeReading($)
    // Redraw once a minute so "~2h 15m" stays true between turns.
    stopTimer?.()
    stopTimer = $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) {
      return result
    }
    await takeReading($)
    return result
  })

  // Fires when a limit window moves a whole point or the cost grows.
  on('session.measure', async ($, e, next) => {
    limits = e.rateLimits ?? []
    costUsd = e.cost?.usd ?? costUsd
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (readings.length === 0 && limits.length === 0)) {
      return next(e)
    }
    const { first, second } = buildPills(await $.clock.now())
    const els: any = $.ui.resolve(e)
    // resolve() names every element on every surface; one a surface cannot draw
    // is an empty fragment, so pick by surface. Only the terminal lacks Svg.
    const isTerminal = e.surface === 'terminal'
    const draw = (p: Pill): Drawn =>
      isTerminal ? textPill(els.Box, els.Text, p) : svgPill(els.Svg, p)
    const top = first.map(draw)
    const bottom = second.map(draw)

    // One line when every pill fits, else two lines.
    // Widths are cells on the terminal and CSS pixels on the other surfaces.
    // The gap is fixed: one cell on the terminal; on the other surfaces each SVG
    // carries a margin of M on both sides, so pills sit 2 * M px apart with no gap.
    const all = [...top, ...bottom]
    const columns = (e.props.bodyColumns ?? 80) - 2
    const room = isTerminal ? columns : columns * CELL_PX
    const gap = isTerminal ? 1 : 0
    const need = all.reduce((sum, d) => sum + d.width, 0) + gap * all.length
    const isOneLine = need <= room

    // A group: pills side by side with the fixed gap.
    const group = (line: Drawn[]) =>
      els.Box({ flexDirection: 'row', gap, children: line.map((d) => d.el) })
    // A row: the full width of the band.
    const row = (justifyContent: string, children: unknown[]) =>
      els.Box({ flexDirection: 'row', flexWrap: 'wrap', justifyContent, gap, width: '100%', children })

    // One line: the context group at the left, the limit group at the right.
    // Otherwise each group starts a new line and fills lines from the left, so a
    // narrow band takes up to five lines, one pill each.
    const rows = isOneLine
      ? [row('space-between', [top, bottom].filter((g) => g.length > 0).map(group))]
      : [...pack(top, room, gap), ...pack(bottom, room, gap)].map((line) => row('flex-start', [group(line)]))
    return els.Box({ flexDirection: 'column', width: '100%', paddingX: 1, children: rows })
  })
}

// Puts pills on lines in order. A pill that does not fit starts a new line;
// a pill wider than the room still gets a line of its own.
function pack(pills: Drawn[], room: number, gap: number): Drawn[][] {
  const lines: Drawn[][] = []
  let line: Drawn[] = []
  let used = 0
  for (const d of pills) {
    const add = line.length > 0 ? gap + d.width : d.width
    if (line.length > 0 && used + add > room) {
      lines.push(line)
      line = [d]
      used = d.width
    } else {
      line.push(d)
      used += add
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

async function takeReading($: any) {
  try {
    const usage = await $.session.usage()
    limits = usage.rateLimits ?? limits
    costUsd = usage.cost?.usd ?? costUsd
    const { context } = usage
    if (context && context.window) {
      const tokens = context.tokens ?? 0
      const percent = Math.round(context.percent ?? (tokens / context.window) * 100)
      // The session.start reading is 0 before any response; drop it once real readings arrive.
      readings = readings.filter((r) => r.tokens > 0)
      readings.push({ tokens, window: context.window, percent })
      if (readings.length > HISTORY) {
        readings = readings.slice(-HISTORY)
      }
    }
    $.ui.invalidate('ui.render')
  } catch {
    // No reading this turn; the band keeps the last one.
  }
}

// ---------------------------------------------------------------- pill data

// Order: weather, CTX, tokens on the first line; 5h, 7d after them, or on a
// second line when one line is too narrow.
function buildPills(now: number): { first: Pill[]; second: Pill[] } {
  const first: Pill[] = []
  const second: Pill[] = []
  const last = readings[readings.length - 1]
  if (last) {
    const f = forecastFor(last.percent)
    first.push({
      kind: 'weather',
      icon: f.icon,
      word: f.word,
      color: f.color,
      chart: readings.map((r) => r.tokens),
      trend: trendWord(),
    })
    first.push({
      kind: 'meter',
      label: 'CTX',
      fraction: last.percent / 100,
      value: `${last.percent}%`,
      tail: `${short(last.tokens)}/${short(last.window)}`,
      accent: last.percent >= 90 ? RED : TEAL,
    })
    if (costUsd !== undefined) {
      first.push({ kind: 'cost', tokens: short(last.tokens), usd: `$${costUsd.toFixed(2)}` })
    }
  }
  for (const w of WINDOWS) {
    const limit = limits.find((l) => l.kind === w.kind)
    if (!limit) continue
    const used = clamp(Math.round(limit.percentUsed), 0, 100)
    second.push({
      kind: 'meter',
      label: w.label,
      fraction: used / 100,
      value: `${used}%`,
      tail: untilReset(limit.resetsAt, now),
      accent: used >= 80 ? RED : w.accent,
    })
  }
  return { first, second }
}

function altText(p: Pill) {
  if (p.kind === 'meter') {
    return p.label === 'CTX'
      ? `Context ${p.value} used, ${p.tail}`
      : `${p.label} limit ${p.value} used, resets in ${p.tail.replace('~', '')}`
  }
  if (p.kind === 'weather') {
    return `${p.word}${p.trend ? `, ${p.trend}` : ''}`
  }
  return `${p.tokens} tokens, ${p.usd}`
}

// ---------------------------------------------------------------- desktop: SVG

// The band's width arrives in cells of the app's code font. CELL_PX converts
// it to CSS pixels. Measured in the desktop app at 100% scale: 159 cells for a
// band about 1500 px wide, so 8.6 to 9.5 px a cell. The low end is used, so a
// close fit takes two lines instead of one line that wraps.
const CELL_PX = 8.6
const FONT = `'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif`
const PILL_FILL = '#0e1014'
const PILL_EDGE = '#262a33'
const LABEL = '#8b93a1'
const MUTED = '#9ca3af'

// F is the text size, in CSS pixels. (14.5 px Segoe UI gives digits 11 px high,
// the same as the app's own "Opus 5.5 Extra" text.) Every other size scales
// from F with K, so a change of F resizes the whole pill. The glow does not scale.
const F = 11
const K = F / 10.5
const px = (n: number) => +(n * K).toFixed(2)

const F_LABEL = F
const F_BADGE = F - 1
const F_TAIL = F
const F_WORD = F
const F_ICON = F + 1
const F_SMALL = F

const H = Math.round(px(24))
const PAD = Math.round(px(10))
const TRACK = Math.round(px(84))

// The text baseline that centres a font size on the pill's middle line.
const base = (size: number) => +(H / 2 + size * 0.35).toFixed(2)

// Neon: a bright core over a soft halo of its own colour. The halo is a blur at
// reduced alpha, so it glows without glare. M leaves room for the outer halo,
// and two M make the fixed gap between pills.
const M = 5
const NEON_DEFS =
  `<defs>` +
  // halo: badge and filled track
  `<filter id="halo" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="2.4" result="b"/>` +
  `<feComponentTransfer in="b" result="h"><feFuncA type="linear" slope="0.55"/></feComponentTransfer>` +
  `<feMerge><feMergeNode in="h"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
  // soft: coloured text
  `<filter id="soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="1.3" result="b"/>` +
  `<feComponentTransfer in="b" result="h"><feFuncA type="linear" slope="0.45"/></feComponentTransfer>` +
  `<feMerge><feMergeNode in="h"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
  // edge: the tube around the pill
  `<filter id="edge" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>` +
  `</defs>`

function svgPill(Svg: any, p: Pill) {
  const { width, body } =
    p.kind === 'meter' ? meterSvg(p) : p.kind === 'weather' ? weatherSvg(p) : costSvg(p)
  const glow = p.kind === 'meter' ? p.accent.edge : p.kind === 'weather' ? p.color : '#fb923c'
  const w = width + 2 * M
  const h = H + 2 * M
  const r = (H - 1) / 2
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">` +
    NEON_DEFS +
    `<g transform="translate(${M} ${M})">` +
    // outer halo, then the dark pill, then a thin tinted tube on its edge
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${H - 1}" rx="${r}" fill="none" stroke="${glow}" stroke-width="2" stroke-opacity="0.32" filter="url(#edge)"/>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${H - 1}" rx="${r}" fill="${PILL_FILL}"/>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${H - 1}" rx="${r}" fill="none" stroke="${PILL_EDGE}"/>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${H - 1}" rx="${r}" fill="none" stroke="${glow}" stroke-opacity="0.28"/>` +
    body +
    `</g></svg>`
  return { el: Svg({ source, alt: altText(p), width: w, height: h }), width: w }
}

// LABEL ──(badge)────── tail, with the track filled up to the badge.
function meterSvg(p: MeterPill) {
  const a = p.accent
  let x = PAD
  const label = svgText(x, base(F_LABEL), p.label, { size: F_LABEL, weight: 700, fill: LABEL, spacing: px(1.1) })
  x += textWidth(p.label, F_LABEL, px(1.1)) + px(8)

  // Badge: a bolt, then the value, in a round box on the track.
  const t0 = +x.toFixed(2)
  const badgeH = Math.round(px(15))
  const boltW = px(5.6)
  const badgeW = Math.ceil(px(6) + boltW + px(3) + textWidth(p.value, F_BADGE) + px(7))
  const cx = clamp(t0 + p.fraction * TRACK, t0 + badgeW / 2, t0 + TRACK - badgeW / 2)
  const bx = +(cx - badgeW / 2).toFixed(2)
  const by = (H - badgeH) / 2
  const trackH = px(3)
  const ty = +(H / 2 - trackH / 2).toFixed(2)
  // An SVG id has letters and digits only: '5h' gives 'g5h'.
  const id = `g${p.label.replace(/[^A-Za-z0-9]/g, '')}`
  const track =
    `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${a.track}" stop-opacity="0.25"/><stop offset="1" stop-color="${a.track}"/></linearGradient></defs>` +
    `<rect x="${t0}" y="${ty}" width="${TRACK}" height="${trackH}" rx="${trackH / 2}" fill="#2a2e37"/>` +
    `<rect x="${t0}" y="${ty}" width="${Math.max(0, +(cx - t0).toFixed(2))}" height="${trackH}" rx="${trackH / 2}" fill="url(#${id})" filter="url(#halo)"/>` +
    `<g filter="url(#halo)">` +
    `<rect x="${bx}" y="${by}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="${a.badge}" fill-opacity="0.88" stroke="${a.edge}" stroke-opacity="0.8"/>` +
    bolt(bx + px(6), H / 2 - px(4), '#ffffff') +
    svgText(+(bx + px(6) + boltW + px(3)).toFixed(2), base(F_BADGE), p.value, { size: F_BADGE, weight: 700, fill: '#ffffff' }) +
    `</g>`
  x = t0 + TRACK + px(8)

  const tail = svgText(+x.toFixed(2), base(F_TAIL), p.tail, { size: F_TAIL, weight: 600, fill: a.text, glow: true })
  x += textWidth(p.tail, F_TAIL) + PAD
  return { width: Math.ceil(x), body: label + track + tail }
}

// ☀ Clear  last turns ▂▃▅▇  ▲ +4k last turn
function weatherSvg(p: WeatherPill) {
  let x = PAD
  let body = svgText(x, base(F_ICON), p.icon, { size: F_ICON, weight: 400, fill: p.color, glow: true })
  x += px(14)
  body += svgText(+x.toFixed(2), base(F_WORD), p.word, { size: F_WORD, weight: 700, fill: p.color, glow: true })
  x += textWidth(p.word, F_WORD) + px(8)
  body += svgText(+x.toFixed(2), base(F_SMALL), 'last turns', { size: F_SMALL, weight: 500, fill: LABEL })
  x += textWidth('last turns', F_SMALL) + px(6)

  // Bars every `step` px, up to `tall` px high, on a floor below the middle line.
  const top = Math.max(...p.chart, 1)
  const step = px(5)
  const barW = px(3)
  const tall = px(10)
  const floor = +(H / 2 + px(5)).toFixed(2)
  body += `<g filter="url(#halo)">`
  p.chart.forEach((tokens, i) => {
    const h = Math.max(2, Math.round((tokens / top) * tall))
    const isLast = i === p.chart.length - 1
    body += `<rect x="${+(x + i * step).toFixed(2)}" y="${+(floor - h).toFixed(2)}" width="${barW}" height="${h}" rx="0.8" fill="${p.color}" fill-opacity="${isLast ? 1 : 0.45}"/>`
  })
  body += `</g>`
  x += p.chart.length * step + px(5)

  if (p.trend) {
    body += svgText(+x.toFixed(2), base(F_SMALL), p.trend, { size: F_SMALL, weight: 500, fill: MUTED })
    x += textWidth(p.trend, F_SMALL)
  }
  return { width: Math.ceil(x + PAD), body }
}

// (flame) 61k tokens · $0.14
function costSvg(p: CostPill) {
  let x = PAD
  let body = `<g filter="url(#halo)">${flame(x, H / 2 - px(5.4), '#fb923c')}</g>`
  x += px(12)
  body += svgText(+x.toFixed(2), base(F_TAIL), p.tokens, { size: F_TAIL, weight: 700, fill: '#f3f4f6' })
  x += textWidth(p.tokens, F_TAIL) + px(4)
  body += svgText(+x.toFixed(2), base(F_SMALL), 'tokens', { size: F_SMALL, weight: 400, fill: MUTED })
  x += textWidth('tokens', F_SMALL) + px(5)
  body += svgText(+x.toFixed(2), base(F_TAIL), '·', { size: F_TAIL, weight: 700, fill: '#4b5563' })
  x += px(7)
  body += svgText(+x.toFixed(2), base(F_TAIL), p.usd, { size: F_TAIL, weight: 700, fill: '#4ade80', glow: true })
  x += textWidth(p.usd, F_TAIL)
  return { width: Math.ceil(x + PAD), body }
}

// A lightning bolt, 7 x 10 px before scaling.
function bolt(x: number, y: number, fill: string) {
  return `<path transform="translate(${+x.toFixed(2)} ${+y.toFixed(2)}) scale(${px(0.8)})" d="M4.6 0 L0 6 H3.1 L2.3 10 L7 3.7 H3.8 Z" fill="${fill}"/>`
}

// A flame, 9.5 x 13.5 px before scaling.
function flame(x: number, y: number, fill: string) {
  const t = `translate(${x} ${+y.toFixed(2)}) scale(${px(0.8)})`
  return (
    `<path transform="${t}" d="M5.5 0 C6 3 9.5 4.5 9.5 8.5 C9.5 11.3 7.6 13.5 5 13.5 C2.4 13.5 0.5 11.4 0.5 8.8 C0.5 6.6 1.8 5.3 2.8 4.2 C3 5.6 3.6 6.4 4.4 6.8 C4 4.2 4.6 1.8 5.5 0 Z" fill="${fill}"/>` +
    `<path transform="${t}" d="M5 13.5 C3.6 13.5 2.8 12.4 2.8 11.2 C2.8 9.8 4 9 4.6 7.9 C5.2 9.2 7.2 9.9 7.2 11.4 C7.2 12.6 6.2 13.5 5 13.5 Z" fill="#fde68a" fill-opacity="0.85"/>`
  )
}

function svgText(
  x: number,
  y: number,
  s: string,
  o: { size: number; weight: number; fill: string; spacing?: number; glow?: boolean },
) {
  const spacing = o.spacing ? ` letter-spacing="${o.spacing}"` : ''
  const glow = o.glow ? ` filter="url(#soft)"` : ''
  return `<text x="${x}" y="${y}" font-size="${o.size}" font-weight="${o.weight}" fill="${o.fill}"${spacing}${glow}>${esc(s)}</text>`
}

// An estimate of the drawn width of `s` in Segoe UI. The pills size from it,
// so the estimate leans wide rather than letting text run past the edge.
function textWidth(s: string, size: number, spacing = 0) {
  let em = 0
  for (const ch of s) {
    if (/[0-9]/.test(ch)) em += 0.57
    else if (/[MW%]/.test(ch)) em += 0.86
    else if (/[A-Z]/.test(ch)) em += 0.64
    else if (/[mw]/.test(ch)) em += 0.82
    else if (/[iljtfr]/.test(ch)) em += 0.33
    else if (/[a-z]/.test(ch)) em += 0.54
    else if (ch === ' ') em += 0.27
    else if (/[.,:·]/.test(ch)) em += 0.27
    else if (/[~+$/]/.test(ch)) em += 0.58
    else em += 0.95
  }
  return em * size * 1.04 + spacing * [...s].length
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------- terminal: text

const T_BG = '#14171d'
const T_DIM = '#6b7280'
const T_BAR = 8

// One piece of a terminal pill: its text and its Text props.
type Piece = [string, Record<string, unknown>]

function textPill(Box: any, Text: any, p: Pill): Drawn {
  const pieces: Piece[] =
    p.kind === 'meter'
      ? meterPieces(p)
      : p.kind === 'weather'
        ? [
            [`${p.icon}  ${p.word}`, { color: p.color, bold: true }],
            ['  last turns ', { color: T_DIM }],
            [chartText(p.chart), { color: p.color }],
            ...(p.trend ? [[`  ${p.trend}`, { color: T_DIM }] as Piece] : []),
          ]
        : [
            ['◆ ', { color: '#fb923c' }],
            [p.tokens, { bold: true, color: '#f3f4f6' }],
            [' tokens · ', { color: T_DIM }],
            [p.usd, { bold: true, color: '#4ade80' }],
          ]
  const children = pieces.map(([s, o]) => Text({ ...o, children: s }))
  // Cells: the text of every piece, plus one cell of padding at each end.
  const width = pieces.reduce((sum, [s]) => sum + [...s].length, 0) + 2
  return { el: Box({ flexDirection: 'row', paddingX: 1, backgroundColor: T_BG, children }), width }
}

function meterPieces(p: MeterPill): Piece[] {
  const filled = clamp(Math.round(p.fraction * T_BAR), 0, T_BAR)
  return [
    [`${p.label} `, { color: T_DIM, bold: true }],
    ['━'.repeat(filled), { color: p.accent.track }],
    [` ϟ ${p.value} `, { color: '#ffffff', backgroundColor: p.accent.badge, bold: true }],
    ['─'.repeat(T_BAR - filled), { color: T_DIM }],
    [` ${p.tail}`, { color: p.accent.text, bold: true }],
  ]
}

// ---------------------------------------------------------------- shared

function forecastFor(percent: number) {
  return FORECAST.find((band) => percent < band.upTo) ?? FORECAST[FORECAST.length - 1]
}

// Bars scale to the busiest reading shown, so growth shows at any fill level.
function chartText(chart: number[]) {
  const top = Math.max(...chart, 1)
  return chart
    .map((t) => BARS[Math.min(BARS.length - 1, Math.floor((t / top) * (BARS.length - 1)))])
    .join('')
}

function trendWord() {
  if (readings.length < 2) {
    return ''
  }
  const delta = readings[readings.length - 1].tokens - readings[readings.length - 2].tokens
  if (delta > 0) return `▲ +${short(delta)} last turn`
  if (delta < 0) return `▼ ${short(-delta)} last turn`
  return 'steady'
}

// "~2h 15m", "~3d 8h", or "~now" once the reset time has passed.
function untilReset(resetsAt: string | undefined, now: number) {
  if (!resetsAt) {
    return '~?'
  }
  const ms = new Date(resetsAt).getTime() - now
  if (Number.isNaN(ms)) {
    return '~?'
  }
  if (ms <= 0) {
    return '~now'
  }
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `~${days}d ${hours}h`
  if (hours > 0) return `~${hours}h ${mins}m`
  return `~${mins}m`
}

function short(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return String(n)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}
