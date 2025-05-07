const { expressjwt: jwt } = require("express-jwt");

const secret = process.env.JWT_SECRET;
const db = require("../db");
const logger = require("winston");

module.exports = authorize;
if (!secret) {
  throw new Error("JWT_SECRET is not defined in environment variables");
}

function authorize(roles = []) {
  // roles param can be a single role string (e.g. Role.User or 'User')
  // or an array of roles (e.g. [Role.Admin, Role.User] or ['Admin', 'User'])
  if (typeof roles === "string") {
    roles = [roles];
  }
  console.log("secret", secret);

  return [
    // authenticate JWT token and attach user to request object (req.user)
    jwt({ secret, algorithms: ["HS256"] }),

    // authorize based on user role
    async (req, res, next) => {
      const user = await db.User.findByPk(req.auth.id);

      if (!user || (roles.length && !roles.includes(user.role))) {
        logger.warn(`Unauthorised access attempt by user ID: ${req.auth.id}`);
        return res.status(401).json({ message: "Unauthorised" });
      }

      req.auth.role = user.role;
      const refreshTokens = await user.getRefreshTokens();
      req.auth.ownsToken = (token) =>
        !!refreshTokens.find((x) => x.token === token);
      next();
    },
  ];
}
