const winston = require("winston"); // Example logging library

// Configure Winston logger with a console transport if not already configured
const logger = winston.createLogger({
  level: "error",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

module.exports = errorHandler;

function errorHandler(err, req, res, next) {
  logger.error(err); // Log error details

  switch (true) {
    case typeof err === "string":
      // custom application error
      const is404 = err.toLowerCase().endsWith("not found");
      const statusCode = is404 ? 404 : 400;
      return res.status(statusCode).json({ message: err });
    case err.name === "UnauthorizedError":
      // jwt authentication error
      return res.status(401).json({ message: "Unauthorized" });
    default:
      return res.status(500).json({ message: err.message });
  }
}
