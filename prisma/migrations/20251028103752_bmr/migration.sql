-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Station" (
    "id" SERIAL NOT NULL,
    "codeSAP" TEXT,
    "codeADA" TEXT,
    "codeBMX" TEXT,
    "nameTH" TEXT,
    "adaStore" TEXT,
    "nameEng" TEXT,
    "WhCodeSAP" TEXT,
    "storeNameTH" TEXT,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "public"."SalesDay" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "channelSales" TEXT NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discount" TEXT NOT NULL,
    "totalPrice" TEXT NOT NULL,

    CONSTRAINT "SalesDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesMonth" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "channelSales" TEXT NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discount" TEXT NOT NULL,
    "totalPrice" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "SalesMonth_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "public"."withdraw" (
    "id" SERIAL NOT NULL,
    "codeProduct" INTEGER NOT NULL,
    "branchCode" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "docStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "withdraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tamplate" (
    "id" SERIAL NOT NULL,
    "branchCode" TEXT NOT NULL,
    "shelfCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
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

-- CreateIndex
CREATE INDEX "ItemMinMax_branchCode_codeProduct_idx" ON "public"."ItemMinMax"("branchCode", "codeProduct");

-- CreateIndex
CREATE INDEX "ListOfItemHold_codeProduct_idx" ON "public"."ListOfItemHold"("codeProduct");

-- CreateIndex
CREATE INDEX "SalesDay_branchCode_codeProduct_channelSales_idx" ON "public"."SalesDay"("branchCode", "codeProduct", "channelSales");

-- CreateIndex
CREATE INDEX "SalesMonth_branchCode_codeProduct_channelSales_idx" ON "public"."SalesMonth"("branchCode", "codeProduct", "channelSales");

-- CreateIndex
CREATE INDEX "Stock_branchCode_codeProduct_idx" ON "public"."Stock"("branchCode", "codeProduct");

-- CreateIndex
CREATE INDEX "withdraw_branchCode_codeProduct_idx" ON "public"."withdraw"("branchCode", "codeProduct");

-- CreateIndex
CREATE INDEX "Sku_branchCode_shelfCode_index_idx" ON "public"."Sku"("branchCode", "shelfCode", "index");
