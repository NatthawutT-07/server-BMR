/*
  Warnings:

  - You are about to drop the `Partners` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[date,branch_code,product_code,quantity]` on the table `Gourmet` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[branchCode,codeProduct]` on the table `Sku` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[docNumber,branchCode,codeProduct,quantity,value]` on the table `withdraw` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Gourmet` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."ListOfItemHold_barcode_key";

-- DropIndex
DROP INDEX "public"."Sku_branchCode_shelfCode_rowNo_codeProduct_key";

-- AlterTable
ALTER TABLE "public"."Gourmet" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "public"."ItemMinMax" ADD COLUMN     "packOrder" INTEGER;

-- DropTable
DROP TABLE "public"."Partners";

-- CreateTable
CREATE TABLE "public"."PogRequest" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "productName" TEXT,
    "fromShelf" TEXT,
    "fromRow" INTEGER,
    "fromIndex" INTEGER,
    "toShelf" TEXT,
    "toRow" INTEGER,
    "toIndex" INTEGER,
    "swapBarcode" TEXT,
    "swapProductName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PogRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShelfUpdate" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "hasUpdate" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ShelfUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShelfChangeLog" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "shelfCode" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "productName" TEXT,
    "fromRow" INTEGER,
    "fromIndex" INTEGER,
    "toRow" INTEGER,
    "toIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "ShelfChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderSI" (
    "id" SERIAL NOT NULL,
    "branch_code" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "si_no" TEXT NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL,
    "delivery_date" TIMESTAMP(3) NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_ex_v" DOUBLE PRECISION NOT NULL,
    "price_in_v" DOUBLE PRECISION NOT NULL,
    "amount_ex_v" DOUBLE PRECISION NOT NULL,
    "amount_in_v" DOUBLE PRECISION NOT NULL,
    "vat_group" TEXT NOT NULL,
    "shipping_location" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSI_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TempSku" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "shelfCode" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,

    CONSTRAINT "TempSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TempTamplate" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "shelfCode" TEXT NOT NULL,
    "fullName" TEXT,
    "rowQty" INTEGER NOT NULL,
    "type" TEXT,

    CONSTRAINT "TempTamplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."employee_hq" (
    "id" SERIAL NOT NULL,
    "employee_code" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "organizational_unit" TEXT NOT NULL,
    "point_earned" INTEGER NOT NULL DEFAULT 0,
    "point_redeemed" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'user',
    "password" TEXT,

    CONSTRAINT "employee_hq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reward_hq" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "point_reward" INTEGER NOT NULL,

    CONSTRAINT "reward_hq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."branch_hq" (
    "id" SERIAL NOT NULL,
    "branch_code" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "avg_target" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "branch_hq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."log_hq" (
    "id" SERIAL NOT NULL,
    "employee_code" TEXT NOT NULL,
    "branch_code" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "target" DOUBLE PRECISION,
    "sales" DOUBLE PRECISION,
    "point" INTEGER,
    "reward" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_hq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PogRequest_branchCode_status_idx" ON "public"."PogRequest"("branchCode", "status");

-- CreateIndex
CREATE INDEX "PogRequest_status_idx" ON "public"."PogRequest"("status");

-- CreateIndex
CREATE INDEX "PogRequest_createdAt_idx" ON "public"."PogRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShelfUpdate_branchCode_key" ON "public"."ShelfUpdate"("branchCode");

-- CreateIndex
CREATE INDEX "ShelfUpdate_branchCode_idx" ON "public"."ShelfUpdate"("branchCode");

-- CreateIndex
CREATE INDEX "ShelfChangeLog_branchCode_shelfCode_idx" ON "public"."ShelfChangeLog"("branchCode", "shelfCode");

-- CreateIndex
CREATE INDEX "ShelfChangeLog_branchCode_createdAt_idx" ON "public"."ShelfChangeLog"("branchCode", "createdAt");

-- CreateIndex
CREATE INDEX "ShelfChangeLog_branchCode_acknowledged_idx" ON "public"."ShelfChangeLog"("branchCode", "acknowledged");

-- CreateIndex
CREATE INDEX "ShelfChangeLog_updateId_idx" ON "public"."ShelfChangeLog"("updateId");

-- CreateIndex
CREATE INDEX "OrderSI_branch_code_idx" ON "public"."OrderSI"("branch_code");

-- CreateIndex
CREATE INDEX "OrderSI_si_no_idx" ON "public"."OrderSI"("si_no");

-- CreateIndex
CREATE INDEX "OrderSI_product_code_idx" ON "public"."OrderSI"("product_code");

-- CreateIndex
CREATE INDEX "OrderSI_order_date_idx" ON "public"."OrderSI"("order_date");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSI_branch_code_si_no_product_code_barcode_key" ON "public"."OrderSI"("branch_code", "si_no", "product_code", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "employee_hq_employee_code_key" ON "public"."employee_hq"("employee_code");

-- CreateIndex
CREATE INDEX "employee_hq_employee_code_idx" ON "public"."employee_hq"("employee_code");

-- CreateIndex
CREATE INDEX "employee_hq_role_idx" ON "public"."employee_hq"("role");

-- CreateIndex
CREATE INDEX "reward_hq_point_reward_idx" ON "public"."reward_hq"("point_reward");

-- CreateIndex
CREATE INDEX "branch_hq_branch_code_idx" ON "public"."branch_hq"("branch_code");

-- CreateIndex
CREATE INDEX "branch_hq_month_idx" ON "public"."branch_hq"("month");

-- CreateIndex
CREATE UNIQUE INDEX "branch_hq_branch_code_month_key" ON "public"."branch_hq"("branch_code", "month");

-- CreateIndex
CREATE INDEX "log_hq_employee_code_idx" ON "public"."log_hq"("employee_code");

-- CreateIndex
CREATE INDEX "log_hq_branch_code_idx" ON "public"."log_hq"("branch_code");

-- CreateIndex
CREATE INDEX "log_hq_date_idx" ON "public"."log_hq"("date");

-- CreateIndex
CREATE INDEX "log_hq_action_idx" ON "public"."log_hq"("action");

-- CreateIndex
CREATE INDEX "Gourmet_date_idx" ON "public"."Gourmet"("date");

-- CreateIndex
CREATE INDEX "Gourmet_branch_code_idx" ON "public"."Gourmet"("branch_code");

-- CreateIndex
CREATE INDEX "Gourmet_product_code_idx" ON "public"."Gourmet"("product_code");

-- CreateIndex
CREATE UNIQUE INDEX "Gourmet_date_branch_code_product_code_quantity_key" ON "public"."Gourmet"("date", "branch_code", "product_code", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_branchCode_codeProduct_key" ON "public"."Sku"("branchCode", "codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_docNumber_branchCode_codeProduct_quantity_value_key" ON "public"."withdraw"("docNumber", "branchCode", "codeProduct", "quantity", "value");

-- AddForeignKey
ALTER TABLE "public"."log_hq" ADD CONSTRAINT "log_hq_employee_code_fkey" FOREIGN KEY ("employee_code") REFERENCES "public"."employee_hq"("employee_code") ON DELETE RESTRICT ON UPDATE CASCADE;
