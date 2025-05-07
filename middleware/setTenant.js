module.exports = async function setTenant(req, res, next) {
  if (req.user?.clientId && req.db?.sequelize) {
    await req.db.sequelize.query("SET @current_client_id = ?", {
      replacements: [req.user.clientId],
    });
  }
  next();
};
