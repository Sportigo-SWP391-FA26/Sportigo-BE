/** Xuất toàn bộ bảng public ra JSON: npx tsx tools/export-db-snapshot.ts <đường-dẫn-file> */
import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const outputPath = process.argv[2]

async function main() {
  if (!outputPath) throw new Error('Thiếu đường dẫn file đầu ra')
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)
  const snapshot: { createdAt: string; schema: string; tables: Record<string, unknown[]>; sequences: unknown[] } = { createdAt: new Date().toISOString(), schema: 'public', tables: {}, sequences: [] }
  for (const { tablename } of tables) {
    const rows = await prisma.$queryRawUnsafe<{ row: unknown }[]>(`SELECT to_jsonb(t) AS row FROM public."${tablename.replaceAll('"', '""')}" t`)
    snapshot.tables[tablename] = rows.map((item) => item.row)
  }
  snapshot.sequences = await prisma.$queryRawUnsafe(`SELECT sequencename, last_value::text FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`)
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2))
  const total = Object.values(snapshot.tables).reduce((sum, rows) => sum + rows.length, 0)
  console.log(`Đã backup ${tables.length} bảng, ${total} dòng`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
