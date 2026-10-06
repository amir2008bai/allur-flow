import type { SimRun } from '../source'
import { BUFFERS, LINKS, LINK_RU, STATE_HEX, STATE_RU, STATUS_HEX, ZONES, ZONE_BY_STATION, linkStatus, type StationState, type Zone } from './layout'
import { useView } from './store'
import { ROLE_HEX } from './cause'
import { useCause } from './useCause'
import { causeLinks } from './CauseFx'

// Вид сверху в стиле чертежа. Единицы SVG — метры, та же раскладка, что и в 3D.
const TINT: Record<StationState, string> = { working: 'rgba(34,197,94,0.10)', starved: 'rgba(148,163,184,0.06)', blocked: 'rgba(245,158,11,0.14)', down: 'rgba(239,68,68,0.14)' }

function Glyphs({ zone }: { zone: Zone }) {
  const g = { fill: '#ffffff', stroke: '#94a3b8', strokeWidth: 0.08 }
  switch (zone.id) {
    case 'welding':
      return <>{[[-2.6, -2.4], [2.6, 2.4]].map(([x, z]) => <g key={x}><circle cx={x} cy={z} r={0.7} {...g} /><line x1={x} y1={z} x2={x + 1.6} y2={z} stroke="#f08a24" strokeWidth={0.35} strokeLinecap="round" /></g>)}</>
    case 'paint':
      return <rect x={-4.5} y={-3} width={9} height={6} rx={0.3} {...g} strokeDasharray="0.4 0.25" />
    case 'assembly':
      return <><rect x={-8} y={-1.1} width={16} height={2.2} rx={0.2} {...g} />{[-6, -2, 2, 6].map((x) => <rect key={x} x={x - 0.6} y={-2.55} width={1.2} height={0.3} {...g} />)}</>
    case 'qc':
      return <>{[-1.8, 1.8].map((z) => <rect key={z} x={-0.25} y={z - 0.25} width={0.5} height={0.5} {...g} />)}<line x1={0} y1={-1.8} x2={0} y2={1.8} stroke="#94a3b8" strokeWidth={0.08} strokeDasharray="0.3 0.2" /></>
    default:
      return <>{[-2.5, 0, 2.5].flatMap((x) => [-3.5, 3.5].map((z) => <rect key={`${x}${z}`} x={x - 0.9} y={z - 0.7} width={1.8} height={1.4} fill="#efe6d4" stroke="#cdb791" strokeWidth={0.06} />))}</>
  }
}

