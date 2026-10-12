import type { RequestHandler } from 'express'
import { idParamsSchema } from './training.common.js'
import {
  createItemSchema,
  itemParamsSchema,
  reorderItemsSchema,
  updateItemSchema,
} from './workout-plan-item.schema.js'
import * as itemService from './workout-plan-item.service.js'

export const listItems: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  response.json(await itemService.listItems(id))
}

export const createItem: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  const input = createItemSchema.parse(request.body)
  response.status(201).json(await itemService.createItem(id, input))
}

export const updateItem: RequestHandler = async (request, response) => {
  const { id, itemId } = itemParamsSchema.parse(request.params)
  const input = updateItemSchema.parse(request.body)
  response.json(await itemService.updateItem(id, itemId, input))
}

export const deleteItem: RequestHandler = async (request, response) => {
  const { id, itemId } = itemParamsSchema.parse(request.params)
  await itemService.deleteItem(id, itemId)
  response.status(204).end()
}

export const reorderItems: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  const input = reorderItemsSchema.parse(request.body)
  response.json(await itemService.reorderItems(id, input))
}
