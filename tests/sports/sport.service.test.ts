import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({
  prisma: {
    sport: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    groupClass: { count: vi.fn() },
    privateCourse: { count: vi.fn() },
  },
}))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }) }))
import { SportService } from '../../src/modules/sports/sport.service.js'

const service = new SportService()

describe('FR-12 Sport Management', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates an active sport when its name is unique', async () => {
    prisma.sport.findUnique.mockResolvedValue(null)
    prisma.sport.create.mockResolvedValue({ id: 1, name: 'Swimming', isActive: true })
    await expect(service.createSport({ name: 'Swimming' })).resolves.toMatchObject({ name: 'Swimming', isActive: true })
    expect(prisma.sport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Swimming', isActive: true }) })
  })

  it('rejects a duplicate sport name', async () => {
    prisma.sport.findUnique.mockResolvedValue({ id: 1, name: 'Swimming' })
    await expect(service.createSport({ name: 'Swimming' })).rejects.toThrow('Tên môn thể thao đã tồn tại')
    expect(prisma.sport.create).not.toHaveBeenCalled()
  })

  it('rejects renaming a sport to another sport name', async () => {
    prisma.sport.findFirst.mockResolvedValue({ id: 2, name: 'Tennis' })
    await expect(service.updateSport(1, { name: 'Tennis' })).rejects.toThrow('Tên môn thể thao bị trùng')
    expect(prisma.sport.update).not.toHaveBeenCalled()
  })

  it('prevents hard deletion when classes or private courses use the sport', async () => {
    prisma.groupClass.count.mockResolvedValue(1)
    prisma.privateCourse.count.mockResolvedValue(0)
    await expect(service.deleteSport(1)).rejects.toThrow('đang được sử dụng')
    expect(prisma.sport.delete).not.toHaveBeenCalled()
  })

  it('deletes a sport that is not referenced by services', async () => {
    prisma.groupClass.count.mockResolvedValue(0)
    prisma.privateCourse.count.mockResolvedValue(0)
    prisma.sport.delete.mockResolvedValue({ id: 1 })
    await expect(service.deleteSport(1)).resolves.toEqual({ id: 1 })
  })
})
