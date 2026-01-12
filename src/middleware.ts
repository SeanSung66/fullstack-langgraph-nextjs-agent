import { NextRequest, NextResponse } from "next/server";

/**
 * CORS configuration interface
 */
export interface CORSConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  allowCredentials: boolean;
  maxAge: number;
}

/**
 * Get CORS configuration from environment variables
 */
export function getCORSConfig(): CORSConfig {
  const originsEnv = process.env.CORS_ALLOWED_ORIGINS || "";
  const allowedOrigins = originsEnv
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    allowedOrigins,
    allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    allowCredentials: true,
    maxAge: 86400, // 24 hours
  };
}

/**
 * Check if the origin is allowed based on configuration
 */
export function isOriginAllowed(origin: string | null, config: CORSConfig): boolean {
  if (!origin) return false;
  if (config.allowedOrigins.includes("*")) return true;
  return config.allowedOrigins.includes(origin);
}

/**
 * Add CORS headers to response
 */
export function addCORSHeaders(
  response: NextResponse,
  origin: string | null,
  config: CORSConfig,
): NextResponse {
  if (origin && isOriginAllowed(origin, config)) {
    // When credentials are allowed, we cannot use "*" for origin
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", config.allowedMethods.join(", "));
    response.headers.set("Access-Control-Allow-Headers", config.allowedHeaders.join(", "));
    response.headers.set("Access-Control-Max-Age", config.maxAge.toString());

    if (config.allowCredentials) {
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }
  }

  return response;
}

/**
 * Handle preflight OPTIONS request
 */
function handlePreflight(origin: string | null, config: CORSConfig): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  return addCORSHeaders(response, origin, config);
}

/**
 * Next.js middleware for CORS support
 */
export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const config = getCORSConfig();

  // Only apply CORS to API routes
  if (!request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Handle preflight OPTIONS request
  if (request.method === "OPTIONS") {
    return handlePreflight(origin, config);
  }

  // For actual requests, add CORS headers to the response
  const response = NextResponse.next();
  return addCORSHeaders(response, origin, config);
}

/**
 * Configure which paths the middleware should run on
 */
export const config = {
  matcher: "/api/:path*",
};
