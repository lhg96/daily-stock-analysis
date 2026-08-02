import type React from 'react';
import { Activity } from 'lucide-react';
import { Badge, Card, EmptyState, Loading } from '../common';
import type { AlertTriggerItem } from '../../types/alerts';
import { formatDateTime } from '../../utils/format';
import { getMarketPhaseSummaryLabel } from '../../utils/marketPhase';

const statusLabel: Record<string, string> = {
  triggered: '트리거됨',
  skipped: '건너뜀',
  degraded: '성능 저하',
  failed: '실패',
};

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'triggered') return 'success';
  if (status === 'skipped' || status === 'degraded') return 'warning';
  if (status === 'failed') return 'danger';
  return 'default';
}

function formatNullable(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '--';
  return String(value);
}

function renderPhaseQuality(trigger: AlertTriggerItem): React.ReactNode {
  const phase = getMarketPhaseSummaryLabel(trigger.marketPhaseSummary, 'ko');
  const quality = trigger.analysisContextPackOverview?.dataQuality?.level;
  const limitations = trigger.analysisContextPackOverview?.dataQuality?.limitations?.slice(0, 2) ?? [];
  if (!phase && !quality && limitations.length === 0) {
    return <span className="text-xs text-muted-text">--</span>;
  }
  return (
    <div className="space-y-1">
      {phase ? <Badge variant="default">{phase.replace('시장 단계: ', '').replace('시장 단계: ', '')}</Badge> : null}
      {quality ? <div className="text-xs text-secondary-text">품질: {quality}</div> : null}
      {limitations.length ? (
        <div className="max-w-[180px] text-xs text-muted-text">{limitations.join('; ')}</div>
      ) : null}
    </div>
  );
}

interface AlertTriggerHistoryProps {
  triggers: AlertTriggerItem[];
  isLoading?: boolean;
}

export const AlertTriggerHistory: React.FC<AlertTriggerHistoryProps> = ({ triggers, isLoading = false }) => {
  return (
    <Card title="트리거 기록" subtitle="평가 기록" variant="bordered" padding="md">
      {isLoading ? <Loading label="트리거 기록을 불러오는 중" /> : null}
      {!isLoading && triggers.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="트리거 기록 없음"
          description="백그라운드 평가는 triggered, skipped, degraded, failed 상태를 기록합니다. 정상적으로 트리거되지 않은 경우에는 기록되지 않습니다."
        />
      ) : null}
      {!isLoading && triggers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-border/60 text-xs uppercase text-muted-text">
              <tr>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">단계 / 품질</th>
                <th className="px-3 py-2 font-medium">대상</th>
                <th className="px-3 py-2 font-medium">관측값</th>
                <th className="px-3 py-2 font-medium">임계값</th>
                <th className="px-3 py-2 font-medium">데이터 소스</th>
                <th className="px-3 py-2 font-medium">데이터 시간</th>
                <th className="px-3 py-2 font-medium">사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {triggers.map((trigger) => (
                <tr key={trigger.id} className="align-top">
                  <td className="px-3 py-3">
                    <Badge variant={statusVariant(trigger.status)}>
                      {statusLabel[trigger.status] ?? trigger.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">{renderPhaseQuality(trigger)}</td>
                  <td className="px-3 py-3 font-mono text-secondary-text">{trigger.target}</td>
                  <td className="px-3 py-3 text-secondary-text">{formatNullable(trigger.observedValue)}</td>
                  <td className="px-3 py-3 text-secondary-text">{formatNullable(trigger.threshold)}</td>
                  <td className="px-3 py-3 text-secondary-text">{formatNullable(trigger.dataSource)}</td>
                  <td className="px-3 py-3 text-xs text-secondary-text">
                    {formatDateTime(trigger.dataTimestamp ?? trigger.triggeredAt)}
                  </td>
                  <td className="px-3 py-3 text-secondary-text">
                    {trigger.reason || trigger.diagnostics || '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
};
