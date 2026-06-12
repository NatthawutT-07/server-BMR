ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "sales_channel" TEXT;

CREATE INDEX IF NOT EXISTS "Bill_sales_channel_idx" ON "Bill"("sales_channel");
