import type { DecisionAction } from '../types/analysis';

export type DecisionActionTone = 'success' | 'warning' | 'danger' | 'default';
export type DecisionActionLabelMap = Record<DecisionAction, string>;
export type DecisionActionLabelTextKey =
  | 'history.actionBuy'
  | 'history.actionAdd'
  | 'history.actionHold'
  | 'history.actionReduce'
  | 'history.actionSell'
  | 'history.actionWatch'
  | 'history.actionAvoid'
  | 'history.actionAlert';
export type DecisionActionLabelTranslator = (key: DecisionActionLabelTextKey) => string;

export const DEFAULT_DECISION_ACTION_LABELS: DecisionActionLabelMap = {
  buy: '매수',
  add: '추가 매수',
  hold: '보유',
  reduce: '비중 축소',
  sell: '매도',
  watch: '관망',
  avoid: '회피',
  alert: '경보',
};

const resolveActionLabels = (labels?: Partial<DecisionActionLabelMap>): DecisionActionLabelMap => ({
  ...DEFAULT_DECISION_ACTION_LABELS,
  ...labels,
});

export const buildDecisionActionLabelMap = (
  t: DecisionActionLabelTranslator,
): DecisionActionLabelMap => ({
  buy: t('history.actionBuy'),
  add: t('history.actionAdd'),
  hold: t('history.actionHold'),
  reduce: t('history.actionReduce'),
  sell: t('history.actionSell'),
  watch: t('history.actionWatch'),
  avoid: t('history.actionAvoid'),
  alert: t('history.actionAlert'),
});

const toneForAction = (action: DecisionAction): DecisionActionTone => {
  if (action === 'buy' || action === 'add' || action === 'hold') return 'success';
  if (action === 'sell' || action === 'reduce') return 'danger';
  return 'warning';
};

const includesAny = (value: string, phrases: readonly string[]): boolean =>
  phrases.some((phrase) => value.includes(phrase));

const normalizeEnglishAdvice = (value: string): string =>
  value.toLowerCase().replace(/[_-]/g, ' ');

const maskEnglishFinancialCompounds = (value: string): string =>
  value
    .replace(/(^|[^a-z0-9_])buy\s*back(?=$|[^a-z0-9_])/g, '$1financialcompound')
    .replace(/(^|[^a-z0-9_])sell\s*off(?=$|[^a-z0-9_])/g, '$1financialcompound');

const matchesEnglishTerm = (value: string, terms: readonly string[]): boolean =>
  terms.some((term) => new RegExp(`(^|[^a-z0-9_])${term}(?=$|[^a-z0-9_])`).test(value));

const matchesEnglishNegatedAction = (value: string, terms: readonly string[]): boolean => {
  const negationPrefix = String.raw`(?:not\s+(?:a\s+|an\s+|to\s+)?|no\s+(?:need\s+to\s+)?|need\s+not\s+|cannot\s+|can't\s+|cant\s+|do\s+not\s+|don't\s+|dont\s+)`;
  return terms.some((term) =>
    new RegExp(`(^|[^a-z0-9_])${negationPrefix}${term}(?=$|[^a-z0-9_])`).test(value),
  );
};

const hasEnglishAvoidedHoldAction = (value: string): boolean => {
  const terms = String.raw`(?:adding|accumulating|selling|reducing|trimming)`;
  return new RegExp(`(^|[^a-z0-9_])avoid\\s+${terms}(?=$|[^a-z0-9_])`).test(value);
};

const hasEnglishDeferredAction = (value: string): boolean => {
  const terms = String.raw`(?:buy|add|accumulate|sell|reduce|trim)`;
  return (
    new RegExp(`(^|[^a-z0-9_])wait(?:ing)?\\s+to\\s+${terms}(?=$|[^a-z0-9_])`).test(value) ||
    new RegExp(`(^|[^a-z0-9_])waiting\\s+(?:for|until)\\b.*?${terms}(?=$|[^a-z0-9_])`).test(value)
  );
};

export const getLegacyDecisionActionLabel = (
  advice?: string | null,
  labels?: Partial<DecisionActionLabelMap>,
): string | null => {
  const action = getLegacyDecisionAction(advice);
  if (!action) return null;
  return resolveActionLabels(labels)[action];
};

