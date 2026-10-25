import type { Prisma, RequestStatus } from '@prisma/client'
// TEMP(FR-62): src/lib/audit.ts là bản tạm, xem comment tại đó
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { FORBIDDEN_MESSAGE, type AuthUser } from '../../middleware/auth.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import {
  addMessage,
  changeStatusInTx,
  completeAssignments,
  findActiveReceptionist,
  findAssignmentHistory,
  findRequestAccess,
  findRequestDetail,
  inTransaction,
  listRequests,
  reassign,
  type RequestAccessRow,
} from './support.repository.js'
import type { ListQueueQuery, StaffMessageInput, UpdateSupportRequestInput } from './support.schema.js'
import { notFound, person, toDetail, toSummary } from './support.service.js'

// FR-56: chuyển trạng thái hợp lệ của nhân viên (ASSIGNED do phân công, CANCELLED do Member)
const TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  ASSIGNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  // note: Member chưa hài lòng thì mở lại xử lý tiếp
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
}
const ASSIGNABLE: RequestStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS']

const STATUS_TEXT: Record<RequestStatus, string> = {
  OPEN: 'mới gửi',
  ASSIGNED: 'đã được tiếp nhận',
  IN_PROGRESS: 'đang được xử lý',
  RESOLVED: 'đã được giải quyết',
  CLOSED: 'đã đóng',
  CANCELLED: 'đã hủy',
}

const isManager = (actor: AuthUser) => actor.role === 'CENTER_MANAGER'
const currentAssigneeId = (request: RequestAccessRow) => request.assignments[0]?.assignedToId ?? null

// note: Receptionist chỉ thấy yêu cầu chưa ai nhận hoặc đang giao cho mình; Manager thấy tất cả
function canView(actor: AuthUser, request: RequestAccessRow) {
  if (isManager(actor)) return true
  const assignee = currentAssigneeId(request)
  return assignee === null || assignee === actor.id
}

async function requireVisible(actor: AuthUser, id: number) {
  const request = await findRequestAccess(id)
  if (!request || !canView(actor, request)) throw notFound()
  return request
}

async function staffDetail(id: number) {
  const [row, history] = await Promise.all([findRequestDetail(id, true), findAssignmentHistory(id)])
  if (!row) throw notFound()
  return {
    ...toDetail(row),
    history: history.map((item) => ({
      id: item.id,
      status: item.status,
      note: item.note,
      assignedAt: item.assignedAt,
      unassignedAt: item.unassignedAt,
      assignedTo: person(item.assignedTo),
      assignedBy: person(item.assignedBy),
    })),
  }
}

// FR-56
export async function listQueue(actor: AuthUser, query: ListQueueQuery) {
  const and: Prisma.SupportRequestWhereInput[] = []
  if (query.status) and.push({ status: query.status })
  if (query.priority) and.push({ priority: query.priority })
  if (query.mine) and.push({ assignments: { some: { status: 'ACTIVE', assignedToId: actor.id } } })
  if (!isManager(actor)) {
    // note: cùng quy tắc với canView: chưa phân công hoặc giao cho mình
    and.push({
      OR: [
        { assignments: { none: { status: 'ACTIVE' } } },
        { assignments: { some: { status: 'ACTIVE', assignedToId: actor.id } } },
      ],
    })
  }
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const }
    and.push({ OR: [{ subject: contains }, { requester: { displayName: contains } }] })
  }
  const [rows, total] = await listRequests({ AND: and }, (query.page - 1) * query.pageSize, query.pageSize)
  return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total }
}

export async function getForStaff(actor: AuthUser, id: number) {
  await requireVisible(actor, id)
  return staffDetail(id)
}

