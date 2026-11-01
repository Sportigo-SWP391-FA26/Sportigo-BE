import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'

export const uploadPurposes = ['avatar', 'sport', 'content'] as const
export type UploadPurpose = (typeof uploadPurposes)[number]

const folders: Record<UploadPurpose, string> = {
  avatar: 'sportigo/avatars',
  sport: 'sportigo/sports',
  content: 'sportigo/content',
}

export async function uploadImage(buffer: Buffer, purpose: UploadPurpose) {
  if (!env.CLOUDINARY_URL) {
    throw new HttpError(503, 'Dịch vụ lưu trữ ảnh chưa được cấu hình', 'UPLOAD_NOT_CONFIGURED')
  }

  let result: UploadApiResponse
  try {
    result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: folders[purpose],
          resource_type: 'image',
          transformation: [{ width: 1800, height: 1800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
        },
        (error, uploaded) => {
          if (error || !uploaded) reject(error ?? new Error('Cloudinary did not return an upload result'))
          else resolve(uploaded)
        },
      )
      stream.end(buffer)
    })
  } catch (error) {
    console.error('Cloudinary upload failed', error instanceof Error ? error.message : 'Unknown Cloudinary error')
    throw new HttpError(503, 'Cloudinary đang từ chối upload. Hãy kiểm tra trạng thái cloud và thông tin kết nối.', 'UPLOAD_PROVIDER_UNAVAILABLE')
  }

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
  }
}
