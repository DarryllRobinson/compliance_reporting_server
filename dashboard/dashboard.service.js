const {
  beginTransactionWithClientContext,
} = require("../helpers/setClientIdRLS");
const db = require("../db/database");
const { logger } = require("../helpers/logger");

module.exports = {
  getDashboardMetrics,
  getPreviousDashboardMetrics,
  getDashboardFlags,
  getDashboardSnapshot,
  getDashboardSignals,
  getDashboardExtendedMetrics,
};

async function getDashboardMetrics(reportId, clientId) {
  logger.logEvent("info", "Fetching dashboard metrics", {
    action: "GetDashboardMetrics",
    reportId,
    clientId,
  });

  const query = `
    SELECT
      COALESCE(SUM("paymentAmount"), 0) AS "totalSpend",
      COUNT(*) AS "invoiceCount",
      ROUND(AVG("paymentTime")::numeric, 2) AS "avgDaysToPay",
      ROUND(SUM(CASE WHEN "paymentTime" > 30 THEN 1 ELSE 0 END)::decimal / NULLIF(COUNT(*), 0), 4) AS "latePaymentRate",
      COALESCE(SUM(CASE WHEN "isSb" = true THEN "paymentAmount" ELSE 0 END), 0) AS "smallBusinessSpend",
      COUNT(*) FILTER (WHERE "transactionType" = 'PEPPOL') AS "peppolCount"
    FROM "tbl_tcp"
    WHERE "reportId" = :reportId AND "clientId" = :clientId AND "isTcp" = true AND "excludedTcp" = false AND "paymentTime" IS NOT NULL
  `;

  const [results] = await db.sequelize.query(query, {
    replacements: { reportId, clientId },
    type: db.sequelize.QueryTypes.SELECT,
  });

  return results;
}

async function getPreviousDashboardMetrics(reportId, clientId) {
  logger.logEvent("info", "Fetching previous dashboard metrics", {
    action: "GetPreviousDashboardMetrics",
    reportId,
    clientId,
  });

  // Lookup the reportingPeriodStartDate for the current report
  const currentReportQuery = `
    SELECT "reportingPeriodStartDate"
    FROM "tbl_report"
    WHERE "id" = :reportId AND "clientId" = :clientId
    LIMIT 1
  `;

  const [currentReport] = await db.sequelize.query(currentReportQuery, {
    replacements: { reportId, clientId },
    type: db.sequelize.QueryTypes.SELECT,
  });

  if (!currentReport || !currentReport.reportingPeriodStartDate) {
    return null;
  }

  // Find the previous report with reportingPeriodStartDate less than current's
  const previousReportQuery = `
    SELECT "id"
    FROM "tbl_report"
    WHERE "clientId" = :clientId AND "reportingPeriodStartDate" < :currentStartDate
    ORDER BY "reportingPeriodStartDate" DESC
    LIMIT 1
  `;

  const [previousReport] = await db.sequelize.query(previousReportQuery, {
    replacements: {
      clientId,
      currentStartDate: currentReport.reportingPeriodStartDate,
    },
    type: db.sequelize.QueryTypes.SELECT,
  });

  if (!previousReport || !previousReport.id) {
    return null;
  }

  // Call getDashboardMetrics with the previous reportId
  return await getDashboardMetrics(previousReport.id, clientId);
}

async function getDashboardFlags(reportId, clientId) {
  logger.logEvent("info", "Fetching flagged records", {
    action: "GetDashboardFlags",
    reportId,
    clientId,
  });

  // Fetch TCP records flagged as potentially anomalous
  const query = `
    SELECT *
    FROM "tbl_tcp"
    WHERE "reportId" = :reportId AND "clientId" = :clientId AND "isTcp" = true AND "excludedTcp" = false
      AND (
        "paymentTime" > 90
        OR ("paymentAmount" > 500000 AND "isSb" = true)
      )
  `;

  const flaggedRecords = await db.sequelize.query(query, {
    replacements: { reportId, clientId },
    type: db.sequelize.QueryTypes.SELECT,
  });

  return flaggedRecords;
}

async function getDashboardSnapshot(reportId, clientId) {
  logger.logEvent("info", "Fetching metrics snapshot", {
    action: "GetDashboardSnapshot",
    reportId,
    clientId,
  });

  // Placeholder snapshot until real snapshot storage is implemented
  return {
    reportId,
    clientId,
    snapshotDate: new Date().toISOString(),
    summary: await getDashboardMetrics(reportId, clientId),
  };
}

