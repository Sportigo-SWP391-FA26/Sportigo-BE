import nodemailer from 'nodemailer'
import { env } from '../../config/env.js'

const transporter =
  env.SMTP_USER && env.SMTP_APP_PASSWORD
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_APP_PASSWORD.replace(/\s/g, ''),
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      })
    : null

export async function sendVerificationEmail(input: {
  email: string
  displayName: string
  verificationUrl: string
}) {
  if (!transporter || !env.SMTP_USER) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMTP_USER and SMTP_APP_PASSWORD are required in production')
    }
    console.info('[email:development] Verify ' + input.email + ': ' + input.verificationUrl)
    return
  }
  const safeDisplayName = escapeHtml(input.displayName)
  const html =
    '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f8ff;padding:32px;color:#10213f"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px"><h1 style="color:#1769e8">Chào mừng đến Sportigo</h1><p>Xin chào ' +
    safeDisplayName +
    ',</p><p>Nhấn nút bên dưới để xác minh email và kích hoạt tài khoản của bạn.</p><p style="margin:28px 0"><a href="' +
    input.verificationUrl +
    '" style="background:#1769e8;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Xác minh email</a></p><p>Liên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản này, hãy bỏ qua email.</p></div></body></html>'

  await transporter.sendMail({
    from: env.EMAIL_FROM ?? `Sportigo <${env.SMTP_USER}>`,
    to: input.email,
    subject: 'Xác minh tài khoản Sportigo',
    text: `Xin chào ${input.displayName},\n\nXác minh tài khoản Sportigo tại: ${input.verificationUrl}\n\nLiên kết có hiệu lực trong 24 giờ.`,
    html,
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}
