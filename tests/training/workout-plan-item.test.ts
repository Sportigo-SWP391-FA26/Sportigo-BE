import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  createCoach,
  createManager,
  createSport,
  createWorkoutPlan,
  resetDatabase,
} from './fixtures.js'

const BR45 = 'Thứ tự mục giáo án bị trùng.'

type Item = {
  id: number
  weekNumber: number
  sessionNumber: number
  itemOrder: number
  title: string
}

describe.skipIf(!hasTestDatabase)('FR-50 Mục trong giáo án', () => {
  let sportId: number
  let coach: Awaited<ReturnType<typeof createCoach>>
  let manager: Awaited<ReturnType<typeof createManager>>

  beforeAll(async () => {
    await resetDatabase()
    sportId = (await createSport()).id
    coach = await createCoach()
    manager = await createManager()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const newPlan = (itemCount = 0, status: 'DRAFT' | 'ACTIVE' = 'DRAFT') =>
    createWorkoutPlan({ sportId, createdById: coach.id, itemCount, status })

  const itemsUrl = (planId: number) => `/api/workout-plans/${planId}/items`

  const addItem = (planId: number, body: Record<string, unknown>) =>
    request(app)
      .post(itemsUrl(planId))
      .set('Authorization', coach.auth)
      .send({ title: 'Bài', content: 'Nội dung', ...body })

  const listTitles = async (planId: number) => {
    const response = await request(app)
      .get(itemsUrl(planId))
      .set('Authorization', coach.auth)
    return (response.body as Item[]).map(
      (item) => `${item.title}#${item.itemOrder}`,
    )
  }

  it('FR-50: thêm mục với tuần, buổi, thứ tự và thông số', async () => {
    const plan = await newPlan()
    const response = await addItem(plan.id, {
      weekNumber: 1,
      sessionNumber: 2,
      itemOrder: 1,
      sets: 3,
      repetitions: 12,
      intensity: 'MEDIUM',
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      weekNumber: 1,
      sessionNumber: 2,
      itemOrder: 1,
      sets: 3,
      repetitions: 12,
    })
  })

  it('FR-50: bỏ trống itemOrder thì tự xếp cuối tuần/buổi', async () => {
    const plan = await newPlan(2)
    const response = await addItem(plan.id, { weekNumber: 1, sessionNumber: 1 })

    expect(response.status).toBe(201)
    expect(response.body.itemOrder).toBe(3)
  })

  it('FR-50 / BR-45: tạo mục trùng tuần/buổi/thứ tự trả 409', async () => {
    const plan = await newPlan(1)
    const response = await addItem(plan.id, {
      weekNumber: 1,
      sessionNumber: 1,
      itemOrder: 1,
    })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('DUPLICATE_ITEM_ORDER')
    expect(response.body.message).toBe(BR45)
  })

  it('FR-50: sửa nội dung và thông số của mục', async () => {
    const plan = await newPlan(1)
    const [item] = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id },
    })
    const response = await request(app)
      .patch(`${itemsUrl(plan.id)}/${item!.id}`)
      .set('Authorization', coach.auth)
      .send({ content: 'Nội dung mới', durationMinutes: 15, note: null })

    expect(response.status).toBe(200)
    expect(response.body.content).toBe('Nội dung mới')
    expect(response.body.durationMinutes).toBe(15)
  })

  it('FR-50 / BR-45: sửa thứ tự trùng với mục khác trả 409', async () => {
    const plan = await newPlan(2)
    const items = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id },
      orderBy: { itemOrder: 'asc' },
    })
    const response = await request(app)
      .patch(`${itemsUrl(plan.id)}/${items[1]!.id}`)
      .set('Authorization', coach.auth)
      .send({ itemOrder: 1 })

    expect(response.status).toBe(409)
    expect(response.body.message).toBe(BR45)
  })

  it('FR-50: tuần vượt thời lượng giáo án trả 422', async () => {
    const plan = await newPlan()
    const response = await addItem(plan.id, { weekNumber: 9, sessionNumber: 1 })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('WEEK_OUT_OF_RANGE')
  })

  it('FR-50 / BR-45: sắp xếp lại thứ tự các mục trong cùng tuần/buổi', async () => {
    const plan = await newPlan(3)
    const items = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id },
      orderBy: { itemOrder: 'asc' },
    })
    const [a, b, c] = items
    const response = await request(app)
      .patch(`${itemsUrl(plan.id)}/reorder`)
      .set('Authorization', coach.auth)
      .send({
        items: [
          { itemId: c!.id, itemOrder: 1 },
          { itemId: a!.id, itemOrder: 2 },
          { itemId: b!.id, itemOrder: 3 },
        ],
      })

    expect(response.status).toBe(200)
    expect(await listTitles(plan.id)).toEqual(['Bài 3#1', 'Bài 1#2', 'Bài 2#3'])
  })

  it('FR-50: reorder thiếu mục hoặc thứ tự không liên tục trả 422', async () => {
    const plan = await newPlan(3)
    const items = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id },
      orderBy: { itemOrder: 'asc' },
    })
    const missingOne = await request(app)
      .patch(`${itemsUrl(plan.id)}/reorder`)
      .set('Authorization', coach.auth)
      .send({
        items: [
          { itemId: items[0]!.id, itemOrder: 2 },
          { itemId: items[1]!.id, itemOrder: 1 },
        ],
      })
    const withGap = await request(app)
      .patch(`${itemsUrl(plan.id)}/reorder`)
      .set('Authorization', coach.auth)
      .send({
        items: items.map((item, index) => ({
          itemId: item.id,
          itemOrder: index * 2 + 1,
        })),
      })

    expect(missingOne.status).toBe(400)
    expect(missingOne.body.code).toBe('REORDER_INCOMPLETE')
    expect(withGap.status).toBe(400)
    expect(await listTitles(plan.id)).toEqual(['Bài 1#1', 'Bài 2#2', 'Bài 3#3'])
  })

  it('FR-50: reorder các mục khác tuần/buổi trả 422', async () => {
    const plan = await newPlan(1)
    const other = await addItem(plan.id, { weekNumber: 2, sessionNumber: 1 })
    const [first] = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id, weekNumber: 1 },
    })
    const response = await request(app)
      .patch(`${itemsUrl(plan.id)}/reorder`)
      .set('Authorization', coach.auth)
      .send({
        items: [
          { itemId: first!.id, itemOrder: 1 },
          { itemId: other.body.id, itemOrder: 2 },
        ],
      })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('ITEMS_NOT_SAME_SLOT')
  })

  it('FR-50 / BR-45: xóa mục rồi đánh lại thứ tự liên tục', async () => {
    const plan = await newPlan(3)
    const items = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id },
      orderBy: { itemOrder: 'asc' },
    })
    const response = await request(app)
      .delete(`${itemsUrl(plan.id)}/${items[1]!.id}`)
      .set('Authorization', coach.auth)

    expect(response.status).toBe(204)
    expect(await listTitles(plan.id)).toEqual(['Bài 1#1', 'Bài 3#2'])
  })

  it('FR-50: không xóa mục cuối cùng của giáo án ACTIVE', async () => {
    const plan = await newPlan(1, 'ACTIVE')
    const [item] = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: plan.id },
    })
    const response = await request(app)
      .delete(`${itemsUrl(plan.id)}/${item!.id}`)
      .set('Authorization', coach.auth)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PLAN_NEEDS_ITEMS')
  })

  it('FR-50: mục không thuộc giáo án trả 404', async () => {
    const planA = await newPlan(1)
    const planB = await newPlan(1)
    const [itemOfB] = await prisma.workoutPlanItem.findMany({
      where: { workoutPlanId: planB.id },
    })
    const response = await request(app)
      .patch(`${itemsUrl(planA.id)}/${itemOfB!.id}`)
      .set('Authorization', coach.auth)
      .send({ title: 'Đổi tên' })

    expect(response.status).toBe(404)
  })

  it('FR-50 / BR-06: Manager được xem nhưng không được thêm mục', async () => {
    const plan = await newPlan(1)
    const read = await request(app)
      .get(itemsUrl(plan.id))
      .set('Authorization', manager.auth)
    const write = await request(app)
      .post(itemsUrl(plan.id))
      .set('Authorization', manager.auth)
      .send({ weekNumber: 1, sessionNumber: 1, title: 'X', content: 'Y' })

    expect(read.status).toBe(200)
    expect(write.status).toBe(403)
  })
})
