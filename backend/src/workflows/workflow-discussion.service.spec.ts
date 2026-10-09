import { ForbiddenException, NotFoundException } from '@nestjs/common'
import {
  DiscussionCtx,
  WorkflowDiscussionService,
  discussionCtx,
  discussionRecipients,
  messageExcerpt,
} from './workflow-discussion.service'

/**
 * The instance discussion over a small in-memory Prisma: thread merge order (messages
 * of every step task + instance-level messages, replies under their message), migrated
 * notes, unread markers, mentions and who is told.
 */

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const TPL = 'tpl-1'
const RUN = 'run-1'
const NOW = new Date('2026-10-08T10:00:00Z')
const at = (min: number) => new Date(NOW.getTime() - (100 - min) * 60_000)

type Row = Record<string, any>

/** Prisma-ish `where` matcher: equality, null, in / not / lt / gt, AND / OR, `replies.some`. */
function matches(row: Row, where: any, all: Row[]): boolean {
  if (!where) return true
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') {
      if (!(v as any[]).every((w) => matches(row, w, all))) return false
      continue
    }
    if (k === 'OR') {
      if (!(v as any[]).some((w) => matches(row, w, all))) return false
      continue
    }
    if (k === 'replies') {
      const kids = all.filter((r) => r.reply_to_comment_id === row.id)
      if (!kids.some((kid) => matches(kid, (v as any).some, all))) return false
      continue
    }
    if (k === 'comment') {
      const parent = (row as any).__comment?.()
      if (!parent || !matches(parent, v, all)) return false
      continue
    }
    const val = row[k]
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      const o = v as any
      if ('in' in o && !o.in.includes(val)) return false
      if ('not' in o && (o.not === null ? val === null || val === undefined : val === o.not)) return false
      if ('lt' in o && !(val < o.lt)) return false
      if ('gt' in o && !(val > o.gt)) return false
      continue
    }
    if (v instanceof Date) {
      if (!(val instanceof Date) || val.getTime() !== v.getTime()) return false
      continue
    }
    if ((val ?? null) !== v) return false
  }
  return true
}

function sortBy(rows: Row[], orderBy: any): Row[] {
  const keys: [string, 'asc' | 'desc'][] = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map(
    (o: any) => Object.entries(o)[0] as [string, 'asc' | 'desc'],
  )
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = a[k] instanceof Date ? a[k].getTime() : a[k]
      const y = b[k] instanceof Date ? b[k].getTime() : b[k]
      if (x < y) return dir === 'asc' ? -1 : 1
      if (x > y) return dir === 'asc' ? 1 : -1
    }
    return 0
  })
}

function pick(row: Row, select: any): Row {
  if (!select) return { ...row }
  const out: Row = {}
  for (const k of Object.keys(select)) out[k] = row[k]
  return out
}

