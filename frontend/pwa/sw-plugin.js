// Плагин сборки: после `vite build` собирает dist/sw.js из шаблона pwa/sw.js —
// подставляет список всех файлов сборки (precache) и версию = хеш их содержимого.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const SKIP = [/\.map$/, /^sw\.js$/, /^icons\/.*\.svg$/]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** @returns {import('vite').Plugin} */
export default function allurSw() {
  let outDir = ''
  return {
    name: 'allur-sw',
    apply: 'build',
    configResolved(config) { outDir = join(config.root, config.build.outDir) },
    closeBundle() {
      const files = walk(outDir).map((f) => relative(outDir, f).replaceAll('\\', '/')).filter((f) => !SKIP.some((re) => re.test(f))).sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const tpl = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
      const sw = tpl.replace("'__VERSION__'", JSON.stringify(version)).replace('__PRECACHE__', JSON.stringify(files.map((f) => '/' + f)))
      writeFileSync(join(outDir, 'sw.js'), sw)
      const kb = files.reduce((s, f) => s + statSync(join(outDir, f)).size, 0) / 1024
      console.log(`[allur-sw] sw.js: версия ${version}, в кеше ${files.length} файлов, ${Math.round(kb)} КБ`)
    },
  }
}
