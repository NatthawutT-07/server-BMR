const express = require("express");
const router = express.Router();
const { authCheck, adminCheck } = require('../middlewares/authCheck')
const { listUser, changeStatus, changeRole } = require('../controllers/admin/admin');
const { listPartner } = require("../controllers/admin/partner");
const { showItems } = require("../controllers/admin/items");
const { deleteStation, addStation, updateStation } = require("../controllers/admin/station");
const { tamplate, itemSearch, itemDelete, itemCreate, itemUpdate } = require("../controllers/admin/shelf");

//Manege
router.get("/users", authCheck, adminCheck, listUser);
router.post("/change-status", authCheck, adminCheck, changeStatus);
router.post("/change-role", authCheck, adminCheck, changeRole);

// CSV
const upload = require('../config/multerConfig');
const { uploadStationCSV, uploadItemMinMaxCSV, uploadPartnersCSV, uploadMasterItemCSV, uploadSalesDayCSV, uploadStockCSV, uploadWithdrawCSV, uploadTamplateCSV, uploadItemSearchCSV, uploadSalesMonthCSV } = require('../controllers/admin/uploadController');
const { data } = require("../controllers/admin/dashboard");
// Upload endpoints
router.post('/upload-stations', authCheck, adminCheck, upload.single('file'), uploadStationCSV);
router.post('/upload-itemminmax', authCheck, adminCheck, upload.single('file'), uploadItemMinMaxCSV);
router.post('/upload-partners', authCheck, adminCheck, upload.single('file'), uploadPartnersCSV)
router.post('/upload-masteritem', authCheck, adminCheck, upload.single('file'), uploadMasterItemCSV)
router.post('/upload-stock', authCheck, adminCheck, upload.single('file'), uploadStockCSV,)
router.post('/upload-withdraw', authCheck, adminCheck, upload.single('file'), uploadWithdrawCSV)
router.post('/upload-salesday', authCheck, adminCheck, upload.single('file'), uploadSalesDayCSV)
router.post('/upload-salesmonth', authCheck, adminCheck, upload.single('file'), uploadSalesMonthCSV)
router.post('/upload-tamplate', authCheck, adminCheck, upload.single('file'), uploadTamplateCSV)
router.post('/upload-itemsearch', authCheck, adminCheck, upload.single('file'), uploadItemSearchCSV)

//partner
router.get("/partner", authCheck, adminCheck, listPartner);

//list of item hold <===
router.get("/items", authCheck, adminCheck, showItems);

// station
router.delete("/station-delete/:id", authCheck, adminCheck, deleteStation)
router.post("/station-add", authCheck, adminCheck, addStation)
router.put("/station-update/:id", authCheck, adminCheck, updateStation)

// Dashboard
router.get("/dashboard-data", authCheck, data) //call sales,withdraw,stock

//Tamplate 
router.get("/shelf-tamplate", authCheck, tamplate); //Tamplate
router.post("/shelf-itemsearch", authCheck, itemSearch); //Item Search
router.delete("/shelf-delete", authCheck, adminCheck, itemDelete);
router.post("/shelf-add", authCheck, adminCheck, itemCreate);
router.put("/shelf-update", authCheck, adminCheck, itemUpdate)

module.exports = router;
