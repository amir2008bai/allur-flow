import { Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { COMPS, LAYERS, LAYER_BY, STATUS_RU, type Comp } from './model'

type D = { c: Comp; selected: boolean; dim: boolean }
const COL_W = 250
const ROW_H = 92

function CompNode({ data }: NodeProps<Node<D>>) {
  const { c, selected, dim } = data
  const layer = LAYER_BY[c.layer]
  const st = STATUS_RU[c.status]
  return (
    <div className={`w-52 cursor-pointer rounded-2xl bg-white px-3.5 py-2.5 shadow-sm ring-1 transition ${selected ? 'ring-2 ring-slate-900' : 'ring-slate-200'} ${dim ? 'opacity-30' : ''} ${c.status === 'plan' ? 'border border-dashed border-slate-300' : ''}`}
      style={{ borderLeft: c.status === 'plan' ? undefined : `4px solid ${layer.hex}` }}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="text-[13px] font-semibold leading-tight text-slate-900">{c.name}</div>
      <div className="mt-0.5 truncate text-[11px] text-slate-500">{c.tech}</div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full" style={{ background: st.hex }} />{st.label}</div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

function ColumnLabel({ data }: NodeProps<Node<{ name: string; hex: string }>>) {
  return <div className="w-52 text-center text-xs font-semibold uppercase tracking-wide" style={{ color: data.hex }}>{data.name}</div>
}

const nodeTypes = { comp: CompNode, col: ColumnLabel }

/** Поток данных слева направо: завод → приём → хранение → ядро → сервисы → экраны. */
export default function ArchFlow({ selected, onSelect, height = 560 }: { selected: string | null; onSelect: (id: string | null) => void; height?: number }) {
  const linked = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    COMPS.forEach((c) => (c.to ?? []).forEach((t) => { if (c.id === selected) s.add(t); if (t === selected) s.add(c.id) }))
    return s
  }, [selected])

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = LAYERS.map((l, i) => ({ id: `col-${l.id}`, type: 'col', position: { x: i * COL_W, y: -48 }, draggable: false, selectable: false, data: { name: l.short, hex: l.hex } }))
    LAYERS.forEach((l, i) => {
      const list = COMPS.filter((c) => c.layer === l.id)
      list.forEach((c, j) => out.push({ id: c.id, type: 'comp', position: { x: i * COL_W, y: j * ROW_H }, draggable: false,
        data: { c, selected: selected === c.id, dim: !!linked && !linked.has(c.id) } }))
    })
    return out
  }, [selected, linked])

  const edges = useMemo<Edge[]>(() => COMPS.flatMap((c) => (c.to ?? []).map((t) => {
    const on = !selected || c.id === selected || t === selected
    const hex = LAYER_BY[c.layer].hex
    const back = LAYERS.findIndex((l) => l.id === COMPS.find((x) => x.id === t)!.layer) <= LAYERS.findIndex((l) => l.id === c.layer)
    return {
      id: `${c.id}-${t}`, source: c.id, target: t, type: 'smoothstep', animated: on,
      style: { stroke: on && selected ? hex : '#94a3b8', strokeWidth: on && selected ? 2 : 1.2, opacity: on ? 0.9 : 0.15 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: on && selected ? hex : '#94a3b8' },
      ...(back ? { pathOptions: { offset: 18 } } : {}),
    } as Edge
  })), [selected])

  return (
    <div style={{ height }} className="overflow-hidden rounded-2xl bg-slate-50/60 ring-1 ring-slate-100">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08 }}
        nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} panOnScroll={false} zoomOnScroll={false} preventScrolling={false}
        minZoom={0.3} maxZoom={1.5} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => { if (n.type === 'comp') onSelect(n.id === selected ? null : n.id) }} onPaneClick={() => onSelect(null)}>
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}
