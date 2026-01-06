-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastPasswordChange" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshTokenVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoginLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Partners" (
    "id" SERIAL NOT NULL,
    "codeBP" TEXT,
    "nameBP" TEXT,
    "accountBalance" DOUBLE PRECISION NOT NULL,
    "interfaceADA" TEXT,
    "interfaceEDI" TEXT,
    "brand" TEXT,
    "paymentTermsCode" TEXT,
    "noOldBP" TEXT,
    "taxGroup" TEXT,
    "remarks" TEXT,
    "idNoTwo" TEXT,
    "gp" TEXT,
    "dc" TEXT,
    "email" TEXT,
    "phoneOne" TEXT,
    "phoneTwo" TEXT,
    "billAddressType" TEXT,
    "billBlock" TEXT,
    "billBuildingFloorRoom" TEXT,
    "billCity" TEXT,
    "billCountry" TEXT,
    "billCountryNo" TEXT,
    "billZipCode" TEXT,
    "branchBP" INTEGER NOT NULL,
    "billExchangeOnCollection" TEXT,
    "billDefault" TEXT,
    "billState" TEXT,
    "billStreet" TEXT,
    "billStreetNo" TEXT,
    "remarkOne" TEXT,
    "groupCode" TEXT,
    "federalTaxId" TEXT,

    CONSTRAINT "Partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ItemMinMax" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "minStore" INTEGER NOT NULL,
    "maxStore" INTEGER NOT NULL,

    CONSTRAINT "ItemMinMax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Stock" (
    "id" SERIAL NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "branchCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataSync" (
    "key" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER,

    CONSTRAINT "DataSync_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."withdraw" (
    "id" SERIAL NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "branchCode" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "docStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "withdraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ListOfItemHold" (
    "id" SERIAL NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "nameProduct" TEXT,
    "groupName" TEXT,
    "status" TEXT,
    "barcode" TEXT,
    "nameBrand" TEXT,
    "consingItem" TEXT,
    "purchasePriceExcVAT" DOUBLE PRECISION NOT NULL,
    "salesPriceIncVAT" INTEGER NOT NULL,
    "preferredVandorCode" TEXT,
    "preferredVandorName" TEXT,
    "GP" TEXT,
    "shelfLife" TEXT,
    "productionDate" TEXT,
    "vatGroupPu" TEXT,

    CONSTRAINT "ListOfItemHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tamplate" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "shelfCode" TEXT NOT NULL,
    "fullName" TEXT,
    "rowQty" INTEGER NOT NULL,
    "type" TEXT,

    CONSTRAINT "Tamplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Sku" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "shelfCode" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Gourmet" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "branch_code" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sales" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Gourmet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Branch" (
    "id" SERIAL NOT NULL,
    "branch_code" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesChannel" (
    "id" SERIAL NOT NULL,
    "channel_code" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,

    CONSTRAINT "SalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" SERIAL NOT NULL,
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" SERIAL NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_brand" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Bill" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "salesChannelId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "bill_number" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "pos_type" TEXT NOT NULL,
    "reference_doc" TEXT,
    "value_excl_tax" DOUBLE PRECISION NOT NULL,
    "vat" DOUBLE PRECISION NOT NULL,
    "end_bill_discount" DOUBLE PRECISION NOT NULL,
    "total_after_discount" DOUBLE PRECISION NOT NULL,
    "rounding" DOUBLE PRECISION NOT NULL,
    "total_sales" DOUBLE PRECISION NOT NULL,
    "total_payment" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillPayment" (
    "id" SERIAL NOT NULL,
    "billId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_method" TEXT,
    "bank" TEXT,
    "reference_number" TEXT,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillItem" (
    "id" SERIAL NOT NULL,
    "billId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "price_per_unit" DOUBLE PRECISION NOT NULL,
    "sales_amount" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "net_sales" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BillItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "public"."User"("name");

-- CreateIndex
CREATE INDEX "ItemMinMax_branchCode_codeProduct_idx" ON "public"."ItemMinMax"("branchCode", "codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMinMax_branchCode_codeProduct_key" ON "public"."ItemMinMax"("branchCode", "codeProduct");

-- CreateIndex
CREATE INDEX "Stock_branchCode_codeProduct_idx" ON "public"."Stock"("branchCode", "codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_branchCode_codeProduct_key" ON "public"."Stock"("branchCode", "codeProduct");

-- CreateIndex
CREATE INDEX "withdraw_branchCode_codeProduct_idx" ON "public"."withdraw"("branchCode", "codeProduct");

-- CreateIndex
CREATE INDEX "withdraw_branchCode_docStatus_codeProduct_idx" ON "public"."withdraw"("branchCode", "docStatus", "codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "ListOfItemHold_codeProduct_key" ON "public"."ListOfItemHold"("codeProduct");

-- CreateIndex
CREATE INDEX "ListOfItemHold_codeProduct_idx" ON "public"."ListOfItemHold"("codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "ListOfItemHold_barcode_key" ON "public"."ListOfItemHold"("barcode");

-- CreateIndex
CREATE INDEX "Tamplate_branchCode_shelfCode_fullName_idx" ON "public"."Tamplate"("branchCode", "shelfCode", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Tamplate_branchCode_shelfCode_key" ON "public"."Tamplate"("branchCode", "shelfCode");

-- CreateIndex
CREATE INDEX "Sku_branchCode_shelfCode_rowNo_index_idx" ON "public"."Sku"("branchCode", "shelfCode", "rowNo", "index");

-- CreateIndex
CREATE INDEX "Sku_branchCode_shelfCode_index_idx" ON "public"."Sku"("branchCode", "shelfCode", "index");

-- CreateIndex
CREATE INDEX "Sku_branchCode_codeProduct_idx" ON "public"."Sku"("branchCode", "codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_branchCode_shelfCode_rowNo_codeProduct_key" ON "public"."Sku"("branchCode", "shelfCode", "rowNo", "codeProduct");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_branch_code_key" ON "public"."Branch"("branch_code");

-- CreateIndex
CREATE UNIQUE INDEX "SalesChannel_channel_code_key" ON "public"."SalesChannel"("channel_code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customer_code_key" ON "public"."Customer"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_product_code_key" ON "public"."Product"("product_code");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_bill_number_key" ON "public"."Bill"("bill_number");

-- CreateIndex
CREATE INDEX "Bill_branchId_doc_type_date_idx" ON "public"."Bill"("branchId", "doc_type", "date");

-- CreateIndex
CREATE INDEX "Bill_date_idx" ON "public"."Bill"("date");

-- CreateIndex
CREATE INDEX "Bill_branchId_date_idx" ON "public"."Bill"("branchId", "date");

-- CreateIndex
CREATE INDEX "Bill_salesChannelId_date_idx" ON "public"."Bill"("salesChannelId", "date");

-- CreateIndex
CREATE INDEX "Bill_customerId_date_idx" ON "public"."Bill"("customerId", "date");

-- CreateIndex
CREATE INDEX "Bill_doc_type_date_idx" ON "public"."Bill"("doc_type", "date");

-- CreateIndex
CREATE INDEX "Bill_date_id_idx" ON "public"."Bill"("date", "id");

-- CreateIndex
CREATE INDEX "BillPayment_billId_idx" ON "public"."BillPayment"("billId");

-- CreateIndex
CREATE INDEX "BillPayment_payment_method_idx" ON "public"."BillPayment"("payment_method");

-- CreateIndex
CREATE INDEX "BillPayment_bank_idx" ON "public"."BillPayment"("bank");

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_billId_amount_payment_method_bank_reference_num_key" ON "public"."BillPayment"("billId", "amount", "payment_method", "bank", "reference_number");

-- CreateIndex
CREATE INDEX "BillItem_productId_idx" ON "public"."BillItem"("productId");

-- CreateIndex
CREATE INDEX "BillItem_billId_idx" ON "public"."BillItem"("billId");

-- CreateIndex
CREATE INDEX "BillItem_billId_productId_idx" ON "public"."BillItem"("billId", "productId");

-- AddForeignKey
ALTER TABLE "public"."LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bill" ADD CONSTRAINT "Bill_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bill" ADD CONSTRAINT "Bill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bill" ADD CONSTRAINT "Bill_salesChannelId_fkey" FOREIGN KEY ("salesChannelId") REFERENCES "public"."SalesChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillPayment" ADD CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public"."Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillItem" ADD CONSTRAINT "BillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public"."Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillItem" ADD CONSTRAINT "BillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
