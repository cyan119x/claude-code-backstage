import { atom, read, update } from 'claude-code'
import type { AgentStatus, BackgroundTaskSummary, EngineInterface, Register, RenderElement } from 'claude-code'

import type { BackstageItem, BackstageKind, BackstageStatus } from '../types'
import { barSvg, mascotSize, mascotSvg, TASK_BLUE, tileSvg } from './art'
import { FRAME_W } from './sprites'

const PANE = 'backstage'
// Change the tag when an item's fields change: it declines what an earlier version stored.
const items = atom({ plugin: 'backstage', key: 'items' } as const, [], { shape: 'items-1' })
const clock = atom({ plugin: 'backstage', key: 'now' } as const, 0)
// True shows every finished item; false the newest few.
const showDone = atom({ plugin: 'backstage', key: 'showDone' } as const, false)
const openRow = atom({ plugin: 'backstage', key: 'open' } as const, null)
const ticker = atom({ plugin: 'backstage', key: 'ticker' } as const, '')
const dismissed = atom({ plugin: 'backstage', key: 'dismissed' } as const, false)

/** How long the line stays after the last piece of work ended. */
const LINGER_MS = 30_000
/** Ended items the pane keeps. */
const KEEP_ENDED = 12
/** Mascots the line above the prompt shows before "+N". */
const PARADE = 5
/** Past this many active items the pane draws one line each. */
const COMPACT_AFTER = 4
/** Finished items the pane shows until "Show all". */
const ENDED_SHOWN = 5
/** The mascot's scale in the pane: a 44 x 30 frame drawn at about 53 x 36. */
const ROW_SCALE = 1.2

// ---------- band-stack: one order for every mod's card above the prompt ----------
// Each mod that keeps it opens a stack another mod built (a Box keyed `band-stack`), adds its own keyed card, and sorts
// by rank, so the order holds whichever way the app nests the hooks. Pieces it does not know rank in the middle.
const STACK = 'band-stack'
const RANK: Record<string, number> = { handoff: 10, backstage: 20, ember: 90 }
const UNKNOWN_RANK = 50

type StackNode = { type?: unknown; props?: { key?: unknown }; children?: unknown }

export function stackPieces(rest: unknown): unknown[] {
  if (rest === null || rest === undefined || rest === false) return []
  const node = rest as StackNode
  if (typeof rest === 'object' && node.type === 'Box' && node.props?.key === STACK && Array.isArray(node.children)) return node.children
  return [rest]
}

export function rankOf(piece: unknown): number {
  const key = typeof piece === 'object' && piece !== null ? (piece as StackNode).props?.key : undefined
  return typeof key === 'string' ? (RANK[key] ?? UNKNOWN_RANK) : UNKNOWN_RANK
}

const LABEL: Record<BackstageStatus, string> = { running: 'Running', waiting: 'Waiting', done: 'Done', failed: 'Failed', stopped: 'Stopped' }
const COLOR: Record<BackstageStatus, string> = { running: 'suggestion', waiting: 'warning', done: 'success', failed: 'error', stopped: 'inactive' }

