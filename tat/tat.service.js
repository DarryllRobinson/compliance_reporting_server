const { cli } = require("winston/lib/winston/config");
const db = require("../helpers/db");

module.exports = {
  getAll,
  getAllByReportId,
  getTatByReportId,
  getAllByClientId,
  sbiUpdate,
  getById,
  create,
  update,
  delete: _delete,
};

async function getAll(clientId) {
  return await db.Tat.findAll({
    where: {
      clientId,
    },
  });
}

async function getAllByReportId(clientId, reportId) {
  const tat = await db.Tat.findAll({
    where: { reportId, clientId },
  });
  return tat;
}

async function getTatByReportId(clientId, reportId) {
  const tat = await db.Tat.findAll({
    where: {
      reportId,
      isTat: true,
      excludedTat: false,
      clientId,
    },
  });
  return tat;
}

async function sbiUpdate(clientId, reportId, params) {
  // Finds the TCP record by payeeEntityAbn and updates isSbi to false
  const tat = await db.Tat.findAll({
    where: {
      reportId,
      payeeEntityAbn: params.payeeEntityAbn,
      clientId,
    },
  });
  if (tat.length > 0) {
    await db.Tat.update(
      { isSb: false },
      {
        where: {
          reportId,
          payeeEntityAbn: params.payeeEntityAbn,
          clientId,
        },
      }
    );
  }
}

async function getById(clientId, id) {
  return await getTat(id, {
    where: { clientId },
  });
}

async function create(clientId, params) {
  return await db.Tat.create({ ...params, clientId });
}

async function getAllByClientId(clientId) {
  return await db.TatView.findAll({
    where: { clientId },
  });
}

async function update(clientId, id, params) {
  // console.log("tatService update", id, params);
  const tat = await getTat(id, {
    where: { clientId },
  });

  // validate
  // if (
  //   params.businessName !== tat.businessName &&
  //   (await db.Tat.findOne({ where: { businessName: params.businessName } }))
  // ) {
  //   throw "Tat with this ABN already exists";
  // }

  // copy params to tat and save
  Object.assign(tat, params);
  await tat.save();
}

async function _delete(clientId, id) {
  const tat = await getTat(id, {
    where: { clientId },
  });
  await tat.destroy();
}

// helper functions
async function getTat(clientId, id) {
  const tat = await db.Tat.findByPk(id, {
    where: { clientId },
  });
  if (!tat) throw { status: 404, message: "Tat not found" };
  return tat;
}
