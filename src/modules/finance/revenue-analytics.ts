import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'

export type AnalyticsPeriod = 'MONTH' | 'QUARTER' | 'YEAR'
export type AnalyticsQuery = { period: AnalyticsPeriod; anchor?: string; channel?: 'ONLINE' | 'COUNTER' | 'WALLET'; itemType?: 'GROUP_CLASS' | 'PRIVATE_COURSE' | 'MEMBERSHIP' }
type DailyRow = { day: string; gross: Prisma.Decimal; refunds: Prisma.Decimal; transactions: bigint }
type Metrics = { gross: number; refunds: number; net: number; transactions: number; averageTransaction: number; refundRate: number }
const DAY = 86_400_000
const zero = (): Metrics => ({ gross: 0, refunds: 0, net: 0, transactions: 0, averageTransaction: 0, refundRate: 0 })
const dateText = (date: Date) => date.toISOString().slice(0, 10)
const dateAtCenter = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const parseDate = (text: string) => new Date(`${text}T00:00:00.000Z`)

export function periodStart(anchor: string, period: AnalyticsPeriod): string {
  const date = parseDate(anchor)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  return dateText(new Date(Date.UTC(year, period === 'YEAR' ? 0 : period === 'QUARTER' ? Math.floor(month / 3) * 3 : month, 1)))
}

export function shiftPeriod(start: string, period: AnalyticsPeriod, count: number): string {
  const date = parseDate(start)
  const months = period === 'YEAR' ? 12 : period === 'QUARTER' ? 3 : 1
  return dateText(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months * count, 1)))
}

function centerInstant(day: string) { return new Date(parseDate(day).getTime() - 7 * 60 * 60 * 1000) }
function metrics(rows: DailyRow[], from: string, toExclusive: string): Metrics {
  const result = zero()
  for (const row of rows) if (row.day >= from && row.day < toExclusive) {
    result.gross += Number(row.gross)
    result.refunds += Number(row.refunds)
    result.transactions += Number(row.transactions)
  }
  result.net = result.gross - result.refunds
  result.averageTransaction = result.transactions ? result.gross / result.transactions : 0
  result.refundRate = result.gross ? result.refunds / result.gross : 0
  return result
}

export function changeRate(current: number, baseline: number): number | null { return baseline === 0 ? null : (current - baseline) / Math.abs(baseline) }

