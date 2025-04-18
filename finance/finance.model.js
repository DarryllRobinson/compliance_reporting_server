const { DataTypes } = require("sequelize");

module.exports = model;

function model(sequelize) {
  const attributes = {
    InvoicePracticesAndArrangements: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    PracticesAndArrangementsForLodgingTender: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    PracticesAndArrangementsToAcceptInvoice: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    TotalValueOfSmallBusinessProcurement: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    SupplyChainFinanceArrangements: { type: DataTypes.STRING, allowNull: true },
    TotalNumberSupplyChainFinanceArrangement: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    TotalValueSupplyChainFinanceArrangements: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    BenefitsOfSupplyChainFinanceArrangements: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    RequirementToUseSupplyChainFinance: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    DetailOfChangeInAccountingPeriod: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    DetailOfChangeInBusinessName: { type: DataTypes.STRING, allowNull: true },
    DetailEntitesBelowReportingThreshold: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true },
  };

  return sequelize.define("finance", attributes, { tableName: "tbl_finance" });
}
