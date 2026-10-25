import { env } from '../../config/env.js'

export async function sendVerificationEmail(input: {
  email: string
  displayName: string
  code: string
}) {
  if (env.NODE_ENV !== 'production') {
    console.info('[email:development] Verify ' + input.email + ' with OTP: ' + input.code)
  }
  if (!env.GMAIL_WEBHOOK_URL || !env.GMAIL_WEBHOOK_SECRET) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Gmail HTTPS webhook configuration is required in production')
    }
    return
  }

  const safeName = escapeHtml(input.displayName)
  const safeCode = escapeHtml(input.code)
  const text = `Xin chào ${input.displayName},\n\nMã OTP xác minh tài khoản Sportigo của bạn là: ${input.code}\n\nMã có hiệu lực trong 10 phút.`
  const html =
    '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#10213a"><div style="max-width:560px;margin:auto;padding:32px"><h1 style="color:#1769e8">Sportigo</h1><h2>Xác minh tài khoản</h2><p>Xin chào ' +
    safeName +
    ',</p><p>Nhập mã OTP dưới đây để kích hoạt tài khoản Member của bạn.</p><p style="margin:28px 0;padding:18px 22px;border-radius:12px;background:#eff6ff;color:#1769e8;font-size:32px;font-weight:800;letter-spacing:10px;text-align:center">' +
    safeCode +
    '</p><p>Mã có hiệu lực trong 10 phút. Nếu bạn không tạo tài khoản này, hãy bỏ qua email.</p></div></body></html>'

  const response = await fetch(env.GMAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.GMAIL_WEBHOOK_SECRET,
      to: input.email,
      subject: `${input.code} là mã xác minh Sportigo của bạn`,
      text,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const result = (await response.json()) as { ok?: boolean; error?: string }
  if (!response.ok || !result.ok) {
    throw new Error(`Gmail webhook error: ${result.error ?? response.status}`)
  }
}

export async function sendPasswordResetEmail(input: {
  email: string
  displayName: string
  code: string
}) {
  if (env.NODE_ENV !== 'production') {
    console.info('[email:development] Reset password for ' + input.email + ' with OTP: ' + input.code)
  }
  const safeName = escapeHtml(input.displayName)
  const safeCode = escapeHtml(input.code)
  await sendEmail({
    to: input.email,
    subject: `${input.code} là mã khôi phục mật khẩu Sportigo`,
    text: `Xin chào ${input.displayName},\n\nMã OTP khôi phục mật khẩu Sportigo của bạn là: ${input.code}\n\nMã có hiệu lực trong 10 phút.`,
    html: '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#10213a"><div style="max-width:560px;margin:auto;padding:32px"><h1 style="color:#1769e8">Sportigo</h1><h2>Khôi phục mật khẩu</h2><p>Xin chào ' + safeName + ',</p><p>Nhập mã OTP dưới đây để đặt mật khẩu mới.</p><p style="margin:28px 0;padding:18px 22px;border-radius:12px;background:#eff6ff;color:#1769e8;font-size:32px;font-weight:800;letter-spacing:10px;text-align:center">' + safeCode + '</p><p>Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu đổi mật khẩu, hãy bỏ qua email.</p></div></body></html>',
  })
}

// TEMP(FR-05): thêm "export" để users gửi email OTP đổi email bằng cùng webhook; logic không đổi.
// Khi Tài có hàm gửi mail dùng chung chính thức thì sửa import trong users/email-change.mail.ts và xóa comment này.
export async function sendEmail(input: { to: string; subject: string; text: string; html: string }) {
  if (!env.GMAIL_WEBHOOK_URL || !env.GMAIL_WEBHOOK_SECRET) {
    if (env.NODE_ENV === 'production') throw new Error('Gmail HTTPS webhook configuration is required in production')
    return
  }
  const response = await fetch(env.GMAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.GMAIL_WEBHOOK_SECRET, ...input }),
    signal: AbortSignal.timeout(15_000),
  })
  const result = (await response.json()) as { ok?: boolean; error?: string }
  if (!response.ok || !result.ok) throw new Error(`Gmail webhook error: ${result.error ?? response.status}`)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
