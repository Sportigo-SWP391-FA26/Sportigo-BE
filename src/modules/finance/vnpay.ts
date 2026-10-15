import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'

export type VnpayParams = Record<string, string>

function encode(value: string) {
  return encodeURIComponent(value).replace(/%20/g, '+')
}

function canonical(params: VnpayParams) {
  return Object.keys(params)
    .filter((key) => key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType' && params[key])
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key]!)}`)
    .join('&')
}

function secret() {
  if (!env.VNPAY_TMN_CODE || !env.VNPAY_HASH_SECRET) {
    throw new HttpError(503, 'VNPay Sandbox chưa được cấu hình', 'VNPAY_NOT_CONFIGURED')
  }
  return { tmnCode: env.VNPAY_TMN_CODE, hashSecret: env.VNPAY_HASH_SECRET }
}

export function signVnpay(params: VnpayParams) {
  const { hashSecret } = secret()
  return createHmac('sha512', hashSecret).update(canonical(params), 'utf8').digest('hex')
}

export function verifyVnpay(params: VnpayParams) {
  const received = params.vnp_SecureHash?.toLowerCase()
  if (!received || !/^[a-f0-9]{128}$/.test(received)) return false
  const expected = signVnpay(params)
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

function vnpDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`
}

export function createPaymentUrl(input: { reference: string; amount: number; ipAddress: string; orderInfo: string }) {
  const { tmnCode } = secret()
  const params: VnpayParams = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: tmnCode,
    vnp_Amount: String(Math.round(input.amount * 100)), vnp_CurrCode: 'VND',
    vnp_TxnRef: input.reference, vnp_OrderInfo: input.orderInfo, vnp_OrderType: 'other',
    vnp_Locale: 'vn', vnp_ReturnUrl: env.VNPAY_RETURN_URL,
    vnp_IpAddr: input.ipAddress.replace('::ffff:', '') || '127.0.0.1', vnp_CreateDate: vnpDate(),
  }
  params.vnp_SecureHash = signVnpay(params)
  return `${env.VNPAY_PAYMENT_URL}?${canonical(params)}&vnp_SecureHash=${params.vnp_SecureHash}`
}

export function normalizeVnpayQuery(query: Record<string, unknown>): VnpayParams {
  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[0].startsWith('vnp_') && typeof entry[1] === 'string'),
  )
}
