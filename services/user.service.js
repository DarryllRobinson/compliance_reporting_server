const bcrypt = require("bcryptjs");
const db = require("../db");

module.exports = {
  authenticate,
};

async function authenticate({ email, password, ipAddress }) {
  const user = await db.User.scope("withHash").findOne({
    where: { email },
  });
  if (
    !user ||
    !user.isVerified ||
    !(await bcrypt.compare(password, user.passwordHash))
  ) {
    throw { status: 401, message: "Email or password is incorrect" };
  }

  // authentication successful so generate jwt and refresh tokens
  const jwtToken = generateJwtToken(user);
  const refreshToken = generateRefreshToken(user, ipAddress);

  // save refresh token
  await refreshToken.save();

  // return basic details and tokens
  return {
    ...basicDetails(user),
    jwtToken,
    refreshToken: refreshToken.token,
  };
}
