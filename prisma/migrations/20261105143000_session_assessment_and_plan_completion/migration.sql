-- Tie progress assessments to the actual group/private session.
ALTER TABLE "ProgressAssessment"
  ADD COLUMN "classSessionId" INTEGER,
  ADD COLUMN "privateCourseAttendanceId" INTEGER;

CREATE UNIQUE INDEX "ProgressAssessment_classSessionId_memberId_key"
  ON "ProgressAssessment"("classSessionId", "memberId");
CREATE UNIQUE INDEX "ProgressAssessment_privateCourseAttendanceId_memberId_key"
  ON "ProgressAssessment"("privateCourseAttendanceId", "memberId");

ALTER TABLE "ProgressAssessment"
  ADD CONSTRAINT "ProgressAssessment_classSessionId_fkey"
  FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgressAssessment"
  ADD CONSTRAINT "ProgressAssessment_privateCourseAttendanceId_fkey"
  FOREIGN KEY ("privateCourseAttendanceId") REFERENCES "PrivateCourseAttendance"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkoutPlanItemCompletion" (
  "id" SERIAL NOT NULL,
  "planAssignmentId" INTEGER NOT NULL,
  "workoutPlanItemId" INTEGER NOT NULL,
  "privateCourseAttendanceId" INTEGER NOT NULL,
  "completedById" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" VARCHAR(500),
  CONSTRAINT "WorkoutPlanItemCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkoutPlanItemCompletion_privateCourseAttendanceId_workoutPlanItemId_key"
  ON "WorkoutPlanItemCompletion"("privateCourseAttendanceId", "workoutPlanItemId");
CREATE INDEX "WorkoutPlanItemCompletion_planAssignmentId_completedAt_idx"
  ON "WorkoutPlanItemCompletion"("planAssignmentId", "completedAt");

ALTER TABLE "WorkoutPlanItemCompletion"
  ADD CONSTRAINT "WorkoutPlanItemCompletion_planAssignmentId_fkey"
  FOREIGN KEY ("planAssignmentId") REFERENCES "PlanPrivateEnrollment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutPlanItemCompletion"
  ADD CONSTRAINT "WorkoutPlanItemCompletion_workoutPlanItemId_fkey"
  FOREIGN KEY ("workoutPlanItemId") REFERENCES "WorkoutPlanItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutPlanItemCompletion"
  ADD CONSTRAINT "WorkoutPlanItemCompletion_privateCourseAttendanceId_fkey"
  FOREIGN KEY ("privateCourseAttendanceId") REFERENCES "PrivateCourseAttendance"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkoutPlanItemCompletion"
  ADD CONSTRAINT "WorkoutPlanItemCompletion_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "Coach"("userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
