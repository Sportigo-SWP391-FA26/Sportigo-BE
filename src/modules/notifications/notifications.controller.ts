import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { listNotificationsSchema, notificationIdSchema } from './notifications.schema.js'
import * as notificationsService from './notifications.service.js'

export const listNotifications: RequestHandler = async (request, response) => {
  const query = listNotificationsSchema.parse(request.query)
  response.json(await notificationsService.listMyNotifications(getAuthUser(request).id, query))
}

export const markNotificationRead: RequestHandler = async (request, response) => {
  const { id } = notificationIdSchema.parse(request.params)
  response.json(await notificationsService.markMyNotificationRead(getAuthUser(request).id, id))
}

export const markAllNotificationsRead: RequestHandler = async (request, response) => {
  response.json(await notificationsService.markAllMyNotificationsRead(getAuthUser(request).id))
}
