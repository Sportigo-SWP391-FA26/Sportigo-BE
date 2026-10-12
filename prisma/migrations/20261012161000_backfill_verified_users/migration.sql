UPDATE "User"
SET "emailVerifiedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'ACTIVE' AND "emailVerifiedAt" IS NULL;
