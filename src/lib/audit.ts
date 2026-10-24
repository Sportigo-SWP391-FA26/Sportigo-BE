import { Prisma, type PrismaClient } from '@prisma/client'

// TEMP(FR-62): bản tạm, sao chép nguyên hàm audit() private trong src/modules/finance/finance.service.ts:12.
// Khi Tài push bản audit dùng chung chính thức: xóa file này (hoặc thay bằng bản của Tài), sửa import
// trong src/modules/users/users.repository.ts, và cho finance.service.ts dùng lại cùng một hàm.
// Grep "TEMP(FR-62)" để thấy mọi chỗ cần dọn.

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
