// Запись промо-ролика Allur Flow: живой интерфейс (3D, План, Схема, прогноз, эффект, брифинг, архитектура)
// с заставкой, подписями и курсором. Кадры — CDP screencast (JPEG), события — для звука (sound.py).
// Запуск: node promo/record.cjs [url]   (сервер с собранным сайтом, по умолчанию http://localhost:8011)
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Amir/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

const URL = process.argv[2] || 'http://localhost:8011'
const OUT = process.env.PROMO_OUT || path.join(__dirname, 'out')
const FRAMES = path.join(OUT, 'frames')
const W = 1440, H = 810, DPR = 4 / 3          // кадр 1920×1080
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000
const events = []
const mark = (type, extra = {}) => events.push({ t: now(), type, ...extra })

// Оверлей ролика: заставка, подписи, курсор. Стиль — светлый интерфейс Allur Flow + тёмные карточки B2B SaaS.
const OVERLAY = `
(() => {
  const css = document.createElement('style')
  css.textContent = \`
    button[aria-label="Спросить двойник"], [data-promo-hide] { display:none !important }
    ::-webkit-scrollbar { display:none }
    html { scrollbar-width:none }
    main { transition: transform 3.2s cubic-bezier(.22,1,.36,1); transform-origin: 50% 30% }
    #promo-card { position:fixed; inset:0; z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px;
      background: radial-gradient(1200px 600px at 20% 10%, rgba(124,58,237,.35), transparent 60%), radial-gradient(900px 500px at 85% 90%, rgba(14,165,233,.35), transparent 60%), #0b1020;
      color:#fff; font-family: -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", sans-serif;
      transition: transform .7s cubic-bezier(.7,0,.2,1), opacity .7s; }
    #promo-card.out { transform: translateY(-105%); }
    #promo-card .logo { width:96px; height:96px; border-radius:28px; display:grid; place-items:center; font-size:52px; font-weight:800;
      background: linear-gradient(135deg,#1e293b,#020617); box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 20px 60px rgba(124,58,237,.45); animation: pop .8s cubic-bezier(.2,1.4,.4,1) both }
    #promo-card h1 { margin:0; font-size:86px; letter-spacing:-.03em; font-weight:800; animation: up .8s .15s cubic-bezier(.22,1,.36,1) both }
    #promo-card p { margin:0; font-size:28px; color:#cbd5e1; animation: up .8s .3s cubic-bezier(.22,1,.36,1) both }
    #promo-card .chips { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; max-width:1100px }
    #promo-card .chip { padding:10px 18px; border-radius:999px; font-size:20px; font-weight:600; background:rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); animation: up .6s both }
    #promo-card .stat b { font-size:30px; color:#86efac }
    #promo-card .note { font-size:16px; color:#94a3b8; animation: up .6s .9s both }
    @keyframes pop { from { transform: scale(.4) rotate(-12deg); opacity:0 } to { transform:none; opacity:1 } }
    @keyframes up { from { transform: translateY(24px); opacity:0 } to { transform:none; opacity:1 } }
    #promo-cap { position:fixed; left:48px; bottom:44px; z-index:9998; padding:18px 26px 18px 22px; border-radius:22px; max-width:880px;
      background: rgba(11,16,32,.86); backdrop-filter: blur(18px); color:#fff; box-shadow: 0 20px 60px rgba(2,6,23,.35);
      font-family: -apple-system, "Segoe UI Variable Display", "Segoe UI", sans-serif; display:flex; gap:16px; align-items:center;
      transform: translateY(140%); transition: transform .55s cubic-bezier(.22,1,.36,1) }
    #promo-cap.on { transform:none }
    #promo-cap .bar { width:6px; align-self:stretch; border-radius:6px; background: linear-gradient(#a78bfa,#38bdf8) }
    #promo-cap .t { font-size:34px; font-weight:800; letter-spacing:-.02em }
    #promo-cap .s { font-size:20px; color:#cbd5e1; margin-top:4px }
    #promo-cur { position:fixed; z-index:10000; width:28px; height:28px; margin:-4px 0 0 -4px; pointer-events:none;
      transition: left .55s cubic-bezier(.22,1,.36,1), top .55s cubic-bezier(.22,1,.36,1); left:50%; top:60% }
    #promo-cur svg { filter: drop-shadow(0 4px 10px rgba(0,0,0,.35)) }
    .promo-ripple { position:fixed; z-index:9999; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; pointer-events:none;
      border:3px solid #7c3aed; animation: rip .6s ease-out forwards }
    @keyframes rip { to { transform: scale(5); opacity:0 } }
  \`
  document.head.appendChild(css)
  const cur = document.createElement('div'); cur.id = 'promo-cur'
  cur.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  document.body.appendChild(cur)
  const cap = document.createElement('div'); cap.id = 'promo-cap'
  cap.innerHTML = '<div class="bar"></div><div><div class="t"></div><div class="s"></div></div>'
  document.body.appendChild(cap)
  window.promo = {
    card(html) { let c = document.getElementById('promo-card'); if (!c) { c = document.createElement('div'); c.id = 'promo-card'; document.body.appendChild(c) } c.className = ''; c.innerHTML = html },
    cardOut() { const c = document.getElementById('promo-card'); if (c) c.classList.add('out') },
    caption(t, s) { cap.classList.remove('on'); setTimeout(() => { cap.querySelector('.t').textContent = t; cap.querySelector('.s').textContent = s || ''; cap.classList.add('on') }, 180) },
    captionOff() { cap.classList.remove('on') },
    cursor(x, y) { cur.style.left = x + 'px'; cur.style.top = y + 'px' },
    ripple(x, y) { const r = document.createElement('div'); r.className = 'promo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700) },
    push(s) { const m = document.querySelector('main'); if (m) m.style.transform = 'scale(' + s + ')' },
  }
})()`

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(FRAMES, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, serviceWorkers: 'block', locale: 'ru-RU' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)) })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.evaluate(OVERLAY)

  // подготовка за кадром: вкладка «Двойник», 3D, скорость
  await page.getByRole('button', { name: 'Двойник', exact: true }).click()
  await page.waitForSelector('canvas', { timeout: 30000 })
  await sleep(4000)
  await page.selectOption('select[aria-label="Скорость"]', '60')
  await page.evaluate(() => { const b = document.querySelector('[aria-label="Скорость"]'); b && b.scrollIntoView({ block: 'center' }); window.scrollTo(0, 0) })

  // заставка
  await page.evaluate(() => window.promo.card(`
    <div class="logo">A</div><h1>Allur Flow</h1><p>Цифровой двойник автозавода · Костанай</p>
    <div class="chips"><span class="chip" style="animation-delay:.45s">3D-двойник</span><span class="chip" style="animation-delay:.55s">План и схема</span>
    <span class="chip" style="animation-delay:.65s">Прогноз смены</span><span class="chip" style="animation-delay:.75s">Эффект в ₸</span><span class="chip" style="animation-delay:.85s">ИИ-помощник</span></div>`))

  // запись кадров
  const cdp = await ctx.newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async (f) => {
    const i = frames.length
    frames.push(f.metadata.timestamp)
    fs.writeFileSync(path.join(FRAMES, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'))
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch { /* конец записи */ }
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
  mark('start'); mark('impact')
  await sleep(2600)

  const click = async (loc, label) => {
    const el = typeof loc === 'string' ? page.locator(loc).first() : loc
    await el.scrollIntoViewIfNeeded()
    const b = await el.boundingBox()
    if (!b) throw new Error('нет элемента ' + label)
    const x = b.x + b.width / 2, y = b.y + b.height / 2
    await page.evaluate(([x, y]) => window.promo.cursor(x, y), [x, y])
    await sleep(600)
    await page.evaluate(([x, y]) => window.promo.ripple(x, y), [x, y])
    mark('click', { label }); console.log('click', label)
    await el.click()
  }
  const scene = async (title, sub) => {
    await page.evaluate(() => window.promo.push(1))
    mark('whoosh', { title })
    await page.evaluate(([t, s]) => window.promo.caption(t, s), [title, sub])
    await sleep(250)
    await page.evaluate(() => window.promo.push(1.035))
  }
  const smooth = async (sel) => {
    await page.evaluate((sel) => { const el = sel === 'top' ? null : document.querySelector(sel); window.scrollTo({ top: el ? el.getBoundingClientRect().top + window.scrollY - 80 : 0, behavior: 'smooth' }) }, sel)
    await sleep(900)
  }

  // 1. 3D-двойник
  await page.evaluate(() => window.promo.cardOut())
  await scene('Цифровой двойник линии', 'Склад → сварка → окраска → сборка → ОТК: каждый кузов в движении')
  await sleep(700)
  await click(page.getByRole('button', { name: 'Пуск' }), 'Пуск')
  await sleep(900)
  await click(page.getByRole('button', { name: /Обзор линии/ }), 'Обзор')
  await sleep(3600)

  // 2. План
  await scene('План цеха', 'Статусы участков и накопители — одним взглядом')
  await click(page.getByRole('button', { name: 'План', exact: true }), 'План')
  await sleep(2300)

  // 3. Схема
  await scene('Схема потока', 'Где копятся кузова и кто тормозит линию')
  await click(page.getByRole('button', { name: 'Схема', exact: true }), 'Схема')
  await sleep(2300)

  // 4. Что если — остановка сейчас
  await click(page.getByRole('button', { name: '3D', exact: true }), '3D')
  await scene('Что если встанет сборка?', 'Прогноз к концу смены пересчитан за секунду')
  const eta = page.locator("xpath=//div[div[starts-with(normalize-space(.), 'Что если прямо сейчас')]]").first()
  await click(eta.getByRole('button', { name: 'Сборка', exact: true }), 'Сборка')
  await sleep(250)
  await click(eta.getByRole('button', { name: '30 мин', exact: true }), '30 мин')
  await sleep(250)
  await click(page.getByRole('button', { name: /Остановить в/ }), 'Остановить')
  mark('impact')
  await sleep(2600)

  // 5. Эффект для завода
  const effectText = await page.evaluate(() => document.getElementById('effect')?.innerText || '')
  await scene('Эффект для завода', 'Каждое действие — в машинах, минутах простоя и тенге')
  await smooth('#effect')
  await sleep(2900)

  // 6. Брифинг
  await smooth('top')
  await scene('Брифинг смены в 08:00', 'Сколько сделаем, что мешает, что сделать')
  await click(page.getByRole('button', { name: 'Брифинг', exact: true }), 'Брифинг')
  await sleep(2600)

  // 7. Архитектура
  await scene('От PLC до экрана мастера', 'Архитектура: данные → двойник → ИИ → решения')
  await click(page.getByRole('button', { name: 'Архитектура', exact: true }), 'Архитектура')
  await sleep(3000)

  // финал: числа — из карточки эффекта (расчёт двойника)
  const m = effectText.match(/\+([\d,]+)\s*машин за смену/)
  const y = effectText.match(/([\d,]+ (?:млн|млрд) ₸)\s*в год/)
  const d = effectText.match(/\(−(\d+)%\)/)
  await page.evaluate(() => window.promo.captionOff())
  mark('riser')
  await sleep(500)
  mark('impact')
  await page.evaluate(([m, y, d]) => window.promo.card(`
    <div class="logo">A</div><h1>Allur Flow</h1><p>Видим проблему → прогнозируем → предлагаем действие → учимся</p>
    <div class="chips">
      ${m ? `<span class="chip stat" style="animation-delay:.4s"><b>+${m}</b> машин за смену</span>` : ''}
      ${d ? `<span class="chip stat" style="animation-delay:.55s"><b>−${d}%</b> простоя</span>` : ''}
      ${y ? `<span class="chip stat" style="animation-delay:.7s"><b>${y}</b> в год</span>` : ''}
    </div>
    <div class="note">расчёт цифрового двойника на данных ТЗ · Qostanai Industry Hackathon · кейс Allur</div>`), [m && m[1], y && y[1], d && d[1]])
  await sleep(3400)
  mark('end')
  await cdp.send('Page.stopScreencast')
  await sleep(300)
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames))
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1))
  console.log('кадров', frames.length, 'длительность', (frames[frames.length - 1] - frames[0]).toFixed(1), 'с')
}
main().catch((e) => { console.error(e); process.exit(1) })
