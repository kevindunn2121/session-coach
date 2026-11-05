import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MANIFEST_PATH, manifestVersion, versionFooter } from '../hooks/version'

// The Setup and Session coach panes end with the plugin's name and manifest version, so you can
// tell which installed copy runs after /reload-plugins.

const OPTIONS = { options: { analyzeEvery: 0, judgeTurns: false, openPane: 'command' } }

// manifest: the plugin.json text to serve; roots collects the folders the plugin read it from.
const world = (on: On, manifest: string, roots: string[]) => {
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/game' }))
  mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/Users/kevin' })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    if (path.endsWith(`/${MANIFEST_PATH}`)) {
      roots.push(path.slice(0, -MANIFEST_PATH.length - 1))
      return { value: manifest }
    }
    throw new Error('missing')
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('model.complete', () => ({ value: { isAnswered: false as const, reason: 'off' } as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine draws') as never
  })
}

const mount = ($: Engine, requestId: string) =>
  $.ui.mount({ plugin: 'session-coach', surface: 'desktop', component: 'Pane', requestId, props: { bodyColumns: 100 } as never })

const startSession = ($: Engine) => $.session.start({ cwd: '/work/game', surface: null, isInteractive: true })

const footers = async ($: Engine) => {
  const texts: string[] = []
  for (const id of ['session-coach', 'session-coach-setup']) {
    const ui = await mount($, id)
    const found = await ui.findAll({ type: 'Text', text: /^session-coach( \d|$)/ })
    texts.push(...found.map(el => el.text ?? ''))
    await ui.unmount()
  }
  return texts
}

test('the manifest version parses, and a missing or broken one leaves the name alone', async () => {
  expect(manifestVersion('{"name":"session-coach","version":"1.2.3"}')).toBe('1.2.3')
  expect(manifestVersion('{"name":"session-coach"}')).toBe('')
  expect(manifestVersion('{"version":7}')).toBe('')
  expect(manifestVersion('not json')).toBe('')
  expect(versionFooter('session-coach', '1.2.3')).toBe('session-coach 1.2.3')
  expect(versionFooter('session-coach', '')).toBe('session-coach')
})

test('both panes end with the version from the plugin.json the engine loaded', OPTIONS, async ($, on) => {
  const roots: string[] = []
  world(on, '{"name":"session-coach","version":"9.8.7"}', roots)
  await startSession($)
  expect(await footers($)).toEqual(['session-coach 9.8.7', 'session-coach 9.8.7'])
  // It reads plugin.json from the plugin's own folder ($.plugin.root), the copy the engine runs.
  expect(roots.length).toBeGreaterThan(0)
  expect(new Set(roots).size).toBe(1)
  expect(roots[0]).toMatch(/^(\/|[A-Za-z]:\/)/)
  expect(roots[0]).not.toBe('/work/game')
})

test('a missing manifest leaves the footer at the name', OPTIONS, async ($, on) => {
  const roots: string[] = []
  world(on, 'not json', roots)
  await startSession($)
  expect(await footers($)).toEqual(['session-coach', 'session-coach'])
})

test('a pane opened after a reload, with no session start, still loads the version', OPTIONS, async ($, on) => {
  const roots: string[] = []
  world(on, '{"name":"session-coach","version":"4.5.6"}', roots)
  expect(await footers($)).toEqual(['session-coach', 'session-coach'])
  await $.command.run({ command: 'coach', args: '' } as never)
  expect(await footers($)).toEqual(['session-coach 4.5.6', 'session-coach 4.5.6'])
})
