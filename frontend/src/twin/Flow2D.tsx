import { Background, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, getStraightPath, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import type { SimRun } from '../source'
import { BUFFERS, STATE_HEX, STATE_RU, ZONES, ZONE_BY_STATION, type StationState, type ZoneId } from './layout'
import { useView } from './store'
import { BottleneckBadge } from '../theme'

type ZoneData = { name: string; equipment: string[]; state: StationState | null; selected: boolean; bottleneck: boolean; good?: number }
type BufData = { level: number; cap: number; flowing: boolean }

function ZoneNode({ data }: NodeProps<Node<ZoneData>>) {
  const st = data.state
  const tone = st === 'down' ? 'ring-red-400 bg-red-50' : st === 'blocked' ? 'ring-amber-300 bg-amber-50' : 'ring-slate-200 bg-white'
  return (
    <div className={`w-40 cursor-pointer rounded-2xl px-4 py-3 shadow-sm ring-1 ${tone} ${data.selected ? '!ring-2 !ring-slate-900' : ''}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{data.name}</span>
        {data.bottleneck && <BottleneckBadge size={11} />}
      </div>
      {st ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
          <span className={`h-2 w-2 rounded-full ${st === 'down' ? 'animate-pulse' : ''}`} style={{ background: STATE_HEX[st] }} />
          {STATE_RU[st]}
        </div>
      ) : (
        <div className="mt-1 text-xs text-slate-500">{data.good !== undefined ? `${data.good} годных` : 'склад'}</div>
      )}
      {data.equipment.length > 0 && <div className="mt-1 text-[11px] text-slate-400">{data.equipment.join(' · ')}</div>}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

function BufferEdge(props: EdgeProps<Edge<BufData>>) {
  const [path, lx, ly] = getStraightPath(props)
  const d = props.data!
  const full = d.level >= d.cap
  const empty = d.level === 0
  return (
    <>
      <BaseEdge path={path} style={{ stroke: full ? '#f59e0b' : '#94a3b8', strokeWidth: 2, strokeDasharray: d.flowing ? '6 6' : undefined, animation: d.flowing ? 'flow 0.6s linear infinite' : undefined }} />
      <EdgeLabelRenderer>
        <div style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly + 26}px)` }} className="absolute text-center">
          <div className="flex gap-0.5">
            {Array.from({ length: d.cap }, (_, i) => <span key={i} className={`h-3 w-1.5 rounded-sm ${i < d.level ? (full ? 'bg-amber-400' : 'bg-slate-700') : 'bg-slate-200'}`} />)}
          </div>
          <div className={`mt-0.5 text-[10px] ${empty ? 'text-red-500' : full ? 'text-amber-600' : 'text-slate-500'}`}>{d.level}/{d.cap}{empty ? ' пусто' : full ? ' полон' : ''}</div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { zone: ZoneNode }
const edgeTypes = { buffer: BufferEdge }

export default function Flow2D({ run }: { run: SimRun }) {
  const t = useView((s) => s.t)
  const selected = useView((s) => s.selected)
  const select = useView((s) => s.select)
  const frame = run.frames[Math.min(Math.floor(t), run.frames.length - 1)]
  const bnStation = run.bottleneck.timeline[Math.min(Math.floor(t / 10), run.bottleneck.timeline.length - 1)]?.station
  const bnZone = bnStation ? ZONE_BY_STATION[bnStation]?.id : undefined

  const nodes: Node<ZoneData>[] = useMemo(() => ZONES.map((z, i) => ({
    id: z.id, type: 'zone', position: { x: i * 230, y: 0 }, draggable: false,
    data: {
      name: z.name, equipment: z.equipment, selected: selected === z.id, bottleneck: bnZone === z.id,
      state: z.station && frame ? (frame.states[z.station] as StationState) : null,
      good: z.id === 'warehouse_out' ? frame?.good : undefined,
    },
  })), [frame, selected, bnZone])

  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = []
    for (let i = 0; i < ZONES.length - 1; i++) {
      const a = ZONES[i], b = ZONES[i + 1]
      const buf = BUFFERS.find((x) => x.from === a.id && x.to === b.id)
      const down = b.station && frame ? frame.states[b.station] : 'working'
      list.push(buf
        ? { id: buf.id, source: a.id, target: b.id, type: 'buffer', data: { level: frame?.buffers[buf.id] ?? 0, cap: run.buffer_cap[buf.id], flowing: down === 'working' } }
        : { id: `${a.id}-${b.id}`, source: a.id, target: b.id, style: { stroke: '#cbd5e1', strokeWidth: 2 } })
    }
    return list
  }, [frame, run.buffer_cap])

  return (
    <div className="h-full w-full">
      <style>{'@keyframes flow { to { stroke-dashoffset: -12; } }'}</style>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.15 }}
        nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => select(selected === n.id ? null : (n.id as ZoneId))} onPaneClick={() => select(null)}>
        <Background color="#e2e8f0" gap={24} />
      </ReactFlow>
    </div>
  )
}