function world() {
  const comments: Row[] = []
  const reads: Row[] = []
  const taskFiles: Row[] = []
  const instanceFiles: Row[] = []
  const assignees: Row[] = []
  const escalations: Row[] = []
  const grants: Row[] = []
  const members: Row[] = []
  const users: Row[] = []
  const tasks: Row[] = []
  const activity: Row[] = []
  let seq = 0

  const table = (rows: Row[]) => ({
    findFirst: jest.fn(async ({ where, select, orderBy }: any = {}) => {
      const hit = sortBy(rows.filter((r) => matches(r, where, rows)), orderBy)[0]
      return hit ? pick(hit, select) : null
    }),
    findMany: jest.fn(async ({ where, select, orderBy, take, distinct }: any = {}) => {
      let list = sortBy(rows.filter((r) => matches(r, where, rows)), orderBy)
      if (distinct) {
        const seen = new Set<string>()
        list = list.filter((r) => {
          const key = distinct.map((d: string) => r[d]).join('|')
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }
      if (take) list = list.slice(0, take)
      return list.map((r) => pick(r, select))
    }),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where, rows)).length),
    create: jest.fn(async ({ data, select }: any) => {
      const r = { id: `id-${++seq}`, created_at: NOW, is_deleted: false, mentioned_user_ids: [], ...data }
      rows.push(r)
      return pick(r, select)
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where, rows))
      hit.forEach((r) => Object.assign(r, data))
      return { count: hit.length }
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.workflow_instance_id_user_id
      const hit = rows.find((r) => r.workflow_instance_id === key.workflow_instance_id && r.user_id === key.user_id)
      if (hit) Object.assign(hit, update)
      else rows.push({ id: `id-${++seq}`, ...create })
      return {}
    }),
  })

  // Steps: A (done, t-a: Asha), B (in progress, t-b: Bina + CC Chetan), C (not started).
  const instance = {
    id: RUN,
    name: 'ACME onboarding',
    workflow_template_id: TPL,
    triggered_by_user_id: 'u-runner',
    template: { created_by_user_id: 'u-creator' },
    steps: [
      { id: 'r-a', status: 'completed', task_id: 't-a', step_snapshot: { title: 'Collect documents', assigner_user_id: 'u-creator' }, returned_to_row_id: null as string | null, waiting_on_row_id: null as string | null },
      { id: 'r-b', status: 'active', task_id: 't-b', step_snapshot: { title: 'Verify documents', assigner_user_id: 'u-creator' }, returned_to_row_id: null as string | null, waiting_on_row_id: null as string | null },
      { id: 'r-c', status: 'pending', task_id: null, step_snapshot: { title: 'Issue PO', assigner_user_id: 'u-creator' }, returned_to_row_id: null as string | null, waiting_on_row_id: null as string | null },
    ],
  }
  tasks.push(
    { id: 't-a', organization_id: ORG, is_deleted: false, workflow_instance_step_id: 'r-a', created_by_user_id: 'u-creator', created_at: at(0) },
    { id: 't-b', organization_id: ORG, is_deleted: false, workflow_instance_step_id: 'r-b', created_by_user_id: 'u-creator', created_at: at(0) },
  )
  assignees.push(
    { organization_id: ORG, task_id: 't-a', user_id: 'u-asha', is_cc: false, removed_at: null },
    { organization_id: ORG, task_id: 't-b', user_id: 'u-bina', is_cc: false, removed_at: null },
    { organization_id: ORG, task_id: 't-b', user_id: 'u-chetan', is_cc: true, removed_at: null },
    { organization_id: ORG, task_id: 't-b', user_id: 'u-removed', is_cc: false, removed_at: at(1) },
  )
  grants.push({ organization_id: ORG, workflow_template_id: TPL, user_id: 'u-viewer', access_type: 'view' })
  for (const id of ['u-creator', 'u-runner', 'u-asha', 'u-bina', 'u-chetan', 'u-viewer', 'u-outsider', 'u-admin', 'u-removed']) {
    members.push({ organization_id: ORG, user_id: id, is_active: true, is_admin: id === 'u-admin' })
    users.push({ id, name: id.replace('u-', '').replace(/^./, (c) => c.toUpperCase()) })
  }

  const prisma: any = {
    taskComment: table(comments),
    workflowDiscussionRead: table(reads),
    taskAttachment: table(taskFiles),
    workflowInstanceAttachment: table(instanceFiles),
    taskAssignee: table(assignees),
    taskEscalation: table(escalations),
    workflowAccess: table(grants),
    organizationMember: table(members),
    user: table(users),
    task: {
      ...table(tasks),
      findFirst: jest.fn(async ({ where, select }: any) => {
        const t = tasks.find((x) => matches(x, where, tasks))
        if (!t) return null
        const out: Row = pick(t, { ...select, assignees: undefined })
        if (select?.assignees) {
          out.assignees = assignees.filter((a) => a.task_id === t.id && a.removed_at === null).map((a) => ({ user_id: a.user_id }))
        }
        return out
      }),
    },
    taskActivityLog: { create: jest.fn(async ({ data }: any) => activity.push(data)) },
    workflowInstance: {
      findFirst: jest.fn(async ({ where }: any) => (where.id === RUN && where.organization_id === ORG ? instance : null)),
    },
    workflowInstanceStep: {
      findFirst: jest.fn(async ({ where }: any) => {
        const s = instance.steps.find((x) => x.task_id === where.task_id)
        return s && where.organization_id === ORG ? { workflow_instance_id: RUN } : null
      }),
    },
  }
  const clock: any = { now: jest.fn(async () => NOW) }
  const notifications: any = {
    emit: jest.fn(async () => 1),
    userName: jest.fn(async (id: string) => users.find((u) => u.id === id)?.name ?? 'Someone'),
  }
  const engine: any = { recordEvent: jest.fn(async () => undefined) }
  const r2: any = {
    deleteObject: jest.fn(async () => undefined),
    getSignedDownloadUrl: jest.fn(async (key: string) => `https://signed/${key}`),
  }
  const files: any = {
    upload: jest.fn(async (_o: string, userId: string, _i: string, f: any, opts: any) => {
      const row = { id: `if-${++seq}`, organization_id: ORG, workflow_instance_id: RUN, comment_id: opts.commentId, file_name: f.originalname, mime_type: f.mimetype, size_bytes: f.size, uploaded_by_user_id: userId, created_at: NOW, deleted_at: null }
      instanceFiles.push(row)
      return { ...row, uploaded_by: { id: userId, name: 'x' }, in_comment: true }
    }),
  }
  const taskAttachments: any = {
    upload: jest.fn(async (_o: string, userId: string, taskId: string, f: any, commentId: string) => {
      const row = { id: `tf-${++seq}`, organization_id: ORG, task_id: taskId, comment_id: commentId, file_name: f.originalname, mime_type: f.mimetype, size_bytes: f.size, uploaded_by_user_id: userId, is_proof: false, proof_visibility: null, created_at: NOW, is_deleted: false }
      taskFiles.push(row)
      return row
    }),
  }
  const moduleRef: any = { get: jest.fn(() => taskAttachments) }
  const svc = new WorkflowDiscussionService(prisma, clock, notifications, engine, r2, files, moduleRef)
  const ctx: DiscussionCtx = discussionCtx(ORG, instance)
  const add = (over: Row) => {
    const r = {
      id: `m-${++seq}`,
      organization_id: ORG,
      workflow_instance_id: RUN,
      task_id: null,
      user_id: 'u-asha',
      body: 'hi',
      reply_to_comment_id: null,
      for_instance_step_id: null,
      mentioned_user_ids: [],
      sent_back_from_row_id: null,
      sent_back_to_row_id: null,
      is_deleted: false,
      created_at: NOW,
      ...over,
    }
    comments.push(r)
    return r
  }
  // `comment` relation for file rows.
  const linkFiles = () => {
    for (const f of [...taskFiles, ...instanceFiles]) {
      Object.defineProperty(f, '__comment', { value: () => comments.find((c) => c.id === f.comment_id), configurable: true })
    }
  }
  return { svc, ctx, prisma, notifications, engine, r2, files, taskAttachments, comments, reads, taskFiles, instanceFiles, instance, activity, add, linkFiles }
}

