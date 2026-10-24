CREATE TABLE "Receptionist" (
    "userId" INTEGER NOT NULL,
    "staffCode" VARCHAR(30) NOT NULL,
    "hiredAt" DATE,

    CONSTRAINT "Receptionist_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "Receptionist_staffCode_key" ON "Receptionist"("staffCode");

ALTER TABLE "Receptionist"
ADD CONSTRAINT "Receptionist_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
