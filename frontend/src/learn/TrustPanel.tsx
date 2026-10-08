import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, SourceBadge } from '../ui'

interface Trust {
  factory?: { hits: number; shifts: number; days: number }
  journal: { hits: number; shifts: number; month: string }
  interval: { coverage: number; target: number }
  model: { version: number; mae: number; mae_naive: number } | null
  real_data: { accuracy_model: number; accuracy_plan: number; interval_coverage: number; interval_target: number; dip_auc: number; test_days: number; dataset: string; url: string } | null
  twin_fit: { hidden_mttr: number; recovered_mttr: number; fact_down: number; twin_before: number; twin_after: number; days: number }
  learning: { votes: number; calib_inputs: number; camera_events: number }
  honesty: { assumptions: number }
}

const pct = (x: number) => `${Math.round(100 * x)}%`
const num = (x: number, d = 1) => x.toFixed(d).replace('.', ',')
const days = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней'}`

function Row({ value, title, sub, source }: { value: string; title: string; sub: string; source: 'sim' | 'forecast' | 'fact' | 'feedback' | 'calc' }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-slate-200">
      <div className="min-w-[76px] text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">{title}<SourceBadge source={source} /></div>
        <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
      </div>
    </div>
  )
}

/** «Почему верить двойнику»: все проверки, которые можно повторить, — в одной карточке. */
export default function TrustPanel() {
  const [t, setT] = useState<Trust | null>(null)
  useEffect(() => { fetch('/api/trust').then((r) => (r.ok ? r.json() : null)).then(setT).catch(() => {}) }, [])
  if (!t) return <Card className="p-6 text-sm text-slate-500">Собираю проверки…</Card>
  const r = t.real_data
  return (
    <Card className="p-6" >
      <div id="trust" className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={18} /></span>
        <div>
          <h2 className="text-lg font-semibold leading-tight">Почему верить двойнику</h2>
          <p className="mt-0.5 text-sm text-slate-500">Каждая цифра ниже — проверка, которую можно повторить.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {r && <Row value={pct(r.accuracy_model)} title="Точность на реальной фабрике" source="fact"
          sub={`прогноз до смены, ${days(r.test_days)} проверки · план даёт ${pct(r.accuracy_plan)} · коридор попал в ${pct(r.interval_coverage)} при обещанных ${pct(r.interval_target)}`} />}
        {t.factory && t.factory.shifts > 0 && <Row value={`${t.factory.hits} из ${t.factory.shifts}`} title="Прогноз смены против данных Allur" source="fact"
          sub={`утренний прогноз против выпуска из таблиц завода · данных пока ${days(t.factory.days)} — вывод предварительный`} />}
        <Row value={pct(t.interval.coverage)} title="Факт внутри коридора прогноза на 2 часа" source="forecast" sub={`обещаем ${pct(t.interval.target)} · коридор сам подстраивается`} />
        {t.model && <Row value={`−${pct(1 - t.model.mae / t.model.mae_naive)}`} title={`Ошибка LightGBM v${t.model.version} против простого прогноза`} source="forecast"
          sub={`${num(t.model.mae, 2)} против ${num(t.model.mae_naive, 2)} машин за 2 ч на потоках, которых модель не видела`} />}
        <Row value={`${num(t.twin_fit.recovered_mttr)} ≈ ${t.twin_fit.hidden_mttr}`} title="Подгонка восстановила скрытый параметр" source="sim"
          sub={`время ремонта окраски, мин · простои по журналу ${num(t.twin_fit.fact_down)} мин/сутки, двойник ${num(t.twin_fit.twin_before)} → ${num(t.twin_fit.twin_after)}`} />
        {r && <Row value={num(r.dip_auc, 2)} title="Провалы выпуска различаются" source="fact" sub="на реальной фабрике: 0,5 — угадывание, 1,0 — идеально" />}
        <Row value={`${t.learning.votes + t.learning.calib_inputs + t.learning.camera_events}`} title="Уроков сохранено в журнале обучения" source="feedback"
          sub={`ответов «да/нет» ${t.learning.votes} · ввод брака ${t.learning.calib_inputs} · событий камеры ${t.learning.camera_events} — переживают перезапуск`} />
        <Row value={`${t.honesty.assumptions}`} title="Допущений названо явно" source="calc" sub="у каждого числа метка источника; ИИ не может выдать число, которого нет в расчёте" />
      </div>
      <p className="mt-3 text-[11px] text-slate-400">Самопроверка расчёта: в журнале месяца ({t.journal.month}) утренний прогноз попал в коридор симулированной смены в {t.journal.hits} из {t.journal.shifts} — двойник сверяется сам с собой, это проверка, что расчёт не сломан, а не точность.</p>
      {r && <p className="mt-1 text-[11px] text-slate-400">Реальные данные: {r.dataset} · <a className="underline" href={r.url} target="_blank" rel="noreferrer">открытый источник</a></p>}
    </Card>
  )
}
