CREATE TABLE "CoachSport" (
    "coachId" INTEGER NOT NULL,
    "sportId" INTEGER NOT NULL,

    CONSTRAINT "CoachSport_pkey" PRIMARY KEY ("coachId", "sportId")
);

ALTER TABLE "CoachSport"
ADD CONSTRAINT "CoachSport_coachId_fkey"
FOREIGN KEY ("coachId") REFERENCES "Coach"("userId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachSport"
ADD CONSTRAINT "CoachSport_sportId_fkey"
FOREIGN KEY ("sportId") REFERENCES "Sport"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
