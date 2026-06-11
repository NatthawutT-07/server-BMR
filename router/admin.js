const express = require("express");
const router = express.Router();
const { authCheck, adminCheck } = require('../middlewares/authCheck')
const { tamplate, sku, itemDelete, itemCreate, itemUpdate, getMasterItem, getShelfDashboardSummary, getShelfDashboardShelfSales } = require("../controllers/admin/shelf");

// //Manege
// User Management
const { listUser, changeStatus, changeRole, createUser, deleteUser } = require("../controllers/admin/admin");
router.get("/users", authCheck, adminCheck, listUser);
router.post("/users", authCheck, adminCheck, createUser);
router.delete("/users/:id", authCheck, adminCheck, deleteUser);
router.post("/change-status", authCheck, adminCheck, changeStatus);
router.post("/change-role", authCheck, adminCheck, changeRole);

// Branch Management
const { listBranches, createBranch, updateBranch, deleteBranch } = require("../controllers/admin/branch");
router.get("/branches", authCheck, adminCheck, listBranches);
router.post("/branches", authCheck, adminCheck, createBranch);
router.put("/branches/:id", authCheck, adminCheck, updateBranch);
router.delete("/branches/:id", authCheck, adminCheck, deleteBranch);

// CSV
const upload = require('../config/multerConfig');
const {
    uploadItemMinMaxXLSX,
    uploadMasterItemXLSX,
    uploadStockXLSX,
    uploadWithdrawXLSX,
    uploadTemplateXLSX,
    uploadSKU_XLSX,
    uploadBillXLSX,
    uploadGourmetXLSX,
    uploadSI_XLSX,
    getUploadStatus,
    getAllSyncDates,
    clearStock,
    clearSku,
    clearTemplate,
    clearMinMax,
} = require('../controllers/admin/upload/uploadController');
// Upload endpoints
router.post('/upload-minmax', authCheck, adminCheck, upload.single('file'), uploadItemMinMaxXLSX);
// router.post('/upload-partners', authCheck, adminCheck, upload.single('file'), uploadPartnersCSV)
router.post('/upload-masterItem', authCheck, adminCheck, upload.single('file'), uploadMasterItemXLSX)
router.post('/upload-stock', authCheck, upload.single('file'), uploadStockXLSX)
router.post('/upload-withdraw', authCheck, adminCheck, upload.single('file'), uploadWithdrawXLSX)
router.post('/upload-template', authCheck, adminCheck, upload.single('file'), uploadTemplateXLSX)
router.post('/upload-sku', authCheck, adminCheck, upload.single('file'), uploadSKU_XLSX)
router.post('/upload-bill', authCheck, adminCheck, upload.single('file'), uploadBillXLSX)
router.post('/upload-gourmets', authCheck, adminCheck, upload.single('file'), uploadGourmetXLSX)
router.post('/upload-si', authCheck, adminCheck, upload.single('file'), uploadSI_XLSX)
router.delete('/clear-stock', authCheck, adminCheck, clearStock)
router.delete('/clear-sku', authCheck, adminCheck, clearSku)
router.delete('/clear-template', authCheck, adminCheck, clearTemplate)
router.delete('/clear-minmax', authCheck, adminCheck, clearMinMax)
router.get('/upload-status', authCheck, adminCheck, getUploadStatus)
router.get('/sync-dates', authCheck, adminCheck, getAllSyncDates)

const { downloadTemplate, downloadSKU } = require('../controllers/admin/download');
//download
router.get("/download-template", authCheck, downloadTemplate); //user
router.get("/download-sku", authCheck, downloadSKU); //user

//Tamplate
const { validate } = require("../middlewares/validate");
const { createShelfItemSchema, deleteShelfItemSchema, updateShelfItemSchema, getSkuSchema } = require("../schemas/shelfSchema");

router.get("/shelf-template", authCheck, tamplate); //Tamplate //user
router.get("/shelf-getMasterItem", authCheck, getMasterItem);
router.post("/shelf-sku", authCheck, validate(getSkuSchema), sku); //Item Search //user // date , withdraw , sales
router.delete("/shelf-delete", authCheck, validate(deleteShelfItemSchema), itemDelete);
router.post("/shelf-add", authCheck, validate(createShelfItemSchema), itemCreate);
router.put("/shelf-update", authCheck, validate(updateShelfItemSchema), itemUpdate)
router.get("/shelf-dashboard-summary", authCheck, getShelfDashboardSummary);
router.get("/shelf-dashboard-shelf-sales", authCheck, getShelfDashboardShelfSales);
// router.get("/shelf-summary",  summary)

// POG Request - Admin
const { getAllPogRequests, updatePogRequestStatus, deletePogRequest, bulkApprove, updatePogRequestPosition } = require('../controllers/admin/pogRequest');
router.get("/pog-requests", authCheck, adminCheck, getAllPogRequests);
router.patch("/pog-requests/:id", authCheck, adminCheck, updatePogRequestStatus);
router.delete("/pog-requests/:id", authCheck, adminCheck, deletePogRequest);
router.post("/pog-requests/bulk-approve", authCheck, adminCheck, bulkApprove);
router.put("/pog-requests/:id/position", authCheck, adminCheck, updatePogRequestPosition);

// Shelf Update Notification - for mobile branch
const { checkShelfUpdate, acknowledgeShelfUpdate, getShelfChangeLogs, acknowledgeChangeLog, acknowledgeAllChangeLogs, getAllBranchAckStatus } = require('../controllers/admin/shelfUpdate');
router.get("/shelf-update-check/:branchCode", authCheck, checkShelfUpdate);
router.post("/shelf-update-acknowledge/:branchCode", authCheck, acknowledgeShelfUpdate);
router.get("/shelf-change-logs/:branchCode", authCheck, getShelfChangeLogs);
router.post("/shelf-change-log-acknowledge/:id", authCheck, acknowledgeChangeLog);
router.post("/shelf-change-logs-acknowledge-all/:branchCode", authCheck, acknowledgeAllChangeLogs);

// Admin: Monitor branch acknowledgment status
router.get("/branch-ack-status", authCheck, adminCheck, getAllBranchAckStatus);

module.exports = router;
