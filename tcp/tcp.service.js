const { cli } = require("winston/lib/winston/config");
const db = require("../helpers/db");

module.exports = {
  getAll,
  getAllByReportId,
  getTcpByReportId,
  getAllByClientId,
  sbiUpdate,
  getById,
  create,
  update,
  delete: _delete,
};

async function getAll(clientId) {
  return await db.Tcp.findAll({
    where: {
      clientId,
    },
  });
}

async function getAllByReportId(clientId, reportId) {
  const tcp = await db.Tcp.findAll({
    where: { reportId, clientId },
  });
  return tcp;
}

async function getTcpByReportId(clientId, reportId) {
  const tcp = await db.Tcp.findAll({
    where: {
      reportId,
      isTcp: true,
      excludedTcp: false,
      clientId,
    },
  });
  return tcp;
}

async function sbiUpdate(clientId, reportId, params) {
  // Finds the TCP record by payeeEntityAbn and updates isSbi to false
  const tcp = await db.Tcp.findAll({
    where: {
      reportId,
      payeeEntityAbn: params.payeeEntityAbn,
      clientId,
    },
  });
  if (tcp.length > 0) {
    await db.Tcp.update(
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
  return await getTcp(id, {
    where: { clientId },
  });
}

async function create(clientId, params) {
  return await db.Tcp.create(
    { ...params, clientId },
    {
      where: { clientId },
    }
  );
}

async function getAllByClientId(clientId) {
  return await db.TcpView.findAll({
    where: { clientId },
  });
}

async function update(clientId, id, params) {
  // console.log("tcpService update", id, params);
  const tcp = await getTcp(id, {
    where: { clientId },
  });

  // validate
  // if (
  //   params.businessName !== tcp.businessName &&
  //   (await db.Tcp.findOne({ where: { businessName: params.businessName } }))
  // ) {
  //   throw "Tcp with this ABN already exists";
  // }

  // copy params to tcp and save
  Object.assign(tcp, params);
  await tcp.save();
}

async function _delete(clientId, id) {
  const tcp = await getTcp(id, {
    where: { clientId },
  });
  await tcp.destroy();
}

// helper functions
async function getTcp(clientId, id) {
  const tcp = await db.Tcp.findOne({
    where: {
      id,
      clientId,
    },
  });
  if (!tcp) throw { status: 404, message: "Tcp not found" };
  return tcp;
}