export const getLegacyDecisionAction = (advice?: string | null): DecisionAction | null => {
  const normalized = advice?.trim();
  if (!normalized) return null;
  const lower = maskEnglishFinancialCompounds(normalizeEnglishAdvice(normalized));

  if (hasEnglishDeferredAction(lower)) {
    return null;
  }

  if (
    includesAny(normalized, [
      '당분간 매수 금지',
      '매수하지 마세요',
      '매수 부적합',
      '일단 매수 금지',
      '매수 불필요',
      '매수 불필요',
      '신규 매수 권장하지 않',
      '당분간 신규 매수 금지',
      '신규 매수하지 마세요',
      '신규 매수 부적합',
      '일단 신규 매수 금지',
      '신규 매수 불필요',
      '신규 매수 불필요',
      '포지션 구축 권장하지 않',
      '당분간 포지션 구축 금지',
      '포지션 구축하지 마세요',
      '포지션 구축 부적합',
      '일단 포지션 구축 금지',
      '포지션 구축 불필요',
      '포지션 구축 불필요',
    ]) ||
    matchesEnglishNegatedAction(lower, ['buy'])
  ) {
    return 'avoid';
  }
  if (
    includesAny(normalized, [
      '추가 매수 권장하지 않',
      '추가 매수 불필요',
      '추가 매수 불필요',
      '추가 매수하지 마세요',
      '추가 매수 부적합',
      '당분간 추가 매수 금지',
      '비중 확대 권장하지 않',
      '비중 확대 불필요',
      '비중 확대 불필요',
      '비중 확대하지 마세요',
      '비중 확대 부적합',
      '당분간 비중 확대 금지',
      '매도 권장하지 않',
      '매도 불필요',
      '매도 불필요',
      '매도하지 마세요',
      '매도 부적합',
      '당분간 매도 금지',
      '비중 축소 권장하지 않',
      '비중 축소 불필요',
      '비중 축소 불필요',
      '비중 축소하지 마세요',
      '비중 축소 부적합',
      '당분간 비중 축소 금지',
      '전량 매도 권장하지 않',
      '전량 매도 불필요',
      '전량 매도 불필요',
      '전량 매도하지 마세요',
      '전량 매도 부적합',
      '당분간 전량 매도 금지',
    ]) ||
    hasEnglishAvoidedHoldAction(lower) ||
    matchesEnglishNegatedAction(lower, ['add', 'accumulate', 'sell', 'reduce', 'trim'])
  ) {
    return 'hold';
  }
  const guardMatches = new Set<DecisionAction>();
  if (
    normalized.includes('매수 권장하지 않') ||
    normalized.includes('매수 회피') ||
    normalized.includes('회피') ||
    normalized.includes('회피') ||
    matchesEnglishTerm(lower, ['avoid'])
  ) {
    guardMatches.add('avoid');
  }
  if (
    normalized.includes('리스크 경고') ||
    normalized.includes('경보 발생') ||
    normalized.includes('경계') ||
    lower.includes('risk alert') ||
    matchesEnglishTerm(lower, ['alert'])
  ) {
    guardMatches.add('alert');
  }
  if (guardMatches.size === 1) {
    return Array.from(guardMatches)[0];
  }
  if (guardMatches.size > 1) {
    return null;
  }

  const matches = new Set<DecisionAction>();
  if (normalized.includes('추가 매수') || normalized.includes('비중 확대') || matchesEnglishTerm(lower, ['add', 'accumulate'])) {
    matches.add('add');
  }
  if (normalized.includes('비중 축소') || matchesEnglishTerm(lower, ['reduce', 'trim'])) {
    matches.add('reduce');
  }
  if (normalized.includes('강력 매도') || normalized.includes('매도') || normalized.includes('전량 매도') || matchesEnglishTerm(lower, ['sell'])) {
    matches.add('sell');
  }
  if (normalized.includes('보유') || normalized.includes('조정 관찰') || matchesEnglishTerm(lower, ['hold'])) {
    matches.add('hold');
  }
  if (normalized.includes('관망') || normalized.includes('대기') || matchesEnglishTerm(lower, ['watch', 'wait'])) {
    matches.add('watch');
  }
  if (normalized.includes('강력 매수') || normalized.includes('매수') || normalized.includes('포지션 구축') || normalized.includes('신규 매수') || matchesEnglishTerm(lower, ['buy'])) {
    matches.add('buy');
  }

  if (matches.size === 1) {
    return Array.from(matches)[0];
  }
  return null;
};

export const getDecisionActionLabel = (
  action?: DecisionAction | null,
  actionLabel?: string | null,
  legacyAdvice?: string | null,
  emptyLabel: string | null = '권고',
  labels?: Partial<DecisionActionLabelMap>,
): string | null => {
  const actionLabels = resolveActionLabels(labels);
  if (action) return actionLabels[action];
  const explicitLabel = actionLabel?.trim();
  if (explicitLabel) return explicitLabel;
  return getLegacyDecisionActionLabel(legacyAdvice, actionLabels) || emptyLabel;
};

export const getDecisionActionTone = (
  action?: DecisionAction | null,
  actionLabel?: string | null,
  legacyAdvice?: string | null,
): DecisionActionTone => {
  if (action) return toneForAction(action);

  const label = actionLabel?.trim() || '';
  if (label) {
    const lowerLabel = normalizeEnglishAdvice(label);
    if (label.includes('매수') || label.includes('보유')) return 'success';
    if (label.includes('매도') || label.includes('비중 축소')) return 'danger';
    if (label.includes('관망') || label.includes('대기') || label.includes('회피') || label.includes('경보')) {
      return 'warning';
    }
    if (matchesEnglishTerm(lowerLabel, ['buy', 'add', 'hold'])) return 'success';
    if (matchesEnglishTerm(lowerLabel, ['sell', 'reduce', 'trim'])) return 'danger';
    if (matchesEnglishTerm(lowerLabel, ['watch', 'wait', 'avoid', 'alert'])) return 'warning';
    return 'default';
  }

  const legacyAction = getLegacyDecisionAction(legacyAdvice);
  if (legacyAction) return toneForAction(legacyAction);

  return 'default';
};
