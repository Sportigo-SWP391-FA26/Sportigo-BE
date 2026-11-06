import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'

export async function listMetricDefinitions(sportId: number, includeInactive = false) {
  return prisma.assessmentMetricDefinition.findMany({
    where: { sportId, isActive: includeInactive ? undefined : true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  })
}

export async function createMetricDefinition(
  sportId: number,
  data: Omit<Prisma.AssessmentMetricDefinitionUncheckedCreateInput, 'sportId'>,
) {
  const sport = await prisma.sport.findUnique({ where: { id: sportId }, select: { id: true } })
  if (!sport) throw new HttpError(404, 'Không tìm thấy bộ môn', 'SPORT_NOT_FOUND')
  return prisma.assessmentMetricDefinition.create({ data: { ...data, sportId } })
}

export async function updateMetricDefinition(sportId: number, id: number, data: Prisma.AssessmentMetricDefinitionUpdateInput) {
  const current = await prisma.assessmentMetricDefinition.findFirst({ where: { id, sportId }, include: { _count: { select: { values: true } } } })
  if (!current) throw new HttpError(404, 'Không tìm thấy chỉ số đánh giá', 'METRIC_NOT_FOUND')
  if (current._count.values > 0 && (data.code !== undefined || data.sport !== undefined)) {
    throw new HttpError(409, 'Không thể đổi mã hoặc bộ môn của chỉ số đã phát sinh dữ liệu', 'METRIC_IDENTITY_LOCKED')
  }
  return prisma.assessmentMetricDefinition.update({ where: { id }, data })
}