const viewer = (userId: string, canEdit = false) => ({ userId, isAdmin: false, canEdit })
const file = { originalname: 'offer.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('0123456789') }

describe('WorkflowDiscussionService — one thread per instance', () => {
  it('merges messages of every step task and the instance page in time order, replies under their message', async () => {
    const w = world()
    const onA = w.add({ task_id: 't-a', user_id: 'u-asha', body: 'Docs uploaded', created_at: at(10) })
    const onPage = w.add({ task_id: null, user_id: 'u-runner', body: 'Thanks all', created_at: at(30) })
    const onB = w.add({ task_id: 't-b', user_id: 'u-bina', body: 'PAN is blurry', created_at: at(20) })
    w.add({ task_id: 't-b', user_id: 'u-asha', body: 'Re-sent', reply_to_comment_id: onB.id, created_at: at(25) })
    // Another instance and another org never leak in.
    w.add({ workflow_instance_id: 'run-other', body: 'elsewhere', created_at: at(15) })
    w.add({ organization_id: OTHER_ORG, body: 'other org', created_at: at(16) })
    const page = await w.svc.thread(w.ctx, viewer('u-bina'))
    expect(page.messages.map((m) => m.body)).toEqual(['Docs uploaded', 'PAN is blurry', 'Thanks all'])
    expect(page.messages[1].replies.map((r) => [r.body, r.author?.name])).toEqual([['Re-sent', 'Asha']])
    // Person, not step: the author is named; the step it was written on is only data.
    expect(page.messages[0]).toMatchObject({ author: { id: 'u-asha', name: 'Asha' }, task_id: 't-a', for_step: null })
    expect(page.messages[2]).toMatchObject({ id: onPage.id, task_id: null, can_delete: false })
    expect(page.messages[0].id).toBe(onA.id)
    expect(page).toMatchObject({ has_more: false, next_before: null, total_count: 4 })
  })

  it('pages newest-last: the latest N, then older ones with `before`', async () => {
    const w = world()
    for (let i = 1; i <= 5; i++) w.add({ body: `m${i}`, created_at: at(i) })
    const p1 = await w.svc.thread(w.ctx, viewer('u-asha'), { limit: 2 })
    expect(p1.messages.map((m) => m.body)).toEqual(['m4', 'm5'])
    expect(p1.has_more).toBe(true)
    const p2 = await w.svc.thread(w.ctx, viewer('u-asha'), { limit: 2, before: p1.next_before })
    expect(p2.messages.map((m) => m.body)).toEqual(['m2', 'm3'])
    const p3 = await w.svc.thread(w.ctx, viewer('u-asha'), { limit: 2, before: p2.next_before })
    expect(p3.messages.map((m) => m.body)).toEqual(['m1'])
    expect(p3.has_more).toBe(false)
    await expect(w.svc.thread(w.ctx, viewer('u-asha'), { before: 'm-of-another-instance' })).rejects.toBeInstanceOf(NotFoundException)
  })

  it('keeps a removed message with live replies as a placeholder (no text, author or files)', async () => {
    const w = world()
    const parent = w.add({ body: 'secret', is_deleted: true, created_at: at(1) })
    w.add({ body: 'answer', reply_to_comment_id: parent.id, created_at: at(2) })
    w.add({ body: 'gone', is_deleted: true, created_at: at(3) })
    const page = await w.svc.thread(w.ctx, viewer('u-asha'))
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0]).toMatchObject({ deleted: true, body: '', author: null, can_delete: false })
    expect(page.messages[0].replies.map((r) => r.body)).toEqual(['answer'])
  })

  it('shows migrated notes (instance-level, tagged) and send-back reasons by step TITLE', async () => {
    const w = world()
    // A former WorkflowInstanceNote: no task, tagged for a later step.
    w.add({ id: 'note-old', task_id: null, user_id: 'u-runner', body: 'Budget is 5L', for_instance_step_id: 'r-c', created_at: at(5) })
    w.add({ task_id: 't-a', user_id: 'u-bina', body: 'PAN and Aadhaar differ', sent_back_from_row_id: 'r-b', sent_back_to_row_id: 'r-a', created_at: at(6) })
    const page = await w.svc.thread(w.ctx, viewer('u-asha'))
    expect(page.messages[0]).toMatchObject({ id: 'note-old', for_step: { row_id: 'r-c', title: 'Issue PO', status: 'pending' } })
    expect(page.messages[1].send_back).toEqual({ from_row_id: 'r-b', from_title: 'Verify documents', to_row_id: 'r-a', to_title: 'Collect documents' })
    // "Notes for this step" reads the same tagged messages.
    const tagged = await w.svc.taggedMessages(ORG, [RUN], 'r-c')
    expect(tagged.map((t) => [t.id, t.author_user_id, t.for_instance_step_id])).toEqual([['note-old', 'u-runner', 'r-c']])
  })
})

