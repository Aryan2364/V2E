'use client'

import React, { useState } from 'react'
import { Star } from 'lucide-react'

interface Props {
  onSubmit: (rating: number, comment: string) => void
  submitting?: boolean
  existingRating?: number
  existingComment?: string
}

export default function RatingWidget({ onSubmit, submitting, existingRating, existingComment }: Props) {
  const [rating, setRating] = useState(existingRating ?? 0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState(existingComment ?? '')

  if (existingRating) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={20} className={n <= existingRating ? 'text-warning fill-warning' : 'text-muted'} />
          ))}
        </div>
        {existingComment && <p className="text-body text-text-secondary italic">"{existingComment}"</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            className="p-0.5"
          >
            <Star
              size={24}
              className={n <= (hovered || rating) ? 'text-warning fill-warning' : 'text-muted'}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)"
        rows={2}
        className="w-full px-3 py-2 border border-border rounded-[8px] text-body text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-hidden resize-none"
      />
      <button
        type="button"
        onClick={() => rating > 0 && onSubmit(rating, comment)}
        disabled={rating === 0 || submitting}
        className="self-start flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-body font-medium text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
      >
        {submitting ? 'Submitting...' : 'Submit Rating'}
      </button>
    </div>
  )
}
