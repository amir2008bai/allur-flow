import { Play, Radio, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { STATUS, type Status } from './theme'
import { Card, SourceBadge } from './ui'

interface Live {
  connected: boolean; last_event_age_s: number | null; feed: string | null; events: number; good: number; defects: number
  stations: { id: string; name: string; assets: string[]; state: Status | null; since: number | null }[]
  emulator: { running: boolean; speed: number; progress: number }
}

const STATE_RU: Record<Status, string> = { working: 'работает', starved: 'ждёт кузов', blocked: 'некуда отдать', down: 'стоит' }

/** «Живые данные»: что приходит с линии прямо сейчас (шлюз PLC/OPC UA или эмулятор PLC) и как подключить завод. */
export default function LivePanel() {
  const [s, setS] = useState<Live | null>(null)
  const load = () => fetch('/api/live/status').then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => {})
  useEffect(() => {
    load()
    const id = setInterval(load, 1500)
    return () => clearInterval(id)
  }, [])
  const start = () => fetch('/api/live/emulator/start?speed=120', { method: 'POST' }).then(load).catch(() => {})
  const stop = () => fetch('/api/live/emulator/stop', { method: 'POST' }).then(load).catch(() => {})
  if (!s) return null

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${s.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><Radio size={18} /></span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Живые данные с линии</h2>
            <p className="text-sm text-slate-500">
              {s.connected ? <>Поток идёт · источник «{s.feed}» · событий {s.events.toLocaleString('ru-RU')} · годных {s.good}</>
                : s.events ? <>Поток остановлен · последнее событие {Math.round(s.last_event_age_s ?? 0)} с назад</>
                : <>Завод ещё не подключён. Шлюз PLC/OPC UA шлёт события сюда — формат в docs/INTEGRATION.md</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {s.events > 0 && <SourceBadge source="fact" />}
          {s.emulator.running
            ? <button onClick={stop} className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"><Square size={14} />Остановить</button>
            : <button onClick={start} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"><Play size={14} />Запустить эмулятор PLC</button>}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {s.stations.map((st) => (
          <div key={st.id} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{st.name}</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="h-2 w-2 rounded-full transition-colors" style={{ background: st.state ? STATUS[st.state].hex : '#e2e8f0' }} />
                {st.state ? STATE_RU[st.state] : 'нет данных'}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400">{st.assets.join(' · ')}</div>
          </div>
        ))}
      </div>
      {s.emulator.running && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round(100 * s.emulator.progress)}%` }} /></div>
      )}
      <p className="mt-3 text-[11px] text-slate-400">Путь на заводе: PLC → OPC UA / MQTT → шлюз (Node-RED, Kepware) → Allur Flow. Эмулятор проигрывает смену событиями в тот же вход, что и настоящий шлюз; события пишутся в журнал с меткой источника.</p>
    </Card>
  )
}
