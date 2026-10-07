import { test, expect, mock } from 'claude-code/testing'

const band = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { top: 0, bodyRows: 10, totalRows: 3 },
      view: {},
    },
  }) as any

// The rows of the band: full-width row Boxes under the root Box.
async function rows(ui: any) {
  const boxes = await ui.findAll({ type: 'Box' })
  return boxes.filter((b: any) => b.props.width === '100%' && b.props.flexDirection === 'row')
}

// The groups of pills: row Boxes with no width of their own, by pill count.
async function groupSizes(ui: any) {
  const boxes = await ui.findAll({ type: 'Box' })
  return boxes
    .filter((b: any) => b.props.width === undefined && b.props.flexDirection === 'row' && b.props.backgroundColor === undefined)
    .map((b: any) => b.children.length)
}

test('pills: order, used percent, red when high, one to five lines', async ($, on) => {
  const start = Date.UTC(2026, 9, 7, 12, 0, 0)
  mock.clock(on, { now: start })
  const at = (h: number) => new Date(start + h * 3_600_000).toISOString()

  // The engine core answers these in a real session; the test stands in for it.
  let tokens = 0
  const usage = () => ({
    startedAt: start,
    context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 38, resetsAt: at(2.25) },
      { kind: 'seven_day', percentUsed: 85, resetsAt: at(80) },
    ],
    cost: { usd: 0.14 },
  })
  on('session.usage', async () => ({ value: usage() }) as any)
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('turn.complete', async () => ({ text: '' }))

  for (const [i, t] of [20_000, 46_000, 50_000].entries()) {
    tokens = t
    await $.turn.complete({
      answer: 'ok',
      durationMs: 1000,
      isAborted: false,
      turnId: `turn-${i}`,
      reason: 'answer',
    })
  }

  // Desktop, wide: all five pills on one line, in the asked order.
  const wide = await $.ui.mount({ plugin: 'token-weather-limits', surface: 'desktop', ...band(240) })
  const alts = (await wide.findAll({ type: 'Svg' })).map((s) => String(s.props.alt))
  expect(alts).toEqual([
    'Cloudy, ▲ +4k last turn',
    'Context 25% used, 50k/200k',
    '50k tokens, $0.14',
    '5h limit 38% used, resets in 2h 15m',
    '7d limit 85% used, resets in 3d 8h',
  ])
  // A limit pill is red (#dc2626 badge) at 80% used or more: 7d at 85% is, 5h at 38% is not.
  const sources = (await wide.findAll({ type: 'Svg' })).map((s) => String(s.props.source))
  expect(sources[4]).toContain('#dc2626')
  expect(sources[3]).not.toContain('#dc2626')
  // The gradient id is made from the label.
  expect(sources[3]).toContain('id="g5h"')

  // One line: the context group at the left, the limit group at the right.
  const wideRows = await rows(wide)
  expect(wideRows).toHaveLength(1)
  expect(wideRows[0].props.justifyContent).toBe('space-between')
  expect(await groupSizes(wide)).toEqual([3, 2])
  await wide.unmount()

  // Desktop, narrower and narrower: each group starts a new line and fills
  // lines from the left, down to one pill a line. Pill widths at F = 11 are
  // 245, 212, 143 (context) and 195, 185 (limits) px; a cell is 8.6 px.
  for (const [columns, sizes] of [
    [100, [3, 2]],
    [62, [2, 1, 2]],
    [40, [1, 1, 1, 1, 1]],
  ] as const) {
    const ui = await $.ui.mount({ plugin: 'token-weather-limits', surface: 'desktop', ...band(columns) })
    const lineRows = await rows(ui)
    expect(await groupSizes(ui)).toEqual([...sizes])
    expect(lineRows.every((r: any) => r.props.justifyContent === 'flex-start')).toBe(true)
    await ui.unmount()
  }

  // Terminal: the same split, measured in cells.
  const termWide = await $.ui.mount({ plugin: 'token-weather-limits', surface: 'terminal', ...band(170) })
  const termWideRows = await rows(termWide)
  expect(termWideRows).toHaveLength(1)
  expect(termWideRows[0].props.justifyContent).toBe('space-between')
  expect(await groupSizes(termWide)).toEqual([3, 2])
  expect(await termWide.find({ type: 'Text', text: /38%/ })).toBeDefined()
  expect(await termWide.find({ type: 'Text', text: /85%/ })).toBeDefined()
  expect(await termWide.find({ type: 'Text', text: /Cloudy/ })).toBeDefined()
  await termWide.unmount()
  const termNarrow = await $.ui.mount({ plugin: 'token-weather-limits', surface: 'terminal', ...band(100) })
  const termRows = await rows(termNarrow)
  expect(termRows).toHaveLength(2)
  expect(termRows.map((r: any) => r.props.justifyContent)).toEqual(['flex-start', 'flex-start'])
  await termNarrow.unmount()
})
