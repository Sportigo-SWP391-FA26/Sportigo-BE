CREATE TYPE "AvailabilitySubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE "AvailabilityChangeStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "CoachAvailabilitySubmission" (
    "id" SERIAL NOT NULL,
    "coachId" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "AvailabilitySubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "rejectionReason" VARCHAR(500),
    "copiedFromId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachAvailabilitySubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachAvailabilitySelection" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "shiftCode" VARCHAR(20) NOT NULL,
    "isAssigned" BOOLEAN NOT NULL DEFAULT false,
    "approvedAvailabilityId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachAvailabilitySelection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachAvailabilityChangeRequest" (
    "id" SERIAL NOT NULL,
    "coachId" INTEGER NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "oldDayOfWeek" INTEGER NOT NULL,
    "oldShiftCode" VARCHAR(20) NOT NULL,
    "newDayOfWeek" INTEGER NOT NULL,
    "newShiftCode" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "AvailabilityChangeStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "rejectionReason" VARCHAR(500),
    "affectedSummary" JSONB,
    CONSTRAINT "CoachAvailabilityChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachAvailabilitySubmission_coachId_month_key" ON "CoachAvailabilitySubmission"("coachId", "month");
CREATE INDEX "CoachAvailabilitySubmission_month_status_submittedAt_idx" ON "CoachAvailabilitySubmission"("month", "status", "submittedAt");
CREATE UNIQUE INDEX "CoachAvailabilitySelection_submissionId_dayOfWeek_shiftCode_key" ON "CoachAvailabilitySelection"("submissionId", "dayOfWeek", "shiftCode");
CREATE INDEX "CoachAvailabilitySelection_approvedAvailabilityId_idx" ON "CoachAvailabilitySelection"("approvedAvailabilityId");
CREATE INDEX "CoachAvailabilityChangeRequest_coachId_status_submittedAt_idx" ON "CoachAvailabilityChangeRequest"("coachId", "status", "submittedAt");
CREATE INDEX "CoachAvailabilityChangeRequest_submissionId_idx" ON "CoachAvailabilityChangeRequest"("submissionId");

ALTER TABLE "CoachAvailabilitySubmission" ADD CONSTRAINT "CoachAvailabilitySubmission_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilitySubmission" ADD CONSTRAINT "CoachAvailabilitySubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilitySubmission" ADD CONSTRAINT "CoachAvailabilitySubmission_copiedFromId_fkey" FOREIGN KEY ("copiedFromId") REFERENCES "CoachAvailabilitySubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilitySelection" ADD CONSTRAINT "CoachAvailabilitySelection_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CoachAvailabilitySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilitySelection" ADD CONSTRAINT "CoachAvailabilitySelection_approvedAvailabilityId_fkey" FOREIGN KEY ("approvedAvailabilityId") REFERENCES "CoachAvailability"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilityChangeRequest" ADD CONSTRAINT "CoachAvailabilityChangeRequest_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilityChangeRequest" ADD CONSTRAINT "CoachAvailabilityChangeRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CoachAvailabilitySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachAvailabilityChangeRequest" ADD CONSTRAINT "CoachAvailabilityChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
