import { toast } from '@/components/ui/sonner'

/**
 * Surface a backend reason (e.g. the proof / checklist gate) via the app's own toast -
 * never a native browser dialog.
 */
export function showActionError(e: unknown) {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string } | null
  const msg = err?.response?.data?.message ?? err?.message ?? 'Something went wrong.'
  toast.warning(Array.isArray(msg) ? msg.join('\n') : msg)
}
