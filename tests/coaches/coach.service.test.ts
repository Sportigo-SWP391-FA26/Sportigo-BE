import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({ prisma: { coachAvailability: { findMany: vi.fn(), create: vi.fn() } } }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }), AvailabilityStatus: { AVAILABLE: 'AVAILABLE' } }))
import { CoachService } from '../../src/modules/coaches/coach.service.js'
const service = new CoachService()
const slot = { dayOfWeek: 2, startTime: '09:00', endTime: '11:00', effectiveFrom: '2026-10-01' }
describe('FR-14 Coach availability', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects a slot whose end is not after its start', async () => {
    await expect(service.addAvailability(7, { ...slot, endTime: '09:00' })).rejects.toThrow('kết thúc phải lớn hơn')
    expect(prisma.coachAvailability.findMany).not.toHaveBeenCalled()
  })
  it('rejects overlapping availability on the same weekday', async () => {
    prisma.coachAvailability.findMany.mockResolvedValue([{ startTime: new Date('1970-01-01T10:00:00Z'), endTime: new Date('1970-01-01T12:00:00Z'), effectiveFrom: new Date('2026-10-01'), effectiveTo: null }])
    await expect(service.addAvailability(7, slot)).rejects.toThrow('bị chồng chéo')
    expect(prisma.coachAvailability.create).not.toHaveBeenCalled()
  })
  it('creates a non-overlapping availability slot', async () => {
    prisma.coachAvailability.findMany.mockResolvedValue([])
    prisma.coachAvailability.create.mockImplementation(async ({ data }) => data)
    const result = await service.addAvailability(7, slot)
    expect(result.coachId).toBe(7)
    expect(result.dayOfWeek).toBe(2)
    expect(prisma.coachAvailability.create).toHaveBeenCalledOnce()
  })
  it('allows the same time on non-overlapping effective dates', async () => {
    prisma.coachAvailability.findMany.mockResolvedValue([{
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: new Date('2026-09-30'),
    }])
    prisma.coachAvailability.create.mockImplementation(async ({ data }) => data)
    await expect(service.addAvailability(7, slot)).resolves.toMatchObject({ coachId: 7 })
  })
  it('matches a class session against an effective coach availability slot', async () => {
    prisma.coachAvailability.findMany.mockResolvedValueOnce([{
      dayOfWeek: 2,
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T11:00:00Z'),
      effectiveFrom: new Date('2026-10-01'),
      effectiveTo: new Date('2026-10-31'),
    }]).mockResolvedValueOnce([])
    await expect(service.isAvailableForSession(
      7,
      new Date('2026-10-06T09:30:00Z'),
      new Date('2026-10-06T10:30:00Z'),
    )).resolves.toBe(true)
    await expect(service.isAvailableForSession(
      7,
      new Date('2026-11-03T09:30:00Z'),
      new Date('2026-11-03T10:30:00Z'),
    )).resolves.toBe(false)
  })
  it('lists availability in weekday and start-time order', async () => {
    prisma.coachAvailability.findMany.mockResolvedValue([])
    await service.getCoachAvailability(7)
    expect(prisma.coachAvailability.findMany).toHaveBeenCalledWith({ where: { coachId: 7 }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] })
  })
})
