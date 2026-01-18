export interface FetchLogsQuery {
  startDate?: string;
  endDate?: string;
  action?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}
