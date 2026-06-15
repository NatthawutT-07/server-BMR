-- Rename columns in withdraw
ALTER TABLE "withdraw" RENAME COLUMN "docNumber" TO "document_reference";
ALTER TABLE "withdraw" RENAME COLUMN "date" TO "date_withdraw";
ALTER TABLE "withdraw" RENAME COLUMN "docStatus" TO "document_status";
