// Adds clearly marked payroll scenarios to draft snapshots only. Never writes teaching,
// attendance, shift or approved payroll records. Run explicitly with --apply.
import 'dotenv/config'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/lib/prisma.js'
import { calculatePay } from '../src/modules/payroll/payroll.calc.js'

const scenarios = [
  { month: '2026-05', staff: 'Nguyễn Minh Hải', absent: 1, makeup: 0, note: 'Giả lập một buổi vắng trong tháng 5' },
  { month: '2026-06', staff: 'Nguyễn Minh Hải', absent: 0, makeup: 2250000, note: 'Giả lập bù một buổi vắng tháng 5' },
  { month: '2026-06', staff: 'Trần Thu An', absent: 1, makeup: 0, note: 'Giả lập một buổi vắng trong tháng 6' },
  { month: '2026-07', staff: 'Trần Thu An', absent: 0, makeup: 1125000, note: 'Giả lập bù một buổi vắng tháng 6' },
  { month: '2026-09', staff: 'Lê Quốc Nam', absent: 1, makeup: 0, note: 'Giả lập một buổi vắng trong tháng 9' },
  { month: '2026-10', staff: 'Lê Quốc Nam', absent: 0, makeup: 2250000, note: 'Giả lập bù một buổi vắng tháng 9' },
  { month: '2026-10', staff: 'Nguyễn Minh Hải', absent: 1, makeup: 0, note: 'Giả lập một buổi vắng tháng 10, chưa có buổi bù' },
] as const

async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Pass --apply to update draft payroll snapshots')
  const months = [...new Set(scenarios.map((row) => row.month))]
  const periods = await prisma.payrollPeriod.findMany({ where: { month: { in: months } }, include: { entries: true } })
  for (const scenario of scenarios) {
    const period = periods.find((row) => row.month === scenario.month)
    if (!period || period.status !== 'DRAFT') throw new Error(`Month ${scenario.month} must exist as DRAFT`)
    const entry = period.entries.find((row) => row.staffName === scenario.staff)
    if (!entry || entry.scheduledUnits === 0) throw new Error(`No scheduled work for ${scenario.staff} in ${scenario.month}`)
  }
  const backupDir = resolve(process.cwd(), '..', 'backups')
  await mkdir(backupDir, { recursive: true })
  const backupPath = resolve(backupDir, `payroll-before-demo-${Date.now()}.json`)
  await writeFile(backupPath, JSON.stringify(periods, (_key, value) => typeof value?.toJSON === 'function' ? value.toJSON() : value, 2))
  await prisma.$transaction(async (tx) => {
    for (const scenario of scenarios) {
      const entry = periods.find((row) => row.month === scenario.month)!.entries.find((row) => row.staffName === scenario.staff)!
      const evidence = entry.workEvidence as Record<string, unknown>
      if (evidence.demoPayrollScenario) throw new Error(`Demo already applied to ${scenario.staff} ${scenario.month}`)
      const baseSalary = Number(entry.baseSalary)
      const absenceDeduction = calculatePay({ baseSalary, scheduledUnits: entry.scheduledUnits, absentUnits: scenario.absent, makeupCredit: 0, allowanceTotal: 0, deductionTotal: 0 }).absenceDeduction
      const netAmount = calculatePay({ baseSalary, scheduledUnits: entry.scheduledUnits, absentUnits: scenario.absent, makeupCredit: scenario.makeup, allowanceTotal: Number(entry.allowanceTotal), deductionTotal: Number(entry.deductionTotal) }).netAmount
      await tx.payrollEntry.update({ where: { id: entry.id }, data: {
        absentUnits: scenario.absent,
        absenceDeduction,
        makeupCredit: scenario.makeup,
        netAmount,
        workEvidence: { ...evidence, demoPayrollScenario: { note: scenario.note, absent: scenario.absent, makeup: scenario.makeup } },
        reviewIssues: [...(entry.reviewIssues as string[]), `DỮ LIỆU DEMO — ${scenario.note}; không duyệt kỳ này trước khi thay bằng chứng từ thực tế`],
      } })
    }
  }, { isolationLevel: 'Serializable' })
  console.log(`Updated ${scenarios.length} draft entries. Backup: ${backupPath}`)
}

main().then(() => process.exit(0)).catch((error: unknown) => { console.error(error); process.exit(1) })
