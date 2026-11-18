export function calculatePay(input: {
  baseSalary: number
  scheduledUnits: number
  absentUnits: number
  allowanceTotal: number
  deductionTotal: number
  makeupCredit: number
}) {
  const absenceDeduction = input.scheduledUnits ? Math.round(input.baseSalary * input.absentUnits / input.scheduledUnits) : 0
  return { absenceDeduction, netAmount: Math.max(0, input.baseSalary - absenceDeduction + input.makeupCredit + input.allowanceTotal - input.deductionTotal) }
}
