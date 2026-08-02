import type {
  PortfolioCashDirection,
  PortfolioCorporateActionType,
  PortfolioFxRefreshResponse,
  PortfolioImportCommitResponse,
  PortfolioImportParseResponse,
  PortfolioPositionItem,
  PortfolioSide,
} from '../types/portfolio';
import { toDateInputValue } from './format';

export type FxRefreshFeedback = {
  tone: 'neutral' | 'success' | 'warning';
  text: string;
};

export type PortfolioAlertVariant = 'info' | 'success' | 'warning' | 'danger';

export function getTodayIso(): string {
  return toDateInputValue(new Date());
}

export function formatMoney(value: number | undefined | null, currency = 'CNY'): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${currency} ${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
}

export function formatSignedPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function hasPositionPrice(row: PortfolioPositionItem): boolean {
  return row.priceAvailable !== false && row.priceSource !== 'missing';
}

export function formatPositionPrice(row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return row.lastPrice.toFixed(4);
}

export function formatPositionMoney(value: number, row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '--';
  return formatMoney(value, row.valuationCurrency);
}

export function getPositionPriceLabel(row: PortfolioPositionItem): string {
  if (!hasPositionPrice(row)) return '가격 없음';
  if (row.priceSource === 'realtime_quote') {
    return row.priceProvider ? `실시간가 · ${row.priceProvider}` : '실시간가';
  }
  if (row.priceSource === 'history_close') {
    return row.priceStale && row.priceDate ? `종가 · ${row.priceDate}` : '종가';
  }
  return row.priceSource || '출처 불명';
}

export function formatSideLabel(value: PortfolioSide): string {
  return value === 'buy' ? '매수' : '매도';
}

export function formatCashDirectionLabel(value: PortfolioCashDirection): string {
  return value === 'in' ? '유입' : '유출';
}

export function formatCorporateActionLabel(value: PortfolioCorporateActionType): string {
  return value === 'cash_dividend' ? '현금 배당' : '분할·병합 조정';
}

export function formatBrokerLabel(value: string, displayName?: string): string {
  if (displayName && displayName.trim()) return `${value}(${displayName.trim()})`;
  if (value === 'huatai') return 'huatai(화타이)';
  if (value === 'citic') return 'citic(중신)';
  if (value === 'cmb') return 'cmb(초상)';
  return value;
}

export function buildFxRefreshFeedback(data: PortfolioFxRefreshResponse): FxRefreshFeedback {
  if (data.refreshEnabled === false) {
    return {
      tone: 'neutral',
      text: '환율 온라인 새로고침이 비활성화되었습니다.',
    };
  }

  if (data.pairCount === 0) {
    return {
      tone: 'neutral',
      text: '현재 범위에 새로고침할 환율 쌍이 없습니다.',
    };
  }

  if (data.updatedCount > 0 && data.staleCount === 0 && data.errorCount === 0) {
    return {
      tone: 'success',
      text: `환율이 새로고침되어 총 ${data.updatedCount}쌍이 업데이트되었습니다.`,
    };
  }

  const summary = `업데이트 ${data.updatedCount}쌍, 여전히 만료 ${data.staleCount}쌍, 실패 ${data.errorCount}쌍.`;
  if (data.staleCount > 0) {
    return {
      tone: 'warning',
      text: `새로고침을 시도했지만 일부 통화 쌍은 여전히 stale/fallback 환율을 사용 중입니다. ${summary}`,
    };
  }

  return {
    tone: 'warning',
    text: `온라인 새로고침이 완전히 성공하지 못했습니다. ${summary}`,
  };
}

export function getFxRefreshFeedbackVariant(tone: FxRefreshFeedback['tone']): PortfolioAlertVariant {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  return 'info';
}

export function getCsvParseVariant(result: PortfolioImportParseResponse): PortfolioAlertVariant {
  return result.errorCount > 0 || result.skippedCount > 0 ? 'warning' : 'info';
}

export function getCsvCommitVariant(result: PortfolioImportCommitResponse, isDryRun: boolean): PortfolioAlertVariant {
  if (isDryRun) return 'info';
  return result.failedCount > 0 || result.duplicateCount > 0 ? 'warning' : 'success';
}
