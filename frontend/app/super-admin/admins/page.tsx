'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import apiClient from '@/lib/api/client'
import { PlusIcon, PowerOffIcon, PowerIcon, XIcon, PencilIcon, Trash2Icon, OctagonXIcon } from 'lucide-react'
import ResponsiveTable from '@/components/ui/ResponsiveTable'
import Tooltip from '@/components/ui/tooltip'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Badge } from '@/components/ui/badge'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatDate } from '@/lib/format'

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
}

const EMPTY_FORM: AddFormState = { name: '', email: '', password: '' }

export default function AdminsPage() {
  const { user } = useAuth()
  const currentUserId = user?.id ?? ''

  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  // Field errors sit under the field that is wrong; focus goes to the first one (kit 11.3, 39.3).
  type FieldErrors = { name?: string; email?: string; password?: string }
  const [addErrors, setAddErrors] = useState<FieldErrors>({})
  const [editErrors, setEditErrors] = useState<FieldErrors>({})
  const focusFirst = (prefix: string, errs: FieldErrors) => {
    const first = (['name', 'email', 'password'] as const).find((k) => errs[k])
    if (first) requestAnimationFrame(() => document.getElementById(`${prefix}-${first}`)?.focus())
  }
  const [actionId, setActionId] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null)

  // Edit states
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null)
  const [editForm, setEditForm] = useState<AddFormState>(EMPTY_FORM)
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
    setForm(EMPTY_FORM)
    setFormError('')
    setAddErrors({})
    setShowAdd(false)
  }

  async function handleAdd() {
    const errs: FieldErrors = {
      name: form.name.trim() ? undefined : 'Enter the full name of the admin.',
      email: form.email.trim() ? undefined : 'Enter an email address, like name@company.com.',
      password: !form.password ? 'Enter a password of at least 8 characters.' : form.password.length < 8 ? 'Use at least 8 characters in the password.' : undefined,
    }
    setAddErrors(errs)
    if (errs.name || errs.email || errs.password) { focusFirst('add', errs); return }
    setSaving(true)
    setFormError('')
    try {
      const created = await adminApi.create({ name: form.name.trim(), email: form.email.trim(), password: form.password })
      setAdmins((prev) => [...prev, created])
      resetForm()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not add the admin. Try again.'
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
    setEditForm({ name: admin.name, email: admin.email, password: '' })
    setEditError('')
    setEditErrors({})
    setShowAdd(false)
  }

  function resetEditForm() {
    setEditingAdmin(null)
    setEditForm(EMPTY_FORM)
    setEditError('')
    setEditErrors({})
  }

  async function handleEdit() {
    if (!editingAdmin) return
    const errs: FieldErrors = {
      name: editForm.name.trim() ? undefined : 'Enter the full name of the admin.',
      email: editForm.email.trim() ? undefined : 'Enter an email address, like name@company.com.',
      password: !editForm.password ? 'Enter a new password of at least 8 characters.' : editForm.password.length < 8 ? 'Use at least 8 characters in the password.' : undefined,
    }
    setEditErrors(errs)
    if (errs.name || errs.email || errs.password) { focusFirst('edit', errs); return }
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
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not save the admin. Try again.'
      setEditError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke(admin: AdminUser) {
    setActionId(admin.id)
    try {
      await adminApi.revoke(admin.id)
      setAdmins((prev) => prev.filter((a) => a.id !== admin.id))
    } catch {
      // ignore
    } finally {
      setActionId(null)
      setRevokeTarget(null)
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Admin users"
        meta={
          <>
            Manage who can access the Admin Portal at{' '}
            <span className="font-medium text-text-primary">/admin</span>.
          </>
        }
        actions={
          <Button onClick={() => { setShowAdd(true); setEditingAdmin(null) }}>
            <PlusIcon size={15} />
            Add admin
          </Button>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Add form */}
        {showAdd && (
          <div className="rounded-card border border-border-light bg-surface p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-section font-medium text-text-primary">New super admin</h2>
              <Tooltip label="Close">
                <Button type="button" onClick={resetForm} aria-label="Close" variant="ghost" size="icon">
                  <XIcon size={16} />
                </Button>
              </Tooltip>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="add-name" required>Full name</Label>
                <Input
                  id="add-name"
                  value={form.name}
                  onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setAddErrors((p) => ({ ...p, name: undefined })) }}
                  aria-invalid={addErrors.name ? true : undefined}
                  placeholder="For example, Jane Smith"
                  className="mt-2 max-w-none"
                />
                <InlineFieldError>{addErrors.name}</InlineFieldError>
              </div>
              <div>
                <Label htmlFor="add-email" required>
                  Email address
                </Label>
                <Input
                  id="add-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => { setForm((f) => ({ ...f, email: e.target.value })); setAddErrors((p) => ({ ...p, email: undefined })) }}
                  aria-invalid={addErrors.email ? true : undefined}
                  placeholder="For example, jane@company.com"
                  className="mt-2 max-w-none"
                />
                <InlineFieldError>{addErrors.email}</InlineFieldError>
              </div>
            </div>

            <div className="mb-4">
              <Label htmlFor="add-password" required>
                Password
              </Label>
              <PasswordInput
                id="add-password"
                value={form.password}
                onChange={(e) => { setForm((f) => ({ ...f, password: e.target.value })); setAddErrors((p) => ({ ...p, password: undefined })) }}
                aria-invalid={addErrors.password ? true : undefined}
                className="mt-2 max-w-sm"
              />
              <InlineFieldError>{addErrors.password}</InlineFieldError>
              <p className="mt-2 text-label text-text-muted">
                If the email already exists in the system, that user will be promoted to super admin — no new account is created.
              </p>
            </div>

            {formError ? (
              <Banner variant="danger" className="mb-4">
                <OctagonXIcon />
                <BannerDescription>{formError}</BannerDescription>
              </Banner>
            ) : null}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
              <Button loading={saving} loadingLabel="Adding" onClick={handleAdd}>
                Add admin
              </Button>
            </div>
          </div>
        )}

        {/* Edit form */}
        {editingAdmin && (
          <div className="rounded-card border border-border-light bg-surface p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-section font-medium text-text-primary">
                Edit super admin ({editingAdmin.name})
              </h2>
              <Tooltip label="Close">
                <Button type="button" onClick={resetEditForm} aria-label="Close" variant="ghost" size="icon">
                  <XIcon size={16} />
                </Button>
              </Tooltip>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-name" required>Full name</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) => { setEditForm((f) => ({ ...f, name: e.target.value })); setEditErrors((p) => ({ ...p, name: undefined })) }}
                  aria-invalid={editErrors.name ? true : undefined}
                  placeholder="For example, Jane Smith"
                  className="mt-2 max-w-none"
                />
                <InlineFieldError>{editErrors.name}</InlineFieldError>
              </div>
              <div>
                <Label htmlFor="edit-email" required>
                  Email address
                </Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => { setEditForm((f) => ({ ...f, email: e.target.value })); setEditErrors((p) => ({ ...p, email: undefined })) }}
                  aria-invalid={editErrors.email ? true : undefined}
                  placeholder="For example, jane@company.com"
                  className="mt-2 max-w-none"
                />
                <InlineFieldError>{editErrors.email}</InlineFieldError>
              </div>
            </div>

            <div className="mb-4">
              <Label htmlFor="edit-password" required>
                New password
              </Label>
              <PasswordInput
                id="edit-password"
                value={editForm.password}
                onChange={(e) => { setEditForm((f) => ({ ...f, password: e.target.value })); setEditErrors((p) => ({ ...p, password: undefined })) }}
                aria-invalid={editErrors.password ? true : undefined}
                className="mt-2 max-w-sm"
              />
              <InlineFieldError>{editErrors.password}</InlineFieldError>
              <p className="mt-2 text-label text-text-muted">
                For security, you must specify a new password (min. 8 characters) to save changes.
              </p>
            </div>

            {editError ? (
              <Banner variant="danger" className="mb-4">
                <OctagonXIcon />
                <BannerDescription>{editError}</BannerDescription>
              </Banner>
            ) : null}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={resetEditForm}>
                Cancel
              </Button>
              <Button loading={saving} loadingLabel="Saving" onClick={handleEdit}>
                Save admin
              </Button>
            </div>
          </div>
        )}

        {/* Admin list */}
        <div className="overflow-hidden rounded-card border border-border-light bg-surface shadow-card">
          {loading ? (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : admins.length === 0 ? (
            <EmptyState variant="nothing-yet" heading="No admin users yet">
              Add a super admin to give them access to the Admin Portal.
            </EmptyState>
          ) : (
            <ResponsiveTable<AdminUser>
              className="rounded-none border-0 shadow-none"
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  primary: true,
                  render: (admin) => {
                    const isSelf = admin.id === currentUserId
                    return (
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary-subtle">
                          <span className="text-label font-medium text-primary-text">
                            {admin.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{admin.name}</p>
                          {isSelf && <p className="text-meta text-text-muted">You</p>}
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
                    <Badge variant={admin.is_active ? 'success' : 'danger'}>
                      {admin.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  ),
                },
                {
                  key: 'added',
                  header: 'Added',
                  render: (admin) => (
                    <span className="whitespace-nowrap text-meta text-text-muted">
                      {formatDate(admin.created_at)}
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
                      <div className="flex items-center justify-end gap-1 md:justify-start">
                        {!isSelf && (
                          <Tooltip label={admin.is_active ? 'Deactivate' : 'Activate'}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() => handleToggle(admin)}
                              aria-label={admin.is_active ? 'Deactivate' : 'Activate'}
                            >
                              {admin.is_active ? <PowerOffIcon size={14} /> : <PowerIcon size={14} />}
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip label="Edit admin">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            onClick={() => openEdit(admin)}
                            aria-label="Edit admin"
                          >
                            <PencilIcon size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip
                          label={
                            isSelf
                              ? 'You cannot revoke your own super admin access'
                              : admins.length <= 1
                                ? 'At least one super administrator account is required'
                                : 'Remove admin access'
                          }
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={busy || isSelf || admins.length <= 1}
                            onClick={() => setRevokeTarget(admin)}
                            aria-label="Remove admin access"
                            className="text-danger hover:bg-danger-bg"
                          >
                            <Trash2Icon size={14} />
                          </Button>
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

        <div className="rounded-card border border-primary-border bg-primary-subtle px-4 py-4">
          <p className="mb-1 text-body font-medium text-primary-text">Admin portal credentials</p>
          <p className="text-body text-primary-text">
            Login URL: <span className="font-medium">/admin</span> — Only users with super admin access can sign in here.
            Regular org accounts (even with the same email) use <span className="font-medium">/login</span> and land in their organization.
          </p>
        </div>
      </div>

      <AlertDialog open={!!revokeTarget} onOpenChange={(next) => { if (!next) setRevokeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove super admin access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget
                ? `${revokeTarget.name} will no longer be able to log into the Admin Portal.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => revokeTarget && handleRevoke(revokeTarget)}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
