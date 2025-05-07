const { Op, where } = require("sequelize");
const db = require("../helpers/db");

module.exports = {
  getAll,
  getById,
  getAllByClientId,
  create,
  update,
  delete: _delete,
};

async function getAll(clientId) {
  return await db.Report.findAll({ where: { clientId } });
}

async function create(clientId, params) {
  return await db.Report.create({ ...params, clientId });
}

async function getAllByClientId(clientId) {
  return await db.ReportView.findAll({
    where: { clientId },
  });
}

async function update(clientId, id, params) {
  const report = await getReport(id, { where: { clientId } });

  // copy params to report and save
  Object.assign(report, params);
  await report.save();
  // return updated report
  return report;
}

async function _delete(clientId, id) {
  const report = await getReport(id, { where: { clientId } });
  await report.destroy();
}

// helper functions
async function getById(clientId, id) {
  const report = await db.Report.findByPk(id, {
    where: { clientId },
  });
  if (!report) throw { status: 404, message: "Report not found" };
  return report;
}
