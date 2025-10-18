const fs = require('fs');
const csv = require('csv-parser');
const prisma = require('../../config/prisma');

exports.uploadStationCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.station.deleteMany();

                const stations = results.map(row => ({
                    codeSAP: row.codeSAP?.trim() || null,
                    codeADA: row.codeADA?.trim() || null,
                    codeBMX: row.codeBMX?.trim() || null,
                    nameTH: row.nameTH?.trim() || null,
                    adaStore: row.adaStore?.trim() || null,
                    nameEng: row.nameEng?.trim() || null,
                    WhCodeSAP: row.WhCodeSAP?.trim() || null,
                    storeNameTH: row.storeNameTH?.trim() || null,
                }));

                await prisma.station.createMany({
                    data: stations,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadItemMinMaxCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.itemMinMax.deleteMany();

                const items = results.map(row => ({
                    branchCode: row.BranchCode
                        ? row.BranchCode.trim().slice(0, 2) + parseInt(row.BranchCode.trim().slice(2), 10).toString().padStart(3, '0')
                        : null,
                    codeProduct: parseInt(row.ItemCode?.trim(), 10) || 0,
                    minStore: row.MinStock ? parseInt(row.MinStock?.trim(), 10) : null,
                    maxStore: row.MaxStock ? parseInt(row.MaxStock?.trim(), 10) : null,
                }));


                await prisma.itemMinMax.createMany({
                    data: items,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadPartnersCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.partners.deleteMany();
                const partners = results.map(row => ({
                    codeBP: row.BPCode || null,
                    nameBP: row.BPName || null,
                    accountBalance: row.AccountBalance ? parseFloat(row.AccountBalance.replace(/[^0-9.-]+/g, '')) : null,
                    interfaceADA: row.InterfaceStatusforADASoft || null,
                    interfaceEDI: row.InterfaceStatusforEDI || null,
                    brand: row.Brand || null,
                    paymentTermsCode: row.PaymentTermsCode || null,
                    noOldBP: row.BPOldNo || null,
                    taxGroup: row.TaxGroup || null,
                    remarks: row.Remarks || null,
                    idNoTwo: row.IDNo2 || null,
                    gp: row.GP || null,
                    dc: row.DC || null,
                    email: row.EMail || null,
                    phoneOne: row.Telephone1 || null,
                    phoneTwo: row.Telephone2 || null,
                    billAddressType: row.BilltoAddressType || null,
                    billBlock: row.BilltoBlock || null,
                    billBuildingFloorRoom: row.BilltoBuilding || null,
                    billCity: row.BilltoCity || null,
                    billCountry: row.BilltoCountry || null,
                    billCountryNo: row.BilltoCounty || null,
                    billZipCode: row.BilltoZipCode || null,
                    branchBP: row.BPBranch ? parseInt(row.BPBranch?.trim(), 10) : null,
                    billExchangeOnCollection: row.BillofExchangeonCollection || null,
                    billDefault: row.BilltoDefault || null,
                    billState: row.BilltoState || null,
                    billStreet: row.BilltoStreet || null,
                    billStreetNo: row.BilltoStreetNo || null,
                    remarkOne: row.Remark || null,
                    groupCode: row.GroupCode || null,
                    federalTaxId: row.FederalTaxID || null,
                }));


                await prisma.partners.createMany({
                    data: partners,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadMasterItemCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.listOfItemHold.deleteMany();

                const masteritem = results.map(row => ({
                    codeProduct: parseInt(row.ItemNo) || null,
                    nameProduct: row.ItemDescription || null,
                    groupName: row.GroupName || null,
                    status: row.Status || null,
                    barcode: row.BarCode || null,
                    nameBrand: row.Name || null,
                    consingItem: row.ConsignItem || null,
                    purchasePriceExcVAT: row.PurchasePriceExcVAT ? parseFloat(row.PurchasePriceExcVAT) : 0,
                    salesPriceIncVAT: row.PurchasePriceExcVAT ? parseInt(row.SalesPriceIncVAT) : 0,
                    preferredVandorCode: row.PreferredVendor || null,
                    preferredVandorName: row.PreferredVendorName || null,
                    GP: row.GP || null,
                    shelfLife: row.ShelfLife || null,
                    productionDate: row.ProductionDate || null,
                    vatGroupPu: row.VatGroupPu || null,
                }));

                await prisma.listOfItemHold.createMany({
                    data: masteritem,
                    skipDuplicates: true,
                });

                try {
                    await fs.promises.unlink(filePath); //Promise-based unlink
                    console.log('File deleted successfully');
                } catch (err) {
                    console.error('Error deleting file:', err);
                }

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadSalesDayCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.salesDay.deleteMany();
                const sales = results.map(row => ({
                    branchCode: row.branchCode || null,
                    channelSales: row.channelSales || null,
                    codeProduct: row.codeProduct ? parseInt(row.codeProduct?.trim(), 10) : 0,
                    quantity: row.quantity ? parseInt(row.quantity?.trim(), 10) : 0,
                    discount: row.discount,
                    totalPrice: row.totalPrice,
                    month: row.month ? parseInt(row.month?.trim(), 10) : 0,
                    year: row.year ? parseInt(row.year?.trim(), 10) : 0,
                }));

                await prisma.salesDay.createMany({
                    data: sales,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadSalesMonthCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                const sales = results.map(row => ({
                    branchCode: row.branchCode || null,
                    channelSales: row.channelSales || null,
                    codeProduct: row.codeProduct ? parseInt(row.codeProduct?.trim(), 10) : 0,
                    quantity: row.quantity ? parseInt(row.quantity?.trim(), 10) : 0,
                    discount: row.discount,
                    totalPrice: row.totalPrice,
                    month: row.month ? parseInt(row.month?.trim(), 10) : 0,
                    year: row.year ? parseInt(row.year?.trim(), 10) : 0,
                }));

                await prisma.salesMonth.createMany({
                    data: sales,
                    skipDuplicates: true,
                });

                // ลบไฟล์หลังจากการบันทึกสำเร็จ
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                // ลบไฟล์หากเกิดข้อผิดพลาดที่เกิดจากฐานข้อมูล
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadStockCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.stock.deleteMany();
                const stocks = results.map(row => ({
                    codeProduct: row.codeProduct ? parseInt(row.codeProduct?.trim(), 10) : 0,
                    branchCode: row.branchCode ? row.branchCode.trim() : 'Unknown',
                    quantity: row.quantity ? parseInt(row.quantity?.trim(), 10) : 0,
                }));

                await prisma.stock.createMany({
                    data: stocks,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadWithdrawCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.withdraw.deleteMany();
                const withdraw = results.map(row => ({
                    codeProduct: row.codeProduct ? parseInt(row.codeProduct?.trim(), 10) : 0,
                    branchCode: row.branchCode ? row.branchCode.split(' ')[0].split('/')[0].replace(/[()]/g, '').trim() : 'Unknown',
                    docNumber: row.docNumber || null,
                    date: row.date || null,
                    docStatus: row.docStatus || null,
                    reason: row.reason || null,
                    quantity: row.quantity ? parseInt(row.quantity?.trim(), 10) : 0,
                    value: row.value || null,
                    // ? parseFloat(row.value?.trim()) : 0,
                }));

                await prisma.withdraw.createMany({
                    data: withdraw,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadTamplateCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.tamplate.deleteMany();

                const tamplate = results.map(row => {
                    //branchCode: ST0002 → ST002
                    let branchCode = row.StoreCode?.trim() || null;
                    if (branchCode) {
                        const match = branchCode.match(/^ST0*(\d{1,})$/); // จับตัวเลขหลัง ST ตัดศูนย์
                        if (match) {
                            const number = match[1].padStart(3, '0'); // ให้มีเลข 3 หลัก
                            branchCode = `ST${number}`;
                        }
                    }

                    return {
                        branchCode: branchCode,
                        shelfCode: row.Code?.trim() || null,
                        fullName: row.Name?.trim() || null,
                        rowQty: row.RowQty ? parseInt(row.RowQty?.trim(), 10) : 0,
                        type: null,
                    };
                });

                await prisma.tamplate.createMany({
                    data: tamplate,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};

exports.uploadItemSearchCSV = async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath, { encoding: 'utf8' })
        .on('error', (err) => {
            console.error('File read error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
            return res.status(500).send('Failed to read uploaded file.');
        })
        .pipe(csv())
        .on('data', (data) => {
            console.log('CSV Row:', data);
            results.push(data);
        })
        .on('end', async () => {
            try {
                await prisma.itemSearch.deleteMany();

                const itemSearch = results.map(row => {
                    let branchCode = row.StoreCode?.trim() || null;
                    if (branchCode) {
                        const match = branchCode.match(/^ST0*(\d{1,})$/);
                        if (match) {
                            const number = match[1].padStart(3, '0');
                            branchCode = `ST${number}`;
                        }
                    }

                    return {
                        branchCode: branchCode,
                        shelfCode: row.ShelfCode?.trim() || null,
                        rowNo: row.RowNo ? parseInt(row.RowNo?.trim(), 10) : 0,
                        codeProduct: row.ItemCode ? parseInt(row.ItemCode?.trim(), 10) : 0,
                        index: row.index ? parseInt(row.index?.trim(), 10) : 0,
                    };
                });

                await prisma.itemSearch.createMany({
                    data: itemSearch,
                    skipDuplicates: true,
                });

                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });

                res.status(200).send('CSV uploaded and data saved to DB');
            } catch (err) {
                console.error('Database error:', err);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting file:', unlinkErr);
                });
                res.status(500).json({ error: err.message });
            }
        });
};