describe('WorkflowDiscussionService — posting', () => {
  it('a message from a step task page belongs to that task; from the instance page to the instance', async () => {
    const w = world()
    const onTask = await w.svc.post(w.ctx, viewer('u-bina'), { body: ' Need the PAN again ', task_id: 't-b' })
    expect(w.comments.at(-1)).toMatchObject({ organization_id: ORG, workflow_instance_id: RUN, task_id: 't-b', body: 'Need the PAN again', created_at: NOW })
    expect(onTask).toMatchObject({ body: 'Need the PAN again', task_id: 't-b', can_delete: true })
    expect(w.activity).toContainEqual(expect.objectContaining({ task_id: 't-b', action: 'comment_added' }))
    const onPage = await w.svc.post(w.ctx, viewer('u-viewer'), { body: 'Looks good' })
    expect(onPage.task_id).toBeNull()
    // A task that isn't this instance's is refused.
    await expect(w.svc.post(w.ctx, viewer('u-bina'), { body: 'x', task_id: 't-elsewhere' })).rejects.toThrow('That task isn’t part of this instance.')
  })

  it('a reply answers any message of this instance and hangs under its top message', async () => {
    const w = world()
    const top = w.add({ user_id: 'u-asha', body: 'top', created_at: at(1) })
    const reply = w.add({ user_id: 'u-bina', body: 'reply', reply_to_comment_id: top.id, created_at: at(2) })
    await w.svc.post(w.ctx, viewer('u-chetan'), { body: 'reply to reply', reply_to_id: reply.id })
    expect(w.comments.at(-1)).toMatchObject({ reply_to_comment_id: top.id })
    // Told: the replied-to author (Bina) among others.
    const told = w.notifications.emit.mock.calls.flatMap((c: any) => c[0].recipients)
    expect(told).toContain('u-bina')
    const foreign = w.add({ workflow_instance_id: 'run-other', body: 'x' })
    await expect(w.svc.post(w.ctx, viewer('u-asha'), { body: 'x', reply_to_id: foreign.id })).rejects.toThrow(
      'The message you are replying to was not found.',
    )
  })

  it('an empty message is allowed only when files follow', async () => {
    const w = world()
    await expect(w.svc.post(w.ctx, viewer('u-asha'), { body: '  ' })).rejects.toThrow('Write a message.')
    await expect(w.svc.post(w.ctx, viewer('u-asha'), { body: '', with_files: true })).resolves.toMatchObject({ body: '' })
  })

  it('keeps only mentions of people who can see the instance (active members)', async () => {
    const w = world()
    const out = await w.svc.post(w.ctx, viewer('u-asha'), {
      body: '@Viewer @Outsider @Removed please check',
      mention_user_ids: ['u-viewer', 'u-outsider', 'u-removed', 'u-viewer'],
    })
    expect(w.comments.at(-1)!.mentioned_user_ids).toEqual(['u-viewer'])
    expect(out.mentions).toEqual([{ id: 'u-viewer', name: 'Viewer' }])
  })

  it('offers @mentions of exactly the people who can see the instance', async () => {
    const w = world()
    const people = await w.svc.people(w.ctx)
    expect(people.map((p) => p.id).sort()).toEqual(['u-asha', 'u-bina', 'u-chetan', 'u-creator', 'u-runner', 'u-viewer'])
  })
})

