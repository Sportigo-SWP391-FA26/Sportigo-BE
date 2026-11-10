import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import * as controller from './membership.controller.js'

const memberOnly = [authenticate, authorize('MEMBER')]
const managerOnly = [authenticate, authorize('CENTER_MANAGER')]
const frontDesk = [authenticate, authorize('RECEPTIONIST', 'CENTER_MANAGER')]

// Gắn ở gốc /api vì các đường dẫn thuộc nhiều nhóm tài nguyên
export const membershipRouter = Router()

membershipRouter.get('/memberships/plans', controller.listPublicPlans)
membershipRouter.get('/memberships/plans/manage', ...managerOnly, controller.listManagedPlans)
membershipRouter.post('/memberships/plans/manage', ...managerOnly, controller.createPlan)
membershipRouter.patch('/memberships/plans/manage/:id', ...managerOnly, controller.updatePlan)
membershipRouter.delete('/memberships/plans/manage/:id', ...managerOnly, controller.deletePlan)
membershipRouter.post('/memberships/purchase', ...memberOnly, controller.purchase)

// "me" phải đứng trước ":id"
membershipRouter.get('/members/me/membership', ...memberOnly, controller.getMyMembership)
membershipRouter.get('/members/me/check-ins', ...memberOnly, controller.listMyCheckIns)
membershipRouter.post('/members/:id/memberships', authenticate, authorize('RECEPTIONIST'), controller.purchaseForMember)

membershipRouter.post('/check-ins', ...frontDesk, controller.checkIn)
membershipRouter.get('/check-ins', ...frontDesk, controller.listCheckIns)
