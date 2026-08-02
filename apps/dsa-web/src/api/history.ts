import apiClient from './index';
import { toCamelCase } from './utils';
import type {
  HistoryListResponse,
  HistoryItem,
  HistoryFilters,
  AnalysisReport,
  NewsIntelResponse,
  NewsIntelItem,
  RunDiagnosticSummary,
  StockBarResponse,
} from '../types/analysis';
import type { RunFlowSnapshot } from '../types/runFlow';

// ============ API 인터페이스 ============

export interface GetHistoryListParams extends HistoryFilters {
  page?: number;
  limit?: number;
}

export const historyApi = {
  /**
   * 히스토리 분석 목록 가져오기
   * @param params 필터 및 페이지네이션 매개변수
   */
  getList: async (params: GetHistoryListParams = {}): Promise<HistoryListResponse> => {
    const { stockCode, reportType, startDate, endDate, page = 1, limit = 20 } = params;

    const queryParams: Record<string, string | number> = { page, limit };
    if (stockCode) queryParams.stock_code = stockCode;
    if (reportType) queryParams.report_type = reportType;
    if (startDate) queryParams.start_date = startDate;
    if (endDate) queryParams.end_date = endDate;

    const response = await apiClient.get<Record<string, unknown>>('/api/v1/history', {
      params: queryParams,
    });

    const data = toCamelCase<{ total: number; page: number; limit: number; items: HistoryItem[] }>(response.data);
    return {
      total: data.total,
      page: data.page,
      limit: data.limit,
      items: data.items.map(item => toCamelCase<HistoryItem>(item)),
    };
  },

  /**
   * 히스토리 리포트 상세 가져오기
   * @param recordId 분석 히스토리 레코드 기본 키 ID (query_id는 일괄 분석 시 중복될 수 있으므로 ID를 사용)
   */
  getDetail: async (recordId: number): Promise<AnalysisReport> => {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/history/${recordId}`);
    return toCamelCase<AnalysisReport>(response.data);
  },

  /**
   * 히스토리 리포트 관련 뉴스 가져오기
   * @param recordId 분석 히스토리 레코드 기본 키 ID
   * @param limit 반환 수량 제한
   */
  getNews: async (recordId: number, limit = 20): Promise<NewsIntelResponse> => {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/history/${recordId}/news`, {
      params: { limit },
    });

    const data = toCamelCase<NewsIntelResponse>(response.data);
    return {
      total: data.total,
      items: (data.items || []).map(item => toCamelCase<NewsIntelItem>(item)),
    };
  },

  /**
   * 히스토리 리포트의 Markdown 형식 내용 가져오기
   * @param recordId 분석 히스토리 레코드 기본 키 ID
   * @returns Markdown 형식의 전체 리포트 내용
   */
  getMarkdown: async (recordId: number): Promise<string> => {
    const response = await apiClient.get<{ content: string }>(`/api/v1/history/${recordId}/markdown`);
    return response.data.content;
  },

  /**
   * 히스토리 리포트 실행 진단 요약 가져오기
   * @param recordId 분석 히스토리 레코드 기본 키 ID
   */
  getDiagnostics: async (recordId: number): Promise<RunDiagnosticSummary> => {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/history/${recordId}/diagnostics`);
    return toCamelCase<RunDiagnosticSummary>(response.data);
  },

  /**
   * 히스토리 리포트 실행 흐름 스냅샷 가져오기
   * @param recordId 분석 히스토리 레코드 기본 키 ID
   */
  getRecordFlow: async (recordId: number): Promise<RunFlowSnapshot> => {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/history/${recordId}/flow`);
    return toCamelCase<RunFlowSnapshot>(response.data);
  },

  /**
   * 히스토리 레코드 일괄 삭제
   * @param recordIds 분석 히스토리 레코드 기본 키 ID 목록
   */
  deleteRecords: async (recordIds: number[]): Promise<{ deleted: number }> => {
    const response = await apiClient.delete<Record<string, unknown>>('/api/v1/history', {
      data: { record_ids: recordIds },
    });

    return toCamelCase<{ deleted: number }>(response.data);
  },

  /**
   * 주식 코드로 모든 히스토리 레코드 삭제
   * @param stockCode 주식 코드
   */
  deleteByCode: async (stockCode: string): Promise<{ deleted: number }> => {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/history/by-code/${encodeURIComponent(stockCode)}`);
    return toCamelCase<{ deleted: number }>(response.data);
  },

  /**
   * 개별 종목 바 목록 가져오기 (중복 종목 없음, 시장 리뷰 제외)
   */
  getStockBarList: async (params: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}): Promise<StockBarResponse> => {
    const queryParams: Record<string, string | number> = {};
    if (params.startDate) queryParams.start_date = params.startDate;
    if (params.endDate) queryParams.end_date = params.endDate;
    if (params.limit) queryParams.limit = params.limit;

    const response = await apiClient.get<Record<string, unknown>>('/api/v1/history/stocks', {
      params: queryParams,
    });

    const data = toCamelCase<{ total: number; items: unknown[] }>(response.data);
    return {
      total: data.total,
      items: data.items.map(item => toCamelCase<Record<string, unknown>>(item) as unknown as typeof data.items[0]),
    } as StockBarResponse;
  },
};
