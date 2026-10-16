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
            <Star key={n} size={20} className={n <= existingRating ? 'text-[#D97706] fill-[#D97706]' : 'text-[#E2E8F0]'} />
          ))}
        </div>
        {existingComment && <p className="text-sm text-[#475569] italic">"{existingComment}"</p>}
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
              className={n <= (hovered || rating) ? 'text-[#D97706] fill-[#D97706]' : 'text-[#CBD5E1]'}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)"
        rows={2}
        className="w-full px-3 py-2 border border-[#CBD5E1] rounded-[8px] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:outline-hidden resize-none"
      />
      <button
        type="button"
        onClick={() => rating > 0 && onSubmit(rating, comment)}
        disabled={rating === 0 || submitting}
        className="self-start flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
      >
        {submitting ? 'Submitting...' : 'Submit Rating'}
      </button>
    </div>
  )
}
