'use client'

import { useState } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { createConversation, sendMessage } from '@/lib/api/messaging'
import { useAuth } from '@/lib/auth/context'
import type { PeopleEvent } from '@/lib/types'

const avatarColors = [
  'bg-primary', 'bg-text-secondary', 'bg-text-secondary',
  'bg-warning', 'bg-success', 'bg-text-secondary',
]

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

function defaultMessage(name: string, eventType: 'birthday' | 'anniversary' | 'new_hiring' | 'work_anniversary', years?: number): string {
  const first = name.split(' ')[0]
  switch (eventType) {
    case 'birthday':
      return `Happy Birthday ${first}! 🎂 Wishing you a wonderful day filled with joy and happiness!`
    case 'anniversary':
      return years
        ? `Happy ${years}th Anniversary ${first}! 🎉 Wishing you both continued happiness!`
        : `Happy Anniversary ${first}! 🎉 Wishing you both joy and happiness!`
    case 'new_hiring':
      return `Welcome to the team, ${first}! 👋 We're really glad to have you here. Looking forward to working with you!`
    case 'work_anniversary':
      return years
        ? `Happy ${years}th Work Anniversary ${first}! 🎊 Thank you for your amazing contribution to the team!`
        : `Happy Work Anniversary ${first}! 🎊 Thank you for everything you do for the team!`
  }
}

interface WishModalProps {
  open: boolean
  onClose: () => void
  recipient: PeopleEvent
  eventType: 'birthday' | 'anniversary' | 'new_hiring' | 'work_anniversary'
}

export default function WishModal({ open, onClose, recipient, eventType }: WishModalProps) {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [message, setMessage] = useState(() =>
    defaultMessage(recipient.name, eventType, recipient.years)
  )
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    setError('')
    try {
      const conv = await createConversation(orgId, {
        type: 'direct',
        user_ids: [recipient.user_id],
      })
      await sendMessage(orgId, conv.id, { body: message.trim() })
      setSent(true)
      setTimeout(() => {
        onClose()
        setSent(false)
        setMessage(defaultMessage(recipient.name, eventType, recipient.years))
      }, 1200)
    } catch {
      setError('Failed to send message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-t-[16px] sm:rounded-[16px] shadow-xl w-full max-w-md border border-border-light overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light shrink-0">
          <h2 className="text-[16px] font-semibold text-text-primary">Send a wish</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:bg-surface-control hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Recipient */}
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${avatarColor(recipient.name)}`}
            >
              {getInitials(recipient.name)}
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{recipient.name}</p>
              <p className="text-xs text-text-secondary">{recipient.label}</p>
            </div>
          </div>

          {/* Message textarea */}
          <div>
            <label className="block text-[13px] font-medium text-text-secondary mb-1.5">
              Message
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full border border-border rounded-[8px] px-3 py-2.5 text-base sm:text-sm text-text-primary placeholder-text-muted resize-none focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 shrink-0">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-primary-text border-2 border-primary rounded-[8px] hover:bg-primary-subtle transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !message.trim() || sent}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-[8px] hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
          >
            {sent ? (
              'Sent!'
            ) : sending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send size={14} />
                Send wish
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
