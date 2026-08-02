import React from 'react';
import type { AnalysisResult, AnalysisReport } from '../../types/analysis';
import { ReportOverview } from './ReportOverview';
import { ReportStrategy } from './ReportStrategy';
import { ReportNews } from './ReportNews';
import { ReportDetails } from './ReportDetails';
import { ReportDiagnostics } from './ReportDiagnostics';
import { AnalysisContextSummary } from './AnalysisContextSummary';
import { MarketReviewReportView } from './MarketReviewReportView';
import { getReportText, normalizeReportLanguage } from '../../utils/reportLanguage';

interface ReportSummaryProps {
  data: AnalysisResult | AnalysisReport;
  isHistory?: boolean;
  /** 관심 종목 관련 */
  watchlist?: {
    isInWatchlist: (code: string) => boolean;
    onToggle: (code: string) => void;
    isActioning: boolean;
    actionMessage: string | null;
  };
  onOpenRunFlow?: (recordId: number) => void;
}

/**
 * 전체 리포트 표시 컴포넌트
 * 본문 내용 우선, 투명성 정보는 뒤쪽에 배치하여 리포트를 표시합니다.
 */
export const ReportSummary: React.FC<ReportSummaryProps> = ({
  data,
  isHistory = false,
  watchlist,
  onOpenRunFlow,
}) => {
  // AnalysisResult와 AnalysisReport 두 가지 데이터 형식을 모두 지원합니다
  const report: AnalysisReport = 'report' in data ? data.report : data;
  // report id를 사용합니다. queryId는 배치 분석 시 중복될 수 있고, 과거 리포트 상세 API는 연관 뉴스와 상세 데이터를 가져오기 위해 recordId가 필요하기 때문입니다.
  const recordId = report.meta.id;
  const diagnosticSummary = 'diagnosticSummary' in data ? data.diagnosticSummary : undefined;

  const { meta, summary, strategy, details } = report;
  const reportLanguage = normalizeReportLanguage(meta.reportLanguage);
  const text = getReportText(reportLanguage);
  const modelUsed = (meta.modelUsed || '').trim();
  const shouldShowModel = Boolean(
    modelUsed && !['unknown', 'error', 'none', 'null', 'n/a'].includes(modelUsed.toLowerCase()),
  );

  if (meta.reportType === 'market_review') {
    return (
      <MarketReviewReportView
        report={report}
        recordId={recordId}
        reportLanguage={reportLanguage}
        onOpenRunFlow={onOpenRunFlow}
      />
    );
  }

  return (
    <div className="space-y-5 pb-8 animate-fade-in">
      {/* 개요 영역(첫 화면) */}
      <ReportOverview
        meta={meta}
        summary={summary}
        details={details}
        isHistory={isHistory}
        watchlist={watchlist}
      />

      {/* 전략 포인트 영역 */}
      <ReportStrategy strategy={strategy} language={reportLanguage} />

      {/* 뉴스 영역 */}
      <ReportNews recordId={recordId} limit={8} language={reportLanguage} />

      {/* 입력 데이터 블록 저민감 요약 */}
      <AnalysisContextSummary
        overview={details?.analysisContextPackOverview}
        language={reportLanguage}
      />

      {/* 실행 진단 요약 */}
      <ReportDiagnostics
        recordId={recordId}
        summary={diagnosticSummary}
        language={reportLanguage}
        onOpenRunFlow={onOpenRunFlow}
      />

      {/* 투명성 및 추적 영역 */}
      <ReportDetails details={details} recordId={recordId} language={reportLanguage} />

      {/* 분석 모델 표시(Issue #528) — 리포트 끝 */}
      {shouldShowModel && (
        <p className="px-1 text-xs text-muted-text">
          {text.analysisModel}: {modelUsed}
        </p>
      )}
    </div>
  );
};
