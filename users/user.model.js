const { DataTypes } = require("sequelize");

module.exports = model;

function model(sequelize) {
  const attributes = {
    email: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: true },
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    position: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false },
    verificationToken: { type: DataTypes.STRING },
    verified: { type: DataTypes.DATE },
    resetToken: { type: DataTypes.STRING },
    resetTokenExpires: { type: DataTypes.DATE },
    passwordReset: { type: DataTypes.DATE },
    created: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated: { type: DataTypes.DATE },
    isVerified: {
      type: DataTypes.VIRTUAL,
      get() {
        return !!(this.verified || this.passwordReset);
      },
    },
    // clientId: { type: DataTypes.INTEGER },
  };

  const options = {
    // disable default timestamp fields (createdAt and updatedAt)
    timestamps: false,
    defaultScope: {
      // exclude password hash by default
      attributes: { exclude: ["passwordHash"] },
    },
    scopes: {
      // include hash with this scope
      withHash: { attributes: {} },
    },
  };

  return sequelize.define("user", attributes, options);
}
