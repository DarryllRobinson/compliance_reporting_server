const express = require("express");
const router = express.Router();
const reportController = require("../controllers/report.controller");
const authenticate = require("../middleware/authenticate");

router.get("/", authenticate, reportController.getAll);

module.exports = router;
