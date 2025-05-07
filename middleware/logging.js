import logger from "../utils/logger.js";

export function logRequest(req, res, next) {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
}

export function logError(err, req, res, next) {
  logger.error(`${req.method} ${req.originalUrl} - ${err.message}`);
  next(err);
}
