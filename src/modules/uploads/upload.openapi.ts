export const uploadPaths = {
  '/uploads/images': {
    post: {
      tags: ['Uploads'],
      summary: 'Tải một ảnh lên Cloudinary',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['image', 'purpose'],
              properties: {
                image: { type: 'string', format: 'binary' },
                purpose: { type: 'string', enum: ['avatar', 'sport', 'content'] },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Upload thành công; trả về secureUrl và metadata ảnh' },
        400: { description: 'Tệp không hợp lệ hoặc vượt quá 5 MB' },
        401: { description: 'Chưa đăng nhập' },
        403: { description: 'Không có quyền upload ảnh nội dung' },
        503: { description: 'Cloudinary chưa được cấu hình' },
      },
    },
  },
} as const
