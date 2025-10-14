-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'user',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Station` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codeSAP` VARCHAR(191) NULL,
    `codeADA` VARCHAR(191) NULL,
    `codeBMX` VARCHAR(191) NULL,
    `nameTH` VARCHAR(191) NULL,
    `adaStore` VARCHAR(191) NULL,
    `nameEng` VARCHAR(191) NULL,
    `WhCodeSAP` VARCHAR(191) NULL,
    `storeNameTH` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Partners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codeBP` VARCHAR(191) NULL,
    `nameBP` VARCHAR(191) NULL,
    `accountBalance` DOUBLE NOT NULL,
    `interfaceADA` VARCHAR(191) NULL,
    `interfaceEDI` VARCHAR(191) NULL,
    `brand` VARCHAR(191) NULL,
    `paymentTermsCode` VARCHAR(191) NULL,
    `noOldBP` VARCHAR(191) NULL,
    `taxGroup` VARCHAR(191) NULL,
    `remarks` VARCHAR(191) NULL,
    `idNoTwo` VARCHAR(191) NULL,
    `gp` VARCHAR(191) NULL,
    `dc` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phoneOne` VARCHAR(191) NULL,
    `phoneTwo` VARCHAR(191) NULL,
    `billAddressType` VARCHAR(191) NULL,
    `billBlock` VARCHAR(191) NULL,
    `billBuildingFloorRoom` VARCHAR(191) NULL,
    `billCity` VARCHAR(191) NULL,
    `billCountry` VARCHAR(191) NULL,
    `billCountryNo` VARCHAR(191) NULL,
    `billZipCode` VARCHAR(191) NULL,
    `branchBP` INTEGER NOT NULL,
    `billExchangeOnCollection` VARCHAR(191) NULL,
    `billDefault` VARCHAR(191) NULL,
    `billState` VARCHAR(191) NULL,
    `billStreet` VARCHAR(191) NULL,
    `billStreetNo` VARCHAR(191) NULL,
    `remarkOne` VARCHAR(191) NULL,
    `groupCode` VARCHAR(191) NULL,
    `federalTaxId` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemMinMax` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchCode` VARCHAR(191) NOT NULL,
    `codeProduct` INTEGER NOT NULL,
    `minStore` INTEGER NOT NULL,
    `maxStore` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ListOfItemHold` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codeProduct` INTEGER NOT NULL,
    `nameProduct` VARCHAR(191) NULL,
    `groupName` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL,
    `barcode` VARCHAR(191) NULL,
    `nameBrand` VARCHAR(191) NULL,
    `consingItem` VARCHAR(191) NULL,
    `purchasePriceExcVAT` DOUBLE NOT NULL,
    `salesPriceIncVAT` INTEGER NOT NULL,
    `preferredVandorCode` VARCHAR(191) NULL,
    `preferredVandorName` VARCHAR(191) NULL,
    `GP` VARCHAR(191) NULL,
    `shelfLife` VARCHAR(191) NULL,
    `productionDate` VARCHAR(191) NULL,
    `vatGroupPu` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sales` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchCode` VARCHAR(191) NOT NULL,
    `channelSales` VARCHAR(191) NOT NULL,
    `codeProduct` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `discount` VARCHAR(191) NOT NULL,
    `totalPrice` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Stock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codeProduct` INTEGER NOT NULL,
    `branchCode` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdraw` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codeProduct` INTEGER NOT NULL,
    `branchCode` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `docStatus` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `value` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tamplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchCode` VARCHAR(191) NOT NULL,
    `shelfCode` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `rowQty` INTEGER NOT NULL,
    `type` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemSearch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchCode` VARCHAR(191) NOT NULL,
    `shelfCode` VARCHAR(191) NOT NULL,
    `rowNo` INTEGER NOT NULL,
    `codeProduct` INTEGER NOT NULL,
    `index` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
