const { logger } = require("../helpers/logger");
const { parseXeroDate } = require("../utils/date-parser");
const { get, post, del } = require("./xeroApi");
const {
  retryWithExponentialBackoff,
  extractErrorDetails,
  handleXeroApiError,
} = require("./xeroApiUtils");
const defineXeroTokenModel = require("./xero_tokens.model");
const db = require("../db/database");
const pLimit = require("p-limit");
const querystring = require("querystring");

// Ensure XeroToken model is initialized with the sequelize instance from db
const XeroToken = defineXeroTokenModel(db.sequelize);

module.exports = {
  refreshToken,
  fetchContacts,
  fetchInvoices,
  fetchPayments,
  fetchOrganisationDetails,
  getTransformedData,
  exchangeAuthCodeForTokens,
  getConnections,
  getAllXeroData,
  syncAllTenants, // Exported for use
  removeTenant,
  saveToken,
  getLatestToken,
  fetchBankTransactions,
};

async function exchangeAuthCodeForTokens(code, state, req) {
  logger.logEvent("info", "Starting exchange of auth code for tokens...", {
    action: "ExchangeAuthCodeForTokens",
    state,
  });
  try {
    const params = querystring.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.XERO_REDIRECT_URI,
      client_id: process.env.XERO_CLIENT_ID,
      client_secret: process.env.XERO_CLIENT_SECRET,
    });

    // Use retryWithExponentialBackoff for robust token exchange
    const { data: tokenData } = await retryWithExponentialBackoff(
      () =>
        post("https://identity.xero.com/connect/token", params, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }),
      3,
      1000,
      global.sendWebSocketUpdate
    );

    logger.logEvent("info", "Auth code exchanged for tokens successfully", {
      action: "ExchangeAuthCodeForTokens",
      state,
    });

    // Extract clientId and reportId securely from state if encoded, else fallback to req.auth.clientId
    let clientId = null;
    let reportId = null;
    let tenantId = null;
    try {
      const parsedState = JSON.parse(state);
      clientId = parsedState.clientId || req.auth.clientId;
      reportId = parsedState.reportId || req.query?.reportId || null;
      tenantId = parsedState.tenantId || null;
    } catch (e) {
      logger.logEvent("warn", "State parsing failed, using req.auth.clientId", {
        action: "ExchangeAuthCodeForTokens",
        state,
        error: e.message,
      });
      clientId = req.auth.clientId;
    }

    if (!clientId) {
      throw new Error(
        "Missing clientId in request or state. Cannot proceed with token exchange."
      );
    }
    logger.logEvent(
      "info",
      "Using clientId and reportId from state or request",
      {
        action: "ExchangeAuthCodeForTokens",
        clientId,
        reportId,
        tenantId,
      }
    );

    // Do not insert token here — save handled after tenantId is known
    return tokenData;
  } catch (error) {
    logger.logEvent("error", "Error exchanging auth code for tokens", {
      action: "ExchangeAuthCodeForTokens",
      error: error.message,
      state,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error exchanging auth code for tokens: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

async function refreshToken() {
  logger.logEvent("info", "Starting token refresh process...", {
    action: "RefreshToken",
  });
  try {
    // Use retryWithExponentialBackoff for robust token refresh
    logger.logEvent(
      "debug",
      "[refreshToken] Initiating Xero token refresh request",
      {
        action: "RefreshToken",
        url: "https://identity.xero.com/connect/token",
      }
    );
    const { data: tokenData } = await retryWithExponentialBackoff(
      () =>
        post("https://identity.xero.com/connect/token", null, {
          params: {
            grant_type: "refresh_token",
            refresh_token: "your_refresh_token_here", // Replace with actual refresh token
            client_id: "your_client_id_here", // Replace with actual client ID
            client_secret: "your_client_secret_here", // Replace with actual client secret
          },
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }),
      3,
      1000,
      global.sendWebSocketUpdate
    );

    logger.logEvent("debug", "Token data returned from Xero", {
      tokenData,
      statusCode: tokenData?.statusCode || "N/A",
    });

    logger.logEvent("info", "Token refreshed successfully", {
      action: "RefreshToken",
      statusCode: tokenData?.statusCode || "N/A",
    });

    // Prepare data to upsert
    const dbTokenRecord = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires: new Date(Date.now() + (tokenData.expires_in || 0) * 1000),
      created: new Date(),
      createdByIp: "", // You may want to pass this in if available
      revoked: null,
      revokedByIp: null,
      replacedByToken: null,
      clientId: null, // You may want to provide actual clientId if available
      reportId: null,
    };
    logger.logEvent("debug", "[refreshToken] Writing token values to DB", {
      dbTokenRecord,
    });
    // Save the new token data to the database
    await XeroToken.upsert(dbTokenRecord);

    logger.logEvent("info", "Token data saved to database", {
      action: "RefreshToken",
      savedFields: Object.keys(dbTokenRecord),
    });
    return tokenData;
  } catch (error) {
    logger.logEvent("error", "Error refreshing token", {
      action: "RefreshToken",
      error: error.message,
      statusCode: error.statusCode || error.response?.status || "N/A",
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error refreshing token: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Fetch contacts from Xero API and save them to the database.
 * Enhanced logging for API responses, errors, retries, and upserts.
 * @param {Object} options - { accessToken, tenantId, clientId, reportId, transactions }
 */
// TODO: Request a list of contacts by id only
// https://developer.xero.com/documentation/api/accounting/contacts#optimised-use-of-the-where-filter
async function fetchContacts(
  accessToken,
  tenantId,
  clientId,
  reportId,
  transactions,
  createdBy
) {
  logger.logEvent("info", "Fetching contacts from Xero", {
    action: "FetchContacts",
    clientId,
    reportId,
  });
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: `Fetching ${tenantId} contacts...`,
      type: "status",
    });
  }
  try {
    logger.logEvent(
      "debug",
      "Number of transactions (payments + bankTxns) before processing",
      {
        action: "FetchContacts",
        clientId,
        reportId,
        transactionCount: transactions.length,
      }
    );

    const contactIdsSet = new Set();
    // Extract ContactID from record (supports both Payment and BankTxn style)
    for (let i = 0; i < transactions.length; i++) {
      const record = transactions[i];
      const contactId =
        record.Contact?.ContactID || record.Invoice?.Contact?.ContactID || null;
      logger.logEvent(
        "debug",
        "[fetchContacts] Extracted contactId from record",
        { contactId, clientId, reportId, iteration: i, source: "record" }
      );
      if (contactId) {
        contactIdsSet.add(contactId);
      }
    }
    const contactIds = Array.from(contactIdsSet);

    // Prepare to collect actual contact objects
    const contactResults = [];

    logger.logEvent(
      "debug",
      "[fetchContacts] Final list of contactIds to fetch",
      { contactIds, clientId, reportId }
    );

    const limit = pLimit(5);

    // Use rate-limiting and error extraction utilities for each contact fetch
    const fetchAndSaveContact = async (contactId, idx) => {
      logger.logEvent("info", `Starting fetch for contact ${contactId}`, {
        action: "FetchContacts",
        clientId,
        reportId,
        contactId,
        iteration: idx,
      });
      try {
        let data, headers, status;
        try {
          ({ data, headers, status } = await retryWithExponentialBackoff(
            () => get(`/Contacts/${contactId}`, accessToken, tenantId),
            3,
            1000,
            global.sendWebSocketUpdate
          ));
        } catch (apiError) {
          // Use extractErrorDetails utility
          logger.logEvent("error", `API error fetching contact ${contactId}`, {
            action: "FetchContacts",
            clientId,
            reportId,
            contactId,
            error: extractErrorDetails(apiError),
            status: apiError.response?.status,
            apiErrorBody: apiError.response?.data,
            iteration: idx,
          });
          if (
            apiError.response?.data?.Warnings ||
            apiError.response?.data?.Errors
          ) {
            logger.logEvent("warn", "API error contains warnings/errors", {
              clientId,
              reportId,
              contactId,
              warnings: apiError.response?.data?.Warnings,
              errors: apiError.response?.data?.Errors,
              iteration: idx,
            });
          }
          return;
        }
        logger.logEvent(
          "debug",
          `API call response status: ${status ?? "n/a"}`,
          { contactId, clientId, reportId, iteration: idx }
        );
        logger.logEvent("debug", "API response body", {
          responseBody: data,
          contactId,
          clientId,
          reportId,
          iteration: idx,
        });
        logger.logEvent("debug", "Xero API response headers", { headers });

        // Xero SDKs may return the body as .Contact or .Contacts, depending on endpoint
        const contact =
          data?.Contact ||
          (data?.Contacts && Array.isArray(data.Contacts)
            ? data.Contacts[0]
            : null);
        if (!data || (!contact && !data?.Contact && !data?.Contacts)) {
          logger.logEvent(
            "warn",
            "API response is empty or missing expected fields for contact",
            { contactId, clientId, reportId, data, iteration: idx }
          );
        }
        if (data?.Warnings || data?.Errors) {
          logger.logEvent("warn", "API response contains warnings/errors", {
            clientId,
            reportId,
            contactId,
            warnings: data?.Warnings,
            errors: data?.Errors,
            iteration: idx,
          });
        }
        logger.logEvent("info", `Fetched data for contact ${contactId}`, {
          action: "FetchContacts",
          clientId,
          reportId,
          contactId,
          contactData: contact,
          iteration: idx,
        });
        if (contact) {
          // Collect the contact object
          contactResults.push(contact);
          try {
            await db.XeroContact.upsert({
              clientId,
              reportId,
              ContactID: contact.ContactID,
              Name: contact.Name,
              CompanyNumber: contact.CompanyNumber,
              TaxNumber: contact.TaxNumber,
              PaymentTerms: contact.PaymentTerms,
              source: "Xero",
              createdBy,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            logger.logEvent(
              "info",
              `Contact ${contactId} upserted successfully`,
              {
                action: "FetchContacts",
                clientId,
                reportId,
                contactId,
                iteration: idx,
              }
            );
          } catch (error) {
            logger.logEvent("error", "Error during contact upsert", {
              error: extractErrorDetails(error),
              contactId,
              clientId,
              reportId,
              iteration: idx,
            });
          }
        } else {
          logger.logEvent("warn", `No contact found for ${contactId}`, {
            action: "FetchContacts",
            clientId,
            reportId,
            contactId,
            iteration: idx,
          });
        }
      } catch (error) {
        logger.logEvent("error", `Unexpected error in fetchAndSaveContact`, {
          action: "FetchContacts",
          clientId,
          reportId,
          contactId,
          error: extractErrorDetails(error),
          iteration: idx,
        });
      }
    };

    await Promise.all(
      contactIds.map((id, idx) => limit(() => fetchAndSaveContact(id, idx)))
    );

    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "Contacts fetched and saved.",
        type: "status",
      });
    }
    logger.logEvent("info", "Contacts fetched and saved", {
      action: "FetchContacts",
      clientId,
      reportId,
      count: contactResults.length,
    });
    return contactResults;
  } catch (error) {
    handleXeroApiError(error, global.sendWebSocketUpdate);
    logger.logEvent("error", "Error fetching contacts from Xero", {
      action: "FetchContacts",
      clientId,
      reportId,
      error: error.message,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error fetching contacts from Xero: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Extract data from Xero and store in DB for the given client.
 * @param {Object} options - { accessToken, tenantId, clientId, reportId, payments }
 */
async function fetchInvoices(
  accessToken,
  tenantId,
  clientId,
  reportId,
  payments,
  createdBy
) {
  logger.logEvent(
    "info",
    "Extracting invoice data from Xero via payment invoiceIds",
    {
      action: "ExtractXeroData",
      clientId,
      reportId,
    }
  );
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: `Fetching ${tenantId} invoices...`,
      type: "status",
    });
  }
  try {
    // Extract unique InvoiceIDs from payments
    const invoiceIdsSet = new Set();
    payments.forEach((payment) => {
      if (payment.Invoice?.InvoiceID) {
        invoiceIdsSet.add(payment.Invoice.InvoiceID);
      }
    });
    const invoiceIds = Array.from(invoiceIdsSet);

    // Prepare to collect actual invoice objects
    const invoiceResults = [];

    // Prepare to collect not found invoices
    const notFoundInvoices = [];

    // Use rate-limiting and error extraction utilities for each invoice fetch
    const limit = pLimit(5);
    await Promise.all(
      invoiceIds.map((id) =>
        limit(async () => {
          try {
            const { data, headers, status } = await retryWithExponentialBackoff(
              () => get(`/Invoices/${id}`, accessToken, tenantId),
              3,
              1000,
              global.sendWebSocketUpdate
            );
            logger.logEvent("debug", "Xero API response headers", { headers });
            // Xero returns {Invoices: [invoice]} or {Invoice: {...}} depending on API
            let invoice = null;
            if (data?.Invoice) {
              invoice = data.Invoice;
            } else if (
              Array.isArray(data?.Invoices) &&
              data.Invoices.length > 0
            ) {
              invoice = data.Invoices[0];
            }
            // If not found, add to notFoundInvoices
            if (!invoice) {
              notFoundInvoices.push({
                invoiceId: id,
                reason: "Not returned by Xero API",
              });
            }
            if (invoice) {
              invoiceResults.push(invoice);
              const invoiceRecord = {
                clientId,
                reportId,
                InvoiceID: invoice.InvoiceID,
                InvoiceNumber: invoice.InvoiceNumber,
                Reference: invoice.Reference,
                LineItems: invoice.LineItems,
                Type: invoice.Type,
                Contact: invoice.Contact,
                DateString: invoice.DateString,
                DueDateString: invoice.DueDateString,
                Payments: invoice.Payments,
                Status: invoice.Status,
                AmountDue: invoice.AmountDue,
                AmountPaid: invoice.AmountPaid,
                AmountCredited: invoice.AmountCredited,
                Total: invoice.Total,
                invoicePaymentTermsBillsDay:
                  invoice.invoicePaymentTermsBillsDay,
                invoicePaymentTermsBillsType:
                  invoice.invoicePaymentTermsBillsType,
                invoicePaymentTermsSalesDay:
                  invoice.invoicePaymentTermsSalesDay,
                invoicePaymentTermsSalesType:
                  invoice.invoicePaymentTermsSalesType,
                source: "Xero",
                createdBy,
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              await db.XeroInvoice.upsert(invoiceRecord);
            }
          } catch (error) {
            handleXeroApiError(error, global.sendWebSocketUpdate);
            logger.logEvent("error", "Error extracting invoice from Xero", {
              action: "ExtractXeroData",
              clientId,
              reportId,
              error: extractErrorDetails(error),
              invoiceId: id,
            });
          }
        })
      )
    );

    if (global.sendWebSocketUpdate && notFoundInvoices.length > 0) {
      global.sendWebSocketUpdate({
        message: "Some invoices could not be retrieved",
        type: "warning",
        missingInvoices: notFoundInvoices,
      });
    }

    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "Invoices fetched and saved.",
        type: "status",
      });
    }
    logger.logEvent(
      "info",
      "Xero data extracted and saved via invoiceId loop",
      {
        action: "ExtractXeroData",
        clientId,
        reportId,
        count: invoiceResults.length,
      }
    );
    return invoiceResults;
  } catch (error) {
    handleXeroApiError(error, global.sendWebSocketUpdate);
    logger.logEvent("error", "Error extracting invoice data from Xero", {
      action: "ExtractXeroData",
      clientId,
      reportId,
      error: error.message,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error extracting invoice data from Xero: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Get transformed data for the current client.
 * @param {Object} options - { clientId, reportId }
 */
// async function getTransformedData(clientId, reportId, db) {
async function getTransformedData(clientId, reportId) {
  // db is passed in for testing purposes
  logger.logEvent("info", "Retrieving transformed data for client", {
    action: "GetTransformedData",
    clientId,
    reportId,
  });
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: "Transforming data...",
      type: "status",
    });
  }
  try {
    // Example: get transformed invoices for this client and reportId
    const transformed = await db.TransformedXeroData.findAll({
      where: { clientId, reportId },
    });
    logger.logEvent("info", "Transformed data retrieved", {
      action: "GetTransformedData",
      clientId,
      reportId,
      count: transformed.length,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "Transformation complete.",
        type: "status",
      });
    }
    return transformed;
  } catch (error) {
    logger.logEvent("error", "Error retrieving transformed data", {
      action: "GetTransformedData",
      clientId,
      reportId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Fetch payments from Xero API and save them to the database.
 * Includes all relevant fields as per the Xero API dump and transformation logic.
 * @param {Object} options - { accessToken, tenantId, clientId, reportId }
 */
async function fetchPayments(
  accessToken,
  tenantId,
  clientId,
  reportId,
  startDate,
  endDate,
  createdBy
) {
  logger.logEvent("info", "Extracting payments from Xero", {
    action: "ExtractXeroPayments",
    clientId,
    reportId,
    startDate,
    endDate,
  });
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: `Fetching ${tenantId} payments...`,
      type: "status",
    });
  }
  try {
    let fetchedAll = false;
    let page = 1;
    const allPayments = [];

    while (!fetchedAll) {
      // Build Xero-compliant ISO 8601 DateTime filter
      const start = new Date(startDate);
      const end = new Date(endDate);
      const whereClause =
        `Date >= DateTime(${start.getFullYear()}, ${start.getMonth() + 1}, ${start.getDate()})` +
        ` && Date <= DateTime(${end.getFullYear()}, ${end.getMonth() + 1}, ${end.getDate()})` +
        ` && Status != "DELETED" && Invoice.Type != "ACCREC" && Invoice.Type != "ACCRECCREDIT"`;
      // Optionally log the final URL/params for troubleshooting
      logger.logEvent("debug", "Xero Payments GET where clause", {
        whereClause,
        clientId,
        reportId,
        startDate,
        endDate,
      });
      const { data, headers } = await retryWithExponentialBackoff(
        () =>
          get("/Payments", accessToken, tenantId, {
            params: {
              where: whereClause,
              page,
              // pageSize: 100, // Xero defaults to 100 per page
            },
          }),
        3,
        1000,
        global.sendWebSocketUpdate
      );
      // logger.logEvent("debug", "Xero API response headers", { headers });
      const pageItems = data?.Payments || [];

      for (const payment of pageItems) {
        allPayments.push(payment);
        // Skip payments with Status "DELETED" or Invoice.Type "ACCREC"
        if (
          payment.Status === "DELETED" ||
          payment.Invoice?.Type === "ACCREC" ||
          payment.Invoice?.Type === "ACCRECCREDIT"
        ) {
          continue;
        }
        const paymentRecord = {
          clientId,
          reportId,
          Amount: payment.Amount,
          PaymentID: payment.PaymentID,
          Date: payment.Date,
          Reference: payment.Reference,
          IsReconciled: payment.IsReconciled,
          Status: payment.Status,
          Invoice: payment.Invoice,
          PaymentType: payment.PaymentType,
          source: "Xero",
          createdBy,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        try {
          await db.XeroPayment.upsert(paymentRecord);
        } catch (error) {
          logger.logEvent("error", "Error during payment upsert", {
            error: extractErrorDetails(error),
            paymentId: payment.PaymentID,
            clientId,
            reportId,
          });
        }
      }

      // if (pageItems.length > 1) {
      if (pageItems.length < 100) {
        fetchedAll = true;
      } else {
        page++;
      }
    }
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "SUCCESS: Payments fetched and saved",
        type: "status",
      });
    }
    logger.logEvent("info", "Xero payments extracted and saved", {
      action: "ExtractXeroPayments",
      clientId,
      reportId,
      count: allPayments.length,
    });
    return allPayments;
  } catch (error) {
    handleXeroApiError(error, global.sendWebSocketUpdate);
    logger.logEvent("error", "Error extracting payments from Xero", {
      action: "ExtractXeroPayments",
      clientId,
      reportId,
      error: error.message,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error extracting payments from Xero: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Fetch organisation details from Xero API and save them to the database.
 * @param {Object} options - { accessToken, tenantId, clientId, reportId }
 */
async function fetchOrganisationDetails({
  accessToken,
  tenantId,
  clientId,
  reportId,
  createdBy,
}) {
  logger.logEvent("info", "Extracting organisation details from Xero", {
    action: "ExtractXeroOrganisationDetails",
    clientId,
    reportId,
  });
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: `Fetching ${tenantId} organisation details...`,
      type: "status",
    });
  }

  try {
    // Use retryWithExponentialBackoff and extractErrorDetails utility
    const { data, headers, status } = await retryWithExponentialBackoff(
      () => get("/Organisation", accessToken, tenantId),
      3,
      1000,
      global.sendWebSocketUpdate
    );
    logger.logEvent("debug", "Xero API response headers", { headers });
    // Xero returns Organisations as an array
    const organisation =
      Array.isArray(data?.Organisations) && data.Organisations.length > 0
        ? data.Organisations[0]
        : null;

    try {
      if (organisation) {
        const orgRecord = {
          OrganisationID: organisation.OrganisationID,
          Name: organisation.Name,
          LegalName: organisation.LegalName,
          RegistrationNumber: organisation.RegistrationNumber,
          TaxNumber: organisation.TaxNumber,
          PaymentTerms: organisation.PaymentTerms,
          // Add required fields
          clientId,
          reportId,
          source: "Xero",
          createdBy,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await db.XeroOrganisation.upsert(orgRecord);
      }
    } catch (error) {
      logger.logEvent("error", "Error during organisation upsert", {
        error: extractErrorDetails(error),
        organisationId: organisation?.APIKey || organisation?.OrganisationID,
        clientId,
        reportId,
      });
    }

    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "SUCCESS: Organisation details saved",
        type: "status",
      });
    }
    return organisation;
  } catch (error) {
    handleXeroApiError(error, global.sendWebSocketUpdate);
    logger.logEvent(
      "error",
      "Error extracting organisation details from Xero",
      {
        action: "ExtractXeroOrganisationDetails",
        clientId,
        reportId,
        error: error.message,
      }
    );
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message:
          "Error extracting organisation details from Xero: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Get connections (tenants) from Xero API.
 * @param {string} accessToken
 */
async function getConnections(accessToken) {
  logger.logEvent("info", "Fetching Xero connections (tenants)", {
    action: "GetConnections",
  });
  try {
    // Use retryWithExponentialBackoff and extractErrorDetails utility
    const { data, headers, status } = await retryWithExponentialBackoff(
      () => get("/connections", accessToken.toString()),
      3,
      1000,
      global.sendWebSocketUpdate
    );
    logger.logEvent("info", "Xero connections retrieved", {
      action: "GetConnections",
      count: Array.isArray(data) ? data.length : 0,
      data,
    });
    return data;
  } catch (error) {
    logger.logEvent("error", "Error fetching Xero connections", {
      action: "GetConnections",
      error: error.message,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error fetching Xero connections: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Fetch all Xero data for a client and reportId.
 * @param {Object} options - { clientId, reportId }
 * @returns {Promise<Object>} - { organisations, invoices, payments, contacts }
 */
async function getAllXeroData(clientId, reportId, db) {
  // async function getAllXeroData(clientId, reportId) { // db is passed in for testing purposes
  logger.logEvent("info", "Fetching all Xero data for client and report", {
    action: "GetAllXeroData",
    clientId,
    reportId,
  });
  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: "Fetching all Xero data...",
      type: "status",
    });
  }
  try {
    // Fetch all records from each table filtered by clientId and reportId
    const [organisations, invoices, payments, contacts] = await Promise.all([
      db.XeroOrganisation.findAll({ where: { clientId, reportId } }),
      db.XeroInvoice.findAll({ where: { clientId, reportId } }),
      db.XeroPayment.findAll({ where: { clientId, reportId } }),
      db.XeroContact.findAll({ where: { clientId, reportId } }),
      db.XeroBankTxn.findAll({ where: { clientId, reportId } }),
    ]);
    logger.logEvent("info", "Fetched XeroOrganisation records", {
      action: "GetAllXeroData",
      clientId,
      reportId,
      count: organisations.length,
    });
    logger.logEvent("info", "Fetched XeroInvoice records", {
      action: "GetAllXeroData",
      clientId,
      reportId,
      count: invoices.length,
    });
    logger.logEvent("info", "Fetched XeroPayment records", {
      action: "GetAllXeroData",
      clientId,
      reportId,
      count: payments.length,
    });
    logger.logEvent("info", "Fetched XeroContact records", {
      action: "GetAllXeroData",
      clientId,
      reportId,
      count: contacts.length,
    });
    logger.logEvent("info", "Fetched XeroBankTxn records", {
      action: "GetAllXeroData",
      clientId,
      reportId,
      count: bankTxns.length,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "SUCCESS: All Xero data fetched",
        type: "status",
      });
    }
    return {
      organisations,
      invoices,
      payments,
      contacts,
      bankTransactions,
    };
  } catch (error) {
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message: "Error fetching all Xero data: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}

/**
 * Sync all tenants with staggered delays to avoid Xero rate limits.
 * This version is a placeholder: the actual tenant-level delay, error handling, and WebSocket updates
 * should be implemented directly in the controller loop for better progress reporting.
 */
async function syncAllTenants(tenants, fetchXeroDataForTenant, logger) {
  // See controller for actual implementation with delay, error handling, and WebSocket updates.
  for (const tenant of tenants) {
    await fetchXeroDataForTenant(tenant);
  }
}

/**
 * Remove a Xero tenant connection.
 * @param {string} tenantId
 */
async function removeTenant(tenantId) {
  logger.logEvent("info", "Removing Xero tenant connection", {
    action: "RemoveTenant",
    tenantId,
  });

  // Log before looking for access token
  logger.logEvent("debug", "Looking for most recent unrevoked access token", {
    action: "RemoveTenant",
    tenantId,
  });

  try {
    const accessTokenRecord = await XeroToken.findOne({
      where: { tenantId, revoked: null },
      order: [["created", "DESC"]],
    });

    if (!accessTokenRecord) {
      logger.logEvent("warn", "No unrevoked access token found", {
        action: "RemoveTenant",
        tenantId,
      });
    } else {
      logger.logEvent("debug", "Access token found for removal", {
        action: "RemoveTenant",
        tenantId,
        tokenCreated: accessTokenRecord.created,
      });
    }

    if (!accessTokenRecord) {
      throw new Error("No active access token found for removing tenant");
    }

    const accessToken = accessTokenRecord.access_token;

    logger.logEvent("debug", "Sending request to Xero to remove connection", {
      action: "RemoveTenant",
      tenantId,
      tokenSnippet: accessToken?.slice?.(0, 10) + "...",
    });

    try {
      await retryWithExponentialBackoff(
        () => del("/connections/" + tenantId, accessToken),
        3,
        1000,
        global.sendWebSocketUpdate
      );

      logger.logEvent("info", "Tenant removed from Xero successfully", {
        action: "RemoveTenant",
        tenantId,
      });
    } catch (error) {
      const details = extractErrorDetails(error);
      if (
        details?.Status === 403 &&
        details?.Detail === "AuthenticationUnsuccessful"
      ) {
        logger.logEvent(
          "warn",
          "Token no longer valid for tenant — assuming removal",
          {
            action: "RemoveTenant",
            tenantId,
            fallback: true,
            details,
          }
        );
        // Log a fallback "Tenant assumed removed" and return early
        logger.logEvent(
          "info",
          "Tenant assumed removed from Xero (token invalid or already removed)",
          {
            action: "RemoveTenant",
            tenantId,
            fallback: true,
          }
        );
        return;
      }

      logger.logEvent("error", "Failed to remove tenant", {
        action: "RemoveTenant",
        tenantId,
        error: details,
      });
      throw error;
    }
  } catch (error) {
    // Add deep debug log of the full error object
    console.error("Full removeTenant error:", error);
    logger.logEvent("error", "Failed to remove tenant", {
      action: "RemoveTenant",
      tenantId,
      error: extractErrorDetails(error),
    });
    throw error;
  }
}

// Save a Xero token for a tenant/client

/**
 * Save or update a Xero token for a tenant.
 * @param {Object} param0
 */
async function saveToken({
  accessToken,
  refreshToken,
  expiresIn,
  clientId,
  tenantId,
  // Optionally accept createdByIp as a parameter if available
}) {
  const updateData = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires: new Date(Date.now() + (expiresIn || 0) * 1000),
    created: new Date(),
    createdByIp: "", // you may want to pass this dynamically
    revoked: null,
    revokedByIp: null,
    replacedByToken: null,
    clientId,
    tenantId,
  };

  await XeroToken.upsert(updateData);
}

/**
 * Retrieve the most recent (unrevoked) token for a given clientId.
 * @param {string} clientId
 * @returns {Promise<Object|null>}
 */
async function getLatestToken(clientId, tenantId) {
  return XeroToken.findOne({
    where: { clientId, tenantId, revoked: null },
    order: [["created", "DESC"]],
  });
}

// Possible fuzzy matching for bank transactions and payments
// import dayjs from "dayjs";

// function matchPaymentsToBankTransactions(
//   payments,
//   bankTransactions,
//   options = {}
// ) {
//   const {
//     dateToleranceDays = 2,
//     amountTolerance = 0.01,
//     useContactMatch = true,
//   } = options;

//   const matched = [];
//   const unmatchedPayments = [];
//   const matchedTransactionIds = new Set();

//   payments.forEach((payment) => {
//     const paymentDate = dayjs(payment.date);
//     const paymentAmount = parseFloat(payment.amount);

//     const match = bankTransactions.find((tx) => {
//       const txDate = dayjs(tx.date);
//       const txAmount = parseFloat(tx.amount);
//       const dateDiff = Math.abs(paymentDate.diff(txDate, "day"));

//       const contactMatch =
//         !useContactMatch ||
//         (payment.contact?.name &&
//           tx.contact?.name &&
//           payment.contact.name.toLowerCase() === tx.contact.name.toLowerCase());

//       const isAmountMatch =
//         Math.abs(paymentAmount - txAmount) <= amountTolerance;

//       const isMatch =
//         isAmountMatch && dateDiff <= dateToleranceDays && contactMatch;

//       return isMatch && !matchedTransactionIds.has(tx.id);
//     });

//     if (match) {
//       matched.push({ payment, bankTransaction: match });
//       matchedTransactionIds.add(match.id);
//     } else {
//       unmatchedPayments.push(payment);
//     }
//   });

//   return {
//     matched,
//     unmatchedPayments,
//     unmatchedBankTransactions: bankTransactions.filter(
//       (tx) => !matchedTransactionIds.has(tx.id)
//     ),
//   };
// }

/**
 * Fetch bank transactions from Xero API and save them to the database.
 * @param {Object} options - { accessToken, tenantId, clientId, reportId, startDate, endDate, createdBy }
 */
async function fetchBankTransactions(
  accessToken,
  tenantId,
  clientId,
  reportId,
  startDate,
  endDate,
  createdBy
) {
  logger.logEvent("info", "Extracting bank transactions from Xero", {
    action: "ExtractXeroBankTransactions",
    clientId,
    reportId,
    startDate,
    endDate,
  });

  if (global.sendWebSocketUpdate) {
    global.sendWebSocketUpdate({
      message: `Fetching ${tenantId} bank transactions...`,
      type: "status",
    });
  }

  try {
    let fetchedAll = false;
    let page = 1;
    const allBankTxns = [];

    while (!fetchedAll) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const whereClause =
        `Date >= DateTime(${start.getFullYear()}, ${start.getMonth() + 1}, ${start.getDate()})` +
        ` && Date <= DateTime(${end.getFullYear()}, ${end.getMonth() + 1}, ${end.getDate()})` +
        ` && Type == "SPEND"`;
      logger.logEvent("debug", "Xero Bank Transactions GET where clause", {
        whereClause,
        clientId,
        reportId,
        startDate,
        endDate,
      });
      const { data, headers } = await retryWithExponentialBackoff(
        () =>
          get("/BankTransactions", accessToken, tenantId, {
            params: {
              where: whereClause,
              page, // Use pagination
              // pageSize: 100, // Xero defaults to 100 per page
            },
          }),
        3,
        1000,
        global.sendWebSocketUpdate
      );

      // console.log("!@!@!@Bank transactions data:", data);

      const pageItems = data?.BankTransactions || [];

      if (!Array.isArray(pageItems)) {
        logger.logEvent("warn", "No bank transactions returned", {
          tenantId,
          clientId,
          reportId,
          page,
        });
        break;
      }

      for (const txn of pageItems) {
        allBankTxns.push(txn);
        try {
          await db.XeroBankTxn.upsert({
            ...txn,
            Date: parseXeroDate(txn.Date, txn.DateString),
            clientId,
            reportId,
            tenantId,
            Url: txn.Url || null,
            Reference: txn.Reference || null,
            source: "Xero",
            createdBy,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (err) {
          logger.logEvent("error", "Error during bank transaction upsert", {
            error: extractErrorDetails(err),
            bankTransactionId: txn.BankTransactionID,
            clientId,
            reportId,
          });
        }
      }

      // if (pageItems.length > 1) {
      if (pageItems.length < 100) {
        fetchedAll = true;
      } else {
        page++;
      }
    }

    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        message: "SUCCESS: Bank transactions fetched and saved",
        type: "status",
      });
    }

    logger.logEvent("info", "Bank transactions extracted and saved", {
      action: "ExtractXeroBankTransactions",
      clientId,
      reportId,
      count: allBankTxns.length,
    });

    return allBankTxns;
  } catch (error) {
    handleXeroApiError(error, global.sendWebSocketUpdate);
    logger.logEvent("error", "Error extracting bank transactions from Xero", {
      action: "ExtractXeroBankTransactions",
      clientId,
      reportId,
      error: error.message,
    });
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        status: "error",
        message:
          "Error extracting bank transactions from Xero: " + error.message,
        code: error.statusCode || error.response?.status || 500,
      });
    }
    throw error;
  }
}
