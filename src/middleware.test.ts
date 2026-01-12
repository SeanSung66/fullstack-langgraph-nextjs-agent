import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { getCORSConfig, isOriginAllowed, addCORSHeaders, CORSConfig } from "./middleware";
import { NextResponse } from "next/server";

/**
 * Feature: api-documentation-and-external-access
 * Property tests for CORS middleware
 */

describe("CORS Middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getCORSConfig", () => {
    it("should parse comma-separated origins from environment variable", () => {
      process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3001,https://example.com";
      const config = getCORSConfig();
      expect(config.allowedOrigins).toEqual(["http://localhost:3001", "https://example.com"]);
    });

    it("should handle empty environment variable", () => {
      process.env.CORS_ALLOWED_ORIGINS = "";
      const config = getCORSConfig();
      expect(config.allowedOrigins).toEqual([]);
    });

    it("should trim whitespace from origins", () => {
      process.env.CORS_ALLOWED_ORIGINS = " http://localhost:3001 , https://example.com ";
      const config = getCORSConfig();
      expect(config.allowedOrigins).toEqual(["http://localhost:3001", "https://example.com"]);
    });

    it("should have default allowed methods", () => {
      const config = getCORSConfig();
      expect(config.allowedMethods).toContain("GET");
      expect(config.allowedMethods).toContain("POST");
      expect(config.allowedMethods).toContain("PATCH");
      expect(config.allowedMethods).toContain("DELETE");
      expect(config.allowedMethods).toContain("OPTIONS");
    });
  });

  describe("isOriginAllowed", () => {
    /**
     * Property 1: CORS Origin 响应一致性
     * 对于任意带有 Origin 头的请求，如果该 Origin 在允许列表中，
     * CORS_Handler 应当在响应中返回匹配的 Access-Control-Allow-Origin 头
     * Validates: Requirements 8.1
     */
    it("Property 1: should return true for origins in the allowed list", () => {
      fc.assert(
        fc.property(
          fc.array(fc.webUrl(), { minLength: 1, maxLength: 10 }),
          fc.nat({ max: 9 }),
          (origins, index) => {
            const safeIndex = index % origins.length;
            const config: CORSConfig = {
              allowedOrigins: origins,
              allowedMethods: ["GET"],
              allowedHeaders: ["Content-Type"],
              allowCredentials: true,
              maxAge: 86400,
            };
            const testOrigin = origins[safeIndex];
            return isOriginAllowed(testOrigin, config) === true;
          },
        ),
        { numRuns: 100 },
      );
    });

    it("Property 1: should return false for origins not in the allowed list", () => {
      fc.assert(
        fc.property(
          fc.array(fc.webUrl(), { minLength: 1, maxLength: 5 }),
          fc.webUrl(),
          (allowedOrigins, testOrigin) => {
            // Only test when testOrigin is not in allowedOrigins
            fc.pre(!allowedOrigins.includes(testOrigin));

            const config: CORSConfig = {
              allowedOrigins,
              allowedMethods: ["GET"],
              allowedHeaders: ["Content-Type"],
              allowCredentials: true,
              maxAge: 86400,
            };
            return isOriginAllowed(testOrigin, config) === false;
          },
        ),
        { numRuns: 100 },
      );
    });

    it("Property 1: wildcard '*' should allow any origin", () => {
      fc.assert(
        fc.property(fc.webUrl(), (origin) => {
          const config: CORSConfig = {
            allowedOrigins: ["*"],
            allowedMethods: ["GET"],
            allowedHeaders: ["Content-Type"],
            allowCredentials: true,
            maxAge: 86400,
          };
          return isOriginAllowed(origin, config) === true;
        }),
        { numRuns: 100 },
      );
    });

    it("should return false for null origin", () => {
      const config: CORSConfig = {
        allowedOrigins: ["http://localhost:3001"],
        allowedMethods: ["GET"],
        allowedHeaders: ["Content-Type"],
        allowCredentials: true,
        maxAge: 86400,
      };
      expect(isOriginAllowed(null, config)).toBe(false);
    });
  });

  describe("addCORSHeaders", () => {
    /**
     * Property 2: OPTIONS 预检响应完整性
     * 对于任意 OPTIONS 预检请求，CORS_Handler 应当返回包含
     * Access-Control-Allow-Methods 和 Access-Control-Allow-Headers 的响应
     * Validates: Requirements 8.2
     */
    it("Property 2: should include Allow-Methods and Allow-Headers for any allowed origin", () => {
      fc.assert(
        fc.property(
          fc.webUrl(),
          fc.array(fc.constantFrom("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"), {
            minLength: 1,
            maxLength: 6,
          }),
          fc.array(fc.constantFrom("Content-Type", "Authorization", "X-Requested-With"), {
            minLength: 1,
            maxLength: 3,
          }),
          (origin, methods, headers) => {
            const config: CORSConfig = {
              allowedOrigins: [origin],
              allowedMethods: methods,
              allowedHeaders: headers,
              allowCredentials: true,
              maxAge: 86400,
            };

            const response = new NextResponse(null, { status: 204 });
            const result = addCORSHeaders(response, origin, config);

            const allowMethods = result.headers.get("Access-Control-Allow-Methods");
            const allowHeaders = result.headers.get("Access-Control-Allow-Headers");

            // Both headers must be present
            if (!allowMethods || !allowHeaders) return false;

            // All configured methods should be in the response
            const responseMethods = allowMethods.split(", ");
            const responseHeaders = allowHeaders.split(", ");

            return (
              methods.every((m) => responseMethods.includes(m)) &&
              headers.every((h) => responseHeaders.includes(h))
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property 3: 凭证支持一致性
     * 对于任意需要凭证的跨域请求，当 allowCredentials 配置为 true 时，
     * 响应应当包含 Access-Control-Allow-Credentials: true 头
     * Validates: Requirements 8.4
     */
    it("Property 3: should include credentials header when allowCredentials is true", () => {
      fc.assert(
        fc.property(fc.webUrl(), (origin) => {
          const config: CORSConfig = {
            allowedOrigins: [origin],
            allowedMethods: ["GET", "POST"],
            allowedHeaders: ["Content-Type"],
            allowCredentials: true,
            maxAge: 86400,
          };

          const response = new NextResponse(null, { status: 200 });
          const result = addCORSHeaders(response, origin, config);

          return result.headers.get("Access-Control-Allow-Credentials") === "true";
        }),
        { numRuns: 100 },
      );
    });

    it("Property 3: should not include credentials header when allowCredentials is false", () => {
      fc.assert(
        fc.property(fc.webUrl(), (origin) => {
          const config: CORSConfig = {
            allowedOrigins: [origin],
            allowedMethods: ["GET", "POST"],
            allowedHeaders: ["Content-Type"],
            allowCredentials: false,
            maxAge: 86400,
          };

          const response = new NextResponse(null, { status: 200 });
          const result = addCORSHeaders(response, origin, config);

          return result.headers.get("Access-Control-Allow-Credentials") === null;
        }),
        { numRuns: 100 },
      );
    });

    it("should set correct origin header for allowed origins", () => {
      const origin = "http://localhost:3001";
      const config: CORSConfig = {
        allowedOrigins: [origin],
        allowedMethods: ["GET", "POST"],
        allowedHeaders: ["Content-Type"],
        allowCredentials: true,
        maxAge: 86400,
      };

      const response = new NextResponse(null, { status: 200 });
      const result = addCORSHeaders(response, origin, config);

      expect(result.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    });

    it("should not set CORS headers for disallowed origins", () => {
      const config: CORSConfig = {
        allowedOrigins: ["http://allowed.com"],
        allowedMethods: ["GET"],
        allowedHeaders: ["Content-Type"],
        allowCredentials: true,
        maxAge: 86400,
      };

      const response = new NextResponse(null, { status: 200 });
      const result = addCORSHeaders(response, "http://disallowed.com", config);

      expect(result.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
