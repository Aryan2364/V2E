'use client'

interface DependencyArrowProps {
  fromLeft: number
  fromTop: number
  toLeft: number
  toTop: number
}

export default function DependencyArrow({ fromLeft, fromTop, toLeft, toTop }: DependencyArrowProps) {
  const x1 = fromLeft
  const y1 = fromTop
  const x2 = toLeft
  const y2 = toTop

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--warning)" />
        </marker>
      </defs>
      <path
        d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
        stroke="var(--warning)"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 2"
        markerEnd="url(#arrowhead)"
      />
    </svg>
  )
}
