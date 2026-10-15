import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import type {
  ChangePlanStatusInput,
  CreatePlanInput,
  ListPlansQuery,
  UpdatePlanInput,
} from './workout-plan.schema.js'
import * as planRepository from './workout-plan.repository.js'
import {
  forbidden,
  notFound,
  toCoachRef,
  toPage,
  toSkipTake,
} from './training.common.js'

type PlanRow = Awaited<ReturnType<typeof planRepository.createPlan>>

function toPlanSummary({ createdBy, _count, ...plan }: PlanRow) {
  return {
    ...plan,
    createdBy: toCoachRef(createdBy),
    itemCount: _count.items,
    assignmentCount: _count.assignments,
  }
}

export async function getPlanStateOrThrow(planId: number) {
  const plan = await planRepository.findPlanState(planId)
  if (!plan) throw notFound('Không tìm thấy giáo án')
  return plan
}

async function assertSportAvailable(sportId: number) {
  const sport = await planRepository.findSport(sportId)
  if (!sport?.isActive) {
    throw new HttpError(
      422,
      'Môn thể thao không tồn tại hoặc đã ngừng hoạt động',
      'SPORT_NOT_AVAILABLE',
    )
  }
}

export async function listPlans(query: ListPlansQuery) {
  const { page, pageSize, ...filter } = query
  const [rows, total] = await planRepository.findPlans(
    filter,
    toSkipTake({ page, pageSize }),
  )
  return toPage(rows.map(toPlanSummary), total, { page, pageSize })
}

export async function getPlan(planId: number) {
  const plan = await planRepository.findPlanDetail(planId)
  if (!plan) throw notFound('Không tìm thấy giáo án')
  const { items, ...summary } = plan
  return { ...toPlanSummary(summary), items }
}

export async function createPlan(user: AuthUser, input: CreatePlanInput) {
  if (!(await planRepository.findCoach(user.id))) throw forbidden()
  await assertSportAvailable(input.sportId)
  const plan = await planRepository.createPlan({
    ...input,
    createdById: user.id,
  })
  return toPlanSummary(plan)
}

export async function updatePlan(planId: number, input: UpdatePlanInput) {
  const plan = await getPlanStateOrThrow(planId)

  if (input.sportId !== undefined && input.sportId !== plan.sportId) {
    // BR-44: giáo án đã từng được gán thì không được đổi môn
    if (plan._count.assignments > 0) {
      throw new HttpError(
        409,
        'Không thể đổi môn của giáo án đã được gán cho học viên',
        'PLAN_SPORT_LOCKED',
      )
    }
    await assertSportAvailable(input.sportId)
  }

  if (input.durationWeeks !== undefined) {
    const maxWeek = await planRepository.findMaxItemWeek(planId)
    if (maxWeek !== null && maxWeek > input.durationWeeks) {
      throw new HttpError(
        422,
        `Giáo án đang có mục ở tuần ${maxWeek}, thời lượng không được nhỏ hơn`,
        'DURATION_TOO_SHORT',
      )
    }
  }

  return toPlanSummary(await planRepository.updatePlan(planId, input))
}

export async function changePlanStatus(
  planId: number,
  { status }: ChangePlanStatusInput,
) {
  const plan = await getPlanStateOrThrow(planId)
  // FR-49: chỉ kích hoạt giáo án đã có ít nhất một mục
  if (status === 'ACTIVE' && plan._count.items === 0) {
    throw new HttpError(
      422,
      'Giáo án phải có ít nhất một mục trước khi kích hoạt',
      'PLAN_HAS_NO_ITEMS',
    )
  }
  return toPlanSummary(await planRepository.updatePlan(planId, { status }))
}

// Không xóa cứng: "xóa" giáo án là chuyển sang INACTIVE
export function deactivatePlan(planId: number) {
  return changePlanStatus(planId, { status: 'INACTIVE' })
}
