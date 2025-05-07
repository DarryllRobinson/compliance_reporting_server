require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const errorHandler = require("./middleware/error-handler");
const app = express();

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(morgan("dev"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Example protected route placeholder
console.log("Loading reports controller");
app.use("/api/reports", require("./reports/reports.controller"));
console.log("Loading tcp controller");
app.use("/api/tcp", require("./tcp/tcp.controller"));
console.log("Loading tat controller");
app.use("/api/tat", require("./tat/tat.controller"));
console.log("Loading users controller");
app.use("/api/users", require("./users/users.controller"));

// Healthcheck
app.get("/api/health", (_, res) => res.send("OK"));

// Catch-all 404
app.use((req, res) => res.status(404).json({ message: "Not found" }));

// Error handling
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
