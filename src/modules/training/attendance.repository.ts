import type { AttendanceStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { memberRefSelect, type Db } from './training.common.js'

const attendanceSelect = {
  id: true,
  registrationId: true,
  classSessionId: true,
  status: true,
  note: true,
  checkedAt: true,
  markedById: true,
  updatedAt: true,
} as const

export function findSessionWithClass(sessionId: number) {
  return prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      groupClass: {
        select: { id: true, name: true, coachId: true, status: true },
      },
    },
  })
}

export function findRegistrationsByIds(ids: number[], db: Db = prisma) {
  return db.classRegistration.findMany({
    where: { id: { in: ids } },
    select: { id: true, classId: true, status: true },
  })
}

export function upsertAttendance(
  db: Db,
  data: {
    registrationId: number
    classSessionId: number
    status: AttendanceStatus
    note: string | null
    markedById: number
    checkedAt: Date
  },
) {
  const { registrationId, classSessionId, ...changes } = data
  return db.sessionAttendance.upsert({
    where: {
      registrationId_classSessionId: { registrationId, classSessionId },
    },
    create: data,
    update: changes,
    select: attendanceSelect,
  })
}

export function findConfirmedRoster(classId: number, sessionId: number) {
  return prisma.classRegistration.findMany({
    where: { classId, status: 'CONFIRMED' },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      member: { select: memberRefSelect },
      attendances: {
        where: { classSessionId: sessionId },
        select: attendanceSelect,
      },
    },
  })
}
