/*
  Warnings:

  - Made the column `weekNumber` on table `WorkoutPlanItem` required. This step will fail if there are existing NULL values in that column.
  - Made the column `sessionNumber` on table `WorkoutPlanItem` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "SessionAttendance" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "markedById" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "WorkoutPlanItem" ADD COLUMN     "intensity" VARCHAR(40),
ADD COLUMN     "note" TEXT,
ALTER COLUMN "weekNumber" SET NOT NULL,
ALTER COLUMN "sessionNumber" SET NOT NULL;

-- CreateIndex
CREATE INDEX "PlanPrivateEnrollment_workoutPlanId_idx" ON "PlanPrivateEnrollment"("workoutPlanId");

-- CreateIndex
CREATE INDEX "SessionAttendance_classSessionId_idx" ON "SessionAttendance"("classSessionId");

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "Coach"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- BR-45: tuần, buổi và thứ tự mục giáo án phải là số dương
ALTER TABLE "WorkoutPlanItem" ADD CONSTRAINT "WorkoutPlanItem_positive_position_check"
CHECK ("weekNumber" >= 1 AND "sessionNumber" >= 1 AND "itemOrder" >= 1);

-- FR-49: thời lượng giáo án (tuần) phải lớn hơn 0 khi có giá trị
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_duration_weeks_check"
CHECK ("durationWeeks" > 0);
