import { Request, Response, NextFunction } from 'express';
import paymentService from './payment.service.js';
import { getAuthUser } from '../../middleware/auth.js';

export class PaymentController {
  // POST /api/orders/:id/pay (FR-27)
  async payOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orderId = Number(req.params.id);
      const { id: actorUserId } = getAuthUser(req);

      const result = await paymentService.payOrderWithWallet(orderId, actorUserId);
      res.status(200).json({
        success: true,
        message: 'Thanh toán đơn hàng thành công.',
        data: result,
      });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new PaymentController();