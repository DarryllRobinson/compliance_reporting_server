const { DataTypes } = require("sequelize");

module.exports = model;

function model(sequelize) {
  const attributes = {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    reportName: { type: DataTypes.STRING, allowNull: false },
    ReportingPeriodStartDate: { type: DataTypes.DATE, allowNull: false },
    ReportingPeriodEndDate: { type: DataTypes.DATE, allowNull: false },
    ApprovalDate: { type: DataTypes.DATE },
    submittedDate: { type: DataTypes.DATE },
    submittedBy: { type: DataTypes.INTEGER },
    reportStatus: { type: DataTypes.STRING },
    createdBy: { type: DataTypes.INTEGER },
    updatedBy: { type: DataTypes.INTEGER },
    clientId: { type: DataTypes.INTEGER },
  };

  const options = {
    tableName: "tbl_reports",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  };

  return sequelize.define("Report", attributes, options);
}