export const isActive = (i: BackstageItem) => i.status === 'running' || i.status === 'waiting'

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`
}

export const clip = (text: string, n: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** A subagent's tool call in a few words: the tool, then what it works on. */
export function brief(call: Record<string, unknown>): string {
  const pick = (k: string) => (typeof call[k] === 'string' && call[k] !== '' ? (call[k] as string) : undefined)
  const path = pick('file_path') ?? pick('notebook_path')
  const target = (path ? path.split('/').pop() : undefined) ?? pick('pattern') ?? pick('command') ?? pick('url') ?? pick('query') ?? pick('description') ?? pick('path') ?? pick('prompt') ?? ''
  return clip(`${String(call.tool)}  ${target}`, 60)
}

export function summaryOf(list: BackstageItem[]): string {
  const running = list.filter(i => i.status === 'running').length
  const waiting = list.filter(i => i.status === 'waiting').length
  const parts = [running ? `${running} running` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'All finished'
}

/** Every active item, then the newest ended ones; newest first in each. */
function prune(list: BackstageItem[]): BackstageItem[] {
  const active = list.filter(isActive)
  const ended = list.filter(i => !isActive(i)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, KEEP_ENDED)
  return [...active, ...ended].sort((a, b) => b.startedAt - a.startedAt)
}

const lastEnded = (list: BackstageItem[]) => list.reduce((at, i) => Math.max(at, i.endedAt ?? 0), 0)

/** What an agent's own status says, in the line's words. */
export function statusOfAgent(status: AgentStatus): BackstageStatus {
  if (status === 'waiting' || status === 'idle') return 'waiting'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'
  return 'running'
}

export type TaskNote = { id: string; status?: string; summary?: string; exitCode?: number }

/** The task notifications a prompt carries (one or several). */
export function parseNotes(text: string): TaskNote[] {
  const blocks = text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? []
  return blocks.flatMap(block => {
    const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim()
    const id = tag('task-id')
    if (!id) return []
    const summary = tag('summary')
    const code = /exit code (\d+)/i.exec(summary ?? '')?.[1]
    return [{ id, status: tag('status'), summary, exitCode: code === undefined ? undefined : Number(code) }]
  })
}

/** How a notification ends an item, or undefined while the task goes on (a monitor's event). */
export function endingOf(note: TaskNote, kind: BackstageKind): { status: BackstageStatus; step: string } | undefined {
  const status = (note.status ?? '').toLowerCase()
  if (status === 'completed') {
    if (note.exitCode !== undefined && note.exitCode !== 0) return { status: 'failed', step: `Exited with code ${note.exitCode}` }
    if (note.exitCode !== undefined) return { status: 'done', step: 'Exited with code 0' }
    return { status: 'done', step: kind === 'agent' ? 'Answer ready' : 'Completed' }
  }
  if (status === 'failed') return { status: 'failed', step: note.exitCode !== undefined ? `Exited with code ${note.exitCode}` : 'Failed' }
  if (status === 'killed' || status === 'stopped') return { status: 'stopped', step: 'Stopped' }
  return undefined
}

async function change($: EngineInterface, id: string, fn: (current: BackstageItem | undefined) => BackstageItem | undefined) {
  let changed: BackstageItem | undefined
  await update($, items, list => {
    const current = list.find(i => i.id === id)
    changed = fn(current)
    if (!changed) return list
    const one = changed
    return prune(current ? list.map(i => (i.id === id ? one : i)) : [one, ...list])
  })
  return changed
}

/** A new piece of work: listed, announced, and the pane opened unless the person closed it while work ran. */
async function add($: EngineInterface, item: BackstageItem) {
  await change($, item.id, current => current ?? item)
  await update($, ticker, () => `${item.title} started`)
  ensureTick($)
  if (!(await read($, dismissed))) await openPane($)
}

/**
 * Ends an item. An ending only guessed (a task missing from the list at a stop) is `guessed`, and the task's own
 * notification, arriving later, corrects it: a failed test must not stay "Done".
 */
async function finish($: EngineInterface, id: string, status: BackstageStatus, step: string, guessed = false) {
  const now = await $.clock.now()
  const done = await change($, id, current =>
    current && (isActive(current) || (current.guessed && !guessed))
      ? { ...current, status, step, endedAt: current.endedAt ?? now, guessed: guessed || undefined, recent: [...current.recent, step].slice(-3) }
      : undefined,
  )
  if (done) await update($, ticker, () => `${done.title} · ${LABEL[status].toLowerCase()}`)
}

// ---------- the clock: one second a tick while work runs, and a while after ----------

let stopTick: (() => void) | undefined

function ensureTick($: EngineInterface) {
  if (stopTick) return
  stopTick = $.clock.every(1000, () => {
    void tick($)
  })
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const list = await read($, items)
  if (list.some(i => i.kind === 'agent' && isActive(i))) await reconcileAgents($)
  const after = await read($, items)
  await update($, clock, () => now)
  if (!after.some(isActive)) await update($, dismissed, () => false)
  if (!after.some(isActive) && now - lastEnded(after) > LINGER_MS) {
    stopTick?.()
    stopTick = undefined
  }
}

/** The engine's own list of agents is the truth for a subagent's state; it also catches one started before a reload. */
async function reconcileAgents($: EngineInterface) {
  let agents
  try {
    agents = await $.agent.list()
  } catch {
    return
  }
  const now = await $.clock.now()
  for (const agent of agents) {
    const status = statusOfAgent(agent.status)
    await change($, agent.id, current => {
      if (!current) {
        if (!(status === 'running' || status === 'waiting')) return undefined
        return { id: agent.id, kind: 'agent', title: agent.description || agent.type, type: agent.type, status, startedAt: now, steps: 0, step: 'Working', recent: [] }
      }
      if (!isActive(current) || current.status === status) return undefined
      if (status === 'running' || status === 'waiting') return { ...current, status, step: status === 'waiting' ? 'Waiting' : current.step }
      const step = status === 'done' ? 'Answer ready' : status === 'failed' ? 'Failed' : 'Stopped'
      return { ...current, status, step, endedAt: now, recent: [...current.recent, step].slice(-3) }
    })
  }
}

async function reconcileTasks($: EngineInterface, tasks: BackgroundTaskSummary[]) {
  const live = new Set(tasks.map(t => t.id))
  const now = await $.clock.now()
  for (const item of await read($, items)) {
    if (item.kind !== 'agent' && isActive(item) && !live.has(item.id)) await finish($, item.id, 'done', 'Finished', true)
  }
  for (const task of tasks) {
    const kind: BackstageKind | undefined = task.type === 'shell' ? 'shell' : task.type === 'monitor' ? 'monitor' : task.type === 'subagent' ? 'agent' : undefined
    if (!kind) continue
    await change($, task.id, current =>
      current
        ? undefined
        : {
            id: task.id,
            kind,
            title: clip(task.description || task.command || task.agent_type || kind, 60),
            type: task.agent_type,
            command: task.command,
            status: 'running',
            startedAt: now,
            steps: 0,
            step: kind === 'agent' ? 'Working' : kind === 'monitor' ? 'Watching' : clip(task.command ?? 'In progress', 60),
            recent: [],
          },
    )
  }
  if (tasks.length) ensureTick($)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Backstage' })
}

// ---------- drawing ----------

type Ui = ReturnType<EngineInterface['ui']['resolve']>

function mascot(ui: Ui, isDesk: boolean, item: BackstageItem, scale: number): RenderElement {
  const { Text } = ui
  const ended = !isActive(item)
  if (isDesk && 'Svg' in ui && ui.Svg) {
    const source = item.kind === 'agent' ? mascotSvg(item.status, scale, ended) : tileSvg(item.kind, item.status, scale)
    return ui.Svg({ source, alt: `${item.title}, ${LABEL[item.status].toLowerCase()}`, ...mascotSize(scale), isInteractive: true })
  }
  const grey = item.status === 'failed' || item.status === 'stopped'
  return Text({ color: grey ? 'inactive' : item.kind === 'agent' ? 'claude' : TASK_BLUE, children: [item.kind === 'agent' ? '✻' : '▣'] })
}

/** What kind of work it is, in a few words. */
export function kindLine(item: BackstageItem): string {
  if (item.kind === 'agent') return `Subagent · ${item.type ?? 'general-purpose'}`
  if (item.kind === 'monitor') return 'Monitor'
  return item.command ? `Background shell · $ ${clip(item.command, 80)}` : 'Background shell'
}

/** The step shown after the status, never the status said twice (an item found at a stop may carry only "Running"). */
export function stepOf(item: BackstageItem): string {
  const step = item.step.trim()
  if (step && step.toLowerCase() !== LABEL[item.status].toLowerCase()) return step
  if (item.kind === 'agent') return item.type ?? 'Subagent'
  if (item.kind === 'monitor') return 'Watching'
  return item.command ? clip(item.command, 60) : 'Background shell'
}

function elapsedOf(item: BackstageItem, now: number) {
  return fmtElapsed((item.endedAt ?? now) - item.startedAt)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'backstage', description: 'Show the subagents and background tasks of this session' })
    const list = await read($, items)
    if (list.some(isActive)) ensureTick($)
    return next(e)
  })

  on('command.run', { command: 'backstage' }, async $ => {
    await update($, dismissed, () => false)
    await openPane($)
    return { text: 'Backstage pane opened.' }
  })

  // Closed by the person while work runs: no more opening it unasked until that work is over.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (e.origin === 'person' && (await read($, items)).some(isActive)) await update($, dismissed, () => true)
    return result
  }).catch(($, e, next) => next(e))

  // A subagent: started here, its steps from its tool calls, its end from its last turn.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const id = 'agentId' in result ? result.agentId : undefined
    if (id) {
      await add($, {
        id,
        kind: 'agent',
        title: clip(e.description || e.subagentType || 'Subagent', 60),
        type: e.subagentType,
        status: 'running',
        startedAt: await $.clock.now(),
        steps: 0,
        step: 'Starting',
        recent: [],
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const call = e as unknown as Record<string, unknown>

    if (e.agentId !== undefined) {
      const step = brief(call)
      const moved = await change($, e.agentId, current =>
        current && isActive(current) ? { ...current, status: 'running', steps: current.steps + 1, step, recent: [...current.recent, step].slice(-3) } : undefined,
      )
      if (moved) await update($, ticker, () => `${moved.title} · ${step}`)
    }

    if (tool === 'TaskStop' || tool === 'KillShell') {
      const result = await next(e)
      const id = (typeof call.task_id === 'string' && call.task_id) || (typeof call.shell_id === 'string' && call.shell_id)
      if (id && !('deny' in result) && !('isError' in result && result.isError)) await finish($, id, 'stopped', 'Stopped')
      return result
    }

    if (tool !== 'Bash' && tool !== 'Monitor') return next(e)

    const result = await next(e)
    const record = 'result' in result ? (result.result as Record<string, unknown> | undefined) : undefined
    const id = tool === 'Bash' ? record?.backgroundTaskId : record?.taskId
    if (typeof id === 'string' && id) {
      const command = typeof call.command === 'string' ? call.command : undefined
      const description = typeof call.description === 'string' ? call.description : undefined
      await add($, {
        id,
        kind: tool === 'Bash' ? 'shell' : 'monitor',
        title: clip(description || command || tool, 60),
        command,
        status: 'running',
        startedAt: await $.clock.now(),
        steps: 0,
        step: tool === 'Bash' ? clip(command ?? 'Running', 60) : 'Watching',
        recent: command ? [`$ ${clip(command, 80)}`] : [],
        events: tool === 'Monitor' ? 0 : undefined,
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) return result
    if (e.reason === 'answer') {
      const first = (e.answer ?? '').split('\n').find(line => line.trim() !== '')
      await finish($, e.agentId, 'done', first ? clip(first, 60) : 'Answer ready')
    } else if (e.reason === 'aborted') await finish($, e.agentId, 'stopped', 'Interrupted')
    else await finish($, e.agentId, 'failed', e.reason === 'refusal' ? 'Refused' : 'Ended with an error')
    return result
  }).catch(($, e, next) => next(e))

  // Background work reports back as a task notification: a shell's or monitor's end, a monitor's event.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      for (const note of parseNotes(e.text)) {
        const current = (await read($, items)).find(i => i.id === note.id)
        if (!current) continue
        const ending = endingOf(note, current.kind)
        if (ending) await finish($, note.id, ending.status, ending.step)
        else if (current.kind === 'monitor' && isActive(current)) {
          const events = (current.events ?? 0) + 1
          const step = clip(note.summary ?? `${events} events`, 60)
          await change($, note.id, c => (c ? { ...c, events, step, recent: [...c.recent, step].slice(-3) } : undefined))
          await update($, ticker, () => `${current.title} · ${step}`)
        }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // At each stop the engine lists what is still in flight: anything missing from it has ended.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (Array.isArray(e.background_tasks)) await reconcileTasks($, e.background_tasks)
    return result
  }).catch(($, e, next) => next(e))

  // A card of its own above the prompt. The cards of every mod that keeps the band-stack convention are laid in one
  // order whatever order the app nests the hooks in: a handoff prompt on top, Backstage, then a status ribbon nearest the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const list = await read($, items)
    const now = Math.max(await read($, clock), await $.clock.now())
    const active = list.filter(isActive)
    const recent = list.filter(i => !isActive(i) && now - (i.endedAt ?? 0) < LINGER_MS)
    if (!active.length && !recent.length) return rest

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const isDesk = e.surface !== 'terminal'
    const news = await read($, ticker)
    const shown = active.length ? active : recent
    const parade = shown.slice(0, PARADE).map(i => mascot(ui, isDesk, i, 0.7))
    const more = shown.length > PARADE ? [Text({ dimColor: true, children: [`+${shown.length - PARADE}`] })] : []

    // On the desktop a Button draws its label alone, so the words are Texts and the press is a plain Button at the end.
    const card = Box({
      key: 'backstage',
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'nowrap',
      columnGap: 'sm',
      borderStyle: 'round',
      ...(isDesk ? { borderColor: 'clawd_background', backgroundColor: 'clawd_background', paddingX: 'md', paddingY: 'xs' } : {}),
      children: [
        ...parade,
        ...more,
        Box({
          flexDirection: 'row',
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          columnGap: 'sm',
          children: [
            Text({ bold: true, wrap: 'truncate-end', children: [summaryOf(list)] }),
            ...(news ? [Text({ dimColor: true, wrap: 'truncate-end', children: [`· ${clip(news, 90)}`] })] : []),
          ],
        }),
        Button({
          key: 'backstage-open',
          plain: true,
          label: 'Details ›',
          onPress: async () => {
            await update($, dismissed, () => false)
            await openPane($)
          },
        }),
      ],
    })
    const pieces = [...stackPieces(rest), card].sort((a, b) => rankOf(a) - rankOf(b)) as RenderElement[]
    return Box({ key: STACK, flexDirection: 'column', rowGap: 'sm', children: pieces })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const isDesk = e.surface !== 'terminal'
    const list = await read($, items)
    const now = Math.max(await read($, clock), await $.clock.now())
    const opened = await read($, openRow)
    const isShowingAll = await read($, showDone)
    // Waiting work first (it may need the person), then the newest.
    const active = list.filter(isActive).sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || b.startedAt - a.startedAt)
    const ended = list.filter(i => !isActive(i)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    const endedShown = isShowingAll ? ended : ended.slice(0, ENDED_SHOWN)
    const isCompact = active.length > COMPACT_AFTER
    const totals = [summaryOf(list), ended.length ? `${ended.length} finished` : ''].filter(Boolean).join(' · ')
    // The text column starts past the mascot, so details line up under the words.
    const indent = isDesk ? Math.round((FRAME_W * ROW_SCALE) / 8) + 1 : 2

    const toggle = (item: BackstageItem) => {
      const isOpen = opened === item.id
      return Button({
        key: `open-${item.id}`,
        plain: true,
        label: isOpen ? '⌃' : '⌄',
        onPress: () => void update($, openRow, current => (current === item.id ? null : item.id)),
      })
    }

    // What sits at the right of the second line: short, so the line stays one line.
    const side = (item: BackstageItem): RenderElement | null => {
      if (!isActive(item)) return null
      if (item.kind === 'agent') return <Text dimColor>{`${item.steps} ${item.steps === 1 ? 'step' : 'steps'}`}</Text>
      if (item.kind === 'monitor') return <Text color="suggestion">{item.events ? `● ${item.events}` : '● live'}</Text>
      return isDesk && 'Svg' in ui && ui.Svg ? ui.Svg({ source: barSvg(48, TASK_BLUE), alt: 'running', width: 48, height: 4, isInteractive: true }) : <Text dimColor>…</Text>
    }

    const fill = (child: RenderElement) => Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [child] })
    // The desktop wraps a Text by default; times and labels stay on one line and never give up their width.
    const fixed = (text: string, look: { color?: string; dimColor?: boolean } = {}) =>
      Box({ flexShrink: 0, children: [Text({ ...look, wrap: 'truncate-end', children: [text] })] })

    const statusLine = (item: BackstageItem) => (
      <Box flexDirection="row" flexWrap="nowrap" flexGrow={1} flexShrink={1} minWidth={0} columnGap="xs">
        {fixed(LABEL[item.status], { color: COLOR[item.status] })}
        {fill(<Text dimColor wrap="truncate-end">{`· ${stepOf(item)}`}</Text>)}
      </Box>
    )

    const details = (item: BackstageItem) =>
      opened === item.id && (
        <Box flexDirection="column" rowGap="xs" paddingLeft={indent}>
          <Text dimColor wrap="truncate-end">
            {kindLine(item)}
          </Text>
          {item.recent.map(line => (
            <Text dimColor wrap="truncate-end">
              {line}
            </Text>
          ))}
          {item.kind === 'agent' && (
            <Box flexDirection="row">
              <Button
                key={`view-${item.id}`}
                plain
                label="Open transcript ›"
                onPress={async () => {
                  const viewed = await $.ui.view({ agentId: item.id })
                  if ('deny' in viewed && viewed.deny) $.ui.toast(`Cannot open that transcript: ${viewed.deny}`)
                }}
              />
            </Box>
          )}
        </Box>
      )

    // Two lines beside the mascot: the title and its time, then the status and a short sign of progress.
    const fullRow = (item: BackstageItem) => (
      <Box key={`row-${item.id}`} flexDirection="column" rowGap="xs">
        <Box flexDirection="row" alignItems="center" flexWrap="nowrap" columnGap="sm">
          {mascot(ui, isDesk, item, ROW_SCALE)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} rowGap="xs">
            <Box flexDirection="row" alignItems="center" flexWrap="nowrap" columnGap="sm">
              {fill(
                <Text bold wrap="truncate-end">
                  {clip(item.title, 120)}
                </Text>,
              )}
              {fixed(elapsedOf(item, now), { dimColor: true })}
              {toggle(item)}
            </Box>
            <Box flexDirection="row" alignItems="center" flexWrap="nowrap" columnGap="sm">
              {statusLine(item)}
              {side(item)}
            </Box>
          </Box>
        </Box>
        {details(item)}
      </Box>
    )

    // One line each, for a long list and for finished work: same mascot column, so everything stays aligned.
    const shortRow = (item: BackstageItem) => {
      const isEnded = !isActive(item)
      return (
        <Box key={`row-${item.id}`} flexDirection="column" rowGap="xs">
          <Box flexDirection="row" alignItems="center" flexWrap="nowrap" columnGap="sm">
            {mascot(ui, isDesk, item, ROW_SCALE)}
            {fill(
              <Text bold={!isEnded} dimColor={isEnded} wrap="truncate-end">
                {isEnded ? `${clip(item.title, 120)} · ${stepOf(item)}` : clip(item.title, 120)}
              </Text>,
            )}
            {fixed(LABEL[item.status], { color: COLOR[item.status] })}
            {fixed(elapsedOf(item, now), { dimColor: true })}
            {toggle(item)}
          </Box>
          {details(item)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap="md">
        <Text dimColor wrap="truncate-end">
          {list.length ? totals : 'Nothing has run in the background yet.'}
        </Text>
        {list.length > 0 && !active.length && <Text dimColor>Nothing running in the background.</Text>}
        {active.map(isCompact ? shortRow : fullRow)}
        {ended.length > 0 && (
          <Box flexDirection="row" alignItems="center" columnGap="sm" paddingTop="sm">
            <Text dimColor bold>
              Finished
            </Text>
            <Box flexGrow={1} />
            {ended.length > ENDED_SHOWN && (
              <Button key="toggle-done" plain label={isShowingAll ? 'Show fewer' : `Show all ${ended.length}`} onPress={() => void update($, showDone, all => !all)} />
            )}
            <Button key="clear-done" plain label="Clear" onPress={() => void update($, items, all => all.filter(isActive))} />
          </Box>
        )}
        {endedShown.map(shortRow)}
      </Box>
    )
  })
}
