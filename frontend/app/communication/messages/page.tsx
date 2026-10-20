'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import {
  getConversations, createConversation, getMessages, sendMessage, markRead,
} from '@/lib/api/messaging'
import { getEmployees } from '@/lib/api/employees'
import { formatTime } from '@/lib/format'
import type { Conversation, Message } from '@/lib/types/communication'
import type { EmployeeProfile } from '@/lib/types'
import { MessageSquare, Plus, Send, Users, Search } from 'lucide-react'
import { io, Socket } from 'socket.io-client'
import { refreshAccessToken } from '@/lib/api/refresh'
import Tooltip from '@/components/ui/tooltip'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shell/page-header'

const SOCKET_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'

export default function MessagesPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewConv, setShowNewConv] = useState(false)
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [convType, setConvType] = useState<'direct' | 'group'>('direct')
  const [groupName, setGroupName] = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; timeout: ReturnType<typeof setTimeout> }>>({})
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks IDs of messages we already added optimistically so the socket echo is ignored
  const ownSentIds = useRef<Set<string>>(new Set())

  // Load conversations
  useEffect(() => {
    if (!orgId) return
    getConversations(orgId).then(setConversations)
  }, [orgId])

  // Load employees for new conversation dialog
  useEffect(() => {
    if (!orgId || !showNewConv) return
    getEmployees(orgId).then(setEmployees)
  }, [orgId, showNewConv])

  // Socket.io connection. Keyed on orgId too: the acting org is now derived from
  // the verified token (which changes on org switch), so the socket must reconnect
  // with the new org's token when the user switches orgs.
  useEffect(() => {
    if (!user?.id) return
    const socket = io(`${SOCKET_URL}/chat`, {
      // Send the verified session token, read FRESH on every (re)connect so a
      // reconnect after a token refresh uses the current token, not a stale one.
      auth: (cb) => cb({ token: localStorage.getItem('access_token') || '' }),
      // Prefer websocket, but fall back to long-polling so a transient WS
      // failure (e.g. backend restarting in dev) degrades gracefully.
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    // If the server denies the handshake (expired/invalid token), try ONE token
    // refresh and reconnect with the fresh token. If the refresh itself fails the
    // session is genuinely gone — stop and let normal logged-out handling take
    // over. No infinite retry loop.
    let triedRefresh = false
    socket.on('connect', () => {
      triedRefresh = false
    })
    socket.on('connect_error', async () => {
      if (socket.active) return // transient failure — socket.io auto-reconnects itself
      if (triedRefresh) return // already refreshed once this episode — don't loop
      triedRefresh = true
      try {
        await refreshAccessToken(localStorage.getItem('access_token'))
        socket.connect()
      } catch {
        /* refresh failed → truly logged out; leave the socket closed */
      }
    })

    socket.on('newMessage', (msg: Message) => {
      setMessages(prev => {
        // Skip messages we sent ourselves (already shown via optimistic update)
        if (ownSentIds.current.has(msg.id)) {
          ownSentIds.current.delete(msg.id)
          return prev
        }
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, msg]
      })
      setConversations(prev => prev.map(c =>
        c.id === msg.conversation_id ? { ...c, last_message: msg, updated_at: msg.created_at } : c
      ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()))
    })

    socket.on('typing', ({ userId: uid, userName, isTyping }: { userId: string; userName: string; isTyping: boolean }) => {
      if (uid === user.id) return
      setTypingUsers(prev => {
        if (!isTyping) {
          const next = { ...prev }
          if (next[uid]?.timeout) clearTimeout(next[uid].timeout)
          delete next[uid]
          return next
        }
        if (prev[uid]?.timeout) clearTimeout(prev[uid].timeout)
        const timeout = setTimeout(() => {
          setTypingUsers(p => { const n = { ...p }; delete n[uid]; return n })
        }, 3000)
        return { ...prev, [uid]: { name: userName, timeout } }
      })
    })

    socket.on('messageEdited', (updated: Message) => {
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
    })

    socket.on('messageDeleted', ({ msgId }: { msgId: string }) => {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true, body: '' } : m))
    })

    return () => { socket.disconnect() }
  }, [user?.id, orgId])

  // Join room and load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId || !orgId || !socketRef.current) return
    // orgId is no longer sent — the server derives the org from the verified token.
    socketRef.current.emit('join', { convId: activeConvId })
    getMessages(orgId, activeConvId).then(msgs => {
      setMessages(msgs)
      markRead(orgId, activeConvId)
      setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, unread_count: 0 } : c))
    })

    return () => {
      socketRef.current?.emit('leave', { convId: activeConvId })
    }
  }, [activeConvId, orgId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    if (!orgId || !activeConvId || !messageInput.trim() || sending || !user) return
    const body = messageInput.trim()
    setMessageInput('')
    setSending(true)

    // Optimistic: show message immediately
    const tempId = `temp-${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      conversation_id: activeConvId,
      sender_user_id: user.id,
      organization_id: orgId,
      body,
      is_deleted: false,
      attachment_urls: [],
      reply_to_message_id: undefined,
      reply_to_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sender: { id: user.id, name: user.name, email: user.email ?? '', role: '' },
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const real = await sendMessage(orgId, activeConvId, { body })
      // Register the real ID so the socket echo is ignored
      ownSentIds.current.add(real.id)
      // Swap optimistic with confirmed server message
      setMessages(prev => prev.map(m => m.id === tempId ? real : m))
    } catch {
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setMessageInput(body)
    } finally {
      setSending(false)
    }
  }, [orgId, activeConvId, messageInput, sending])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function emitTyping(isTyping: boolean) {
    if (!activeConvId || !socketRef.current) return
    socketRef.current.emit('typing', { convId: activeConvId, userName: user?.name ?? '', isTyping })
  }

  function handleInputChange(val: string) {
    setMessageInput(val)
    emitTyping(true)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 2000)
  }

  async function handleCreateConversation() {
    if (!orgId || selectedUsers.length === 0) return
    const conv = await createConversation(orgId, {
      type: convType,
      user_ids: selectedUsers,
      name: convType === 'group' ? groupName.trim() || undefined : undefined,
    })
    setConversations(prev => {
      const exists = prev.find(c => c.id === conv.id)
      return exists ? prev : [conv, ...prev]
    })
    setActiveConvId(conv.id)
    setShowNewConv(false)
    setSelectedUsers([])
    setGroupName('')
    setConvType('direct')
  }

  const activeConv = conversations.find(c => c.id === activeConvId)
  const typingList = Object.values(typingUsers).map(t => t.name)
  const filteredEmployees = employees.filter(e =>
    e.user_id !== user?.id && (
      !empSearch || e.user?.name?.toLowerCase().includes(empSearch.toLowerCase())
    )
  )

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col bg-surface-sunken px-6 pt-6 pb-4">
      <PageHeader
        title="Messages"
        actions={
          <Button onClick={() => setShowNewConv(true)}>
            <Plus size={16} />
            New conversation
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-card border border-border-light">
      {/* Sidebar */}
      <div className="w-72 bg-surface border-r border-border-light flex flex-col shrink-0">
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <MessageSquare size={32} className="text-muted mb-2" />
              <p className="text-label text-text-secondary">No conversations yet</p>
            </div>
          ) : (
            conversations.map(conv => {
              const isActive = conv.id === activeConvId
              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConvId(conv.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={[
                    'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full text-left px-4 py-3 border-b border-border-light hover:bg-surface-sunken transition-colors flex gap-3 items-start',
                    isActive ? 'bg-primary-subtle' : '',
                  ].join(' ')}
                >
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-label font-medium shrink-0">
                    {conv.type === 'group' ? <Users size={16} /> : (conv.display_name?.charAt(0).toUpperCase() ?? '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-label font-medium text-text-primary truncate">{conv.display_name ?? conv.name ?? 'Conversation'}</span>
                      {(conv.unread_count ?? 0) > 0 && (
                        <span className="ml-1 bg-primary text-primary-foreground text-meta font-medium rounded-full px-1.5 py-0.5 shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                    {conv.last_message && (
                      <p className="text-meta text-text-muted truncate mt-0.5">
                        {conv.last_message.is_deleted ? <em>Message deleted</em> : conv.last_message.body}
                      </p>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Chat Area */}
      {activeConvId && activeConv ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border-light bg-surface flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-label font-medium">
              {activeConv.type === 'group' ? <Users size={15} /> : (activeConv.display_name?.charAt(0).toUpperCase() ?? '?')}
            </div>
            <div>
              <p className="text-label font-medium text-text-primary">{activeConv.display_name ?? activeConv.name ?? 'Conversation'}</p>
              <p className="text-meta text-text-muted">{activeConv.members.length} members</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {messages.map(msg => {
              const isMine = msg.sender_user_id === user?.id
              return (
                <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!isMine && (
                    <div className="w-7 h-7 rounded-full bg-text-secondary flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0 mt-1">
                      {msg.sender?.name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={`max-w-[65%] flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}>
                    {!isMine && <span className="text-meta font-medium text-text-secondary">{msg.sender?.name}</span>}
                    {msg.reply_to_message && !msg.is_deleted && (
                      <div className={`text-meta text-text-secondary bg-surface-control px-2 py-1 rounded-control border-l-2 border-primary max-w-full truncate`}>
                        {msg.reply_to_message.body}
                      </div>
                    )}
                    <div className={[
                      'px-3 py-2 rounded-card text-label',
                      isMine ? 'bg-primary text-primary-foreground rounded-tr-none' : 'bg-surface border border-border-light text-text-primary rounded-tl-none',
                      msg.is_deleted ? 'italic opacity-60' : '',
                    ].join(' ')}>
                      {msg.is_deleted ? 'This message was deleted' : msg.body}
                    </div>
                    <span className="text-meta text-text-muted">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                </div>
              )
            })}
            {typingList.length > 0 && (
              <div className="text-meta text-text-muted italic">
                {typingList.join(', ')} {typingList.length === 1 ? 'is' : 'are'} typing…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-border-light bg-surface flex gap-2 items-end">
            <textarea
              value={messageInput}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              className="flex-1 border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary resize-none"
              style={{ maxHeight: 120, overflowY: 'auto' }}
            />
            <Tooltip label="Send message">
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!messageInput.trim() || sending}
                aria-label="Send message"
                className="shrink-0"
              >
                <Send size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageSquare size={48} className="text-muted mx-auto mb-3" />
            <p className="text-text-secondary font-medium">Select a conversation</p>
            <p className="text-label text-text-muted">or start a new one</p>
          </div>
        </div>
      )}

      </div>

      {/* New conversation dialog */}
      <Dialog
        open={showNewConv}
        onOpenChange={(next) => { if (!next) { setShowNewConv(false); setSelectedUsers([]); setEmpSearch('') } }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex gap-2 mb-4">
              {(['direct', 'group'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={convType === t}
                  onClick={() => { setConvType(t); setSelectedUsers([]) }}
                  className={`outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring flex-1 py-2 rounded-control text-label font-medium transition-colors ${convType === t ? 'bg-primary text-primary-foreground' : 'bg-surface-control text-text-secondary hover:bg-surface-control-pressed'}`}
                >
                  {t === 'direct' ? 'Direct message' : 'Group chat'}
                </button>
              ))}
            </div>

            {convType === 'group' && (
              <input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="Group name (optional)"
                className="w-full border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary mb-3"
              />
            )}

            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                placeholder="Search employees…"
                className="w-full pl-8 pr-3 py-2 border border-border rounded-control text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
              />
            </div>

            <div className="max-h-48 overflow-y-auto border border-border-light rounded-control mb-4">
              {filteredEmployees.map(emp => {
                const uid = emp.user_id
                const selected = selectedUsers.includes(uid)
                const disabled = convType === 'direct' && selectedUsers.length === 1 && !selected
                return (
                  <button
                    key={uid}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (convType === 'direct') {
                        setSelectedUsers(selected ? [] : [uid])
                      } else {
                        setSelectedUsers(prev => selected ? prev.filter(u => u !== uid) : [...prev, uid])
                      }
                    }}
                    className={[
                      'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-border-light last:border-0 transition-colors',
                      selected ? 'bg-primary-subtle' : 'hover:bg-surface-sunken',
                      disabled ? 'opacity-40 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-meta font-medium shrink-0">
                      {emp.user?.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-label font-medium text-text-primary">{emp.user?.name}</p>
                      <p className="text-meta text-text-muted">{emp.user?.email}</p>
                    </div>
                    {selected && <div className="ml-auto w-4 h-4 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-meta">✓</div>}
                  </button>
                )
              })}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setShowNewConv(false); setSelectedUsers([]); setEmpSearch('') }}>Cancel</Button>
            <Button onClick={handleCreateConversation} disabled={selectedUsers.length === 0}>
              {convType === 'direct' ? 'Open chat' : `Create group (${selectedUsers.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
