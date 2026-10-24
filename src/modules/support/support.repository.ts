import type { Prisma, RequestStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

const personSelect = { id: true, displayName: true, role: { select: { name: true } } } satisfies Prisma.UserSelect

export const requestSummarySelect = {
  id: true,
  subject: true,
  category: true,
  priority: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  requester: { select: personSelect },
  // note: chỉ lấy phân công đang hiệu lực để biết ai đang xử lý
  assignments: {
    where: { status: 'ACTIVE' },
    orderBy: { assignedAt: 'desc' },
    take: 1,
    select: { assignedTo: { select: personSelect } },
  },
  _count: { select: { messages: true } },
} satisfies Prisma.SupportRequestSelect

export type RequestSummaryRow = Prisma.SupportRequestGetPayload<{ select: typeof requestSummarySelect }>

export function listRequests(where: Prisma.SupportRequestWhereInput, skip: number, take: number) {
  return prisma.$transaction([
    prisma.supportRequest.findMany({ where, select: requestSummarySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
    prisma.supportRequest.count({ where }),
  ])
}

export function findRequestDetail(id: number, includeInternal: boolean) {
  return prisma.supportRequest.findUnique({
    where: { id },
    select: {
      ...requestSummarySelect,
      description: true,
      messages: {
        // note: Member không được thấy ghi chú nội bộ của nhân viên
        where: includeInternal ? {} : { isInternal: false },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        select: { id: true, content: true, isInternal: true, sentAt: true, sender: { select: personSelect } },
      },
    },
  })
}

export type RequestDetailRow = NonNullable<Awaited<ReturnType<typeof findRequestDetail>>>

export function findRequestAccess(id: number) {
  return prisma.supportRequest.findUnique({ where: { id }, select: { id: true, requesterId: true, status: true, subject: true } })
}

export function createRequest(data: Prisma.SupportRequestUncheckedCreateInput) {
  return prisma.supportRequest.create({ data, select: { id: true } })
}

export function addMessage(data: { requestId: number; senderId: number; content: string; isInternal?: boolean }) {
  return prisma.supportMessage.create({ data, select: { id: true } })
}

// note: chỉ đổi khi status vẫn đúng như lúc đọc, tránh ghi đè thao tác đồng thời của nhân viên
export async function changeStatusIf(id: number, from: RequestStatus[], data: Prisma.SupportRequestUpdateManyMutationInput) {
  const updated = await prisma.supportRequest.updateMany({ where: { id, status: { in: from } }, data })
  return updated.count === 1
}
