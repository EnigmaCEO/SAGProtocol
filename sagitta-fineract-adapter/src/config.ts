import "dotenv/config";

export interface FineractConfig {
  baseUrl: string;
  healthUrl: string;
  tenantId: string;
  username: string;
  password: string;
  sslInsecure: boolean;
}

const DEFAULT_BASE_URL = "https://localhost:8443/fineract-provider/api/v1";

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBoolean(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }

  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }

  throw new Error(`${name} must be either true or false.`);
}

export function loadConfig(): FineractConfig {
  const baseUrl = readString("FINERACT_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, "");
  const parsedBaseUrl = new URL(baseUrl);
  const sslInsecure = readBoolean("FINERACT_SSL_INSECURE");

  if (sslInsecure && !["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)) {
    throw new Error("FINERACT_SSL_INSECURE=true is allowed only for a local Fineract URL.");
  }

  if (!parsedBaseUrl.pathname.endsWith("/api/v1")) {
    throw new Error("FINERACT_BASE_URL must end with /api/v1.");
  }

  const healthPath = parsedBaseUrl.pathname.replace(/\/api\/v1$/, "/actuator/health");
  const healthUrl = new URL(healthPath, parsedBaseUrl.origin).toString();

  return {
    baseUrl,
    healthUrl,
    tenantId: readString("FINERACT_TENANT_ID", "default"),
    username: readString("FINERACT_USERNAME", "mifos"),
    password: readString("FINERACT_PASSWORD", "password"),
    sslInsecure,
  };
}
