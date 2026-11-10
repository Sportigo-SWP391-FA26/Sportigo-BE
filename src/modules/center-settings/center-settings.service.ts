import { audit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'
import { AVAILABILITY_RULES } from '../coach-availability/coach-availability.constants.js'

const SETTING_ID = 1

export async function getCenterSettings() {
  const record = await prisma.centerSetting.findUnique({ where: { id: SETTING_ID } })
  return { minimumShifts: record?.minimumShifts ?? AVAILABILITY_RULES.minimumShifts }
}

export async function updateCenterSettings(data: { minimumShifts: number }, actorId: number) {
  const oldData = await getCenterSettings()
  const record = await prisma.centerSetting.upsert({ where: { id: SETTING_ID }, update: data, create: { id: SETTING_ID, ...data } })
  await audit(prisma, { actorId, action: 'UPDATE', entityType: 'CENTER_SETTING', entityId: SETTING_ID, oldData, newData: { minimumShifts: record.minimumShifts } })
  return { minimumShifts: record.minimumShifts }
}
