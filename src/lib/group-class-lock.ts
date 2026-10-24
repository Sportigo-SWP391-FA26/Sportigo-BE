import type { Prisma } from '@prisma/client'

export async function lockGroupClass(tx: Prisma.TransactionClient, classId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id" FROM "GroupClass" WHERE "id" = ${classId} FOR UPDATE
  `
  return rows.length > 0
}