export default function Plan2D({ run }: { run: SimRun }) {
  const t = useView((s) => s.t)
  const selected = useView((s) => s.selected)
  const select = useView((s) => s.select)
  const frame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const bnStation = run.bottleneck.timeline[Math.min(Math.floor(t / 10), run.bottleneck.timeline.length - 1)]?.station
  const bnZone = bnStation ? ZONE_BY_STATION[bnStation]?.id : undefined
  const steps = useCause(run)?.steps ?? []

  return (
    <svg viewBox="-42 -13 97 23" className="h-full w-full select-none" preserveAspectRatio="xMidYMid meet" onClick={() => select(null)}>
      <defs>
        <pattern id="g1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#e8ecf1" strokeWidth="0.03" /></pattern>
        <pattern id="g5" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#g1)" /><path d="M5 0H0V5" fill="none" stroke="#dbe1e8" strokeWidth="0.05" /></pattern>
        {Object.entries(STATUS_HEX).map(([k, c]) => (
          <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill={c} /></marker>
        ))}
      </defs>
      <style>{'@keyframes dash{to{stroke-dashoffset:-1.2}} .flowing{animation:dash .6s linear infinite} @keyframes cdash{to{stroke-dashoffset:-3}} .cause{animation:cdash .5s linear infinite} @keyframes pulse2{0%{r:4;opacity:.6}100%{r:11;opacity:0}} .shock{animation:pulse2 1.4s ease-out infinite}'}</style>
      <rect x={-42} y={-13} width={97} height={23} fill="url(#g5)" />

      {/* потоки между участками */}
      {LINKS.map((l) => {
        const st = linkStatus(l, frame?.states)
        const x0 = l.from.x + l.from.w / 2 + 0.2, x1 = l.to.x - l.to.w / 2 - 0.2
        const y = l.buffer ? -4.6 : 0
        return (
          <g key={l.from.id}>
            <line x1={x0} y1={y} x2={x1} y2={y} stroke={STATUS_HEX[st]} strokeWidth={0.22} strokeDasharray="0.7 0.5" className={st === 'flow' ? 'flowing' : ''} markerEnd={`url(#arr-${st})`} />
            {l.buffer && <text x={(x0 + x1) / 2} y={y - 0.7} textAnchor="middle" fontSize={0.9} fill={STATUS_HEX[st]} fontWeight={600}>{LINK_RU[st]}</text>}
          </g>
        )
      })}

      {/* буферы: заполненные ячейки = кузова в очереди */}
      {BUFFERS.map((b) => {
        const cap = run.buffer_cap[b.id], level = frame?.buffers[b.id] ?? 0, cols = 4, rows = Math.ceil(cap / cols)
        return (
          <g key={b.id}>
            {Array.from({ length: cap }, (_, i) => {
              const c = i % cols, r = Math.floor(i / cols)
              const x = b.x + (c - (cols - 1) / 2) * 1.0, y = (r - (rows - 1) / 2) * 1.9
              return <rect key={i} x={x - 0.3} y={y - 0.6} width={0.6} height={1.2} rx={0.12}
                fill={i < level ? (b.from === 'welding' ? '#94a3b8' : '#3b5b8c') : '#ffffff'} stroke="#cbd5e1" strokeWidth={0.05} style={{ transition: 'fill .3s' }} />
            })}
            <text x={b.x} y={rows * 0.95 + 1.2} textAnchor="middle" fontSize={0.7} fill={level === 0 ? '#ef4444' : level >= cap ? '#d97706' : '#64748b'}>{level}/{cap}</text>
          </g>
        )
      })}

      {/* участки */}
      {ZONES.map((z) => {
        const st = z.station && frame ? (frame.states[z.station] as StationState) : null
        const isSel = selected === z.id
        return (
          <g key={z.id} transform={`translate(${z.x} ${z.z})`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); select(isSel ? null : z.id) }}>
            <rect x={-z.w / 2} y={-z.d / 2} width={z.w} height={z.d} rx={0.6}
              fill={st ? TINT[st] : '#ffffff'} stroke={isSel ? '#0f172a' : st ? STATE_HEX[st] : '#cbd5e1'} strokeWidth={isSel ? 0.25 : 0.12}
              style={{ transition: 'fill .4s, stroke .4s' }} />
            <Glyphs zone={z} />
            {st && st !== 'starved' && <rect x={-0.8} y={-0.4} width={1.6} height={0.8} rx={0.2} fill={z.id === 'welding' ? '#94a3b8' : '#3b5b8c'} />}
            <text x={-z.w / 2 + 0.6} y={-z.d / 2 + 1.5} fontSize={1.3} fontWeight={600} fill="#0f172a">{z.short}</text>
            {st && <g transform={`translate(${-z.w / 2 + 0.6} ${-z.d / 2 + 2.4})`}>
              <circle cx={0.3} cy={-0.28} r={0.3} fill={STATE_HEX[st]} className={st === 'down' ? 'animate-pulse' : ''} />
              <text x={0.85} y={0} fontSize={0.95} fill="#475569">{STATE_RU[st]}</text>
            </g>}
            {z.id === 'warehouse_out' && <text x={-z.w / 2 + 0.6} y={-z.d / 2 + 2.4} fontSize={0.95} fill="#475569">{frame?.good ?? 0} годных</text>}
            {bnZone === z.id && <g transform={`translate(${z.w / 2 - 1.1} ${-z.d / 2 + 1.1})`}><circle r={0.75} fill="#7c3aed" /><path d="M-0.3 -0.38 H0.3 M-0.3 0.38 H0.3 M-0.24 -0.38 L0.24 0.38 M0.24 -0.38 L-0.24 0.38" stroke="#fff" strokeWidth={0.12} strokeLinecap="round" /></g>}
          </g>
        )
      })}
      {/* причина → следствие: волна у причины и дуги по линии */}
      {steps.length > 0 && (() => {
        const z0 = ZONES.find((z) => z.id === steps[0].zone)!
        return <circle cx={z0.x} cy={z0.z} r={6} fill="none" stroke="#ef4444" strokeWidth={0.25} className="shock" />
      })()}
      {causeLinks(steps).map(([f, to]) => {
        const a = ZONES.find((z) => z.id === f.zone)!, b = ZONES.find((z) => z.id === to.zone)!
        const ya = a.z - a.d / 2 - 0.4, yb = b.z - b.d / 2 - 0.4, mx = (a.x + b.x) / 2, my = Math.min(ya, yb) - 3.5
        return <path key={f.zone + to.zone} d={`M ${a.x} ${ya} Q ${mx} ${my} ${b.x} ${yb}`} fill="none" stroke={ROLE_HEX[to.role]} strokeWidth={0.35} strokeDasharray="1 0.5" className="cause" markerEnd={`url(#arr-${to.role === 'result' ? 'idle' : 'stop'})`} />
      })}
      {steps.map((s) => {
        const z = ZONES.find((q) => q.id === s.zone)!
        return <g key={s.zone} transform={`translate(${z.x} ${z.z - z.d / 2 - 0.4})`}><circle r={0.9} fill={ROLE_HEX[s.role]} /><text y={0.35} textAnchor="middle" fontSize={1} fontWeight={700} fill="#fff">{s.order}</text></g>
      })}
      <text x={-41.5} y={9.5} fontSize={0.7} fill="#94a3b8">Вид сверху · сетка 1 м · компоновка условная</text>
    </svg>
  )
}
