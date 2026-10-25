import { env } from '../../config/env.js'
// TEMP(FR-05): sendEmail được export tạm từ auth/email.service.ts, xem comment tại đó
import { sendEmail } from '../auth/email.service.js'

// note: escape tên người dùng trước khi chèn vào HTML để tránh chèn mã độc vào email
const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')

// FR-05: gửi OTP tới EMAIL MỚI để chứng minh người dùng thật sự sở hữu địa chỉ đó
export async function sendEmailChangeCode(input: { email: string; displayName: string; code: string }) {
  // note: môi trường dev in OTP ra console giống module auth để test không cần hộp thư thật
  if (env.NODE_ENV !== 'production') console.info('[email:development] Change email to ' + input.email + ' with OTP: ' + input.code)
  const safeName = escapeHtml(input.displayName)
  await sendEmail({
    to: input.email,
    subject: `${input.code} là mã xác nhận đổi email Sportigo`,
    text: `Xin chào ${input.displayName},\n\nMã OTP xác nhận đổi email đăng nhập Sportigo sang địa chỉ này là: ${input.code}\n\nMã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu đổi email, hãy bỏ qua email này.`,
    html:
      '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#10213a"><div style="max-width:560px;margin:auto;padding:32px"><h1 style="color:#1769e8">Sportigo</h1><h2>Xác nhận đổi email</h2><p>Xin chào ' +
      safeName +
      ',</p><p>Nhập mã OTP dưới đây để dùng địa chỉ này làm email đăng nhập mới.</p><p style="margin:28px 0;padding:18px 22px;border-radius:12px;background:#eff6ff;color:#1769e8;font-size:32px;font-weight:800;letter-spacing:10px;text-align:center">' +
      escapeHtml(input.code) +
      '</p><p>Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu đổi email, hãy bỏ qua email này.</p></div></body></html>',
  })
}
