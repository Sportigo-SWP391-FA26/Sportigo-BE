/**
 * Dọn dữ liệu kiểm thử có dấu hiệu rõ ràng.
 *   Chạy thử (không ghi):  npx tsx tools/cleanup-demo-data.ts
 *   Ghi thật:              npx tsx tools/cleanup-demo-data.ts --apply
 *
 * Script đi theo khóa ngoại trong DB: bản ghi con có FK bắt buộc bị xóa theo,
 * FK tùy chọn được đặt NULL. Hãy backup bằng tools/export-db-snapshot.mjs trước khi --apply.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

// Tài khoản đăng nhập demo: chỉ liệt kê, không bao giờ xóa
const PROTECTED_EMAILS = ['member1@gmail.com', 'coach1@gmail.com', 'letan1@gmail.com', 'centermanager1@gmail.com']
const REVIEW_PROMOTIONS = ['SPORTIGO10', 'PRIVATE500']

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

type ForeignKey = { child: string; childColumn: string; parent: string; parentColumn: string; nullable: boolean }
type Row = Record<string, unknown>

async function loadForeignKeys() {
  const rows = await prisma.$queryRawUnsafe<(Omit<ForeignKey, 'nullable'> & { nullable: boolean; columnCount: number })[]>(`
    SELECT child.relname AS child, child_col.attname AS "childColumn",
           parent.relname AS parent, parent_col.attname AS "parentColumn",
           NOT child_col.attnotnull AS nullable, cardinality(c.conkey)::int AS "columnCount"
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace AND ns.nspname = 'public'
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_attribute child_col ON child_col.attrelid = c.conrelid AND child_col.attnum = c.conkey[1]
    JOIN pg_attribute parent_col ON parent_col.attrelid = c.confrelid AND parent_col.attnum = c.confkey[1]
    WHERE c.contype = 'f'`)
  const composite = rows.filter((row) => row.columnCount > 1)
  if (composite.length) throw new Error(`Chưa hỗ trợ FK nhiều cột: ${composite.map((row) => row.child).join(', ')}`)
  return rows as ForeignKey[]
}

async function primaryKeys() {
  const rows = await prisma.$queryRawUnsafe<{ table: string; columns: string[] }[]>(`
    SELECT cls.relname AS "table", array_agg(att.attname::text ORDER BY att.attnum) AS columns
    FROM pg_constraint c
    JOIN pg_class cls ON cls.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = 'public'
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
    WHERE c.contype = 'p'
    GROUP BY cls.relname`)
  return new Map(rows.map((row) => [row.table, row.columns]))
}

const rowKey = (row: Row, columns: string[]) => columns.map((column) => String(row[column])).join('|')
const keyExpression = (columns: string[]) => `concat_ws('|', ${columns.map((column) => `${quote(column)}::text`).join(', ')})`

async function select(table: string, where: string, values?: string[]) {
  const sql = `SELECT to_jsonb(t) AS row FROM ${quote(table)} t WHERE ${where}`
  const rows = await (values ? prisma.$queryRawUnsafe<{ row: Row }[]>(sql, values) : prisma.$queryRawUnsafe<{ row: Row }[]>(sql))
  return rows.map((item) => item.row)
}

const SEEDS: [string, string][] = [
  ['User', `email ILIKE 'flowtest.%' OR id IN (SELECT "userId" FROM "Member" WHERE "memberCode" LIKE 'FLOWTEST-%' OR "memberCode" LIKE 'TEST-%') OR id IN (SELECT "userId" FROM "Coach" WHERE "coachCode" LIKE 'FLOWTEST-%' OR "coachCode" LIKE 'TEST-%')`],
  ['ServiceOrder', `"orderNumber" LIKE 'FLOWTEST-%'`],
  ['Payment', `reference LIKE 'FLOWTEST-%'`],
  ['Room', `code LIKE 'FLOW-%'`],
  ['GroupClass', `name LIKE 'FLOWTEST%'`],
  ['SupportRequest', `subject LIKE 'FLOWTEST%'`],
]

async function main() {
  const [foreignKeys, keys] = await Promise.all([loadForeignKeys(), primaryKeys()])
  const marked = new Map<string, Map<string, Row>>()
  const clearNull = new Map<string, Set<string>>() // "bảng.cột" -> khóa chính của dòng
  const queue: { table: string; row: Row }[] = []

  const mark = (table: string, rows: Row[]) => {
    const columns = keys.get(table)
    if (!columns) throw new Error(`Bảng ${table} không có khóa chính`)
    const bucket = marked.get(table) ?? new Map<string, Row>()
    marked.set(table, bucket)
    for (const row of rows) {
      const key = rowKey(row, columns)
      if (bucket.has(key)) continue
      bucket.set(key, row)
      queue.push({ table, row })
    }
  }

  for (const [table, where] of SEEDS) {
    const protectedRows = table === 'User' ? ` AND email NOT IN (${PROTECTED_EMAILS.map((email) => `'${email}'`).join(',')})` : ''
    mark(table, await select(table, `(${where})${protectedRows}`))
  }

  while (queue.length) {
    const batch = queue.splice(0, queue.length)
    const byTable = new Map<string, Row[]>()
    for (const item of batch) byTable.set(item.table, [...(byTable.get(item.table) ?? []), item.row])
    for (const [table, rows] of byTable) {
      for (const fk of foreignKeys.filter((item) => item.parent === table)) {
        const values = rows.map((row) => String(row[fk.parentColumn]))
        const children = await select(fk.child, `${quote(fk.childColumn)}::text = ANY($1::text[])`, values)
        if (fk.nullable) {
          const target = `${fk.child}.${fk.childColumn}`
          const set = clearNull.get(target) ?? new Set<string>()
          children.forEach((child) => set.add(rowKey(child, keys.get(fk.child)!)))
          clearNull.set(target, set)
        } else {
          mark(fk.child, children)
        }
      }
    }
  }

  const reachedProtected = [...(marked.get('User')?.values() ?? [])].filter((row) => PROTECTED_EMAILS.includes(String(row.email)))
  if (reachedProtected.length) throw new Error(`Dừng: chạm tài khoản được bảo vệ ${reachedProtected.map((row) => row.email).join(', ')}`)

  console.log(`\n=== ${APPLY ? 'GHI THẬT' : 'CHẠY THỬ, KHÔNG GHI'} ===`)
  console.log('\nSẽ xóa:')
  for (const [table, rows] of [...marked].filter(([, rows]) => rows.size).sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${table}: ${rows.size}`)
  console.log('\nSẽ đặt NULL:')
  for (const [target, rows] of [...clearNull].filter(([, rows]) => rows.size).sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${target}: ${rows.size}`)
  console.log('\nTài khoản bị xóa:')
  for (const row of marked.get('User')?.values() ?? []) console.log(`  #${row.id} ${row.displayName}`)
  const classes = [...(marked.get('GroupClass')?.values() ?? [])]
  console.log(`\nLớp nhóm bị xóa (${classes.length}):`)
  classes.forEach((row) => console.log(`  #${row.id} ${row.name}`))

  const [{ late, excused }] = await prisma.$queryRawUnsafe<{ late: number; excused: number }[]>(`
    SELECT count(*) FILTER (WHERE status = 'LATE')::int AS late, count(*) FILTER (WHERE status = 'EXCUSED')::int AS excused FROM "SessionAttendance"`)
  console.log(`\nĐiểm danh cũ cần chuyển: LATE→PRESENT ${late}, EXCUSED→ABSENT ${excused}`)

  console.log('\nCẦN BẠN QUYẾT ĐỊNH (script không đụng tới):')
  const accounts = await prisma.user.findMany({ where: { email: { in: PROTECTED_EMAILS } }, select: { email: true } })
  console.log(`  Tài khoản demo còn giữ: ${accounts.map((account) => account.email).join(', ') || 'không có'}`)
  const promotions = await prisma.promotion.findMany({ where: { code: { in: REVIEW_PROMOTIONS } }, select: { code: true, status: true } })
  console.log(`  Mã khuyến mãi: ${promotions.map((promotion) => `${promotion.code} (${promotion.status})`).join(', ') || 'không có'}`)

  if (!APPLY) {
    console.log('\nChưa ghi gì. Thêm --apply để thực hiện.')
    return
  }

  // Xóa bảng con trước bảng cha theo FK bắt buộc
  const remaining = new Set([...marked].filter(([, rows]) => rows.size).map(([table]) => table))
  const order: string[] = []
  while (remaining.size) {
    const ready = [...remaining].filter((table) => !foreignKeys.some((fk) => !fk.nullable && fk.parent === table && fk.child !== table && remaining.has(fk.child)))
    if (!ready.length) throw new Error(`Có vòng FK bắt buộc: ${[...remaining].join(', ')}`)
    ready.forEach((table) => { remaining.delete(table); order.push(table) })
  }

  await prisma.$transaction(async (tx) => {
    for (const [target, rows] of clearNull) {
      if (!rows.size) continue
      const [table, column] = target.split('.') as [string, string]
      await tx.$executeRawUnsafe(`UPDATE ${quote(table)} SET ${quote(column)} = NULL WHERE ${keyExpression(keys.get(table)!)} = ANY($1::text[])`, [...rows])
    }
    for (const table of order) {
      await tx.$executeRawUnsafe(`DELETE FROM ${quote(table)} WHERE ${keyExpression(keys.get(table)!)} = ANY($1::text[])`, [...marked.get(table)!.keys()])
    }
    await tx.$executeRawUnsafe(`UPDATE "SessionAttendance" SET status = 'PRESENT' WHERE status = 'LATE'`)
    await tx.$executeRawUnsafe(`UPDATE "SessionAttendance" SET status = 'ABSENT' WHERE status = 'EXCUSED'`)
  }, { timeout: 180_000, maxWait: 20_000 })
  console.log('\nĐã thực hiện xong.')
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
