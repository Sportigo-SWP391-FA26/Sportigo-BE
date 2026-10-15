import { z } from 'zod'

export const assignPlanSchema = z.object({
  workoutPlanId: z.number().int().positive(),
})

export type AssignPlanInput = z.infer<typeof assignPlanSchema>
