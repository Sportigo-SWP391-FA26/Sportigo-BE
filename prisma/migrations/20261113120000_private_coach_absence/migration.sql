ALTER TABLE "PrivateCourseScheduleException"
  ADD COLUMN "newCoachId" INTEGER;

ALTER TABLE "PrivateCourseScheduleException"
  ADD CONSTRAINT "PrivateCourseScheduleException_newCoachId_fkey"
  FOREIGN KEY ("newCoachId") REFERENCES "Coach"("userId") ON DELETE SET NULL;

CREATE TABLE "PrivateCoachAbsenceRequest" (
  "id" SERIAL PRIMARY KEY,
  "scheduleId" INTEGER NOT NULL,
  "sessionDate" DATE NOT NULL,
  "coachId" INTEGER NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "status" "CoachAbsenceStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "originalStartsAt" TIMESTAMP(3) NOT NULL,
  "originalEndsAt" TIMESTAMP(3) NOT NULL,
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" VARCHAR(300),
  "makeupStartsAt" TIMESTAMP(3),
  "makeupEndsAt" TIMESTAMP(3),
  "makeupRoomId" INTEGER,
  "makeupCoachId" INTEGER,
  "makeupCreatedAt" TIMESTAMP(3),
  CONSTRAINT "PrivateCoachAbsenceRequest_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PrivateCourseSchedule"("id") ON DELETE RESTRICT,
  CONSTRAINT "PrivateCoachAbsenceRequest_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE RESTRICT,
  CONSTRAINT "PrivateCoachAbsenceRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "PrivateCoachAbsenceRequest_scheduleId_sessionDate_key" ON "PrivateCoachAbsenceRequest"("scheduleId", "sessionDate");
CREATE INDEX "PrivateCoachAbsenceRequest_status_requestedAt_idx" ON "PrivateCoachAbsenceRequest"("status", "requestedAt");
