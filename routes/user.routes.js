const express = require("express");
const router = express.Router();
const userController = require("../controllers/users.controller");

// Public routes
router.post("/login", userController.authenticate);

module.exports = router;
