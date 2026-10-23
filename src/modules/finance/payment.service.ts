import { payWithWallet, getOrder } from './finance.service.js'

export class PaymentService {
  async payOrderWithWallet(orderId: number, actorUserId: number) {
    const user = { id: actorUserId, role: 'MEMBER' }
    const order = await getOrder(orderId, user)
    return payWithWallet(orderId, Number(order.finalAmount), actorUserId)
  }
}

export default new PaymentService()
