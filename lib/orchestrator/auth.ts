import {timingSafeEqual} from "node:crypto";

const ADMIN_TOKEN = process.env.RALPH_ADMIN_TOKEN;

export const isAdminAuthEnabled = () => Boolean(ADMIN_TOKEN);

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isAuthorized(request: Request) {
  if (!ADMIN_TOKEN) return true;

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("ralph_admin_token="))
    ?.slice("ralph_admin_token=".length);

  return safeEqual(decodeURIComponent(bearer || cookie || ""), ADMIN_TOKEN);
}

export function unauthorized() {
  return Response.json({error: "Nao autorizado."}, {status: 401});
}
