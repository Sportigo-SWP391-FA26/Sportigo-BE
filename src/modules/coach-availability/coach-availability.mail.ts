import { sendEmail } from '../auth/email.service.js'

export async function sendAvailabilityEmail(input: { to: string; subject: string; message: string }) {
  await sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#10213a"><div style="max-width:560px;margin:auto;padding:32px"><h1 style="color:#1769e8">Sportigo</h1><p>${input.message.replace(/[&<>]/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[value] ?? value)}</p></div></body></html>`,
  })
}

