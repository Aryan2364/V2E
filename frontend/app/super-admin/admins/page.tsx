'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import apiClient from '@/lib/api/client'
import { ShieldCheck, Plus, PowerOff, Power, X, Eye, EyeOff, Loader2, Pencil, Trash2 } from 'lucide-react'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
import Tooltip from '@/components/ui/Tooltip'

interface AdminUser {
  id: string
  name: string
  email: string
  is_active: boolean
  created_at: string
}

function unwrap<T>(res: { data: { data?: T } | T }): T {
  const d = res.data as { data?: T }
  return d.data !== undefined ? (d.data as T) : (res.data as T)
}

const adminApi = {
  list: async (): Promise<AdminUser[]> => {
    const res = await apiClient.get('/api/v1/auth/admins')
    return unwrap<AdminUser[]>(res)
  },
  create: async (dto: { name: string; email: string; password: string }): Promise<AdminUser> => {
    const res = await apiClient.post('/api/v1/auth/admins', dto)
    return unwrap<AdminUser>(res)
  },
  toggle: async (id: string, is_active: boolean): Promise<AdminUser> => {
    const res = await apiClient.patch(`/api/v1/auth/admins/${id}/toggle`, { is_active })
    return unwrap<AdminUser>(res)
  },
  update: async (id: string, dto: { name?: string; email: string; password?: string }): Promise<AdminUser> => {
    const res = await apiClient.put(`/api/v1/auth/admins/${id}`, dto)
    return unwrap<AdminUser>(res)
  },
  revoke: async (id: string): Promise<AdminUser> => {
    const res = await apiClient.delete(`/api/v1/auth/admins/${id}`)
    return unwrap<AdminUser>(res)
  },
}
interface AddFormState {
  name: string
  email: string
  password: string
  showPassword: boolean
}

