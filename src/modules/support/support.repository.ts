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
  return prisma.supportRequest.findUnique({
    where: { id },
    select: {
      id: true,
      requesterId: true,
      status: true,
      subject: true,
      // note: người đang phụ trách, dùng để kiểm tra quyền của Receptionist (FR-56)
      assignments: { where: { status: 'ACTIVE' }, select: { assignedToId: true }, take: 1 },
    },
  })
}

export type RequestAccessRow = NonNullable<Awaited<ReturnType<typeof findRequestAccess>>>

// FR-56: lịch sử người xử lý
export function findAssignmentHistory(requestId: number) {
  return prisma.requestAssignment.findMany({
    where: { requestId },
    orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      status: true,
      note: true,
      assignedAt: true,
      unassignedAt: true,
      assignedTo: { select: personSelect },
      assignedBy: { select: personSelect },
    },
  })
}

export function findActiveReceptionist(userId: number) {
  return prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE', role: { name: 'RECEPTIONIST' } }, select: { id: true } })
}

type Tx = Prisma.TransactionClient

export function inTransaction<T>(work: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(work)
}

// note: kết thúc phân công cũ rồi tạo phân công mới; OPEN thì chuyển sang ASSIGNED
export async function reassign(tx: Tx, input: { requestId: number; assignedToId: number; assignedById: number; note?: string }) {
  await tx.requestAssignment.updateMany({
    where: { requestId: input.requestId, status: 'ACTIVE' },
    data: { status: 'CANCELLED', unassignedAt: new Date() },
  })
  await tx.requestAssignment.create({
    data: { requestId: input.requestId, assignedToId: input.assignedToId, assignedById: input.assignedById, note: input.note },
  })
  await tx.supportRequest.updateMany({ where: { id: input.requestId, status: 'OPEN' }, data: { status: 'ASSIGNED' } })
}

export async function completeAssignments(tx: Tx, requestId: number) {
  await tx.requestAssignment.updateMany({
    where: { requestId, status: 'ACTIVE' },
    data: { status: 'COMPLETED', unassignedAt: new Date() },
  })
}

export async function changeStatusInTx(tx: Tx, id: number, from: RequestStatus, data: Prisma.SupportRequestUpdateManyMutationInput) {
  const updated = await tx.supportRequest.updateMany({ where: { id, status: from }, data })
  return updated.count === 1
}

export function createRequest(data: Prisma.SupportRequestUncheckedCreateInput) {
  return prisma.supportRequest.create({ data, select: { id: true } })
}

export function addMessage(data: { requestId: number; senderId: number; content: string; isInternal?: boolean }, db: Tx | typeof prisma = prisma) {
  return db.supportMessage.create({ data, select: { id: true } })
}

// note: chỉ đổi khi status vẫn đúng như lúc đọc, tránh ghi đè thao tác đồng thời của nhân viên
export async function changeStatusIf(id: number, from: RequestStatus[], data: Prisma.SupportRequestUpdateManyMutationInput) {
  const updated = await prisma.supportRequest.updateMany({ where: { id, status: { in: from } }, data })
  return updated.count === 1
}
