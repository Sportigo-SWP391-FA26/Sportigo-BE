import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'

export function assertClassRegistrationCancellable(
  startsAt: Date,
  actorRole: string,
  now = new Date(),
  cutoffHours = env.CLASS_CANCELLATION_CUTOFF_HOURS,
) {
  const hoursUntilStart = (startsAt.getTime() - now.getTime()) / (60 * 60 * 1000)
  if (hoursUntilStart <= 0) {
    throw new HttpError(409, 'Không thể hủy đăng ký sau khi lớp đã bắt đầu.', 'CLASS_ALREADY_STARTED')
  }
  // BR-22: Member hoặc lễ tân đều hủy được; trước hạn hủy hoàn 100%, sau hạn hoàn 50%.
  void actorRole
  return hoursUntilStart >= cutoffHours ? 1 : 0.5
}