export default function AdminsPage() {
  const { user } = useAuth()
  const currentUserId = user?.id ?? ''

  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddFormState>({ name: '', email: '', password: '', showPassword: false })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)

  // Edit states
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null)
  const [editForm, setEditForm] = useState<AddFormState>({ name: '', email: '', password: '', showPassword: false })
  const [editError, setEditError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await adminApi.list()
      setAdmins(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function resetForm() {
    setForm({ name: '', email: '', password: '', showPassword: false })
    setFormError('')
    setShowAdd(false)
  }

  async function handleAdd() {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setFormError('All fields are required.')
      return
    }
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const created = await adminApi.create({ name: form.name.trim(), email: form.email.trim(), password: form.password })
      setAdmins((prev) => [...prev, created])
      resetForm()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to add admin.'
      setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(admin: AdminUser) {
    setActionId(admin.id)
    try {
      const updated = await adminApi.toggle(admin.id, !admin.is_active)
      setAdmins((prev) => prev.map((a) => a.id === updated.id ? updated : a))
    } catch {
      // ignore
    } finally {
      setActionId(null)
    }
  }

  function openEdit(admin: AdminUser) {
    setEditingAdmin(admin)
    setEditForm({ name: admin.name, email: admin.email, password: '', showPassword: false })
    setEditError('')
    setShowAdd(false)
  }

  function resetEditForm() {
    setEditingAdmin(null)
    setEditForm({ name: '', email: '', password: '', showPassword: false })
    setEditError('')
  }

  async function handleEdit() {
    if (!editingAdmin) return
    if (!editForm.email.trim() || !editForm.password) {
      setEditError('Email address and password are required to save changes.')
      return
    }
    if (editForm.password.length < 8) {
      setEditError('Password must be at least 8 characters.')
      return
    }
    setSaving(true)
    setEditError('')
    try {
      const updated = await adminApi.update(editingAdmin.id, {
        name: editForm.name.trim() || undefined,
        email: editForm.email.trim(),
        password: editForm.password
      })
      setAdmins((prev) => prev.map((a) => a.id === updated.id ? updated : a))
      resetEditForm()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save changes.'
      setEditError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke(admin: AdminUser) {
    if (!confirm(`Remove super admin access from ${admin.name}? They will no longer be able to log into the Admin Portal.`)) return
    setActionId(admin.id)
    try {
      await adminApi.revoke(admin.id)
      setAdmins((prev) => prev.filter((a) => a.id !== admin.id))
    } catch {
      // ignore
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary">Admin Users</h1>
          <p className="text-[15px] text-text-secondary mt-1">
            Manage who can access the Admin Portal at <span className="font-medium text-text-primary">/admin</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowAdd(true); setEditingAdmin(null) }}
          className="flex items-center gap-2 h-10 px-4 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition-colors"
        >
          <Plus size={15} />
          Add Admin
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-border-light rounded-[12px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[18px] font-semibold text-text-primary">New Super Admin</h2>
            <button
              type="button"
              onClick={resetForm}
              className="p-1.5 rounded-[6px] hover:bg-surface-control text-text-secondary transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Full name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                className="w-full h-10 px-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Email address</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@company.com"
                className="w-full h-10 px-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Password</label>
            <div className="relative max-w-sm">
              <input
                type={form.showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min. 8 characters"
                className="w-full h-10 px-3 pr-10 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setForm((f) => ({ ...f, showPassword: !f.showPassword }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {form.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              If the email already exists in the system, that user will be promoted to super admin — no new account is created.
            </p>
          </div>

          {formError && (
            <p className="text-sm text-danger mb-3">{formError}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="h-9 px-4 rounded-[8px] border-2 border-primary text-sm font-semibold text-primary-text bg-white hover:bg-primary-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleAdd}
              className="h-9 px-4 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors flex items-center gap-2"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Adding...' : 'Add Admin'}
            </button>
          </div>
        </div>
      )}

      {/* Edit form */}
      {editingAdmin && (
        <div className="bg-white border border-border-light rounded-[12px] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[18px] font-semibold text-text-primary">Edit Super Admin ({editingAdmin.name})</h2>
            <button
              type="button"
              onClick={resetEditForm}
              className="p-1.5 rounded-[6px] hover:bg-surface-control text-text-secondary transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Full name</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                className="w-full h-10 px-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Email address (Required)</label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@company.com"
                className="w-full h-10 px-3 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1.5">New Password (Required)</label>
            <div className="relative max-w-sm">
              <input
                type={editForm.showPassword ? 'text' : 'password'}
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min. 8 characters"
                className="w-full h-10 px-3 pr-10 rounded-[8px] border border-border text-sm text-text-primary placeholder:text-text-muted bg-white focus:border-primary focus:outline-hidden transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setEditForm((f) => ({ ...f, showPassword: !f.showPassword }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {editForm.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              For security, you must specify a new password (min. 8 characters) to save changes.
            </p>
          </div>

          {editError && (
            <p className="text-sm text-danger mb-3">{editError}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetEditForm}
              className="h-9 px-4 rounded-[8px] border-2 border-primary text-sm font-semibold text-primary-text bg-white hover:bg-primary-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleEdit}
              className="h-9 px-4 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors flex items-center gap-2"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Admin list */}
      <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={22} className="animate-spin text-text-muted" />
          </div>
        ) : admins.length === 0 ? (
          <div className="p-8 text-center">
            <ShieldCheck size={32} className="text-[#CBD5E1] mx-auto mb-2" />
            <p className="text-sm text-text-muted">No admin users found.</p>
          </div>
        ) : (
          <ResponsiveTable<AdminUser>
            className="border-0 shadow-none rounded-none"
            columns={[
              {
                key: 'name',
                header: 'Name',
                primary: true,
                render: (admin) => {
                  const isSelf = admin.id === currentUserId
                  return (
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary-subtle border border-primary-border flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-primary-text">
                          {admin.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">{admin.name}</p>
                        {isSelf && <p className="text-[11px] text-text-muted">You</p>}
                      </div>
                    </div>
                  )
                },
              },
              {
                key: 'email',
                header: 'Email',
                render: (admin) => <span className="text-text-secondary">{admin.email}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (admin) => (
                  <span className={[
                    'text-[11px] font-medium px-2.5 py-0.5 rounded-full border',
                    admin.is_active
                      ? 'bg-success-bg text-success border-success-border'
                      : 'bg-danger-bg text-danger border-danger-border',
                  ].join(' ')}>
                    {admin.is_active ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
              {
                key: 'added',
                header: 'Added',
                render: (admin) => (
                  <span className="text-text-muted text-xs whitespace-nowrap">
                    {new Date(admin.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (admin) => {
                  const isSelf = admin.id === currentUserId
                  const busy = actionId === admin.id
                  return (
                    <div className="flex items-center gap-1 md:justify-start justify-end">
                      {!isSelf && (
                        <Tooltip label={admin.is_active ? 'Deactivate' : 'Activate'}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggle(admin)}
                          aria-label={admin.is_active ? 'Deactivate' : 'Activate'}
                          className="p-1.5 rounded-[6px] hover:bg-surface-control text-text-secondary disabled:opacity-40 transition-colors"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : admin.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        </Tooltip>
                      )}
                      <Tooltip label="Edit admin">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(admin)}
                        aria-label="Edit admin"
                        className="p-1.5 rounded-[6px] hover:bg-primary-subtle text-primary-text disabled:opacity-40 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      </Tooltip>
                      <Tooltip label={
                          isSelf
                            ? 'You cannot revoke your own super admin access'
                            : admins.length <= 1
                              ? 'At least one super administrator account is required'
                              : 'Remove admin access'
                        }>
                      <button
                        type="button"
                        disabled={busy || isSelf || admins.length <= 1}
                        onClick={() => handleRevoke(admin)}
                        aria-label={
                          isSelf
                            ? 'You cannot revoke your own super admin access'
                            : admins.length <= 1
                              ? 'At least one super administrator account is required'
                              : 'Remove admin access'
                        }
                        className="p-1.5 rounded-[6px] hover:bg-danger-bg text-danger disabled:opacity-40 disabled:hover:bg-transparent disabled:text-[#CBD5E1] transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                      </Tooltip>
                    </div>
                  )
                },
              },
            ]}
            rows={admins}
            rowKey={(admin) => admin.id}
          />
        )}
      </div>

      <div className="bg-primary-subtle border border-primary-border rounded-[12px] px-5 py-4">
        <p className="text-sm font-semibold text-primary-text mb-1">Admin Portal credentials</p>
        <p className="text-sm text-primary-text">
          Login URL: <span className="font-medium">/admin</span> — Only users with super admin access can sign in here.
          Regular org accounts (even with the same email) use <span className="font-medium">/login</span> and land in their organization.
        </p>
      </div>
    </div>
  )
}
