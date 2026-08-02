import type React from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bookmark,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Droplet,
  Factory,
  Flame,
  Gem,
  Landmark,
  Pickaxe,
  Plane,
  Play,
  PlusCircle,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Stethoscope,
  Trees,
  Utensils,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  screeningApi,
  type ScreeningCandidate,
  type ScreeningHotspotDetail,
  type ScreeningHotspot,
  type ScreeningHotspotsResponse,
  type ScreeningScreenResponse,
  type ScreeningScreenTaskStatus,
  type ScreeningStrategy,
} from '../api/screening';
import { formatParsedApiError, getParsedApiError, toApiErrorMessage, type ParsedApiError } from '../api/error';
import { AppPage, Button, InlineAlert } from '../components/common';

const MARKETS = [{ id: 'cn', label: 'A주' }];
const SCREEN_TASK_STORAGE_KEY = 'dsa.screening.activeScreenTask.v1';
const SCREEN_TASK_POLL_INTERVAL_MS = 2000;

type PersistedScreenTask = {
  taskId: string;
  market: string;
  strategy: string;
  maxResults: number;
};

const readPersistedScreenTask = (): PersistedScreenTask | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(SCREEN_TASK_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedScreenTask>;
    if (typeof parsed.taskId !== 'string' || !parsed.taskId.trim()) {
      return null;
    }
    const restoredMaxResults = Number(parsed.maxResults);
    return {
      taskId: parsed.taskId,
      market: typeof parsed.market === 'string' && parsed.market.trim() ? parsed.market : 'cn',
      strategy: typeof parsed.strategy === 'string' && parsed.strategy.trim() ? parsed.strategy : 'dual_low',
      maxResults: Number.isFinite(restoredMaxResults) ? Math.min(100, Math.max(1, restoredMaxResults)) : 3,
    };
  } catch {
    return null;
  }
};

const persistScreenTask = (task: PersistedScreenTask) => {
  try {
    window.sessionStorage.setItem(SCREEN_TASK_STORAGE_KEY, JSON.stringify(task));
  } catch {
    // Session storage is best-effort; polling still works while the page stays mounted.
  }
};

const clearPersistedScreenTask = () => {
  try {
    window.sessionStorage.removeItem(SCREEN_TASK_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};

const isUnrecoverableScreenTaskError = (error: ParsedApiError) =>
  error.title === '选股任务不可恢复';

const formatRecoverableScreenTaskPollingError = (error: ParsedApiError) => {
  if (error.category === 'upstream_timeout') {
    return '선별 작업이 아직 백그라운드에서 실행 중입니다. 상태 폴링이 일시적으로 시간 초과되어 자동으로 재시도합니다.';
  }
  if (error.category === 'upstream_network' || error.category === 'local_connection_failed') {
    return '선별 작업이 아직 백그라운드에서 실행 중입니다. 로컬 서비스에 연결해 상태를 가져올 수 없어 자동으로 재시도합니다.';
  }
  return formatParsedApiError(error) || '잠시 선별 작업 상태를 가져올 수 없습니다. 잠시 후 자동으로 재시도합니다.';
};

const formatScore = (score: ScreeningCandidate['score']) => {
  if (score == null || Number.isNaN(Number(score))) {
    return '-';
  }
  return Number(score).toFixed(2);
};

const formatNumber = (value: unknown, digits = 2) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return '-';
  }
  return Number(value).toFixed(digits);
};

