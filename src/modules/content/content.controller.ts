import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { contentKindSchema, facilitySchema, heroSlideSchema, newsletterSchema, partnerSchema, siteSettingSchema } from './content.schema.js'
import * as service from './content.service.js'

const schemaFor = (kind: 'heroes' | 'facilities' | 'partners') => kind === 'heroes' ? heroSlideSchema : kind === 'facilities' ? facilitySchema : partnerSchema

export const publicLanding: RequestHandler = async (_request, response) => {
  response.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
  response.json({ success: true, data: await service.getPublicLanding() })
}
export const newsletter: RequestHandler = async (request, response) => {
  const { email } = newsletterSchema.parse(request.body)
  const result = await service.subscribeNewsletter(email)
  response.status(result.alreadySubscribed ? 200 : 201).json({ success: true, data: result.subscriber, alreadySubscribed: result.alreadySubscribed })
}
export const memberHome: RequestHandler = async (request, response) => response.json({ success: true, data: await service.getMemberHome(getAuthUser(request).id) })
export const managerDashboard: RequestHandler = async (_request, response) => response.json({ success: true, data: await service.getManagerDashboard() })
export const list: RequestHandler = async (request, response) => { const kind = contentKindSchema.parse(request.params.kind); response.json({ success: true, data: await service.listContent(kind) }) }
export const create: RequestHandler = async (request, response) => { const kind = contentKindSchema.parse(request.params.kind); const data = schemaFor(kind).parse(request.body); response.status(201).json({ success: true, data: await service.createContent(kind, data, getAuthUser(request).id) }) }
export const update: RequestHandler = async (request, response) => { const kind = contentKindSchema.parse(request.params.kind); const data = schemaFor(kind).partial().parse(request.body); response.json({ success: true, data: await service.updateContent(kind, Number(request.params.id), data, getAuthUser(request).id) }) }
export const remove: RequestHandler = async (request, response) => { const kind = contentKindSchema.parse(request.params.kind); response.json({ success: true, data: await service.deleteContent(kind, Number(request.params.id), getAuthUser(request).id) }) }
export const getSettings: RequestHandler = async (_request, response) => response.json({ success: true, data: await service.getSettings() })
export const updateSettings: RequestHandler = async (request, response) => response.json({ success: true, data: await service.updateSettings(siteSettingSchema.parse(request.body), getAuthUser(request).id) })
