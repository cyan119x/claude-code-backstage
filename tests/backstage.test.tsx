import { expect, mock, test } from 'claude-code/testing'

import { brief, endingOf, fmtElapsed, parseNotes, rankOf, stackPieces, statusOfAgent, stepOf, summaryOf } from '../hooks/register'

const BAND = {
  plugin: 'backstage',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const PANE = {
  plugin: 'backstage',
  component: 'Pane',
  requestId: 'backstage',
  props: { title: 'Backstage', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('a subagent and a background shell show in the line and the pane', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: { command: 'backstage' } }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', (_, e) =>
    String(e.tool) === 'Bash'
      ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
      : { result: {} },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Map the event types', description: 'Map plugin event types', subagentType: 'Explore' })
  await $.tool.call({ tool: 'Read', file_path: '/x/register.tsx', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build production bundle', run_in_background: true })

  // Each new piece of work opens the pane.
  expect(opened).toEqual(['backstage', 'backstage'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /2 running/ }))?.text).toBe('2 running')
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /Map plugin event types/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Read register\.tsx/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Build production bundle/ })).toBeDefined()
    await pane.unmount()
  }
})

test('a subagent that answered moves to Finished', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a2' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.agent.spawn({ prompt: 'Look', description: 'Review auth diff' })
  await $.turn.complete({ agentId: 'a2', reason: 'answer', answer: 'Found 3 places.', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /Finished/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Found 3 places/ })).toBeDefined()
  await pane.unmount()
})

test('nothing running leaves the band to the others', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /running/ })).toBeUndefined()
  await band.unmount()
})

test('task notifications are read', () => {
  const text =
    '<task-notification><task-id>b1</task-id><status>completed</status><summary>Background command "npm run build" completed (exit code 2)</summary></task-notification>' +
    '<task-notification><task-id>m1</task-id><summary>GET / 200</summary></task-notification>'
  const notes = parseNotes(text)
  expect(notes).toEqual([
    { id: 'b1', status: 'completed', summary: 'Background command "npm run build" completed (exit code 2)', exitCode: 2 },
    { id: 'm1', status: undefined, summary: 'GET / 200', exitCode: undefined },
  ])
  expect(endingOf(notes[0]!, 'shell')).toEqual({ status: 'failed', step: 'Exited with code 2' })
  expect(endingOf(notes[1]!, 'monitor')).toBeUndefined()
  expect(endingOf({ id: 'a', status: 'killed' }, 'agent')).toEqual({ status: 'stopped', step: 'Stopped' })
})

test('small helpers', () => {
  expect(fmtElapsed(84_000)).toBe('1m 24s')
  expect(fmtElapsed(9_000)).toBe('9s')
  expect(fmtElapsed(3_900_000)).toBe('1h 05m')
  expect(brief({ tool: 'Grep', pattern: 'agentId' })).toBe('Grep agentId')
  expect(statusOfAgent('idle')).toBe('waiting')
  expect(statusOfAgent('killed')).toBe('stopped')
  expect(summaryOf([])).toBe('All finished')
})

test('the band keeps every other card and lays them in band-stack order', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a9' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // Stands for Ember and Handoff drawn beneath, already stacked.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ key: 'band-stack', children: [Box({ key: 'ember', children: [Text({ children: ['ember card'] })] }), Box({ key: 'handoff', children: [Text({ children: ['handoff card'] })] })] })
  })
  await $.agent.spawn({ prompt: 'x', description: 'Look around' })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /ember card/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /handoff card/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  await band.unmount()
})

test('band-stack ranks and the step line', () => {
  const card = (key: string) => ({ type: 'Box', props: { key }, children: [] })
  const stack = { type: 'Box', props: { key: 'band-stack' }, children: [card('ember'), card('handoff'), card('other')] }
  const order = [...stackPieces(stack), card('backstage')].sort((a, b) => rankOf(a) - rankOf(b)).map(p => (p as { props: { key: string } }).props.key)
  expect(order).toEqual(['handoff', 'backstage', 'other', 'ember'])
  expect(stackPieces(null)).toEqual([])
  const base = { id: 'm', kind: 'monitor' as const, title: 't', status: 'running' as const, startedAt: 0, steps: 0, recent: [] }
  expect(stepOf({ ...base, step: 'Running' })).toBe('Watching')
  expect(stepOf({ ...base, step: 'GET / 200' })).toBe('GET / 200')
})