describe('WorkflowDiscussionService — who is told', () => {
  const emits = (w: ReturnType<typeof world>) =>
    Object.fromEntries(w.notifications.emit.mock.calls.map((c: any) => [c[0].event_type, c[0]]))

  it('the step’s people, people already in the discussion, mentions — never the author or everyone in the instance', async () => {
    const w = world()
    w.add({ user_id: 'u-runner', body: 'earlier', created_at: at(1) })
    await w.svc.post(w.ctx, viewer('u-bina'), { body: 'Need the PAN again @Viewer', task_id: 't-b', mention_user_ids: ['u-viewer'] })
    const e = emits(w)
    expect(e.workflow_mention.recipients).toEqual(['u-viewer'])
    expect(e.workflow_mention).toMatchObject({ title: 'Bina mentioned you', body: '“Need the PAN again @Viewer”\nin “ACME onboarding”', link: '/dashboard/tasks/t-b' })
    // Step B's people (task creator + CC; Bina wrote it) + the earlier writer. Not Asha (step A), not the removed assignee.
    expect(e.workflow_discussion.recipients.sort()).toEqual(['u-chetan', 'u-creator', 'u-runner'])
    expect(e.workflow_discussion.title).toBe('Bina commented')
    expect(e.workflow_discussion.entity).toEqual({ type: 'workflow_instance', id: RUN })
  })

  it('a message on the instance page links to the instance page', async () => {
    const w = world()
    w.add({ user_id: 'u-asha', body: 'earlier', created_at: at(1) })
    await w.svc.post(w.ctx, viewer('u-viewer'), { body: 'All good' })
    expect(emits(w).workflow_discussion).toMatchObject({
      recipients: ['u-asha'],
      link: `/dashboard/tasks/workflows/${TPL}/instances/${RUN}`,
    })
  })

  it('an open send-back: both sides hear each other', async () => {
    const w = world()
    // B sent the instance back to A: B waits, A is redone and owes B an answer.
    w.instance.steps[0].status = 'active'
    w.instance.steps[0].returned_to_row_id = 'r-b'
    w.instance.steps[1].status = 'sent_back'
    w.instance.steps[1].waiting_on_row_id = 'r-a'
    const ctx = discussionCtx(ORG, w.instance)
    await w.svc.post(ctx, viewer('u-asha'), { body: 'Re-uploaded', task_id: 't-a' })
    expect(emits(w).workflow_discussion.recipients).toEqual(expect.arrayContaining(['u-bina', 'u-chetan']))
    w.notifications.emit.mockClear()
    // A reply to the send-back reason, written on the instance page, reaches both steps too.
    const reason = w.add({ task_id: 't-a', user_id: 'u-bina', body: 'Mismatch', sent_back_from_row_id: 'r-b', sent_back_to_row_id: 'r-a', created_at: at(2) })
    await w.svc.post(ctx, viewer('u-viewer'), { body: 'What exactly?', reply_to_id: reason.id })
    expect(emits(w).workflow_discussion.recipients).toEqual(expect.arrayContaining(['u-asha', 'u-bina', 'u-chetan']))
  })

  it('a message for a step that has started tells its workers; one that has not, no one yet', async () => {
    const w = world()
    await w.svc.post(w.ctx, viewer('u-runner'), { body: 'Use vendor list', for_row_id: 'r-b' })
    expect(emits(w).workflow_note_added).toMatchObject({ recipients: ['u-bina'], link: '/dashboard/tasks/t-b', title: 'New message for your step' })
    w.notifications.emit.mockClear()
    await w.svc.post(w.ctx, viewer('u-runner'), { body: 'Budget 5L', for_row_id: 'r-c' })
    expect(emits(w).workflow_note_added).toBeUndefined()
    await expect(w.svc.post(w.ctx, viewer('u-runner'), { body: 'x', for_row_id: 'r-a' })).rejects.toThrow(
      'Choose a step of this instance that isn’t done or skipped.',
    )
  })

  it('people who lost access are not told (admins still are)', async () => {
    const w = world()
    w.add({ user_id: 'u-outsider', body: 'from before', created_at: at(1) })
    w.add({ user_id: 'u-admin', body: 'admin note', created_at: at(2) })
    await w.svc.post(w.ctx, viewer('u-viewer'), { body: 'ping' })
    const r = emits(w).workflow_discussion.recipients
    expect(r).toContain('u-admin')
    expect(r).not.toContain('u-outsider')
  })

  it('discussionRecipients: each person once, by priority, author excluded, fail closed', () => {
    const out = discussionRecipients({
      authorId: 'a',
      stepPeople: ['a', 'b', 'c'],
      priorAuthors: ['c', 'd'],
      replyToAuthorId: 'e',
      mentioned: ['b', 'x'],
      sendBackPeople: ['f'],
      taggedStepPeople: ['c'],
      canSee: (id) => id !== 'x',
    })
    expect(out).toEqual({ mentioned: ['b'], tagged: ['c'], others: ['d', 'e', 'f'] })
    expect(messageExcerpt('')).toBe('Shared an attachment')
    expect(messageExcerpt('x'.repeat(120))).toBe(`“${'x'.repeat(100)}…”`)
  })
})

