const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/twin/journalRequest.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function requestWith(fetch) {
  const exports = {}
  new Function('exports', 'fetch', code)(exports, fetch)
  return exports.journalRequest
}
async function main() {
  let calls = 0
  const recovering = requestWith(async () => ++calls === 1
    ? new Response('', { status: 503 })
    : Response.json({ days: [] }))
  assert.deepEqual(await recovering('/month', { retryDelayMs: 0 }), { days: [] })
  assert.equal(calls, 2)
  calls = 0
  const failedSave = requestWith(async () => { calls++; return new Response('', { status: 500 }) })
  await assert.rejects(failedSave('/mark', { method: 'POST' }), /Сервер/)
  assert.equal(calls, 1)
  const hanging = requestWith((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  await assert.rejects(hanging('/month', { timeoutMs: 10 }), /слишком много времени/)
  const controller = new AbortController()
  const cancelled = hanging('/day', { signal: controller.signal })
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  const incomplete = requestWith(async () => Response.json(null))
  await assert.rejects(incomplete('/month'), /неполный ответ/)
  console.log('Journal request: recovery, save failure, timeout, cancellation, incomplete response passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