const formatAmount = (value: unknown) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return '-';
  }
  const amount = Number(value);
  if (Math.abs(amount) >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(2)} 억`;
  }
  if (Math.abs(amount) >= 10_000) {
    return `${(amount / 10_000).toFixed(2)} 만`;
  }
  return amount.toFixed(2);
};

const formatPercent = (value: unknown) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return '-';
  }
  return `${(Number(value) * 100).toFixed(0)}%`;
};

const getCandidateReason = (item: ScreeningCandidate) => {
  if (item.reason) {
    return item.reason;
  }
  const summaries = item.postAnalysisSummaries || {};
  const summary = Object.values(summaries).find((value) => typeof value === 'string' && value.trim());
  if (typeof summary === 'string') {
    return summary;
  }
  return '내장 엔진이 후보를 반환했지만 텍스트 요약을 제공하지 않았습니다. 아래의 팩터, 리스크 및 원본 필드를 확인하세요.';
};

const getSignal = (item: ScreeningCandidate) => {
  const rawSignal = item.raw.action ?? item.raw.signal ?? item.raw.recommendation;
  return typeof rawSignal === 'string' && rawSignal.trim() ? rawSignal : '관찰';
};

const getFactorEntries = (item: ScreeningCandidate) =>
  Object.entries(item.factorScores || {})
    .filter(([, value]) => typeof value === 'number')
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6);

const toMessageList = (values: string[] | undefined) =>
  Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];

const KNOWN_SNAPSHOT_SOURCES = new Set(['tushare', 'efinance', 'akshare_em', 'em_datacenter', 'baostock']);
const MAX_MESSAGE_DETAIL_LENGTH = 96;

const truncateMessageDetail = (value: string, maxLength = MAX_MESSAGE_DETAIL_LENGTH) => {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
};

const summarizeScreeningDiagnostic = (detail: string) => {
  if (/trade_cal returned no open trading days/i.test(detail)) {
    return '거래일 달력에 사용 가능한 개장일이 없습니다';
  }
  if (/too many requests|rate limit|http\s*429/i.test(detail)) {
    return '요청이 너무 빈번합니다';
  }
  if (/403 forbidden|forbidden|access denied/i.test(detail)) {
    return '액세스가 거부되었습니다';
  }
  if (/timeout|timed out/i.test(detail)) {
    return '요청 시간 초과';
  }
  if (/RemoteDisconnected|Connection aborted|ProtocolError|ConnectionPool|Max retries exceeded|ProxyError|NameResolutionError/i.test(detail)) {
    return '네트워크 연결이 끊겼습니다';
  }
  if (/missing .*api key|GEMINI_API_KEY|GOOGLE_API_KEY|gemini_api_key/i.test(detail)) {
    return '사용 가능한 LLM API 키가 없습니다';
  }
  if (/returned no data|empty/i.test(detail)) {
    return '사용 가능한 데이터가 반환되지 않았습니다';
  }

  const withoutUrl = detail
    .replace(/https?:\/\/\S+/gi, 'URL')
    .replace(/\bwith url:\s*\S+/gi, 'with url: URL')
    .replace(/\burl:\s*\S+/gi, 'url: URL');
  return truncateMessageDetail(withoutUrl);
};

const parseSourceDiagnostic = (value: string) => {
  const match = value.match(/^([a-zA-Z0-9_-]+)\s*[:：]\s*(.+)$/);
  if (!match) {
    return null;
  }
  return {
    source: match[1],
    detail: match[2],
  };
};

const normalizeScreenMessageKey = (value: string) => {
  const formatted = formatScreenMessage(value);
  return formatted ? formatted.trim().toLowerCase() : value.trim().toLowerCase();
};

const formatScreenMessage = (value: string) => {
  if (/^DSA provider context applied \d+ of \d+ candidates/i.test(value)) {
    return '';
  }
  if (/^LLM ranking failed/i.test(value)) {
    return `LLM 재정렬 실패: ${summarizeScreeningDiagnostic(value)}, 로컬 팩터 점수로 대체되었습니다.`;
  }

  const snapshotFallback = value.match(/^Snapshot source fallback:\s*(.+)$/i);
  if (snapshotFallback) {
    const parsed = parseSourceDiagnostic(snapshotFallback[1]);
    if (parsed) {
      return `데이터 소스 저하: ${parsed.source}(${summarizeScreeningDiagnostic(parsed.detail)})`;
    }
    return `데이터 소스 저하: ${summarizeScreeningDiagnostic(snapshotFallback[1])}`;
  }

  const parsed = parseSourceDiagnostic(value);
  if (parsed && KNOWN_SNAPSHOT_SOURCES.has(parsed.source.toLowerCase())) {
    return `데이터 소스 저하: ${parsed.source}(${summarizeScreeningDiagnostic(parsed.detail)})`;
  }
  return truncateMessageDetail(value);
};

const getScreenMessages = (meta: ScreeningScreenResponse | null) => {
  if (!meta) {
    return [];
  }
  const messages: string[] = [];
  const seen = new Set<string>();
  [...toMessageList(meta.warnings), ...toMessageList(meta.sourceErrors), ...toMessageList(meta.llmParseErrors)].forEach(
    (value) => {
      const key = normalizeScreenMessageKey(value);
      if (seen.has(key)) {
        return;
      }
      const message = formatScreenMessage(value);
      if (!message) {
        return;
      }
      seen.add(key);
      messages.push(message);
    },
  );
  return messages;
};

const isRunningScreenTask = (status: string | undefined | null) => status === 'pending' || status === 'processing';

const formatScreenTaskFailure = (value: string | null | undefined) => {
  const text = String(value || '').trim();
  if (!text) {
    return '선별 작업에 실패했습니다. 잠시 후 다시 시도하세요.';
  }
  return `선별 작업 실패: ${summarizeScreeningDiagnostic(text)}`;
};

const SCREENING_HOTSPOT_NO_CACHE_HINT = 'No cached Screening hotspot snapshot. Click refresh to fetch live hotspots.';
const SCREENING_HOTSPOT_UNAVAILABLE_CODE = 'eastmoney_hotspot_unavailable';

const formatHotspotEmptyMessage = (result: ScreeningHotspotsResponse) => {
  const message = String(result.message || '').trim();
  const sourceErrors = result.sourceErrors || [];
  if (message && sourceErrors.includes(SCREENING_HOTSPOT_UNAVAILABLE_CODE)) {
    return message;
  }
  if (message === SCREENING_HOTSPOT_NO_CACHE_HINT) {
    return '캐시된 핫 테마가 없습니다. 펼친 후 새로고침을 클릭하면 실시간 데이터를 가져옵니다.';
  }
  const sourceError = sourceErrors[0];
  if (sourceError) {
    return `핫 테마 데이터가 아직 반환되지 않았습니다: ${summarizeScreeningDiagnostic(sourceError)}`;
  }
  return '핫 테마 데이터가 아직 반환되지 않았습니다';
};

const ScreenAlertMessage: React.FC<{ messages: string[] }> = ({ messages }) => {
  if (messages.length <= 1) {
    return <span>{messages[0]}</span>;
  }
  return (
    <ul className="list-disc space-y-1 pl-4">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
};

const hasLlmInsight = (item: ScreeningCandidate) =>
  Boolean(
    item.llmThesis ||
      item.llmSector ||
      item.llmTheme ||
      item.llmConfidence != null ||
      item.llmWatchItems?.length ||
      item.llmCatalysts?.length,
  );

const getRouteTimeLabel = (item: ScreeningHotspotDetail['route'][number]) => {
  const rawTime = item.publishedAt || item.date || item.time || '';
  if (!rawTime) {
    return item.source || '확인 대기';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawTime)) {
    return rawTime;
  }
  const parsed = new Date(rawTime);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return rawTime;
};

const getHotspotRouteItems = (detail: ScreeningHotspotDetail) => {
  const route = detail.route || [];
  if (route.length > 0) {
    return route;
  }
  return detail.timeline || [];
};

const formatHotspotMetric = (value: unknown, digits = 1) => {
  const formatted = formatNumber(value, digits);
  return formatted === '-' ? '관찰 중' : formatted;
};

const getHotspotLeadersText = (item: ScreeningHotspot) => {
  const leaders = (item.leaders || []).map((value) => String(value).trim()).filter(Boolean);
  if (leaders.length > 0) {
    return leaders.slice(0, 2).join('、');
  }
  return '관찰 중';
};

const getHotspotSampleText = (item: ScreeningHotspot) => {
  if (item.sampleStockCount == null || Number.isNaN(Number(item.sampleStockCount))) {
    return '활발한 종목 관찰 중';
  }
  return `${item.sampleStockCount}개 종목 포함`;
};

const formatStockChangeText = (value: unknown) => {
  const formatted = formatNumber(value);
  return formatted === '-' ? '시세 대기 중' : `${formatted}%`;
};

const formatHotspotUpdatedAt = (value: string | null) => {
  if (!value) {
    return '새로고침 대기';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const getHotspotStrength = (item: ScreeningHotspot, index: number) => {
  const heat = Number(item.heatScore ?? 0);
  const changePct = Number(item.changePct ?? 0);
  if (index === 0 || heat >= 90 || changePct >= 8) {
    return { label: '강세 선도', className: 'bg-red-500/10 text-red-500' };
  }
  if (heat >= 80 || changePct >= 5) {
    return { label: '강세', className: 'bg-blue-500/10 text-blue-500' };
  }
  return { label: '비교적 강세', className: 'bg-cyan/10 text-cyan' };
};

const HOTSPOT_ICON_RULES: Array<{
  pattern: RegExp;
  icon: React.ComponentType<{ className?: string }>;
  className: string;
}> = [
  { pattern: /金|银|铜|铝|铅|锌|钼|钴|镍|贵金属|矿|有色|금속|광물|제련|비철|귀금속/, icon: Pickaxe, className: 'bg-orange-500/10 text-orange-500' },
  { pattern: /黄金|珠宝|금|보석|주얼리/, icon: Gem, className: 'bg-amber-500/10 text-amber-500' },
  { pattern: /油|气|能源|煤|석유|가스|에너지|석탄|정유/, icon: Droplet, className: 'bg-yellow-700/10 text-yellow-700' },
  { pattern: /金融|券商|银行|保险|资本|금융|증권|은행|보험|자본/, icon: Landmark, className: 'bg-orange-500/10 text-orange-500' },
  { pattern: /航空|机场|航天|运输|항공|공항|우주|운송|물류/, icon: Plane, className: 'bg-blue-500/10 text-blue-500' },
  { pattern: /林业|农业|种植|임업|농업|재배|식품가공/, icon: Trees, className: 'bg-emerald-500/10 text-emerald-500' },
  { pattern: /医疗|诊断|卫生|医药|의료|진단|제약|바이오|헬스케어/, icon: Stethoscope, className: 'bg-teal-500/10 text-teal-500' },
  { pattern: /食品|餐饮|酒|식품|외식|음료|주류/, icon: Utensils, className: 'bg-violet-500/10 text-violet-500' },
  { pattern: /工业|制造|修理|机械|设备|산업|제조|기계|설비|장비/, icon: Wrench, className: 'bg-blue-500/10 text-blue-500' },
  { pattern: /租赁|地产|建筑|임대|부동산|건설|건축/, icon: Building2, className: 'bg-emerald-500/10 text-emerald-500' },
  { pattern: /电|芯片|算力|AI|机器人|전자|반도체|칩|로봇|인공지능|AI/, icon: Factory, className: 'bg-indigo-500/10 text-indigo-500' },
  { pattern: /保险|安全|보안|안전|보험/, icon: Shield, className: 'bg-blue-500/10 text-blue-500' },
];

const getHotspotIcon = (topic: string) => {
  const match = HOTSPOT_ICON_RULES.find((rule) => rule.pattern.test(topic));
  return match || { icon: Activity, className: 'bg-cyan/10 text-cyan' };
};

const MiniSparkline: React.FC<{ score?: number | null; selected?: boolean }> = ({ score, selected }) => {
  const normalizedScore = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Number(score))) : 65;
  const lift = Math.max(0, Math.min(16, normalizedScore / 7));
  const path = `M2 35 C12 ${32 - lift / 4}, 16 ${34 - lift / 2}, 24 ${28 - lift / 3} S38 ${29 - lift}, 46 ${23 - lift / 2} S62 ${24 - lift}, 72 ${16 - lift / 3} S86 ${15 - lift}, 94 ${7}`;
  return (
    <svg className="h-8 w-20" viewBox="0 0 96 40" aria-hidden="true">
      <path d={`${path} L94 40 L2 40 Z`} fill={selected ? 'rgba(249,115,22,0.14)' : 'rgba(59,130,246,0.12)'} />
      <path d={path} fill="none" stroke={selected ? '#f97316' : '#3b82f6'} strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
};

const StockScreeningPage: React.FC = () => {
  const navigate = useNavigate();
  const [restoredTask] = useState<PersistedScreenTask | null>(() => readPersistedScreenTask());
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [market, setMarket] = useState(restoredTask?.market || 'cn');
  const [strategy, setStrategy] = useState(restoredTask?.strategy || 'dual_low');
  const [strategies, setStrategies] = useState<ScreeningStrategy[]>([]);
  const [maxResults, setMaxResults] = useState(restoredTask?.maxResults || 3);
  const [candidates, setCandidates] = useState<ScreeningCandidate[]>([]);
  const [hotspots, setHotspots] = useState<ScreeningHotspot[]>([]);
  const [hotspotsUpdatedAt, setHotspotsUpdatedAt] = useState<string | null>(null);
  const [hotspotsExpanded, setHotspotsExpanded] = useState(false);
  const [selectedHotspotTopic, setSelectedHotspotTopic] = useState<string | null>(null);
  const selectedHotspotTopicRef = useRef<string | null>(null);
  const hotspotDetailRequestIdRef = useRef(0);
  const hotspotDetailsByTopicRef = useRef<Record<string, ScreeningHotspotDetail>>({});
  const [hotspotDetail, setHotspotDetail] = useState<ScreeningHotspotDetail | null>(null);
  const [loadingHotspotDetail, setLoadingHotspotDetail] = useState(false);
  const [hotspotDetailError, setHotspotDetailError] = useState('');
  const [loadingHotspots, setLoadingHotspots] = useState(false);
  const [hotspotError, setHotspotError] = useState('');
  const [screenMeta, setScreenMeta] = useState<ScreeningScreenResponse | null>(null);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(restoredTask?.taskId));
  const [enabling, setEnabling] = useState(false);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  const [error, setError] = useState('');
  const [strategyLoadError, setStrategyLoadError] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(restoredTask?.taskId ?? null);
  const [taskProgress, setTaskProgress] = useState(restoredTask?.taskId ? 10 : 0);
  const [taskMessage, setTaskMessage] = useState(restoredTask?.taskId ? '선별 작업 상태를 복원하는 중...' : '');

  const selectedStrategy = useMemo(() => strategies.find((item) => item.id === strategy), [strategies, strategy]);
  const selectedStrategyTitle = selectedStrategy?.name || selectedStrategy?.title || '사용자 정의 전략';
  const selectedStrategyTag = selectedStrategy?.category || selectedStrategy?.tag || selectedStrategy?.tags?.[0] || '사용자 정의';
  const displayedStrategy = selectedStrategy ? selectedStrategyTitle : `사용자 정의 전략 (${strategy})`;
  const screenMessages = useMemo(() => getScreenMessages(screenMeta), [screenMeta]);
  const llmDegraded = screenMeta?.llmRanked === false;
  const alertMessages = llmDegraded
    ? screenMessages.length > 0
      ? screenMessages
      : ['LLM 재정렬이 완료되지 않았거나 판단을 반환하지 않았습니다. 현재 후보는 내장 팩터 점수에서 나온 것입니다.']
    : screenMessages;
  const isScreeningEnabled = enabled && available;
  const statusText = isScreeningEnabled ? '선별 활성화됨' : '선별 비활성화됨';

  const applyScreenResult = useCallback((result: ScreeningScreenResponse) => {
    const nextCandidates = result.candidates || [];
    setScreenMeta(result);
    setCandidates(nextCandidates);
    setExpandedCode(nextCandidates[0]?.code ?? null);
  }, []);

  const clearScreeningResults = () => {
    setCandidates([]);
    setScreenMeta(null);
    setExpandedCode(null);
  };

  const loadHotspotDetail = useCallback(async (topic: string, options: { refresh?: boolean } = {}) => {
    if (!topic) {
      return;
    }
    const cachedDetail = !options.refresh ? hotspotDetailsByTopicRef.current[topic] : null;
    if (cachedDetail) {
      setHotspotDetail(cachedDetail);
      setHotspotDetailError('');
      setLoadingHotspotDetail(false);
      return;
    }
    const requestId = hotspotDetailRequestIdRef.current + 1;
    hotspotDetailRequestIdRef.current = requestId;
    const isCurrentRequest = () => hotspotDetailRequestIdRef.current === requestId;
    const canApplyRequest = () => isCurrentRequest() && selectedHotspotTopicRef.current === topic;
    setLoadingHotspotDetail(true);
    setHotspotDetail((currentDetail) => (currentDetail?.topic === topic ? currentDetail : null));
    setHotspotDetailError('');
    try {
      const detail = await screeningApi.getHotspotDetail({ topic, provider: 'akshare', refresh: options.refresh ?? false });
      if (!canApplyRequest()) {
        return;
      }
      hotspotDetailsByTopicRef.current = {
        ...hotspotDetailsByTopicRef.current,
        [topic]: detail,
      };
      setHotspotDetail(detail);
    } catch (err) {
      if (!canApplyRequest()) {
        return;
      }
      setHotspotDetail(null);
      setHotspotDetailError(toApiErrorMessage(err, '핫 테마 상세 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'));
    } finally {
      if (isCurrentRequest()) {
        setLoadingHotspotDetail(false);
      }
    }
  }, []);

  const loadStrategies = useCallback(async () => {
    setLoadingStrategies(true);
    try {
      setStrategyLoadError('');
      const result = await screeningApi.getStrategies();
      const loadedStrategies = result.strategies || [];
      setStrategies(loadedStrategies);
      if (loadedStrategies.length > 0) {
        setStrategy((currentStrategy) =>
          loadedStrategies.some((item) => item.id === currentStrategy) ? currentStrategy : loadedStrategies[0].id,
        );
      }
    } catch (err) {
      setStrategies([]);
      setStrategyLoadError(err instanceof Error ? err.message : '내장 전략 목록을 불러오지 못했습니다');
    } finally {
      setLoadingStrategies(false);
    }
  }, []);

  const loadHotspots = useCallback(async (refresh = false) => {
    setLoadingHotspots(true);
    setHotspotError('');
    try {
      const result = await screeningApi.getHotspots({ provider: 'akshare', top: 12, refresh });
      const nextHotspots = result.hotspots || [];
      const nextDetails = result.details || {};
      hotspotDetailsByTopicRef.current = {
        ...hotspotDetailsByTopicRef.current,
        ...nextDetails,
      };
      const currentTopic = selectedHotspotTopicRef.current;
      const retainedTopic = Boolean(currentTopic && nextHotspots.some((item) => item.topic === currentTopic));
      const nextTopic = retainedTopic ? currentTopic : null;
      setHotspots(nextHotspots);
      setHotspotsUpdatedAt(result.cachedAt || (nextHotspots.length > 0 ? new Date().toISOString() : null));
      setSelectedHotspotTopic(nextTopic);
      selectedHotspotTopicRef.current = nextTopic;
      if (nextTopic && nextDetails[nextTopic]) {
        setHotspotDetail(nextDetails[nextTopic]);
        setLoadingHotspotDetail(false);
      } else if (retainedTopic && refresh && nextTopic) {
        void loadHotspotDetail(nextTopic, { refresh: true });
      } else if (!retainedTopic) {
        setHotspotDetail(null);
      }
      setHotspotDetailError('');
      if (nextHotspots.length === 0) {
        setHotspotError(formatHotspotEmptyMessage(result));
      }
    } catch (err) {
      setHotspotError(toApiErrorMessage(err, '핫 테마를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'));
    } finally {
      setLoadingHotspots(false);
    }
  }, [loadHotspotDetail]);

  const handleHotspotSelect = useCallback((topic: string) => {
    selectedHotspotTopicRef.current = topic;
    setSelectedHotspotTopic(topic);
    const cachedDetail = hotspotDetailsByTopicRef.current[topic];
    if (cachedDetail) {
      setHotspotDetail(cachedDetail);
      setHotspotDetailError('');
      setLoadingHotspotDetail(false);
    } else {
      setHotspotDetail((currentDetail) => (currentDetail?.topic === topic ? currentDetail : null));
    }
  }, []);

  const toggleHotspotsExpanded = useCallback(() => {
    setHotspotsExpanded((expanded) => {
      const nextExpanded = !expanded;
      if (!nextExpanded) {
        selectedHotspotTopicRef.current = null;
        setSelectedHotspotTopic(null);
        setHotspotDetail(null);
        setHotspotDetailError('');
      }
      return nextExpanded;
    });
  }, []);

  const handleAnalyzeHotspotStock = useCallback((stock: ScreeningHotspotDetail['stocks'][number]) => {
    const stockCode = String(stock.code || '').trim();
    if (!stockCode) {
      return;
    }
    const stockName = String(stock.name || stockCode).trim();
    navigate('/', {
      state: {
        stockCode,
        stockName,
        autoAnalyze: true,
        selectionSource: 'screening_hotspot',
        skills: ['hot_theme'],
      },
    });
  }, [navigate]);

  const handleAnalyzeCandidate = useCallback((candidate: ScreeningCandidate) => {
    const stockCode = String(candidate.code || '').trim();
    if (!stockCode) {
      return;
    }
    const stockName = String(candidate.name || stockCode).trim();
    const analysisSkills = (selectedStrategy?.analysisSkills || []).filter(Boolean);
    navigate('/', {
      state: {
        stockCode,
        stockName,
        autoAnalyze: true,
        selectionSource: 'screening_result',
        ...(analysisSkills.length > 0 ? { skills: analysisSkills } : {}),
      },
    });
  }, [navigate, selectedStrategy]);

  useEffect(() => {
    selectedHotspotTopicRef.current = selectedHotspotTopic;
  }, [selectedHotspotTopic]);

  useEffect(() => {
    if (!selectedHotspotTopic) {
      return;
    }
    void loadHotspotDetail(selectedHotspotTopic);
  }, [loadHotspotDetail, selectedHotspotTopic]);

  useEffect(() => {
    let active = true;
    screeningApi
      .getStatus()
      .then((status) => {
        if (!active) {
          return;
        }
        setEnabled(status.enabled);
        setAvailable(status.available);
        if (status.enabled && status.available) {
          void loadStrategies();
          void loadHotspots(false);
        }
      })
      .catch(() => {
        if (active) {
          setEnabled(false);
          setAvailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadHotspots, loadStrategies]);

  useEffect(() => {
    if (!activeTaskId) {
      return undefined;
    }

    const pollingTaskId = activeTaskId;
    let active = true;
    let timer: ReturnType<typeof window.setTimeout> | undefined;

    function finishTask() {
      clearPersistedScreenTask();
      setActiveTaskId(null);
      setLoading(false);
    }

    function applyTaskStatus(task: ScreeningScreenTaskStatus) {
      const nextProgress = Number(task.progress ?? 0);
      setTaskProgress(Number.isFinite(nextProgress) ? nextProgress : 0);
      setTaskMessage(task.message || '');

      if (task.status === 'completed') {
        if (task.result) {
          applyScreenResult(task.result);
          setError('');
        } else {
          setError('선별 작업이 완료되었지만 서버가 후보 결과를 반환하지 않았습니다.');
          setCandidates([]);
          setScreenMeta(null);
        }
        finishTask();
        return;
      }

      if (task.status === 'failed') {
        setCandidates([]);
        setScreenMeta(null);
        setExpandedCode(null);
        setError(formatScreenTaskFailure(task.error || task.message));
        finishTask();
        return;
      }

      if (isRunningScreenTask(task.status)) {
        setLoading(true);
        timer = window.setTimeout(pollTask, SCREEN_TASK_POLL_INTERVAL_MS);
        return;
      }

      setError(`선별 작업이 알 수 없는 상태를 반환했습니다: ${task.status || 'unknown'}`);
      finishTask();
    }

    async function pollTask() {
      try {
        const task = await screeningApi.getScreenTask(pollingTaskId);
        if (!active) {
          return;
        }
        applyTaskStatus(task);
      } catch (err) {
        if (!active) {
          return;
        }
        const parsedError = getParsedApiError(err);
        if (isUnrecoverableScreenTaskError(parsedError)) {
          setError(formatParsedApiError(parsedError) || '선별 작업을 복구할 수 없습니다. 다시 제출하세요.');
          setCandidates([]);
          setScreenMeta(null);
          finishTask();
          return;
        }
        setError(formatRecoverableScreenTaskPollingError(parsedError));
        setLoading(true);
        timer = window.setTimeout(pollTask, SCREEN_TASK_POLL_INTERVAL_MS);
      }
    }

    void pollTask();

    return () => {
      active = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [activeTaskId, applyScreenResult]);

  const handleEnable = async () => {
    setEnabling(true);
    setError('');
    try {
      await screeningApi.enable();
      setEnabled(true);
      setAvailable(true);
      await loadStrategies();
    } catch (err) {
      try {
        const status = await screeningApi.getStatus();
        setEnabled(status.enabled);
        setAvailable(status.available);
      } catch {
        setEnabled(false);
        setAvailable(false);
      }
      setError(err instanceof Error ? err.message : '내장 종목 선별 활성화 실패');
    } finally {
      setEnabling(false);
    }
  };

  const handleStrategyChange = (nextStrategy: string) => {
    if (nextStrategy !== strategy) {
      clearScreeningResults();
    }
    setStrategy(nextStrategy);
  };

  const handleMarketChange = (nextMarket: string) => {
    if (nextMarket !== market) {
      clearScreeningResults();
    }
    setMarket(nextMarket);
  };

  const handleMaxResultsChange = (nextMaxResults: number) => {
    if (nextMaxResults !== maxResults) {
      clearScreeningResults();
    }
    setMaxResults(nextMaxResults);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setScreenMeta(null);
    setTaskProgress(0);
    setTaskMessage('선별 작업을 제출하는 중...');
    try {
      const task = await screeningApi.startScreen({ market, strategy, maxResults });
      persistScreenTask({
        taskId: task.taskId,
        market,
        strategy,
        maxResults,
      });
      setActiveTaskId(task.taskId);
      setTaskProgress(0);
      setTaskMessage(task.message || '선별 작업이 제출되었습니다');
    } catch (err) {
      setCandidates([]);
      setLoading(false);
      setError(toApiErrorMessage(err, '선별 작업 제출에 실패했습니다. 잠시 후 다시 시도하세요.'));
    }
  };

  return (
    <AppPage className="max-w-6xl space-y-6 pb-12 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-cyan text-cyan shadow-[0_0_24px_hsl(var(--primary)/0.18)]">
            <PlusCircle className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-foreground">내장 종목 선별</h1>
            <p className="mt-1 text-sm text-secondary-text">DSA 내장 엔진이 후보 종목을 생성하고 시세와 뉴스를 보강합니다. AlphaSift 참조 구현</p>
          </div>
        </div>

        <div className="inline-flex w-fit items-center gap-2 rounded-2xl border border-border/70 bg-card/80 px-4 py-2 text-sm shadow-soft-card">
          <span className={`h-2.5 w-2.5 rounded-full ${isScreeningEnabled ? 'bg-success' : 'bg-warning'}`} />
          <span className="font-medium text-secondary-text">{statusText}</span>
        </div>
      </div>

      {!enabled ? (
        <InlineAlert
          variant="info"
          title="내장 종목 선별이 비활성화됨"
          message="클릭하면 SCREENING_ENABLED가 활성화되고 내장 전략 선별 진입점이 열립니다."
          action={
            <Button size="sm" isLoading={enabling} loadingText="활성화 중..." onClick={() => void handleEnable()}>
              선별 활성화
            </Button>
          }
        />
      ) : null}

      {enabled && !available ? (
        <InlineAlert
          variant="warning"
          title="내장 종목 선별 엔진을 사용할 수 없음"
          message="백엔드 로그, 전략 파일, 기초 데이터 의존성을 확인한 후 서비스를 재시작하세요."
        />
      ) : null}

      <InlineAlert
        variant="warning"
        title="실험 기능 및 위험 안내"
        message="내장 종목 선별은 아직 실험 단계입니다. 결과는 연구 및 판단 보조 용도로만 사용되며 투자 조언을 구성하지 않습니다. 시장에는 위험이 있으며, 거래 결정과 손익은 사용자가 직접 부담합니다."
      />

      {loading ? (
        <InlineAlert
          variant="info"
          title="선별 작업 실행 중"
          message={`${taskMessage || '종목 선별을 실행하는 중'}. 작업 ID: ${activeTaskId ? activeTaskId.slice(0, 12) : '-'}`}
        />
      ) : null}

      {error ? <InlineAlert variant="danger" title="호출 실패" message={error} /> : null}

      <section className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-soft-card">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-500/10 text-orange-500 shadow-[0_10px_30px_rgba(249,115,22,0.16)]">
              <Flame className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold tracking-normal text-foreground">핫 테마</h2>
              <p className="mt-1 text-xs leading-5 text-secondary-text">
                capital_heat, balanced_alpha 등의 전략은 핫 테마의 theme_heat를 점수에 반영합니다.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!isScreeningEnabled}
                onClick={toggleHotspotsExpanded}
              >
                <Bookmark className="h-4 w-4" />
                {hotspotsExpanded ? '핫 테마 접기' : `핫 테마 펼치기${hotspots.length ? `(${hotspots.length})` : ''}`}
                <ChevronDown className={`h-4 w-4 transition-transform ${hotspotsExpanded ? 'rotate-180' : ''}`} />
              </Button>
              {hotspotsExpanded ? (
              <Button
                size="sm"
                variant="secondary"
                isLoading={loadingHotspots}
                loadingText="새로고침 중..."
                disabled={!isScreeningEnabled || loadingHotspots}
                onClick={() => void loadHotspots(true)}
              >
                <RefreshCw className="h-4 w-4" />
                핫 테마 새로고침
              </Button>
              ) : null}
            </div>
            <p className="text-xs text-secondary-text">업데이트 시간: {formatHotspotUpdatedAt(hotspotsUpdatedAt)}</p>
          </div>
        </div>

        {hotspotError ? (
          <p className="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {hotspotError}
          </p>
        ) : null}

        {!hotspotsExpanded ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-surface/70 px-4 py-3 text-sm text-secondary-text sm:flex-row sm:items-center sm:justify-between">
            <span>
              {hotspots.length > 0
                ? `핫 테마 ${hotspots.length}개가 캐시되어 있습니다. 펼치면 열기, 단계, 발효 경로를 확인할 수 있습니다.`
                : '핫 테마는 기본적으로 접혀 있습니다. 펼치면 캐시를 읽을 수 있고, 새로고침을 클릭해야 실시간 데이터를 가져옵니다.'}
            </span>
            <span className="text-xs">실시간 상세 정보는 특정 테마를 선택한 후 로드됩니다</span>
          </div>
        ) : hotspots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/70 px-4 py-6 text-sm text-secondary-text">
            새로고침을 클릭하면 핫 테마/업종 순위, 열기 점수, 수명주기 단계, 활발한 선두주를 가져옵니다.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {hotspots.map((item, index) => {
              const selected = selectedHotspotTopic === item.topic;
              const strength = getHotspotStrength(item, index);
              const iconMeta = getHotspotIcon(item.name || item.topic);
              const Icon = iconMeta.icon;
              return (
              <button
                key={`${item.topic}-${item.rank ?? ''}`}
                className={`group relative min-h-[116px] overflow-hidden rounded-xl border px-3 py-3 text-left transition-all ${
                  selected
                    ? 'border-orange-400 bg-gradient-to-br from-orange-500/10 via-card to-card shadow-[0_0_0_1px_rgba(249,115,22,0.16),0_18px_44px_rgba(249,115,22,0.14)]'
                    : 'border-border/80 bg-card hover:-translate-y-0.5 hover:border-orange-300/70 hover:shadow-soft-card'
                }`}
                type="button"
                onClick={() => handleHotspotSelect(item.topic)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                        index < 3 ? 'bg-orange-500 text-white shadow-[0_8px_24px_rgba(249,115,22,0.24)]' : 'bg-surface text-secondary-text'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${iconMeta.className}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{item.name || item.topic}</p>
                      <span className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${strength.className}`}>
                        {strength.label}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-2xl font-black leading-none text-orange-500">
                    {formatNumber(item.heatScore, 0)}
                  </span>
                </div>
                <div className="mt-4 grid max-w-[72%] gap-1 text-[11px] text-secondary-text">
                  <span>등락률 <strong className="font-semibold text-foreground">{formatHotspotMetric(item.changePct)}%</strong></span>
                  <span>추세 <strong className="font-semibold text-foreground">{formatHotspotMetric(item.trendScore)}</strong> · 지속성 <strong className="font-semibold text-foreground">{formatHotspotMetric(item.persistenceScore)}</strong></span>
                  <span>{getHotspotSampleText(item)} · 선두주 {getHotspotLeadersText(item)}</span>
                </div>
                <div className="absolute bottom-3 right-3 opacity-95 transition-transform group-hover:scale-105">
                  <MiniSparkline score={item.heatScore} selected={selected} />
                </div>
              </button>
              );
            })}
          </div>
        )}

        {hotspotsExpanded && selectedHotspotTopic ? (
          <div className="mt-4 rounded-xl border border-border/80 bg-surface/80 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {hotspotDetail?.name || selectedHotspotTopic}
                </h3>
                <p className="mt-1 text-xs leading-5 text-secondary-text">
                  {loadingHotspotDetail ? '발효 경로와 테마주를 읽는 중...' : hotspotDetail?.summary || '테마를 클릭하면 발효 경로와 테마주를 확인할 수 있습니다.'}
                </p>
                {hotspotDetail?.canonicalTopic && hotspotDetail.canonicalTopic !== selectedHotspotTopic ? (
                  <p className="mt-1 text-[11px] text-secondary-text">표준 테마: {hotspotDetail.canonicalTopic}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hotspotDetail?.qualityStatus ? (
                  <span className="w-fit rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                    품질 {hotspotDetail.qualityStatus}
                  </span>
                ) : null}
                {hotspotDetail?.fallbackUsed || hotspotDetail?.stale ? (
                  <span className="w-fit rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                    {hotspotDetail.staleAgeHours != null ? `캐시 대체 ${formatNumber(hotspotDetail.staleAgeHours, 1)}h` : '캐시 대체'}
                  </span>
                ) : null}
                {hotspotDetail?.stockCount != null ? (
                  <span className="w-fit rounded-full bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-500">
                    테마주 {hotspotDetail.stockCount}
                  </span>
                ) : null}
              </div>
            </div>

            {hotspotDetailError ? (
              <p className="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {hotspotDetailError}
              </p>
            ) : null}

            {hotspotDetail && ((hotspotDetail.missingFields || []).length > 0 || (hotspotDetail.sourceErrors || []).length > 0) ? (
              <details className="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <summary className="cursor-pointer font-semibold">상세 데이터가 저하되었습니다. 펼쳐서 원인을 확인하세요</summary>
                <div className="mt-2 space-y-1 leading-5">
                  {(hotspotDetail.missingFields || []).length > 0 ? (
                    <p>누락된 필드: {(hotspotDetail.missingFields || []).join('、')}</p>
                  ) : null}
                  {(hotspotDetail.sourceErrors || []).slice(0, 4).map((message, index) => (
                    <p key={`${message}-${index}`}>{message}</p>
                  ))}
                </div>
              </details>
            ) : null}

            {hotspotDetail ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
                <div>
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-secondary-text">
                    <Clock3 className="h-3.5 w-3.5 text-orange-500" />
                    발효 타임라인
                  </p>
                  <div className="relative space-y-0 pl-4 before:absolute before:bottom-3 before:left-[5px] before:top-2 before:w-px before:bg-border">
                    {getHotspotRouteItems(hotspotDetail).map((item, index) => (
                      <div key={`${item.title}-${index}`} className="relative pb-4 last:pb-0">
                        <span className="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full border border-orange-400 bg-card" />
                        <div className="rounded-lg border border-border/70 bg-card/80 p-3">
                          <p className="text-[11px] font-semibold text-orange-500">{getRouteTimeLabel(item)}</p>
                          <p className="mt-1 text-xs font-semibold text-foreground">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-secondary-text">{item.description}</p>
                          {item.source ? <p className="mt-2 text-[11px] text-secondary-text">출처 {item.source}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-secondary-text">테마주</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(hotspotDetail.stocks || []).slice(0, 10).map((stock) => (
                      <div key={`${stock.code || stock.name}`} className="rounded-lg border border-border/70 bg-card/80 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-foreground">{stock.name || stock.code || '-'}</p>
                            <p className="mt-1 text-[11px] text-secondary-text">{stock.code || '-'}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded-full bg-cyan/10 px-2 py-1 text-[11px] font-semibold text-cyan">
                              {stock.role || '테마주'}
                            </span>
                            {stock.code ? (
                              <button
                                type="button"
                                aria-label={`분석 ${stock.name || stock.code}`}
                                className="inline-flex h-7 items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-2 text-[11px] font-semibold text-cyan transition-colors hover:border-cyan hover:bg-cyan/15 hover:text-foreground"
                                onClick={() => handleAnalyzeHotspotStock(stock)}
                              >
                                <Play className="h-3 w-3" />
                                분석
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-secondary-text">
                          등락률 {formatStockChangeText(stock.changePct)} · 열기 {formatNumber(stock.hotStockScore, 0)}
                        </p>
                        {stock.source || stock.sourceConfidence != null || stock.fallbackUsed ? (
                          <p className="mt-1 text-[11px] text-secondary-text">
                            출처 {stock.source || '-'}
                            {stock.sourceConfidence != null ? ` · 신뢰 ${formatPercent(stock.sourceConfidence)}` : ''}
                            {stock.fallbackUsed ? ' · 대체' : ''}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-cyan/35 bg-card/95 p-4 shadow-soft-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">전략 선택</h2>
            <p className="mt-1 text-xs text-secondary-text">DSA는 내장 전략 후보에 시세, 펀더멘털, 뉴스 컨텍스트를 보강합니다.</p>
          </div>
          <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-semibold text-cyan">
            {selectedStrategyTag}
          </span>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {loadingStrategies ? (
            <div className="rounded-xl border border-dashed border-border bg-surface/70 p-4 text-sm text-secondary-text">
              사용 가능한 전략을 읽는 중...
            </div>
          ) : strategies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface/70 p-4 text-sm text-secondary-text">
              {strategyLoadError || '내장 전략 목록을 아직 불러오지 못했습니다. 아래에서 전략 매개변수를 직접 입력할 수 있습니다.'}
            </div>
          ) : (
            strategies.map((item) => {
              const selected = item.id === strategy;
              return (
                <button
                  key={item.id}
                  className={`min-h-28 rounded-xl border p-4 text-left transition-all ${
                    selected
                      ? 'border-cyan bg-cyan/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.15),0_16px_36px_hsl(var(--primary)/0.12)]'
                      : 'border-border/80 bg-surface/70 hover:border-cyan/45 hover:bg-hover/70'
                  }`}
                  type="button"
                  disabled={loading}
                  onClick={() => handleStrategyChange(item.id)}
                >
                  <span className="text-base font-semibold text-foreground">{item.name || item.title || item.id}</span>
                  <span className="mt-2 block text-sm leading-6 text-secondary-text">{item.description || item.id}</span>
                  <span className="mt-3 inline-flex text-xs font-semibold text-cyan">
                    {item.category || item.tag || item.tags?.[0] || item.id}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-soft-card">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-cyan" />
          매개변수 설정
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_180px_auto] lg:items-end">
          <label className="space-y-2 text-xs font-medium text-secondary-text">
            시장
            <select
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-cyan"
              value={market}
              disabled={loading}
              onChange={(event) => handleMarketChange(event.target.value)}
            >
              {MARKETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-xs font-medium text-secondary-text">
            전략 매개변수
            <input
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-cyan"
              value={strategy}
              disabled={loading}
              onChange={(event) => handleStrategyChange(event.target.value)}
            />
          </label>

          <label className="space-y-2 text-xs font-medium text-secondary-text">
            반환 수량
            <input
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-cyan"
              type="number"
              min={1}
              max={100}
              value={maxResults}
              disabled={loading}
              onChange={(event) => handleMaxResultsChange(Number(event.target.value))}
            />
          </label>

          <Button
            className="h-11 min-w-40"
            isLoading={loading}
            loadingText="선별 중..."
            disabled={!isScreeningEnabled || loading}
            onClick={() => void handleSubmit()}
          >
            <Play className="h-4 w-4" />
            선별 실행
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-soft-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`grid h-7 w-7 place-items-center rounded-full ${
                candidates.length > 0 ? 'text-success' : isScreeningEnabled ? 'text-cyan' : 'text-warning'
              }`}
            >
              {candidates.length > 0 ? <CheckCircle2 className="h-5 w-5" /> : <CircleAlert className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {loading ? '선별 실행 중' : candidates.length > 0 ? '선별 완료' : isScreeningEnabled ? '실행 대기' : '활성화 대기'}
              </h2>
              <p className="mt-1 text-xs text-secondary-text">
                {loading
                  ? `${taskMessage || '종목 선별을 실행하는 중'} · ${taskProgress}%`
                  : `현재 전략: ${displayedStrategy} · ${MARKETS.find((item) => item.id === market)?.label}`}
              </p>
            </div>
          </div>
          <div className="grid gap-1 text-xs text-secondary-text sm:text-right">
            <span>작업: {activeTaskId ? activeTaskId.slice(0, 12) : '-'}</span>
            <span>Run ID：{screenMeta?.runId || '-'}</span>
            <span>
              스냅샷 {screenMeta?.snapshotCount ?? '-'} · 필터링 후 {screenMeta?.afterFilterCount ?? '-'} · 후보 {screenMeta?.candidateCount ?? candidates.length}
            </span>
            <span>
              LLM: {screenMeta?.llmRanked ? '재정렬됨' : screenMeta ? '재정렬 안 됨' : '-'}
              {screenMeta?.llmCoverage != null ? ` · 커버리지 ${formatPercent(screenMeta.llmCoverage)}` : ''}
            </span>
            <span>
              DSA 보강: {screenMeta?.dsaEnrichment?.enrichedCount ?? '-'} / {screenMeta?.dsaEnrichment?.requestedCount ?? '-'}
            </span>
          </div>
        </div>
      </section>

      {screenMeta && alertMessages.length > 0 ? (
        <InlineAlert
          variant={llmDegraded ? 'warning' : 'info'}
          title={llmDegraded ? 'LLM 저하됨' : '선별 안내'}
          message={<ScreenAlertMessage messages={alertMessages} />}
        />
      ) : null}

      <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-soft-card">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">선별 결과</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">
              내장 엔진이 후보를 반환하면 DSA가 상위 종목에 시세, 펀더멘털, 뉴스, 보조 요약을 보강합니다.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-secondary-text">
            <Search className="h-4 w-4 text-cyan" />
            {candidates.length} 개 후보
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/70 px-5 py-10 text-center">
            <p className="text-sm font-medium text-foreground">결과 없음</p>
            <p className="mt-2 text-sm text-secondary-text">내장 종목 선별을 활성화한 후 “선별 실행”을 클릭하면 후보 목록이 생성됩니다.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="bg-surface text-left text-xs text-secondary-text">
                <tr>
                  <th className="w-14 px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">코드</th>
                  <th className="px-4 py-3 font-semibold">이름</th>
                  <th className="px-4 py-3 font-semibold">업종</th>
                  <th className="px-4 py-3 font-semibold">가격</th>
                  <th className="px-4 py-3 font-semibold">등락률</th>
                  <th className="px-4 py-3 font-semibold">점수</th>
                  <th className="px-4 py-3 font-semibold">LLM</th>
                  <th className="px-4 py-3 font-semibold">리스크</th>
                  <th className="px-4 py-3 font-semibold">상세</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((item) => {
                  const expanded = expandedCode === item.code;
                  const factors = getFactorEntries(item);
                  const llmInsightAvailable = hasLlmInsight(item);
                  const llmFallbackText =
                    llmDegraded && !llmInsightAvailable
                      ? '이번 LLM 재정렬이 실패했거나 판단을 반환하지 않았습니다. 현재 표시되는 것은 로컬 팩터 점수 결과입니다.'
                      : 'LLM 판단 없음';
                  const dsaWarnings = item.dsaContext?.warnings || [];
                  const dsaNews = item.dsaNews || [];
                  const dsaEvents = item.dsaEvents || [];
                  return (
                    <Fragment key={`${item.rank}-${item.code}`}>
                      <tr className="border-t border-border align-top transition-colors hover:bg-hover/50">
                        <td className="px-4 py-3 text-secondary-text">{item.rank}</td>
                        <td className="px-4 py-3 font-mono font-semibold text-foreground">{item.code}</td>
                        <td className="px-4 py-3 font-semibold text-foreground">{item.name || '-'}</td>
                        <td className="px-4 py-3 text-secondary-text">{item.industry || '-'}</td>
                        <td className="px-4 py-3 text-secondary-text">{formatNumber(item.price)}</td>
                        <td className="px-4 py-3 text-secondary-text">{formatNumber(item.changePct)}%</td>
                        <td className="px-4 py-3 font-bold text-cyan">{formatScore(item.score)}</td>
                        <td className="px-4 py-3 text-secondary-text">{llmDegraded ? '재정렬 안 됨' : formatScore(item.llmScore)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-lg bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                            {item.riskLevel || 'unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            className="text-sm font-semibold text-cyan transition-colors hover:text-foreground"
                            type="button"
                            onClick={() => setExpandedCode(expanded ? null : item.code)}
                          >
                            {expanded ? '접기' : '펼쳐서 보기'}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-border bg-surface/45">
                          <td colSpan={10} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                              <div className="space-y-3">
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">요약</p>
                                  <p className="mt-1 text-sm leading-6 text-foreground">{getCandidateReason(item)}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">매매 신호</p>
                                  <p className="mt-1 text-sm text-foreground">{getSignal(item)}</p>
                                  <button
                                    className="mt-2 rounded-lg border border-cyan/40 px-3 py-1.5 text-xs font-semibold text-cyan transition-colors hover:bg-cyan/10"
                                    type="button"
                                    onClick={() => handleAnalyzeCandidate(item)}
                                  >
                                    DSA로 심층 분석
                                  </button>
                                </div>
                                {item.dsaAnalysisSummary ? (
                                  <div>
                                    <p className="text-xs font-semibold text-secondary-text">DSA 보강 요약</p>
                                    <p className="mt-1 text-sm leading-6 text-foreground">{item.dsaAnalysisSummary}</p>
                                  </div>
                                ) : null}
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">LLM 판단</p>
                                  <p className="mt-1 text-sm leading-6 text-foreground">
                                    {item.llmThesis || llmFallbackText}
                                  </p>
                                  {llmInsightAvailable ? (
                                    <p className="mt-1 text-xs text-secondary-text">
                                      섹터 {item.llmSector || '-'} · 테마 {item.llmTheme || '-'} · 신뢰도 {formatPercent(item.llmConfidence)}
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-xs text-secondary-text">LLM 메타데이터가 반환되지 않았습니다</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">리스크 라벨</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {[...(item.riskFlags || []), ...(item.llmRisks || [])].length
                                      ? [...(item.riskFlags || []), ...(item.llmRisks || [])].join('，')
                                      : '없음'}
                                  </p>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">주요 팩터</p>
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    {factors.length > 0 ? (
                                      factors.map(([key, value]) => (
                                        <div key={key} className="rounded-lg border border-border bg-card px-3 py-2">
                                          <span className="block text-xs text-secondary-text">{key}</span>
                                          <span className="text-sm font-semibold text-foreground">{formatNumber(value)}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <span className="text-sm text-secondary-text">팩터 상세 없음</span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">거래대금</p>
                                  <p className="mt-1 text-sm text-foreground">{formatAmount(item.amount)}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">LLM 관심 항목</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {item.llmWatchItems?.length ? item.llmWatchItems.join('，') : llmDegraded ? '반환되지 않음(LLM 저하됨)' : '없음'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">촉매 요인</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {item.llmCatalysts?.length ? item.llmCatalysts.join('，') : llmDegraded ? '반환되지 않음(LLM 저하됨)' : '없음'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">DSA 뉴스</p>
                                  {dsaNews.length > 0 ? (
                                    <ul className="mt-1 space-y-1 text-sm text-foreground">
                                      {dsaNews.slice(0, 3).map((newsItem, newsIndex) => (
                                        <li key={`${item.code}-dsa-news-${newsIndex}`}>
                                          {newsItem.title || newsItem.snippet || '-'}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="mt-1 text-sm text-secondary-text">없음</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-secondary-text">DSA 공시 및 이벤트</p>
                                  {dsaEvents.length > 0 ? (
                                    <ul className="mt-1 space-y-1 text-sm text-foreground">
                                      {dsaEvents.slice(0, 3).map((eventItem, eventIndex) => (
                                        <li key={`${item.code}-dsa-event-${eventIndex}`}>
                                          {eventItem.title || eventItem.snippet || '-'}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="mt-1 text-sm text-secondary-text">없음</p>
                                  )}
                                </div>
                                {dsaWarnings.length > 0 ? (
                                  <div>
                                    <p className="text-xs font-semibold text-secondary-text">DSA 보강 안내</p>
                                    <p className="mt-1 text-sm text-secondary-text">{dsaWarnings.join('，')}</p>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppPage>
  );
};

export default StockScreeningPage;
