import { ReplayService } from './replay.service'

/**
 * Replay drives the day-granular engines once per simulated day. Workflow steps
 * waiting for their start time must start on their own simulated day (right after
 * that day's schedules fire), not all at the end of the catch-up.
 */
describe('ReplayService — workflow waiting steps', () => {
  it('starts waiting workflow steps day by day, after each day’s schedules', async () => {
    const calls: string[] = []
    const day = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const epoch = new Date(2026, 9, 5, 9, 0, 0)
    const now = new Date(2026, 9, 7, 15, 0, 0)
    const prisma: any = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ is_test: true, sim_epoch: epoch, sim_anchor: epoch, sim_replayed_until: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const clock: any = { nowFor: jest.fn(() => now) }
    const scheduler: any = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) })
    const workflow: any = {
      processSchedulesForOrg: jest.fn(async (_o: string, d: Date) => void calls.push(`schedules ${day(d)}`)),
      processWaitingStepsForOrg: jest.fn(async (_o: string, d: Date) => void calls.push(`waiting ${day(d)}`)),
      processOverdueStepsForOrg: jest.fn(async () => void calls.push('overdue')),
    }
    const tickets: any = { processSlaForOrg: jest.fn() }
    const notifications: any = { processOverdueNotificationsForOrg: jest.fn() }
    const replay = new ReplayService(prisma, clock, scheduler, workflow, tickets, notifications)

    const res = await replay.catchUp('org-1')
    expect(res?.daysReplayed).toBe(3)
    expect(calls).toEqual([
      'schedules 2026-10-5',
      'waiting 2026-10-5',
      'schedules 2026-10-6',
      'waiting 2026-10-6',
      'schedules 2026-10-7',
      'waiting 2026-10-7',
      'overdue',
    ])
  })
})
