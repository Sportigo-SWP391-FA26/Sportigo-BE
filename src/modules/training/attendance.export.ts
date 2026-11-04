import ExcelJS from 'exceljs'
import type { AttendanceStatus } from '@prisma/client'
import type { AttendanceExportItem } from './attendance.service.js'

const CENTER_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const statusLabels: Record<AttendanceStatus, string> = {
  PRESENT: 'Có mặt',
  LATE: 'Muộn',
  ABSENT: 'Vắng',
  EXCUSED: 'Có phép',
}

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: CENTER_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: CENTER_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const formatDate = (value: Date) => dateFormat.format(value)
const formatTime = (value: Date) => timeFormat.format(value)
const formatDateTime = (value: Date | null) =>
  value ? `${formatDate(value)} ${formatTime(value)}` : ''

function styleHeader(sheet: ExcelJS.Worksheet) {
  // Cùng kiểu dòng tiêu đề với báo cáo của module finance
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

/** Báo cáo điểm danh: sheet chi tiết từng lượt + sheet tổng hợp chuyên cần theo học viên */
export async function toAttendanceWorkbook(items: AttendanceExportItem[]) {
  const workbook = new ExcelJS.Workbook()

  const detail = workbook.addWorksheet('Chi tiết điểm danh')
  detail.columns = [
    { header: 'Ngày', key: 'date', width: 12 },
    { header: 'Giờ học', key: 'time', width: 14 },
    { header: 'Lớp', key: 'className', width: 32 },
    { header: 'Môn', key: 'sport', width: 16 },
    { header: 'Mã học viên', key: 'memberCode', width: 16 },
    { header: 'Học viên', key: 'memberName', width: 26 },
    { header: 'Trạng thái', key: 'status', width: 12 },
    { header: 'Ghi chú', key: 'note', width: 36 },
    { header: 'Điểm danh lúc', key: 'checkedAt', width: 18 },
  ]
  detail.addRows(
    items.map((item) => ({
      date: formatDate(item.session.startsAt),
      time: `${formatTime(item.session.startsAt)}–${formatTime(item.session.endsAt)}`,
      className: item.class.name,
      sport: item.class.sport.name,
      memberCode: item.member.memberCode,
      memberName: item.member.displayName,
      status: statusLabels[item.status],
      note: item.note ?? '',
      checkedAt: formatDateTime(item.checkedAt),
    })),
  )
  styleHeader(detail)

  // Chuyên cần = (Có mặt + Muộn) / số buổi đã điểm danh, cùng công thức trang Kết quả & Tiến độ
  const byMember = new Map<
    number,
    {
      memberCode: string
      memberName: string
      counts: Record<AttendanceStatus, number>
    }
  >()
  for (const item of items) {
    const row = byMember.get(item.member.id) ?? {
      memberCode: item.member.memberCode,
      memberName: item.member.displayName,
      counts: { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 },
    }
    row.counts[item.status] += 1
    byMember.set(item.member.id, row)
  }

  const summary = workbook.addWorksheet('Tổng hợp theo học viên')
  summary.columns = [
    { header: 'Mã học viên', key: 'memberCode', width: 16 },
    { header: 'Học viên', key: 'memberName', width: 26 },
    { header: 'Có mặt', key: 'present', width: 10 },
    { header: 'Muộn', key: 'late', width: 10 },
    { header: 'Vắng', key: 'absent', width: 10 },
    { header: 'Có phép', key: 'excused', width: 10 },
    { header: 'Tổng buổi', key: 'total', width: 12 },
    { header: 'Chuyên cần', key: 'rate', width: 12 },
  ]
  summary.addRows(
    [...byMember.values()]
      .sort((a, b) => a.memberCode.localeCompare(b.memberCode))
      .map(({ memberCode, memberName, counts }) => {
        const total =
          counts.PRESENT + counts.LATE + counts.ABSENT + counts.EXCUSED
        return {
          memberCode,
          memberName,
          present: counts.PRESENT,
          late: counts.LATE,
          absent: counts.ABSENT,
          excused: counts.EXCUSED,
          total,
          rate: total > 0 ? (counts.PRESENT + counts.LATE) / total : 0,
        }
      }),
  )
  summary.getColumn('rate').numFmt = '0.0%'
  styleHeader(summary)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
