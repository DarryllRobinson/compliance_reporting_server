const express = require("express");
const Joi = require("joi");
const validateRequest = require("../middleware/validate-request");
const userService = require("../services/user.service");
const { setTokenCookie } = require("../utils/auth.utils");

module.exports = {
  authenticateSchema,
  authenticate,
};

function authenticateSchema(req, res, next) {
  const schema = Joi.object({
    email: Joi.string().required(),
    password: Joi.string().required(),
  });
  validateRequest(req, next, schema);
}

async function authenticate(req, res, next) {
  try {
    const { email, password } = req.body;
    const ipAddress = req.ip;
    const { refreshToken, ...user } = await userService.authenticate({
      email,
      password,
      ipAddress,
    });
    setTokenCookie(res, refreshToken);
    res.json(user);
  } catch (error) {
    next(error);
  }
}
