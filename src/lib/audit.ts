import { Prisma, type PrismaClient } from '@prisma/client'

// note: hàm ghi Audit Log dùng chung cho mọi module (FR-59). Trước đây finance có bản private riêng,
// nay finance và users/support cùng gọi hàm này để mọi log có cùng định dạng.

type Db = Prisma.TransactionClient | PrismaClient

export type AuditInput = {
  actorId?: number
  action: string
  entityType: string
  entityId: string | number
  oldData?: unknown
  newData?: unknown
  ipAddress?: string
}

// note: nhận db (prisma hoặc tx) để ghi log trong cùng transaction với thao tác nghiệp vụ → không có log "ma"
export async function audit(db: Db, input: AuditInput) {
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      // note: cột entityId là VarChar nên ép về chuỗi
      entityId: String(input.entityId),
      // note: undefined → Prisma bỏ qua cột, DB lưu NULL; không truyền null thường vào cột Json
      oldData: input.oldData as Prisma.InputJsonValue | undefined,
      newData: input.newData as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  })
}
