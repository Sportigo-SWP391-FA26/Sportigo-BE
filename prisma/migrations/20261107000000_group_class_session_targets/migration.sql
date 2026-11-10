ALTER TABLE "GroupClass" ADD COLUMN "totalSessions" INTEGER;
ALTER TABLE "GroupClass" ADD COLUMN "sessionsPerWeek" INTEGER;
ALTER TABLE "GroupClass" ADD CONSTRAINT "GroupClass_session_targets_check" CHECK (
  ("totalSessions" IS NULL AND "sessionsPerWeek" IS NULL) OR
  ("totalSessions" > 0 AND "sessionsPerWeek" > 0 AND "sessionsPerWeek" <= "totalSessions")
);
