import type { RequestHandler } from 'express'
import { z } from 'zod'
import { HttpError } from '../../lib/http-error.js'
import { getAuthUser } from '../../middleware/auth.js'
import { uploadImage, uploadPurposes } from './upload.service.js'

const bodySchema = z.object({ purpose: z.enum(uploadPurposes) })

export const createImageUpload: RequestHandler = async (request, response) => {
  const { purpose } = bodySchema.parse(request.body)
  const actor = getAuthUser(request)
  if (purpose !== 'avatar' && actor.role !== 'CENTER_MANAGER') {
    throw new HttpError(403, 'Bạn không có quyền tải ảnh cho nội dung này', 'FORBIDDEN')
  }
  if (!request.file) throw new HttpError(400, 'Hãy chọn một tệp ảnh', 'IMAGE_REQUIRED')
  response.status(201).json(await uploadImage(request.file.buffer, purpose))
}