describe('WorkflowDiscussionService — unread', () => {
  it('counts others’ live messages after my marker; never read = all of them; mark-read clears it', async () => {
    const w = world()
    w.add({ user_id: 'u-asha', body: 'a', created_at: at(1) })
    w.add({ user_id: 'u-bina', body: 'mine', created_at: at(2) })
    w.add({ user_id: 'u-asha', body: 'gone', is_deleted: true, created_at: at(3) })
    expect(await w.svc.counts(ORG, RUN, 'u-bina')).toEqual({ count: 2, unread_count: 1, last_read_at: null })
    await w.svc.markRead(w.ctx, 'u-bina')
    expect(w.reads).toEqual([expect.objectContaining({ organization_id: ORG, workflow_instance_id: RUN, user_id: 'u-bina', last_read_at: NOW })])
    expect((await w.svc.counts(ORG, RUN, 'u-bina')).unread_count).toBe(0)
    w.add({ user_id: 'u-asha', body: 'new', created_at: new Date(NOW.getTime() + 60_000) })
    const page = await w.svc.thread(w.ctx, viewer('u-bina'))
    expect(page).toMatchObject({ unread_count: 1, last_read_at: NOW })
    // Someone else's marker is theirs alone.
    expect((await w.svc.counts(ORG, RUN, 'u-chetan')).unread_count).toBe(3)
  })

  it('the marker never moves back', async () => {
    const w = world()
    const later = new Date(NOW.getTime() + 3_600_000)
    w.reads.push({ organization_id: ORG, workflow_instance_id: RUN, user_id: 'u-bina', last_read_at: later })
    expect(await w.svc.markRead(w.ctx, 'u-bina')).toEqual({ last_read_at: later, unread_count: 0 })
  })
})

