import { Resend } from 'resend'
import { env } from '../../config/env.js'

export async function sendVerificationEmail(input: { email: string; displayName: string; verificationUrl: string }) {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is required in production')
    console.info('[email:development] Verify ' + input.email + ': ' + input.verificationUrl)
    return
  }
  const resend = new Resend(env.RESEND_API_KEY)
  const html = '<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f8ff;padding:32px;color:#10213f"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px"><h1 style="color:#1769e8">Chào mừng đến Sportigo</h1><p>Xin chào ' + escapeHtml(input.displayName) + ',</p><p>Nhấn nút bên dưới để xác minh email và kích hoạt tài khoản của bạn.</p><p style="margin:28px 0"><a href="' + input.verificationUrl + '" style="background:#1769e8;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Xác minh email</a></p><p>Liên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản này, hãy bỏ qua email.</p></div></body></html>'
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: input.email,
    subject: 'Xác minh tài khoản Sportigo',
    html,
  })
  if (error) throw new Error('Resend error: ' + error.message)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}
