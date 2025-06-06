const { DataTypes } = require("sequelize");

const XeroInvoice = (sequelize) => {
  return sequelize.define(
    "XeroInvoice",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      clientId: {
        type: DataTypes.STRING(10),
        allowNull: false,
        references: {
          model: "tbl_client",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      reportId: {
        type: DataTypes.STRING(10),
        allowNull: true,
        references: {
          model: "tbl_report",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      InvoiceID: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      InvoiceNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      Reference: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      LineItems: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      Type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      Contact: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      DateString: { type: DataTypes.STRING, allowNull: false },
      DueDateString: { type: DataTypes.STRING, allowNull: true },
      Payments: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      Status: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      AmountPaid: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.0,
      },
      AmountDue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.0,
      },
      AmountCredited: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.0,
      },
      Total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.0,
      },
      invoicePaymentTermsBillsDay: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      invoicePaymentTermsBillsType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      invoicePaymentTermsSalesDay: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      invoicePaymentTermsSalesType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "xero_invoices",
      timestamps: true,
    }
  );
};

module.exports = XeroInvoice;