async function getDashboardSignals(reportId, clientId) {
  const t = await beginTransactionWithClientContext(clientId);
  try {
    console.log(
      "Fetching dashboard signals for reportId:",
      reportId,
      "clientId:",
      clientId
    );
    logger.logEvent("info", "Fetching dashboard signals", {
      action: "GetDashboardSignals",
      reportId,
      clientId,
    });

    const coreMetrics = await getDashboardMetrics(reportId, clientId);

    const [summaryResult] = await db.sequelize.query(
      `
        SELECT
          ROUND(AVG("paymentTime")::numeric, 2) AS "avgDays",
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "paymentTime") AS "medianDays",
          ROUND(SUM(CASE WHEN "isSb" = true AND "paymentTime" > 30 THEN 1 ELSE 0 END)::decimal / NULLIF(SUM(CASE WHEN "isSb" = true THEN 1 ELSE 0 END), 0), 4) AS "lateSbRate"
        FROM "tbl_tcp"
        WHERE "reportId" = :reportId AND "clientId" = :clientId AND "isTcp" = true AND "excludedTcp" = false AND "paymentTime" IS NOT NULL
      `,
      {
        replacements: { reportId, clientId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );
    console.log("Summary result:", summaryResult);
    const summary = summaryResult[0];

    const topSuppliers = await db.sequelize.query(
      `
        SELECT "payeeEntityAbn", ROUND(AVG("paymentTime")::numeric, 2) AS "avgDays"
        FROM "tbl_tcp"
        WHERE "reportId" = :reportId AND "clientId" = :clientId AND "isTcp" = true AND "excludedTcp" = false AND "isSb" = true
        GROUP BY "payeeEntityAbn"
        ORDER BY "avgDays" DESC
        LIMIT 10
      `,
      {
        replacements: { reportId, clientId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );
    console.log("Top suppliers result:", topSuppliers);

    const [bandsResult] = await db.sequelize.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE "paymentAmount" < 5000) AS "lt5k",
          COUNT(*) FILTER (WHERE "paymentAmount" >= 5000 AND "paymentAmount" < 50000) AS "btw5k50k",
          COUNT(*) FILTER (WHERE "paymentAmount" >= 50000 AND "paymentAmount" < 200000) AS "btw50k200k",
          COUNT(*) FILTER (WHERE "paymentAmount" >= 200000) AS "gt200k"
        FROM "tbl_tcp"
        WHERE "reportId" = :reportId AND "clientId" = :clientId AND "isTcp" = true AND "excludedTcp" = false AND "isSb" = true
      `,
      {
        replacements: { reportId, clientId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );
    console.log("Invoice band result:", bandsResult);
    const bands = Array.isArray(bandsResult) ? bandsResult[0] : bandsResult;

    await t.commit();

    logger.logEvent("info", "Returning dashboard signals", {
      action: "ReturnDashboardSignals",
      reportId,
      clientId,
      signals: {
        ...coreMetrics,
        avgDays: summary?.avgDays,
        medianDays: summary?.medianDays,
        lateSbRate: summary?.lateSbRate,
        slowestPaidSuppliers: topSuppliers,
        invoiceBands: [
          { label: "<$5k", count: Number(bands?.lt5k) },
          { label: "$5k–50k", count: Number(bands?.btw5k50k) },
          { label: "$50k–200k", count: Number(bands?.btw50k200k) },
          { label: ">$200k", count: Number(bands?.gt200k) },
        ],
      },
    });

    return {
      ...coreMetrics,
      avgDays: summary?.avgDays,
      medianDays: summary?.medianDays,
      lateSbRate: summary?.lateSbRate,
      slowestPaidSuppliers: topSuppliers,
      invoiceBands: [
        { label: "<$5k", count: Number(bands?.lt5k) },
        { label: "$5k–50k", count: Number(bands?.btw5k50k) },
        { label: "$50k–200k", count: Number(bands?.btw50k200k) },
        { label: ">$200k", count: Number(bands?.gt200k) },
      ],
    };
  } catch (error) {
    await t.rollback();
    logger.logEvent("error", "Failed to fetch dashboard signals", {
      action: "GetDashboardSignals",
      reportId,
      clientId,
      error: error.message,
    });
    throw error;
  }
}

async function getDashboardExtendedMetrics(reportId, clientId) {
  const t = await beginTransactionWithClientContext(clientId);
  try {
    logger.logEvent("info", "Fetching extended dashboard metrics", {
      action: "GetExtendedDashboardMetrics",
      reportId,
      clientId,
    });

    const [results] = await db.sequelize.query(
      `
        SELECT
          SUM(CASE WHEN "paymentTime" <= 30 THEN 1 ELSE 0 END) AS "invoicesPaidWithin30Days",
          SUM(CASE WHEN "paymentTime" <= 30 THEN "paymentAmount" ELSE 0 END) AS "valuePaidWithin30Days",
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY "paymentTime") AS "percentile80",
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "paymentTime") AS "percentile95",
          SUM(CASE WHEN "isSb" = true THEN 1 ELSE 0 END) AS "sbNumPayments",
          SUM(CASE WHEN "isSb" = true THEN "paymentAmount" ELSE 0 END) AS "sbValuePayments",
          SUM(CASE WHEN "isSb" = true AND "transactionType" = 'PEPPOL' THEN 1 ELSE 0 END) AS "sbPeppolNum",
          SUM(CASE WHEN "isSb" = true AND "transactionType" = 'PEPPOL' THEN "paymentAmount" ELSE 0 END) AS "sbPeppolValue"
        FROM "tbl_tcp"
        WHERE "reportId" = :reportId AND "clientId" = :clientId AND "isTcp" = true AND "excludedTcp" = false AND "paymentTime" IS NOT NULL
      `,
      {
        replacements: { reportId, clientId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );

    await t.commit();
    return results;
  } catch (error) {
    await t.rollback();
    logger.logEvent("error", "Failed to fetch extended dashboard metrics", {
      action: "GetExtendedDashboardMetrics",
      reportId,
      clientId,
      error: error.message,
    });
    throw error;
  }
}
