// Documentation drift guard: the verified DSH build is declared exactly once, in
// package.json, and the READMEs plus the peer ranges must agree with it. DSH ships
// fast, so "which version was this tested against" is the one claim that must not
// silently rot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const readme = (name) => readFileSync(new URL(name, root), 'utf8')
const en = readme('README.md')
const zh = readme('README-zh.md')

const verified = pkg.dsh?.verifiedWith

test('package.json declares the verified DSH build', () => {
  assert.equal(typeof verified, 'string', 'dsh.verifiedWith must be set')
  assert.match(verified, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'must look like a version')
})

test('every harness peer opens at the verified build and never caps the range', () => {
  const peers = Object.entries(pkg.peerDependencies ?? {}).filter(([name]) =>
    /^@deepseek-ai\/dsh(-|$)/.test(name),
  )
  assert.ok(peers.length > 0, 'the plugin consumes harness services, so it declares harness peers')
  for (const [name, range] of peers) {
    assert.equal(range, `>=${verified}`, `${name} must open exactly at the verified build`)
    assert.ok(!range.includes('<'), `${name} must not carry an upper bound (a capped range makes DSH skip the bundle)`)
  }
})

test('the browser-half peers and imports stay declared', () => {
  const peers = pkg.peerDependencies ?? {}
  for (const name of ['@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/schemastery']) {
    assert.ok(peers[name], `${name} must stay a declared peer`)
  }
})

test('both READMEs state the verified build and its status table', () => {
  const expectations = [
    ['README.md', en, ['## Which DSH versions this works with', 'Verified', 'Not supported']],
    ['README-zh.md', zh, ['## 适配哪些 DSH 版本', '已验证', '不支持']],
  ]
  for (const [file, text, markers] of expectations) {
    assert.ok(text.includes(`\`${verified}\``), `${file} must quote the verified build ${verified}`)
    for (const marker of markers) assert.ok(text.includes(marker), `${file} is missing: ${marker}`)
    assert.ok(text.includes('dsh.verifiedWith'), `${file} must point at the machine-readable field`)
    assert.ok(/\n_Last verified: |\n_最后验证：/.test(text), `${file} must carry the verification date line`)
  }
})

test('the READMEs keep the same structure', () => {
  const headings = (text) => text.split('\n').filter((l) => /^## /.test(l)).length
  assert.equal(headings(en), headings(zh), 'both READMEs must have the same top-level section count')
})
