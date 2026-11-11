import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import process from "node:process";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseBasicAuthorization(header = "") {
  const separatorIndex = header.indexOf(" ");
  if (
    separatorIndex < 0 ||
    header.slice(0, separatorIndex).toLowerCase() !== "basic"
  ) {
    return null;
  }
  const encoded = header.slice(separatorIndex + 1).trim();
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function createAppAuthMiddleware({
  username = process.env.APP_AUTH_USER,
  password = process.env.APP_AUTH_PASSWORD,
} = {}) {
  return (req, res, next) => {
    if (
      (req.path === "/api" || req.path.startsWith("/api/")) &&
      req.header("x-api-key")
    ) {
      req.appUserAuthenticated = false;
      return next();
    }
    if (!username || !password) {
      req.appUserAuthenticated = false;
      return next();
    }
    const credentials = parseBasicAuthorization(
      req.header("authorization") || "",
    );
    const authenticated =
      credentials &&
      safeEqual(credentials.username, username) &&
      safeEqual(credentials.password, password);
    if (!authenticated) {
      res.set("WWW-Authenticate", 'Basic realm="XYZW NAS"');
      return res.status(401).send("Authentication required");
    }
    req.appUserAuthenticated = true;
    next();
  };
}
