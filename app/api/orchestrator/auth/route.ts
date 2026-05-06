import {isAdminAuthEnabled, isAuthorized, unauthorized} from "@/lib/orchestrator/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminAuthEnabled()) return Response.json({enabled: false, authorized: true});
  return Response.json({enabled: true, authorized: isAuthorized(request)});
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return Response.json({ok: true});
}
