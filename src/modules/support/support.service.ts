import type { Prisma, RequestStatus } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import {
  addMessage,
  changeStatusIf,
  createRequest,
  findRequestAccess,
  findRequestDetail,
  listRequests,
  type RequestDetailRow,
  type RequestSummaryRow,
} from './support.repository.js'
import {
  FINISHED_STATUSES,
  type CreateSupportRequestInput,
  type ListSupportRequestsQuery,
  type SendMessageInput,
} from './support.schema.js'

const MEMBER_CANCELLABLE: RequestStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS']

const person = (user: { id: number; displayName: string; role: { name: string } }) => ({
  id: user.id,
  displayName: user.displayName,
  role: user.role.name,
})

export function toSummary(row: RequestSummaryRow) {
  const assignee = row.assignments[0]?.assignedTo
  return {
    id: row.id,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    requester: person(row.requester),
    assignee: assignee ? person(assignee) : null,
    messageCount: row._count.messages,
  }
}

function toDetail(row: RequestDetailRow) {
  return {
    ...toSummary(row),
    description: row.description,
    messages: row.messages.map((message) => ({
      id: message.id,
      content: message.content,
      isInternal: message.isInternal,
      sentAt: message.sentAt,
      sender: person(message.sender),
    })),
  }
}

const notFound = () => new HttpError(404, 'Không tìm thấy yêu cầu hỗ trợ', 'REQUEST_NOT_FOUND')

// note: FR-55 chỉ có Member; FR-56 mở rộng cho nhân viên xử lý
async function requireOwnRequest(actor: AuthUser, id: number) {
  const request = await findRequestAccess(id)
  // note: yêu cầu của người khác trả 404 (không phải 403) để không lộ việc id đó tồn tại
  if (!request || request.requesterId !== actor.id) throw notFound()
  return request
}

async function detailFor(id: number) {
  const row = await findRequestDetail(id, false)
  if (!row) throw notFound()
  return toDetail(row)
}

// FR-55
export async function createSupportRequest(actor: AuthUser, input: CreateSupportRequestInput) {
  const created = await createRequest({ requesterId: actor.id, ...input })
  return detailFor(created.id)
}

export async function listMySupportRequests(actor: AuthUser, query: ListSupportRequestsQuery) {
  const where: Prisma.SupportRequestWhereInput = { requesterId: actor.id, ...(query.status ? { status: query.status } : {}) }
  const [rows, total] = await listRequests(where, (query.page - 1) * query.pageSize, query.pageSize)
  return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total }
}

export async function getSupportRequest(actor: AuthUser, id: number) {
  await requireOwnRequest(actor, id)
  return detailFor(id)
}

export async function sendMemberMessage(actor: AuthUser, id: number, input: SendMessageInput) {
  const request = await requireOwnRequest(actor, id)
  if ((FINISHED_STATUSES as readonly string[]).includes(request.status)) {
    throw new HttpError(409, 'Yêu cầu đã đóng, vui lòng gửi yêu cầu mới', 'REQUEST_CLOSED')
  }
  await addMessage({ requestId: id, senderId: actor.id, content: input.content })
  return detailFor(id)
}

export async function cancelSupportRequest(actor: AuthUser, id: number) {
  const request = await requireOwnRequest(actor, id)
  if (!MEMBER_CANCELLABLE.includes(request.status)) {
    throw new HttpError(409, 'Yêu cầu đã được giải quyết hoặc đóng, không thể hủy', 'INVALID_STATUS_TRANSITION')
  }
  const changed = await changeStatusIf(id, MEMBER_CANCELLABLE, { status: 'CANCELLED' })
  if (!changed) throw new HttpError(409, 'Trạng thái yêu cầu vừa thay đổi, vui lòng tải lại', 'STATUS_CONFLICT')
  return detailFor(id)
}
