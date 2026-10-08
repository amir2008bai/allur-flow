import { motion } from 'motion/react'
import { Box, Factory, Layers, Network, RefreshCw, Server } from 'lucide-react'
import { Suspense, lazy, useEffect, useState } from 'react'
import { Card } from '../ui'
import { isPhone } from '../twin/store'
import ArchCycle from './ArchCycle'
import ArchFlow from './ArchFlow'
import { COMPS, COMP_BY, LAYERS, LAYER_BY, STATUS_RU, type Status } from './model'

const Arch3D = lazy(() => import('./Arch3D'))   // three.js грузится только при открытии 3D

type View = '3d' | 'flow' | 'cycle'
const VIEWS: { id: View; label: string; short: string; icon: React.ReactNode }[] = [
  { id: '3d', label: '3D-слои', short: '3D', icon: <Layers size={14} /> },
  { id: 'flow', label: 'Поток данных', short: 'Поток', icon: <Network size={14} /> },
  { id: 'cycle', label: 'Цикл решения', short: 'Цикл', icon: <RefreshCw size={14} /> },
]

function StatusPill({ s }: { s: Status }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_RU[s].cls}`}><span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_RU[s].hex }} />{STATUS_RU[s].label}</span>
}

/** Карточка выбранного блока: что это, на чём сделано, где в коде, с чем связан. */
function Detail({ id, onSelect, apiCount }: { id: string | null; onSelect: (id: string | null) => void; apiCount: number | null }) {
  if (!id) return (
    <div className="text-sm text-slate-500">
      <div className="font-semibold text-slate-800">Нажмите на любой блок</div>
      <p className="mt-1">Покажу, что он делает, на чём сделан и где лежит в коде. Связанные блоки подсветятся.</p>
      <ul className="mt-3 space-y-1.5">
        {(['ready', 'demo', 'plan'] as Status[]).map((s) => <li key={s} className="flex items-center gap-2"><StatusPill s={s} /><span className="text-xs">{s === 'ready' ? 'работает и проверено тестами' : s === 'demo' ? 'работает на эмуляторе или в «Испытаниях»' : 'описано, запуск — на заводе'}</span></li>)}
      </ul>
    </div>
  )
  const c = COMP_BY[id]
  const layer = LAYER_BY[c.layer]
  const from = COMPS.filter((x) => x.to?.includes(id))
  const to = (c.to ?? []).map((t) => COMP_BY[t]).filter(Boolean)
  const Chip = ({ x }: { x: typeof c }) => <button onClick={() => onSelect(x.id)} className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">{x.name}</button>
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: layer.hex }}>{layer.name}<StatusPill s={c.status} /></div>
      <div className="mt-1 text-lg font-semibold leading-tight">{c.name}</div>
      <p className="mt-1.5 text-sm text-slate-600">{c.what}</p>
      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <div><span className="text-slate-400">на чём:</span> {c.tech}</div>
        {c.code && <div><span className="text-slate-400">в коде:</span> <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">{c.code}</code></div>}
        {id === 'apis' && apiCount != null && <div><span className="text-slate-400">сейчас:</span> {apiCount} адресов API (живой счёт с сервера)</div>}
      </div>
      {from.length > 0 && <div className="mt-3"><div className="mb-1 text-[11px] text-slate-400">получает от</div><div className="flex flex-wrap gap-1">{from.map((x) => <Chip key={x.id} x={x} />)}</div></div>}
      {to.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] text-slate-400">передаёт в</div><div className="flex flex-wrap gap-1">{to.map((x) => <Chip key={x.id} x={x} />)}</div></div>}
    </div>
  )
}

/** Архитектура решения (требование ТЗ): три вида одной схемы + как это работает сейчас и на заводе. */
export default function ArchPage() {
  const [view, setView] = useState<View>(isPhone() ? 'cycle' : '3d')
  const [selected, setSelected] = useState<string | null>(null)
  const [apiCount, setApiCount] = useState<number | null>(null)
  useEffect(() => {
    fetch('/openapi.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.paths) setApiCount(Object.values(d.paths as Record<string, object>).reduce((n, p) => n + Object.keys(p).length, 0))
    }).catch(() => {})
  }, [])
  const phone = isPhone()
  const counts = (['ready', 'demo', 'plan'] as Status[]).map((s) => [s, COMPS.filter((c) => c.status === s).length] as const)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Как устроен Allur Flow</h1>
          <p className="text-sm text-slate-500">Архитектура решения: от оборудования завода до экрана мастера. {COMPS.length} блоков в {LAYERS.length} слоях · {counts.map(([s, n]) => `${STATUS_RU[s].label} — ${n}`).join(' · ')}.</p>
        </div>
        <div className="flex gap-0.5 rounded-full bg-slate-900/[0.05] p-1">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium ${view === v.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}>
              {view === v.id && <motion.span layoutId="arch-pill" className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="relative flex items-center gap-1.5">{v.icon}<span className="sm:hidden">{v.short}</span><span className="hidden sm:inline">{v.label}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-3">
          {view === '3d' && <Suspense fallback={<div className="grid h-[520px] place-items-center text-sm text-slate-400">Загружаю 3D…</div>}><Arch3D selected={selected} onSelect={setSelected} height={phone ? 380 : 520} /></Suspense>}
          {view === 'flow' && <ArchFlow selected={selected} onSelect={setSelected} height={phone ? 460 : 560} />}
          {view === 'cycle' && <ArchCycle onSelect={(id) => { setSelected(id); }} />}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-slate-500">
            {view === '3d' && <span>Слои снизу вверх: завод → экраны. Шарики — данные, бегут по связям. Вращайте мышью, нажмите на блок.</span>}
            {view === 'flow' && <span>Слева направо: откуда данные → куда идут → какой экран. Пунктирные блоки — следующий этап.</span>}
            {view === 'cycle' && <span>Ради чего всё устроено: каждую смену проходим круг — и прогноз становится точнее.</span>}
          </div>
        </Card>
        <Card className="p-5"><Detail id={selected} onSelect={setSelected} apiCount={apiCount} /></Card>
      </div>

      {/* слои кратко */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...LAYERS].reverse().map((l) => {
          const list = COMPS.filter((c) => c.layer === l.id)
          return (
            <Card key={l.id} className="p-4">
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.hex }} />{l.name}</div>
              <p className="mt-1 text-xs text-slate-500">{l.about}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {list.map((c) => <button key={c.id} onClick={() => { setSelected(c.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${c.status === 'plan' ? 'border border-dashed border-slate-300 text-slate-400 ring-transparent' : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100'}`}>{c.name}</button>)}
              </div>
            </Card>
          )
        })}
      </div>

      {/* сейчас и на заводе */}
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">Как запускается</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <div className="flex items-center gap-2 text-sm font-semibold"><Box size={15} className="text-slate-500" />Сейчас — прототип</div>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li>• Один обычный компьютер: сервер на Python и сайт по одному адресу</li>
              <li>• База — один файл SQLite, ничего ставить не нужно</li>
              <li>• Данные — тестовые таблицы ТЗ, двойник и эмулятор линии; прогноз ИИ учится на эмуляторе</li>
              <li>• С телефона — как приложение; без сети работают «Двойник» на записанных прогонах и «Испытания»</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Factory size={15} className="text-slate-500" />На заводе — следующий этап</div>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li>• Шлюз PLC: OPC UA / MQTT → события в Allur Flow (инструкция готова)</li>
              <li>• Выгрузка из MES раз в сутки → двойник сам подгоняет надёжность участков</li>
              <li>• SQLite → TimescaleDB для длинной истории событий</li>
              <li>• Docker + HTTPS на сервере завода — файлы готовы, на этом ПК не запускались</li>
            </ul>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><Server size={13} />Правила, которые держит архитектура:</span>
          <span>у каждого числа — метка источника</span>
          <span>прогноз не видит факта</span>
          <span>ИИ сверяет каждое число с расчётом, неподтверждённое помечает</span>
          <span>параметры линии — файлом, без программиста</span>
        </div>
      </Card>
    </div>
  )
}
