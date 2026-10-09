import { BadRequestException, NotFoundException } from '@nestjs/common'
import { WorkflowFilesService } from './workflow-files.service'

const ORG = 'org-1'
const RUN = 'run-1'
const file = { originalname: 'offer.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('0123456789') }

function build() {
  const prisma: any = {
    workflowInstanceAttachment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'f-1', created_at: new Date(0), ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u-1', name: 'Asha' }]),
      findUnique: jest.fn().mockResolvedValue({ name: 'Asha' }),
    },
    task: { findMany: jest.fn().mockResolvedValue([]) },
    taskAttachment: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const r2: any = {
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
  }
  const engine: any = { recordEvent: jest.fn().mockResolvedValue(undefined) }
  return { prisma, r2, engine, svc: new WorkflowFilesService(prisma, r2, engine) }
}

describe('WorkflowFilesService — run files (R2 conventions)', () => {
  it('stores under the run key, records the row and a history event', async () => {
    const { svc, prisma, r2, engine } = build()
    const out = await svc.upload(ORG, 'u-1', RUN, file)
    expect(r2.putObject.mock.calls[0][0]).toMatch(new RegExp(`^org/${ORG}/workflows/${RUN}/[0-9a-f-]+\\.pdf$`))
    expect(prisma.workflowInstanceAttachment.create.mock.calls[0][0].data).toMatchObject({
      organization_id: ORG,
      workflow_instance_id: RUN,
      file_name: 'offer.pdf',
      size_bytes: 10,
      uploaded_by_user_id: 'u-1',
    })
    expect(out).toMatchObject({ id: 'f-1', file_name: 'offer.pdf', uploaded_by: { id: 'u-1', name: 'Asha' } })
    expect(engine.recordEvent).toHaveBeenCalledWith(ORG, RUN, 'file_added', 'Asha added “offer.pdf”', {
      actorUserId: 'u-1',
      metadata: { file_id: 'f-1', file_name: 'offer.pdf' },
    })
  })

  it('rejects disallowed types before touching storage, and rolls back the object if the insert fails', async () => {
    const a = build()
    await expect(a.svc.upload(ORG, 'u-1', RUN, { ...file, originalname: 'x.exe' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(a.r2.putObject).not.toHaveBeenCalled()

    const b = build()
    b.prisma.workflowInstanceAttachment.create.mockRejectedValue(new Error('db down'))
    await expect(b.svc.upload(ORG, 'u-1', RUN, file)).rejects.toThrow('db down')
    expect(b.r2.deleteObject).toHaveBeenCalledWith(b.r2.putObject.mock.calls[0][0])
  })

  it('looks files up under their run and org; removal soft-deletes and purges', async () => {
    const { svc, prisma, r2 } = build()
    prisma.workflowInstanceAttachment.findFirst.mockResolvedValue(null)
    await expect(svc.getDownloadUrl(ORG, RUN, 'f-x')).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.workflowInstanceAttachment.findFirst.mock.calls[0][0].where).toEqual({
      id: 'f-x',
      organization_id: ORG,
      workflow_instance_id: RUN,
      deleted_at: null,
    })

    prisma.workflowInstanceAttachment.findFirst.mockResolvedValue({ id: 'f-1', storage_key: 'k', file_name: 'offer.pdf' })
    expect(await svc.getDownloadUrl(ORG, RUN, 'f-1')).toEqual({ url: 'https://signed', file_name: 'offer.pdf' })
    await svc.remove(ORG, 'u-1', RUN, 'f-1')
    expect(prisma.workflowInstanceAttachment.updateMany.mock.calls[0][0].where).toEqual({
      id: 'f-1',
      organization_id: ORG,
      workflow_instance_id: RUN,
      deleted_at: null,
    })
    expect(r2.deleteObject).toHaveBeenCalledWith('k')
  })
})

describe('WorkflowFilesService — documents aggregate', () => {
  it('groups step files by row, hides private proofs from others, skips deleted tasks', async () => {
    const { svc, prisma } = build()
    prisma.task.findMany.mockResolvedValue([
      { id: 't-a', created_by_user_id: 'u-creator' },
      { id: 't-b', created_by_user_id: 'u-creator' },
    ])
    const att = (id: string, task_id: string, over: Record<string, unknown> = {}) => ({
      id,
      task_id,
      comment_id: null,
      file_name: `${id}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 1,
      uploaded_by_user_id: 'u-1',
      is_proof: false,
      proof_visibility: null,
      created_at: new Date(0),
      ...over,
    })
    prisma.taskAttachment.findMany.mockResolvedValue([
      att('a1', 't-a', { comment_id: 'c-1' }),
      att('a2', 't-a', { is_proof: true, proof_visibility: 'private' }),
      att('b1', 't-b', { is_proof: true, proof_visibility: 'everyone' }),
      att('gone', 't-deleted'),
    ])
    const out = await svc.documents(
      ORG,
      RUN,
      [
        { row_id: 'r-a', step_title: 'Collect', task_id: 't-a' },
        { row_id: 'r-b', step_title: 'Review', task_id: 't-b' },
        { row_id: 'r-c', step_title: 'Approve', task_id: null },
      ],
      { userId: 'u-viewer', isAdmin: false },
    )
    expect(prisma.taskAttachment.findMany.mock.calls[0][0].where).toMatchObject({
      organization_id: ORG,
      is_deleted: false,
      OR: [{ comment_id: null }, { comment: { is_deleted: false } }],
    })
    expect(out.step_files.map((g) => [g.row_id, g.files.map((f) => [f.id, f.in_comment, f.is_proof])])).toEqual([
      ['r-a', [['a1', true, false]]],
      ['r-b', [['b1', false, true]]],
    ])
    expect(out.run_files).toEqual([])
  })
})
