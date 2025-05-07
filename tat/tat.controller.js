const express = require("express");
const router = express.Router();
const Joi = require("joi");
const validateRequest = require("../middleware/validate-request");
const authorise = require("../middleware/authorise");
const tatService = require("./tat.service");

// routes
router.get("/", authorise(), getAll);
router.get("/report/:id", authorise(), getAllByReportId);
router.get("/tat/:id", authorise(), getTatByReportId);
router.get("/:id", authorise(), getById);
router.post("/", authorise(), createSchema, create);
router.put("/:id", authorise(), updateSchema, update);
router.delete("/:id", authorise(), _delete);

module.exports = router;

function getAll(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .getAll(clientId)
    .then((entities) => res.json(entities))
    .catch(next);
}

function getAllByReportId(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .getAllByReportId(clientId, req.params.id)
    .then((tat) => (tat ? res.json(tat) : res.sendStatus(404)))
    .catch(next);
}

function getTatByReportId(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .getTatByReportId(clientId, req.params.id)
    .then((tat) => (tat ? res.json(tat) : res.sendStatus(404)))
    .catch(next);
}

function getById(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .getById(clientId, req.params.id)
    .then((tat) => (tat ? res.json(tat) : res.sendStatus(404)))
    .catch(next);
}

function createSchema(req, res, next) {
  const schema = Joi.object({
    mostCommonPaymentTerm: Joi.string().required(),
    receivableTermComarison: Joi.string().required(),
    rangeMinCurrent: Joi.integer().required(),
    rangeMaxCurrent: Joi.integer().required(),
    expectedMostCommonPaymentTerm: Joi.integer().required(),
    expectedRangeMin: Joi.integer().required(),
    expectedRangeMax: Joi.integer().required(),
    averagePaymentTime: Joi.float().required(),
    medianPaymentTime: Joi.float().required(),
    percentile80: Joi.integer().required(),
    percentile95: Joi.integer().required(),
    paidWithinTermsPercent: Joi.float().required(),
    paidWithin30DaysPercent: Joi.float().required(),
    paid31To60DaysPercent: Joi.float().required(),
    paidOver60DaysPercent: Joi.float().required(),
    reportId: Joi.number().required(),
    createdBy: Joi.number().required(),
  });
  validateRequest(req, next, schema);
}

function create(req, res, next) {
  tatService
    .create(clientId, req.body, req.user)
    .then((record) => res.json(record))
    .catch(next);
}

function getAll(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .getAllByClientId(clientId)
    .then((records) => res.json(records))
    .catch(next);
}

function update(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .update(clientId, req.params.id, req.body)
    .then((tat) => res.json(tat))
    .catch(next);
}

function updateSchema(req, res, next) {
  const schema = Joi.object({
    mostCommonPaymentTerm: Joi.string().allow(null, ""),
    receivableTermComarison: Joi.string().allow(null, ""),
    rangeMinCurrent: Joi.integer().allow(null),
    rangeMaxCurrent: Joi.integer().allow(null),
    expectedMostCommonPaymentTerm: Joi.integer().allow(null),
    expectedRangeMin: Joi.integer().allow(null),
    expectedRangeMax: Joi.integer().allow(null),
    averagePaymentTime: Joi.float().allow(null),
    medianPaymentTime: Joi.float().allow(null),
    percentile80: Joi.integer().allow(null),
    percentile95: Joi.integer().allow(null),
    paidWithinTermsPercent: Joi.float().allow(null),
    paidWithin30DaysPercent: Joi.float().allow(null),
    paid31To60DaysPercent: Joi.float().allow(null),
    paidOver60DaysPercent: Joi.float().allow(null),
    reportId: Joi.number().required(),
    updatedBy: Joi.number().required(),
  });
  validateRequest(req, next, schema);
}

function _delete(req, res, next) {
  const clientId = req.user.clientId;
  tatService
    .delete(clientId, req.params.id)
    .then(() => res.json({ message: "Tat deleted successfully" }))
    .catch((error) => {
      console.error("Error deleting tat:", error); // Log the error details
      next(error); // Pass the error to the global error handler
    });
}
