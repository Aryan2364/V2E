'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { createConversation, sendMessage } from '@/lib/api/messaging'
import { useAuth } from '@/lib/auth/context'
import type { PeopleEvent } from '@/lib/types'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Send a wish</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {/* Recipient */}
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 ${avatarColor(recipient.name)}`}
              >
                {getInitials(recipient.name)}
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">{recipient.name}</p>
                <p className="text-xs text-text-secondary">{recipient.label}</p>
              </div>
            </div>

            {/* Message textarea */}
            <div>
              <Label className="mb-1.5">Message</Label>
              <Textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !message.trim() || sent}
            loading={sending}
          >
            {sent ? (
              'Sent!'
            ) : (
              <>
                <Send size={14} />
                Send wish
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
