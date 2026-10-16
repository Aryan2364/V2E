import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  title?: string
}

export default function Card({ children, className = '', title }: CardProps) {
  return (
    <div
      className={[
        'bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title && (
        <h3 className="text-[18px] font-semibold text-text-primary mb-4">
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}
