const express = require("express");
const router = express.Router();
const { authCheck, adminCheck } = require('../middlewares/authCheck')
const { listUser, changeStatus, changeRole } = require('../controllers/admin/admin');
const { tamplate, sku, itemDelete, itemCreate, itemUpdate, getMasterItem } = require("../controllers/admin/shelf");

// //Manege
// router.get("/users", authCheck, adminCheck, listUser);
// router.post("/change-status", authCheck, adminCheck, changeStatus);
// router.post("/change-role", authCheck, adminCheck, changeRole);

// CSV
const upload = require('../config/multerConfig');
const {
    uploadItemMinMaxXLSX,
    uploadMasterItemXLSX,
    uploadSalesDayXLSX,
    uploadStockXLSX,
    uploadWithdrawXLSX,
    uploadTemplateXLSX,
    uploadSKU_XLSX,
    uploadBillXLSX,
    uploadStationXLSX,
    uploadGourmetXLSX,
    getUploadStatus,
} = require('../controllers/admin/uploadController');
// Upload endpoints
router.post('/upload-station', authCheck, adminCheck, upload.single('file'), uploadStationXLSX);
router.post('/upload-minmax', authCheck, adminCheck, upload.single('file'), uploadItemMinMaxXLSX);
// router.post('/upload-partners', authCheck, adminCheck, upload.single('file'), uploadPartnersCSV)
router.post('/upload-masterItem', authCheck, adminCheck, upload.single('file'), uploadMasterItemXLSX)
router.post('/upload-stock', authCheck, adminCheck, upload.single('file'), uploadStockXLSX,)
router.post('/upload-withdraw', authCheck, adminCheck, upload.single('file'), uploadWithdrawXLSX)
router.post('/upload-sales', authCheck, adminCheck, upload.single('file'), uploadSalesDayXLSX)
// router.post('/upload-salesmonth', authCheck, adminCheck, upload.single('file'), uploadSalesMonthCSV)
router.post('/upload-template', authCheck, adminCheck, upload.single('file'), uploadTemplateXLSX)
router.post('/upload-sku', authCheck, adminCheck, upload.single('file'), uploadSKU_XLSX)
router.post('/upload-bill', authCheck, adminCheck, upload.single('file'), uploadBillXLSX)
router.post('/upload-gourmets', authCheck, adminCheck, upload.single('file'), uploadGourmetXLSX)
router.get('/upload-status', authCheck, adminCheck, getUploadStatus)

const { downloadTemplate, downloadSKU } = require('../controllers/admin/download');
//download
router.get("/download-template", authCheck, downloadTemplate); //user
router.get("/download-sku", authCheck, downloadSKU); //user

const { getSearchBranchSales, getBranchListSales, getSearchBranchSalesDay
    , getSearchBranchSalesProductMonth, getSearchBranchSalesProductDay,
    searchProductSales,
    getProductSalesDetail,
    getCustomers } = require("../controllers/admin/sales");
//sales
router.get('/sales-list-branch', authCheck, getBranchListSales); //user
router.post('/sales-search-branch', authCheck, getSearchBranchSales);
router.post('/sales-search-branch-day', authCheck, getSearchBranchSalesDay);
router.post('/sales-search-branch-monthproduct', authCheck, getSearchBranchSalesProductMonth);
router.post('/sales-search-branch-dayproduct', authCheck, getSearchBranchSalesProductDay);

// member
router.post('/sales-member', getCustomers,);


// product search + sales detail
router.get("/sales-product", authCheck, searchProductSales); // user
router.post("/sales-product-detail", authCheck, getProductSalesDetail);

// Dashboard
const { getDashboardData, getDashboardProductList } = require("../controllers/admin/dashboard");
router.get("/dashboard-data", authCheck, getDashboardData)
router.get("/dashboard-product-list", authCheck, getDashboardProductList)

// stock
const { getStock } = require("../controllers/admin/stock");
router.get("/stock-data", authCheck, getStock)



//Tamplate 
router.get("/shelf-template", authCheck, tamplate); //Tamplate //user
router.get("/shelf-getMasterItem", authCheck, getMasterItem);
router.post("/shelf-sku", authCheck, sku); //Item Search //user // date , withdraw , sales
router.delete("/shelf-delete", authCheck, itemDelete);
router.post("/shelf-add", authCheck, itemCreate);
router.put("/shelf-update", authCheck, itemUpdate)
// router.get("/shelf-summary",  summary)


module.exports = router;
