const db = require("../db");

exports.getReportsByClient = async (clientId) => {
  const [rows] = await db.query("SELECT * FROM v_reports WHERE client_id = ?", [
    clientId,
  ]);
  return rows;
};
