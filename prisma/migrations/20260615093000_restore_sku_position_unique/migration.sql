DELETE FROM "SkuPosition" a
USING "SkuPosition" b
WHERE a."branch_code" = b."branch_code"
  AND a."item_code" = b."item_code"
  AND a."id" > b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "SkuPosition_branch_code_item_code_key"
ON "SkuPosition"("branch_code", "item_code");
