import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({ prisma: {
  room: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  classSession: { count: vi.fn() },
} }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }), RoomStatus: { AVAILABLE: 'AVAILABLE', MAINTENANCE: 'MAINTENANCE', INACTIVE: 'INACTIVE' } }))
import { RoomService } from '../../src/modules/rooms/room.service.js'
const service = new RoomService()
describe('FR-13 Room Management', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects zero or negative capacity', async () => {
    await expect(service.createRoom({ code: 'R-1', name: 'Room 1', capacity: 0 })).rejects.toThrow('lớn hơn 0')
    expect(prisma.room.findUnique).not.toHaveBeenCalled()
  })
  it('rejects duplicate room codes', async () => {
    prisma.room.findUnique.mockResolvedValue({ id: 1, code: 'R-1' })
    await expect(service.createRoom({ code: 'R-1', name: 'Room 1', capacity: 10 })).rejects.toThrow('Mã phòng')
  })
  it('creates room with AVAILABLE as default status', async () => {
    prisma.room.findUnique.mockResolvedValue(null)
    prisma.room.create.mockResolvedValue({ id: 1, code: 'R-1', status: 'AVAILABLE' })
    await expect(service.createRoom({ code: 'R-1', name: 'Room 1', capacity: 10 })).resolves.toMatchObject({ status: 'AVAILABLE' })
    expect(prisma.room.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'AVAILABLE', capacity: 10 }) })
  })
  it('rejects invalid capacity updates', async () => {
    await expect(service.updateRoom(1, { capacity: -2 })).rejects.toThrow('lớn hơn 0')
    expect(prisma.room.update).not.toHaveBeenCalled()
  })
  it('prevents deleting a room with scheduled sessions', async () => {
    prisma.classSession.count.mockResolvedValue(1)
    await expect(service.deleteRoom(1)).rejects.toThrow('đang có lịch học')
    expect(prisma.room.delete).not.toHaveBeenCalled()
  })
})
