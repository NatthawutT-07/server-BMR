-- Rename columns in ListOfItemHold
ALTER TABLE "ListOfItemHold" RENAME COLUMN "nameProduct" TO "item_name";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "groupName" TO "group_name";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "status" TO "item_status";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "nameBrand" TO "brand_name";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "consingItem" TO "is_consignment";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "purchasePriceExcVAT" TO "purchase_price";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "salesPriceIncVAT" TO "selling_price_vat";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "preferredVandorCode" TO "preferred_vendor_code";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "preferredVandorName" TO "preferred_vendor_name";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "GP" TO "gross_profit_pct";
ALTER TABLE "ListOfItemHold" RENAME COLUMN "shelfLife" TO "shelf_life_days";

-- Drop unused columns
ALTER TABLE "ListOfItemHold" DROP COLUMN IF EXISTS "productionDate";
ALTER TABLE "ListOfItemHold" DROP COLUMN IF EXISTS "vatGroupPu";
