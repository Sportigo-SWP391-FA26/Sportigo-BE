import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({ prisma: {
  groupClass: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  sport: { findUnique: vi.fn() }, coach: { findUnique: vi.fn() },
  classSession: { findFirst: vi.fn() }, privateCourseSchedule: { findFirst: vi.fn() },
  coachAvailability: { findMany: vi.fn() },
} }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }), ClassStatus: { DRAFT: 'DRAFT', OPEN: 'OPEN' }, CoachStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' }, SessionStatus: { SCHEDULED: 'SCHEDULED' } }))
import { GroupClassService } from '../../src/modules/group-classes/group-class.service.js'
const service = new GroupClassService()
const validClass = () => ({ sportId: 1, coachId: 10, name: 'Beginner swim', capacity: 10, tuitionFee: 100, registrationOpenAt: '2026-10-01T00:00:00Z', registrationCloseAt: '2026-10-20T00:00:00Z', startDate: '2026-10-21T00:00:00Z', endDate: '2026-12-21T00:00:00Z' })
describe('FR-15 / FR-16 Group class', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects a non-positive class capacity', async () => {
    await expect(service.createGroupClass({ ...validClass(), capacity: 0 })).rejects.toThrow('Sức chứa')
  })
  it('rejects negative tuition', async () => {
    await expect(service.createGroupClass({ ...validClass(), tuitionFee: -1 })).rejects.toThrow('Học phí')
  })
  it('requires an active sport and an active coach with the matching skill', async () => {
    prisma.sport.findUnique.mockResolvedValue({ id: 1, isActive: true })
    prisma.coach.findUnique.mockResolvedValue({ userId: 10, status: 'ACTIVE', coachSports: [{ sportId: 2 }] })
    await expect(service.createGroupClass(validClass())).rejects.toThrow('không có chuyên môn')
    expect(prisma.groupClass.create).not.toHaveBeenCalled()
  })
  it('creates a valid class as DRAFT', async () => {
    prisma.sport.findUnique.mockResolvedValue({ id: 1, isActive: true })
    prisma.coach.findUnique.mockResolvedValue({ userId: 10, status: 'ACTIVE', coachSports: [{ sportId: 1 }] })
    prisma.groupClass.create.mockImplementation(async ({ data }) => data)
    await expect(service.createGroupClass(validClass())).resolves.toMatchObject({ status: 'DRAFT', sportId: 1, coachId: 10 })
  })
  it('does not open a class with missing required information', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({ id: 1, name: '', capacity: 10, tuitionFee: 100 })
    await expect(service.updateClassStatus(1, 'OPEN' as never)).rejects.toThrow('thiếu thông tin cơ bản')
    expect(prisma.groupClass.update).not.toHaveBeenCalled()
  })
  it('rejects assigning an inactive coach', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({ id: 1, sportId: 1 })
    prisma.coach.findUnique.mockResolvedValue({ userId: 20, status: 'INACTIVE', coachSports: [{ sportId: 1 }] })
    await expect(service.assignCoach(1, 20)).rejects.toThrow('không hoạt động')
  })
  it('rejects assigning a coach whose schedule overlaps an existing class session', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      sportId: 1,
      sessions: [{ id: 2, startsAt: new Date('2026-11-01T10:00:00Z'), endsAt: new Date('2026-11-01T11:00:00Z') }],
    })
    prisma.coach.findUnique.mockResolvedValue({ userId: 20, status: 'ACTIVE', coachSports: [{ sportId: 1 }] })
    prisma.classSession.findFirst.mockResolvedValue({ id: 3 })
    await expect(service.assignCoach(1, 20)).rejects.toThrow('trùng lịch')
    expect(prisma.groupClass.update).not.toHaveBeenCalled()
  })
})
