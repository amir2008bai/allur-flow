// Скриншоты главных экранов для README: node promo/screens.cjs [url]  → media/screens/*.jpg
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Amir/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

const URL = process.argv[2] || 'http://localhost:8011'
const OUT = path.join(__dirname, '..', 'media', 'screens')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, serviceWorkers: 'block', locale: 'ru-RU' })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: 'button[aria-label="Спросить двойник"]{display:none!important} ::-webkit-scrollbar{display:none}' })
  const shot = async (name, opts = {}) => { await sleep(opts.wait ?? 1200); await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 86, ...opts.extra }); console.log('ok', name) }
  const tab = (name) => page.locator('nav button', { hasText: name }).first().click()
  const top = () => page.evaluate(() => window.scrollTo(0, 0))
  const to = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70) }, sel)

  await tab('Брифинг'); await shot('briefing', { wait: 4000 })

  await tab('Двойник'); await page.waitForSelector('canvas', { timeout: 30000 }); await sleep(3000)
  await page.selectOption('select[aria-label="Скорость"]', '60')
  await page.getByRole('button', { name: 'Пуск' }).click(); await sleep(7000)
  await page.getByRole('button', { name: 'Пауза' }).click()
  await top(); await shot('twin-3d', { wait: 1500 })
  await page.getByRole('button', { name: 'План', exact: true }).click(); await shot('twin-plan', { wait: 1500 })
  await page.getByRole('button', { name: 'Схема', exact: true }).click(); await shot('twin-schema', { wait: 1500 })
  await page.getByRole('button', { name: '3D', exact: true }).click(); await sleep(1500)

  await to('#kpi'); await shot('twin-now', { wait: 2500 })
  await page.getByRole('button', { name: 'Решения' }).click(); await sleep(500); await to('#effect'); await shot('twin-effect', { wait: 4000 })
  await page.getByRole('button', { name: 'Качество' }).click(); await sleep(500); await to('#paint-spc'); await shot('twin-quality', { wait: 4000 })

  await top(); await tab('Архитектура'); await shot('architecture', { wait: 5000 })

  await page.locator('[aria-label="Переключить язык"]').click(); await sleep(500)
  await tab('Брифинг'); await top(); await shot('briefing-kk', { wait: 3000 })
  await page.locator('[aria-label="Переключить язык"]').click()
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
