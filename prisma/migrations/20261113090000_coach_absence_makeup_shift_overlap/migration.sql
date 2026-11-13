CREATE TYPE "CoachAbsenceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "CoachAbsenceRequest" (
  "id" SERIAL PRIMARY KEY,
  "sessionId" INTEGER NOT NULL UNIQUE,
  "coachId" INTEGER NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "status" "CoachAbsenceStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" VARCHAR(300),
  "makeupSessionId" INTEGER UNIQUE,
  "makeupCreatedAt" TIMESTAMP(3),
  CONSTRAINT "CoachAbsenceRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE RESTRICT,
  CONSTRAINT "CoachAbsenceRequest_makeupSessionId_fkey" FOREIGN KEY ("makeupSessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL,
  CONSTRAINT "CoachAbsenceRequest_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE RESTRICT,
  CONSTRAINT "CoachAbsenceRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "CoachAbsenceRequest_status_requestedAt_idx" ON "CoachAbsenceRequest"("status", "requestedAt");

-- A database constraint is needed because two managers can schedule the same receptionist concurrently.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_no_scheduled_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" = 'SCHEDULED');
