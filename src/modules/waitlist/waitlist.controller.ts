import { Request, Response, NextFunction } from 'express'
import { WaitlistStatus } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import waitlistService from './waitlist.service.js'
import { getAuthUser } from '../../middleware/auth.js'

function queryInteger(
  value: unknown,
  name: string,
  defaultValue?: number,
): number | undefined {
  if (value === undefined && defaultValue !== undefined) return defaultValue
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(
      400,
      `${name} phải là số nguyên dương.`,
      'INVALID_QUERY',
    )
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError(400, `${name} không hợp lệ.`, 'INVALID_QUERY')
  }
  return parsed
}

export class WaitlistController {
  // POST /api/group-classes/:id/waitlist (FR-25)
  async joinWaitlist(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const classId = queryInteger(req.params.id, 'id')!;
      const { id: memberId } = getAuthUser(req)

      const result = await waitlistService.joinWaitlist(memberId, classId)
      res.status(201).json({
        success: true,
        message: 'Đã thêm vào danh sách chờ (Waitlist) thành công.',
        data: result,
      })
    } catch (error: unknown) {
      next(error)
    }
  }

  async respondToOffer(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const classId = queryInteger(req.params.id, 'id')!;
      const { id: memberId } = getAuthUser(req)
      const { accept } = req.body as { accept?: unknown }
      if (typeof accept !== 'boolean') {
        res
          .status(400)
          .json({ success: false, message: 'accept phải là giá trị boolean.' })
        return
      }

      const result = await waitlistService.respondToOffer(
        memberId,
        classId,
        accept,
      )
      res.status(200).json({ success: true, data: result })
    } catch (error: unknown) {
      next(error)
    }
  }

  async getMyWaitlists(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id: memberId } = getAuthUser(req)
      const items = await waitlistService.getMemberWaitlists(memberId)
      res.status(200).json({ success: true, data: { items } })
    } catch (error: unknown) {
      next(error)
    }
  }

  async listWaitlists(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const classId = queryInteger(req.query.classId, 'classId')
      const page = queryInteger(req.query.page, 'page', 1)!
      const limit = queryInteger(req.query.limit, 'limit', 20)!
      if (limit > 100)
        throw new HttpError(
          400,
          'limit không được lớn hơn 100.',
          'INVALID_QUERY',
        )
      const rawStatus = req.query.status
      if (
        rawStatus !== undefined &&
        (typeof rawStatus !== 'string' ||
          !Object.values(WaitlistStatus).includes(rawStatus as WaitlistStatus))
      ) {
        throw new HttpError(400, 'status không hợp lệ.', 'INVALID_QUERY')
      }

      const data = await waitlistService.listWaitlists({
        classId,
        status: rawStatus as WaitlistStatus | undefined,
        page,
        limit,
      })
      res.status(200).json({ success: true, data })
    } catch (error: unknown) {
      next(error)
    }
  }

  async getWaitlistHistory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const waitlistId = queryInteger(req.params.id, 'id')
      const data = await waitlistService.getWaitlistHistory(waitlistId!)
      res.status(200).json({ success: true, data })
    } catch (error: unknown) {
      next(error)
    }
  }
}

export default new WaitlistController()
