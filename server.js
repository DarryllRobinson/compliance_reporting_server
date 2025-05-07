require("dotenv").config();
// --- TENANT MULTITENANCY foundation ---
const mysql = require("mysql2/promise"); // For dynamic per-tenant schema connections
const jwt = require("jsonwebtoken"); // For extracting user & tenant info from JWT
const express = require("express");
const morgan = require("morgan");
const helmet = require("helmet");
const cors = require("cors");
const errorHandler = require("./middleware/error-handler");
const authenticate = require("./middleware/authenticate");

// --- Tenant connection pool cache, keyed by schema name ---
const tenantPools = {}; // keyed by schema name
async function getTenantConnection(schema) {
  if (!tenantPools[schema]) {
    tenantPools[schema] = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.TENANT_DB_USER,
      password: process.env.TENANT_DB_PASSWORD,
      database: schema,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return tenantPools[schema];
}

const app = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(morgan("dev"));
app.use(helmet());
app.use(
  cors({
    origin: "http://localhost:3000", // 👈 Must be exact
    credentials: true, // 👈 Allow cookies
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Tenant extraction middleware: attaches req.user and req.db for per-tenant access ---
app.use(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // If JWT contains tenant schema info, attach a db connection for downstream use
    if (decoded.schema) {
      req.db = await getTenantConnection(decoded.schema);
    }
  } catch (err) {
    console.error("Token parse error:", err.message);
  }
  next();
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Example secured route
app.use("/api/reports", authenticate, require("./routes/report.routes"));
app.use("/api/users", require("./routes/user.routes"));

// Error handling
app.use(errorHandler);

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
