import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

export enum AuthHeaderType {
  Bearer = "bearer",
  OAuth = "oauth",
  Custom = "custom",
  None = "none",
}

export type HttpClientConfig = {
  baseURL: string;
  accessToken?: string;
  token?: string;
  headers?: Record<string, string>;
  timeout?: number;
  authType?: "bearer" | "oauth" | "custom" | "none";
  headerType?: AuthHeaderType;
  customAuthHeader?: string;
};

export type HttpResponse<T> = {
  data: T;
  headers: Record<string, unknown>;
  success: boolean;
  error?: string;
};

export class HttpClient {
  private readonly client: AxiosInstance;

  constructor(config: HttpClientConfig) {
    const {
      baseURL,
      accessToken,
      token,
      headers = {},
      timeout = 30000,
      authType,
      headerType,
      customAuthHeader,
    } = config;

    const finalToken = token || accessToken;
    const rawAuthType = headerType || authType || "bearer";

    const finalAuthType = String(rawAuthType);

    const authHeaders: Record<string, string> = {};

    if (finalToken && finalAuthType !== "none") {
      if (customAuthHeader) {
        authHeaders.Authorization = customAuthHeader;
      } else if (finalAuthType === "bearer") {
        authHeaders.Authorization = `Bearer ${finalToken}`;
      } else if (finalAuthType === "oauth") {
        authHeaders.Authorization = `OAuth ${finalToken}`;
      }
    }

    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...headers,
      },
      timeout,
    });
  }

  async get<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.client.get<T>(url, config);
      return {
        data: response.data,
        headers: response.headers as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          data: null as T,
          headers: error.response?.headers || {},
          success: false,
          error: error.response?.data?.message || error.message,
        };
      }
      throw error;
    }
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.client.post<T>(url, data, config);
      return {
        data: response.data,
        headers: response.headers as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Capture the full error response for debugging
        const errorDetails = error.response?.data
          ? typeof error.response.data === "string"
            ? error.response.data
            : JSON.stringify(error.response.data)
          : error.message;

        return {
          data: null as T,
          headers: error.response?.headers || {},
          success: false,
          error:
            error.response?.data?.message ||
            error.response?.data?.detail ||
            error.response?.data?.title ||
            errorDetails,
        };
      }
      throw error;
    }
  }

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.client.put<T>(url, data, config);
      return {
        data: response.data,
        headers: response.headers as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          data: null as T,
          headers: error.response?.headers || {},
          success: false,
          error: error.response?.data?.message || error.message,
        };
      }
      throw error;
    }
  }

  async delete<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.client.delete<T>(url, config);
      return {
        data: response.data,
        headers: response.headers as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          data: null as T,
          headers: error.response?.headers || {},
          success: false,
          error: error.response?.data?.message || error.message,
        };
      }
      throw error;
    }
  }

  async patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    try {
      const response = await this.client.patch<T>(url, data, config);
      return {
        data: response.data,
        headers: response.headers as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          data: null as T,
          headers: error.response?.headers || {},
          success: false,
          error: error.response?.data?.message || error.message,
        };
      }
      throw error;
    }
  }
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}
