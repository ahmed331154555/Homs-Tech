"use strict";

function createAdminAuth({ jwt, getAdminUsername, getJwtSecret }) {
  if (!jwt || typeof jwt.verify !== "function") {
    throw new TypeError("A JWT verifier is required.");
  }
  if (typeof getAdminUsername !== "function" || typeof getJwtSecret !== "function") {
    throw new TypeError("Admin username and JWT secret providers are required.");
  }

  function getSuperAdminUser(username) {
    return { id: null, username, role: "superadmin", permissions: ["*"] };
  }

  function getAdminFromRequest(req) {
    const token = req.cookies.token;
    if (!token) return null;
    const user = jwt.verify(token, getJwtSecret());
    if (user.username === String(getAdminUsername() || "")) {
      return getSuperAdminUser(user.username);
    }
    return {
      id: user.id || null,
      username: user.username,
      role: user.role || "admin",
      permissions: Array.isArray(user.permissions) ? user.permissions : []
    };
  }

  function requireAuth(req, res, next) {
    try {
      const user = getAdminFromRequest(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      req.admin = user;
      next();
    } catch (error) {
      return res.status(401).json({ error: "Not authenticated" });
    }
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      try {
        const user = getAdminFromRequest(req);
        if (!user) return res.status(401).json({ error: "Not authenticated" });
        if (
          user.role === "superadmin" ||
          user.username === String(getAdminUsername() || "") ||
          user.permissions.includes("*") ||
          user.permissions.includes(permission)
        ) {
          req.admin = user;
          return next();
        }
        return res.status(403).json({ error: "Geen toestemming voor deze actie." });
      } catch (error) {
        return res.status(401).json({ error: "Not authenticated" });
      }
    };
  }

  return {
    getSuperAdminUser,
    getAdminFromRequest,
    requireAuth,
    requirePermission
  };
}

module.exports = { createAdminAuth };
