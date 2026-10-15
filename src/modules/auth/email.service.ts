import { env } from '../../config/env.js'

export async function sendVerificationEmail(input: {
  email: string
  displayName: string
  verificationUrl: string
}) {
  if (!env.GMAIL_WEBHOOK_URL || !env.GMAIL_WEBHOOK_SECRET) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Gmail HTTPS webhook configuration is required in production')
    }
    console.info('[email:development] Verify ' + input.email + ': ' + input.verificationUrl)
    return
  }

  const safeName = escapeHtml(input.displayName)
  const safeUrl = escapeHtml(input.verificationUrl)
  const text = `Xin chào ${input.displayName},\n\nXác minh tài khoản Sportigo tại: ${input.verificationUrl}\n\nLiên kết có hiệu lực trong 24 giờ.`
  const html =
    '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#10213a"><div style="max-width:560px;margin:auto;padding:32px"><h1 style="color:#1769e8">Sportigo</h1><h2>Xác minh tài khoản</h2><p>Xin chào ' +
    safeName +
    ',</p><p>Nhấn nút bên dưới để kích hoạt tài khoản Member của bạn.</p><p><a href="' +
    safeUrl +
    '" style="background:#1769e8;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Xác minh email</a></p><p>Liên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản này, hãy bỏ qua email.</p></div></body></html>'

  const response = await fetch(env.GMAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.GMAIL_WEBHOOK_SECRET,
      to: input.email,
      subject: 'Xác minh tài khoản Sportigo',
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
