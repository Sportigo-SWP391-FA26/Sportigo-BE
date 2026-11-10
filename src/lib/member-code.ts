import { randomInt } from 'node:crypto'

// Bỏ 0, 1, I, L, O để lễ tân đọc và nhập tay không nhầm
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function generateMemberCode() {
  let code = 'SG'
  for (let index = 0; index < 6; index += 1) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}
