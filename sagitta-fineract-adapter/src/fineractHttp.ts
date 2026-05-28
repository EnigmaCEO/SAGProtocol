import { Agent, fetch, type Dispatcher, type RequestInit } from "undici";
import { loadConfig, type FineractConfig } from "./config.js";

export interface JsonRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

export class FineractHttpClient {
  readonly config: FineractConfig;
  private readonly dispatcher?: Dispatcher;

  constructor(config: FineractConfig = loadConfig()) {
    this.config = config;
    this.dispatcher = config.sslInsecure
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
  }

  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint);
  }

  post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", body });
  }

  requestAbsolute<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
    return this.send<T>(url, options);
  }

  request<T>(endpoint: string, options: JsonRequestOptions = {}): Promise<T> {
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return this.send<T>(`${this.config.baseUrl}${path}`, options);
  }

  private async send<T>(url: string, options: JsonRequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const headers = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Fineract-Platform-TenantId": this.config.tenantId,
    };
    const init: RequestInit = {
      method,
      headers,
      dispatcher: this.dispatcher,
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fineract request failed: ${method} ${url}: ${message}`);
    }

    const responseBody = await response.text();
    if (!response.ok) {
      const body = responseBody || "<empty response body>";
      throw new Error(
        `Fineract request failed: ${method} ${url} -> ${response.status} ${response.statusText}\n${body}`,
      );
    }

    if (!responseBody) {
      return undefined as T;
    }

    try {
      return JSON.parse(responseBody) as T;
    } catch {
      throw new Error(`Fineract returned non-JSON content for ${method} ${url}: ${responseBody}`);
    }
  }
}
