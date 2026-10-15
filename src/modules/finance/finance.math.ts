import { Prisma } from '@prisma/client'

export type MoneyInput = Prisma.Decimal | number | string
export const toMoney = (value: MoneyInput) => new Prisma.Decimal(value)

export function calculateRemaining(finalAmount: MoneyInput, payments: { amount: MoneyInput; status: string }[]) {
  const paid = payments.filter((item) => ['SUCCESS', 'PARTIALLY_REFUNDED'].includes(item.status)).reduce((sum, item) => sum.plus(item.amount), toMoney(0))
  return Prisma.Decimal.max(toMoney(0), toMoney(finalAmount).minus(paid))
}

export function calculateDiscount(input: { originalAmount: MoneyInput; discountType: 'PERCENTAGE'|'FIXED_AMOUNT'; discountValue: MoneyInput; maxDiscount?: MoneyInput | null }) {
  const original = toMoney(input.originalAmount)
  let discount = input.discountType === 'PERCENTAGE' ? original.mul(input.discountValue).div(100) : toMoney(input.discountValue)
  if (input.maxDiscount != null) discount = Prisma.Decimal.min(discount, toMoney(input.maxDiscount))
  return Prisma.Decimal.min(discount, original)
}

export function calculateRefundable(amount: MoneyInput, adjustments: { amount: MoneyInput; type: string }[]) {
  return toMoney(amount).minus(adjustments.filter((item) => item.type === 'REFUND').reduce((sum, item) => sum.plus(item.amount), toMoney(0)))
}

export function isFullyRefunded(totalPaid: MoneyInput, previousRefunds: MoneyInput[], approvedAmount: MoneyInput) {
  return previousRefunds.reduce<Prisma.Decimal>((sum, value) => sum.plus(value), toMoney(approvedAmount)).greaterThanOrEqualTo(totalPaid)
}
