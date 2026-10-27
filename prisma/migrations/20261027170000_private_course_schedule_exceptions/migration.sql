CREATE TYPE "PrivateCourseOccurrenceAction" AS ENUM ('CANCELLED', 'RESCHEDULED');

CREATE TABLE "PrivateCourseScheduleException" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "sessionDate" DATE NOT NULL,
    "action" "PrivateCourseOccurrenceAction" NOT NULL,
    "rescheduledStartsAt" TIMESTAMP(3),
    "rescheduledEndsAt" TIMESTAMP(3),
    "newRoomId" INTEGER,
    "reason" VARCHAR(500) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateCourseScheduleException_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivateCourseScheduleException_valid_reschedule_check"
        CHECK (
            ("action" = 'CANCELLED' AND "rescheduledStartsAt" IS NULL AND "rescheduledEndsAt" IS NULL)
            OR
            ("action" = 'RESCHEDULED'
                AND "rescheduledStartsAt" IS NOT NULL
                AND "rescheduledEndsAt" IS NOT NULL
                AND "rescheduledStartsAt" < "rescheduledEndsAt")
        )
);

CREATE UNIQUE INDEX "PrivateCourseScheduleException_scheduleId_sessionDate_key"
ON "PrivateCourseScheduleException"("scheduleId", "sessionDate");

CREATE INDEX "PrivateCourseScheduleException_sessionDate_action_idx"
ON "PrivateCourseScheduleException"("sessionDate", "action");

ALTER TABLE "PrivateCourseScheduleException"
ADD CONSTRAINT "PrivateCourseScheduleException_scheduleId_fkey"
FOREIGN KEY ("scheduleId") REFERENCES "PrivateCourseSchedule"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrivateCourseScheduleException"
ADD CONSTRAINT "PrivateCourseScheduleException_newRoomId_fkey"
FOREIGN KEY ("newRoomId") REFERENCES "Room"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
