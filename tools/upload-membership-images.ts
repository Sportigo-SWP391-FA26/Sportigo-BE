import 'dotenv/config'
import { v2 as cloudinary } from 'cloudinary'
import { resolve } from 'node:path'

const imageDir = resolve('../Sport_Center_FE/public/images/membership')
const names = ['one-month', 'three-month', 'six-month'] as const

async function main() {
  if (!process.env.CLOUDINARY_URL) throw new Error('CLOUDINARY_URL chưa được cấu hình')
  for (const name of names) {
    const result = await cloudinary.uploader.upload(resolve(imageDir, `${name}.webp`), {
      public_id: name,
      folder: 'sportigo/memberships',
      overwrite: true,
      resource_type: 'image',
    })
    console.log(`${name}=${result.secure_url}`)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