describe('WorkflowDiscussionService — removing, files', () => {
  it('its author, editors and admins remove a message; its files go with it', async () => {
    const w = world()
    const m = w.add({ task_id: 't-b', user_id: 'u-bina', body: 'with file' })
    w.taskFiles.push({ id: 'tf-1', organization_id: ORG, task_id: 't-b', comment_id: m.id, storage_key: 'k1', is_deleted: false })
    await expect(w.svc.remove(w.ctx, viewer('u-asha'), m.id)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(w.svc.remove(w.ctx, viewer('u-bina'), m.id)).resolves.toEqual({ id: m.id, deleted: true })
    expect(m).toMatchObject({ is_deleted: true, deleted_at: NOW })
    expect(w.taskFiles[0]).toMatchObject({ is_deleted: true })
    expect(w.r2.deleteObject).toHaveBeenCalledWith('k1')
    expect(w.activity).toContainEqual(expect.objectContaining({ task_id: 't-b', action: 'comment_deleted' }))
    const other = w.add({ user_id: 'u-asha', body: 'x' })
    await expect(w.svc.remove(w.ctx, viewer('u-creator', true), other.id)).resolves.toMatchObject({ deleted: true })
    const foreign = w.add({ workflow_instance_id: 'run-other', user_id: 'u-asha' })
    await expect(w.svc.remove(w.ctx, viewer('u-asha'), foreign.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('a file goes on your own message: with its step task, or as an instance file', async () => {
    const w = world()
    const onTask = w.add({ task_id: 't-b', user_id: 'u-bina' })
    const onPage = w.add({ task_id: null, user_id: 'u-bina' })
    await expect(w.svc.uploadFile(w.ctx, 'u-asha', onTask.id, file)).rejects.toThrow('You can only attach files to your own messages.')
    const f1 = await w.svc.uploadFile(w.ctx, 'u-bina', onTask.id, file)
    expect(w.taskAttachments.upload).toHaveBeenCalledWith(ORG, 'u-bina', 't-b', file, onTask.id)
    expect(f1).toMatchObject({ task_id: 't-b', file_name: 'offer.pdf' })
    const f2 = await w.svc.uploadFile(w.ctx, 'u-bina', onPage.id, file)
    expect(w.files.upload).toHaveBeenCalledWith(ORG, 'u-bina', RUN, file, { commentId: onPage.id })
    expect(f2).toMatchObject({ task_id: null })
    // Both show on their messages in the thread.
    const page = await w.svc.thread(w.ctx, viewer('u-asha'))
    expect(page.messages.map((m) => m.attachments.map((a) => a.id))).toEqual([[f1.id], [f2.id]])
  })

  it('downloads only files of live messages of THIS instance; private proofs stay private', async () => {
    const w = world()
    const m = w.add({ task_id: 't-b', user_id: 'u-bina' })
    const gone = w.add({ task_id: null, user_id: 'u-bina', is_deleted: true })
    const elsewhere = w.add({ workflow_instance_id: 'run-other', user_id: 'u-bina' })
    w.taskFiles.push(
      { id: 'tf-ok', organization_id: ORG, task_id: 't-b', comment_id: m.id, storage_key: 'k-ok', file_name: 'a.pdf', is_deleted: false, is_proof: false, task: { created_by_user_id: 'u-creator' } },
      { id: 'tf-proof', organization_id: ORG, task_id: 't-b', comment_id: m.id, storage_key: 'k-p', file_name: 'p.pdf', is_deleted: false, is_proof: true, proof_visibility: 'private', uploaded_by_user_id: 'u-bina', task: { created_by_user_id: 'u-creator' } },
      { id: 'tf-x', organization_id: ORG, task_id: 't-x', comment_id: elsewhere.id, storage_key: 'k-x', file_name: 'x.pdf', is_deleted: false, is_proof: false },
    )
    w.instanceFiles.push({ id: 'if-gone', organization_id: ORG, workflow_instance_id: RUN, comment_id: gone.id, storage_key: 'k-g', file_name: 'g.pdf', deleted_at: null })
    w.linkFiles()
    await expect(w.svc.downloadFile(w.ctx, viewer('u-asha'), 'tf-ok')).resolves.toEqual({ url: 'https://signed/k-ok', file_name: 'a.pdf' })
    await expect(w.svc.downloadFile(w.ctx, viewer('u-asha'), 'tf-proof')).rejects.toBeInstanceOf(NotFoundException)
    await expect(w.svc.downloadFile(w.ctx, viewer('u-bina'), 'tf-proof')).resolves.toMatchObject({ file_name: 'p.pdf' })
    await expect(w.svc.downloadFile(w.ctx, viewer('u-asha'), 'tf-x')).rejects.toBeInstanceOf(NotFoundException)
    await expect(w.svc.downloadFile(w.ctx, viewer('u-asha'), 'if-gone')).rejects.toBeInstanceOf(NotFoundException)
  })
})
