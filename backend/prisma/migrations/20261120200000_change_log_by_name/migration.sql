-- The saver's name on each change-log row, so a row still says who saved it if the account is ever deleted.
ALTER TABLE "ChangeLog" ADD COLUMN "byName" TEXT;

-- Rows whose account still exists take its name now; rows whose account is already gone stay null (shown as "Unknown").
UPDATE "ChangeLog" c SET "byName" = u."displayName" FROM "User" u WHERE c."userId" = u."id";
