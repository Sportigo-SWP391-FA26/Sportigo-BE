import { Router, type RequestHandler } from 'express'
import multer, { MulterError } from 'multer'
import { HttpError } from '../../lib/http-error.js'
import { authenticate } from '../../middleware/auth.js'
import { createImageUpload } from './upload.controller.js'

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      callback(new HttpError(400, 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP', 'IMAGE_TYPE_NOT_ALLOWED'))
      return
    }
    callback(null, true)
  },
})

export const uploadRouter = Router()
uploadRouter.use(authenticate)
const parseImage: RequestHandler = (request, response, next) => {
  imageUpload.single('image')(request, response, (error) => {
    if (!error) return next()
    if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new HttpError(400, 'Ảnh phải nhỏ hơn hoặc bằng 5 MB', 'IMAGE_TOO_LARGE'))
    }
    return next(error)
  })
}
uploadRouter.post('/images', parseImage, createImageUpload)
