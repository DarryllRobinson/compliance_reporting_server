const { Op } = require("sequelize");
const db = require("../helpers/db");

module.exports = {
  getAll,
  getById,
  getAllByClientId,
  create,
  update,
  delete: _delete,
};

async function getAll() {
  return await db.Report.findAll();
}

async function create(params, user) {
  return await db.Report.create({ ...params, clientId: user.clientId });
}

async function getAllByClientId(clientId) {
  return await db.ReportView.findAll({
    where: { clientId },
  });
}

async function update(id, params) {
  const report = await getReport(id);

  // copy params to report and save
  Object.assign(report, params);
  await report.save();
  // return updated report
  return report;
}

async function _delete(id) {
  const report = await getReport(id);
  await report.destroy();
}

// helper functions
async function getById(id) {
  const report = await db.Report.findByPk(id);
  if (!report) throw { status: 404, message: "Report not found" };
  return report;
}

async function getEntitiesByABN(abn) {
  const entities = await db.Report.findAll({
    where: {
      ABN: {
        [Op.like]: `%${abn}%`,
      },
    },
  });
  return entities;
}

async function getEntitiesByACN(acn) {
  const entities = await db.Report.findAll({
    where: {
      ACN: {
        [Op.like]: `%${acn}%`,
      },
    },
  });
  return entities;
}

async function getEntitiesByBusinessName(businessName) {
  const entities = await db.Report.findAll({
    where: {
      BusinessName: {
        [Op.like]: `%${businessName}%`,
      },
    },
  });
  return entities;
}