export async function revenueAnalytics(query: AnalyticsQuery, now = new Date()) {
  const today = dateAtCenter(now)
  const anchor = query.anchor ?? today
  if (anchor > today) throw new HttpError(422, 'Không thể xem kỳ trong tương lai', 'FUTURE_REPORT_PERIOD')
  const start = periodStart(anchor, query.period)
  const next = shiftPeriod(start, query.period, 1)
  const previous = shiftPeriod(start, query.period, -1)
  const yearAgo = query.period === 'MONTH' ? shiftPeriod(start, query.period, -12) : query.period === 'QUARTER' ? shiftPeriod(start, query.period, -4) : shiftPeriod(start, query.period, -1)
  const count = query.period === 'MONTH' ? 12 : query.period === 'QUARTER' ? 8 : 5
  const firstTrend = shiftPeriod(start, query.period, 1 - count)
  const earliest = [firstTrend, previous, yearAgo].sort()[0]!
  const latest = next > today ? dateText(new Date(parseDate(today).getTime() + DAY)) : next
  const partial = start <= today && today < next
  const elapsedDays = Math.floor((parseDate(today).getTime() - parseDate(start).getTime()) / DAY) + 1
  const comparisonEnd = (periodStartText: string) => partial ? dateText(new Date(Math.min(parseDate(shiftPeriod(periodStartText, query.period, 1)).getTime(), parseDate(periodStartText).getTime() + elapsedDays * DAY))) : shiftPeriod(periodStartText, query.period, 1)
  const channel = query.channel ? Prisma.sql`AND p."channel"::text = ${query.channel}` : Prisma.empty
  const itemFilter = query.itemType ? Prisma.sql`AND oi."itemType"::text = ${query.itemType}` : Prisma.empty
  const refundItemFilter = query.itemType ? Prisma.sql`AND COALESCE(ri."itemType"::text, oi."itemType"::text) = ${query.itemType}` : Prisma.empty
  const rows = await prisma.$queryRaw<DailyRow[]>(Prisma.sql`
    WITH service_totals AS (
      SELECT "orderId", SUM("finalAmount") AS total FROM "OrderItem"
      WHERE "itemType"::text IN ('GROUP_CLASS','PRIVATE_COURSE','MEMBERSHIP') GROUP BY "orderId"
    ), paid AS (
      SELECT p.id, p."paidAt" AS instant,
        p.amount * COALESCE(SUM(oi."finalAmount") / NULLIF(st.total, 0), 0) AS gross
      FROM "Payment" p
      JOIN service_totals st ON st."orderId" = p."orderId"
      JOIN "OrderItem" oi ON oi."orderId" = p."orderId" AND oi."itemType"::text IN ('GROUP_CLASS','PRIVATE_COURSE','MEMBERSHIP') ${itemFilter}
      WHERE p.status::text IN ('SUCCESS','PARTIALLY_REFUNDED','REFUNDED') AND p."paidAt" >= ${centerInstant(earliest)} AND p."paidAt" < ${centerInstant(latest)} ${channel}
      GROUP BY p.id, st.total
    ), returned AS (
      SELECT a.id, a."createdAt" AS instant,
        a.amount * CASE WHEN a."orderItemId" IS NOT NULL THEN 1 ELSE COALESCE(SUM(oi."finalAmount") / NULLIF(st.total, 0), 0) END AS refunds
      FROM "PaymentAdjustment" a
      JOIN "Payment" p ON p.id = a."paymentId"
      JOIN service_totals st ON st."orderId" = p."orderId"
      LEFT JOIN "OrderItem" ri ON ri.id = a."orderItemId"
      JOIN "OrderItem" oi ON oi."orderId" = p."orderId" AND oi."itemType"::text IN ('GROUP_CLASS','PRIVATE_COURSE','MEMBERSHIP')
      WHERE a.type::text = 'REFUND' AND a."createdAt" >= ${centerInstant(earliest)} AND a."createdAt" < ${centerInstant(latest)} ${channel} ${refundItemFilter}
        AND (a."orderItemId" IS NULL OR oi.id = a."orderItemId")
      GROUP BY a.id, st.total
    ), events AS (
      SELECT instant, gross, 0::numeric AS refunds, 1::bigint AS transactions FROM paid
      UNION ALL SELECT instant, 0::numeric, refunds, 0::bigint FROM returned
    )
    SELECT to_char((instant AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day,
      SUM(gross) AS gross, SUM(refunds) AS refunds, SUM(transactions) AS transactions
    FROM events GROUP BY 1 ORDER BY 1
  `)
  const current = metrics(rows, start, partial ? latest : next)
  const prior = metrics(rows, previous, comparisonEnd(previous))
  const yearEarlier = metrics(rows, yearAgo, comparisonEnd(yearAgo))
  const trend = Array.from({ length: count }, (_, index) => {
    const from = shiftPeriod(firstTrend, query.period, index)
    const to = shiftPeriod(from, query.period, 1)
    return { periodStart: from, ...metrics(rows, from, to > latest ? latest : to) }
  })
  return {
    period: query.period, anchor, range: { from: start, to: partial ? latest : next }, filters: { channel: query.channel ?? null, itemType: query.itemType ?? null },
    current, previous: { from: previous, ...prior }, yearAgo: { from: yearAgo, ...yearEarlier },
    change: { previous: changeRate(current.net, prior.net), yearAgo: changeRate(current.net, yearEarlier.net) }, trend,
  }
}
