"use strict";

const { sanitizeStoredAdminPermissions } = require("./admin-permissions");

function createAdminAuth({ jwt, getAdminUsername, getJwtSecret, pool, logError = console.error }) {
  if (!jwt || typeof jwt.verify !== "function") {
    throw new TypeError("A JWT verifier is required.");
  }
  if (typeof getAdminUsername !== "function" || typeof getJwtSecret !== "function") {
    throw new TypeError("Admin username and JWT secret providers are required.");
  }
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required for admin permission refresh.");
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

  async function refreshAdminUserFromDb(user) {
    if (!user) return null;
    if (
      user.role === "superadmin" ||
      user.username === String(getAdminUsername() || "")
    ) return user;

    try {
      const result = await pool.query(
        "SELECT id,username,role,permissions,active FROM admin_users WHERE id=$1 OR LOWER(username)=LOWER($2) LIMIT 1",
        [user.id || 0, user.username || ""]
      );
      if (!result.rows.length || !result.rows[0].active) return null;
      const admin = result.rows[0];
      return {
        id: admin.id,
        username: admin.username,
        role: admin.role || "admin",
        permissions: sanitizeStoredAdminPermissions(admin.permissions)
      };
    } catch (error) {
      // Fail closed: a database error must never preserve stale permissions.
      logError("Refresh admin permissions error:", error);
      return null;
    }
  }

  async function requireSiteOrPhoneUpdate(req, res, next) {
    try {
      let user = getAdminFromRequest(req);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      user = await refreshAdminUserFromDb(user);
      if (!user) {
        return res.status(401).json({ error: "Admin account is inactive or no longer exists." });
      }
      if (
        user.role === "superadmin" ||
        user.username === String(getAdminUsername() || "") ||
        user.permissions.includes("*") ||
        user.permissions.includes("site.save")
      ) {
        req.admin = user;
        return next();
      }
      const section = String(req.headers["x-homs-admin-section"] || "").trim().toLowerCase();
      if (section === "phones" && user.permissions.includes("phones.update")) {
        req.admin = user;
        return next();
      }
      return res.status(403).json({ error: "Geen toestemming voor deze wijziging." });
    } catch (error) {
      return res.status(401).json({ error: "Not authenticated" });
    }
  }

  function requirePermission(permission) {
    return async (req, res, next) => {
      try {
        let user = getAdminFromRequest(req);
        if (!user) return res.status(401).json({ error: "Not authenticated" });
        user = await refreshAdminUserFromDb(user);
        if (!user) {
          return res.status(401).json({ error: "Admin account is inactive or no longer exists." });
        }
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
    requirePermission,
    refreshAdminUserFromDb,
    requireSiteOrPhoneUpdate
  };
}

module.exports = { createAdminAuth };
