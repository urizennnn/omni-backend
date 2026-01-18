import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

export type HttpClientConfig = {
  baseURL: string;
  accessToken?: string;
  headers?: Record<string, string>;
  timeout?: number;
  authType?: "bearer" | "oauth" | "custom" | "none";
  customAuthHeader?: string;
};

export class HttpClient {
  private readonly client: AxiosInstance;

  constructor(config: HttpClientConfig) {
    const {
      baseURL,
      accessToken,
      headers = {},
      timeout = 30000,
      authType = "bearer",
      customAuthHeader,
    } = config;

    const authHeaders: Record<string, string> = {};

    if (accessToken && authType !== "none") {
      if (customAuthHeader) {
        authHeaders.Authorization = customAuthHeader;
      } else if (authType === "bearer") {
        authHeaders.Authorization = `Bearer ${accessToken}`;
      } else if (authType === "oauth") {
        authHeaders.Authorization = `OAuth ${accessToken}`;
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

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  async patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }
}
