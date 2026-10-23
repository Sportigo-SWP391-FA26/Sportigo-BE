CREATE TABLE "PrivateCourseAttendance" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "sessionDate" DATE NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "markedById" INTEGER NOT NULL,

    CONSTRAINT "PrivateCourseAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivateCourseAttendance_scheduleId_sessionDate_key"
ON "PrivateCourseAttendance"("scheduleId", "sessionDate");

CREATE INDEX "PrivateCourseAttendance_markedById_completedAt_idx"
ON "PrivateCourseAttendance"("markedById", "completedAt");

ALTER TABLE "PrivateCourseAttendance"
ADD CONSTRAINT "PrivateCourseAttendance_scheduleId_fkey"
FOREIGN KEY ("scheduleId") REFERENCES "PrivateCourseSchedule"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrivateCourseAttendance"
ADD CONSTRAINT "PrivateCourseAttendance_markedById_fkey"
FOREIGN KEY ("markedById") REFERENCES "Coach"("userId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrivateCourseAttendance"
ADD CONSTRAINT "PrivateCourseAttendance_valid_time_check"
CHECK ("startsAt" < "endsAt");