export async function updateRequest(actor: AuthUser, id: number, input: UpdateSupportRequestInput, ipAddress?: string) {
  const request = await requireVisible(actor, id)

  if (input.assigneeId !== undefined) {
    // note: Receptionist chỉ tự nhận việc; giao cho người khác là quyền của Manager
    if (!isManager(actor) && input.assigneeId !== actor.id) throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN')
    if (!ASSIGNABLE.includes(request.status)) {
      throw new HttpError(409, 'Yêu cầu đã giải quyết hoặc đóng, không thể phân công', 'INVALID_STATUS_TRANSITION')
    }
    if (currentAssigneeId(request) === input.assigneeId) throw new HttpError(409, 'Người này đang phụ trách yêu cầu', 'ALREADY_ASSIGNED')
    if (!(await findActiveReceptionist(input.assigneeId))) {
      throw new HttpError(400, 'Chỉ giao cho Receptionist đang hoạt động', 'INVALID_ASSIGNEE', { field: 'assigneeId' })
    }
  }

  // note: nếu PATCH vừa nhận việc vừa đổi trạng thái thì tính từ trạng thái sau khi nhận (OPEN → ASSIGNED)
  const from: RequestStatus = input.assigneeId !== undefined && request.status === 'OPEN' ? 'ASSIGNED' : request.status
  let nextStatus: RequestStatus | undefined
  if (input.status !== undefined) {
    const assignee = input.assigneeId ?? currentAssigneeId(request)
    if (assignee === null) throw new HttpError(409, 'Cần phân công người xử lý trước', 'REQUEST_NOT_ASSIGNED')
    if (!isManager(actor) && assignee !== actor.id) throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN')
    if (!TRANSITIONS[from]?.includes(input.status)) {
      throw new HttpError(409, `Không thể chuyển từ ${from} sang ${input.status}`, 'INVALID_STATUS_TRANSITION', { from, to: input.status })
    }
    nextStatus = input.status
  }

  await inTransaction(async (tx) => {
    if (input.assigneeId !== undefined) {
      await reassign(tx, { requestId: id, assignedToId: input.assigneeId, assignedById: actor.id, note: input.note })
      await audit(tx, {
        actorId: actor.id,
        action: 'SUPPORT_ASSIGNED',
        entityType: 'SupportRequest',
        entityId: id,
        oldData: { assigneeId: currentAssigneeId(request) },
        newData: { assigneeId: input.assigneeId, note: input.note },
        ipAddress,
      })
    }
    if (nextStatus) {
      const changed = await changeStatusInTx(tx, id, from, {
        status: nextStatus,
        // note: resolvedAt ghi khi giải quyết, xóa khi mở lại; CLOSED giữ nguyên mốc giải quyết
        ...(nextStatus === 'RESOLVED' ? { resolvedAt: new Date() } : nextStatus === 'IN_PROGRESS' ? { resolvedAt: null } : {}),
      })
      if (!changed) throw new HttpError(409, 'Trạng thái yêu cầu vừa thay đổi, vui lòng tải lại', 'STATUS_CONFLICT')
      if (nextStatus === 'CLOSED') await completeAssignments(tx, id)
      await audit(tx, {
        actorId: actor.id,
        action: 'SUPPORT_STATUS_CHANGED',
        entityType: 'SupportRequest',
        entityId: id,
        oldData: { status: from },
        newData: { status: nextStatus, note: input.note },
        ipAddress,
      })
    }
    // note: báo Member khi trạng thái thực sự đổi (kể cả OPEN → ASSIGNED lúc nhận việc); đổi người phụ trách giữa chừng thì không
    const finalStatus = nextStatus ?? (from !== request.status ? from : undefined)
    if (finalStatus) {
      await notify(tx, {
        userIds: [request.requesterId],
        type: NOTIFICATION_TYPES.SUPPORT,
        title: `Yêu cầu hỗ trợ ${STATUS_TEXT[finalStatus]}`,
        content: `Yêu cầu "${request.subject}" ${STATUS_TEXT[finalStatus]}.`,
      })
    }
  })
  return staffDetail(id)
}

export async function sendStaffMessage(actor: AuthUser, id: number, input: StaffMessageInput) {
  const request = await requireVisible(actor, id)
  if (request.status === 'CLOSED' || request.status === 'CANCELLED') {
    throw new HttpError(409, 'Yêu cầu đã đóng', 'REQUEST_CLOSED')
  }
  const assignee = currentAssigneeId(request)
  // note: trả lời công khai phải là người phụ trách (hoặc Manager), tránh hai lễ tân trả lời chồng nhau
  if (!input.isInternal && !isManager(actor) && assignee !== actor.id) {
    throw new HttpError(409, 'Hãy nhận xử lý yêu cầu trước khi trả lời hội viên', 'REQUEST_NOT_ASSIGNED')
  }

  await inTransaction(async (tx) => {
    await addMessage({ requestId: id, senderId: actor.id, content: input.content, isInternal: input.isInternal }, tx)
    if (input.isInternal) return
    // note: phản hồi công khai đầu tiên coi như bắt đầu xử lý
    if (request.status === 'ASSIGNED') await changeStatusInTx(tx, id, 'ASSIGNED', { status: 'IN_PROGRESS' })
    await notify(tx, {
      userIds: [request.requesterId],
      type: NOTIFICATION_TYPES.SUPPORT,
      title: 'Trung tâm đã phản hồi yêu cầu hỗ trợ',
      content: `Yêu cầu "${request.subject}" có phản hồi mới. Mở mục Hỗ trợ để xem.`,
    })
  })
  return staffDetail(id)
}
