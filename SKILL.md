---
name: "stock_analyzer"
description: "주식과 시장을 분석합니다. 사용자가 단일/다중 종목 분석 또는 시장 리뷰를 요청할 때 호출합니다."
---

# 주식 분석기

본 스킬은 `src/services/analyzer_service.py`의 로직을 기반으로 주식 및 전체 시장 분석 기능을 제공합니다.

## 출력 구조 (`AnalysisResult`)

분석 함수는 풍부한 구조를 가진 `AnalysisResult` 객체(또는 그 리스트)를 반환합니다. 핵심 구성 요소와 실제 출력 예시는 다음과 같습니다:

`dashboard` 속성은 핵심 분석을 4개 섹션으로 나누어 포함합니다:
1. **`core_conclusion`**: 한 줄 요약, 신호 유형, 포지션 조언.
2. **`data_perspective`**: 기술 데이터 — 추세 상태, 가격 위치, 거래량 분석, 매집 구조.
3. **`intelligence`**: 정성 정보 — 뉴스, 리스크 경고, 긍정 촉매.
4. **`battle_plan`**: 실행 가능한 전략 — 매수/매도 목표가, 포지션 전략, 리스크 관리 체크리스트.

## 설정 (`Config`)

모든 분석 함수는 선택적으로 `config` 객체를 받을 수 있습니다. 이 객체는 API 키, 알림 설정, 분석 파라미터 등 애플리케이션의 모든 설정을 포함합니다.

`config` 객체를 제공하지 않으면, 함수는 자동으로 `.env` 파일에서 로드된 전역 싱글톤 인스턴스를 사용합니다.

**참조:** [`Config`](src/config.py)

## 함수

### 1. 단일 종목 분석

**설명:** 단일 종목을 분석하고 분석 결과를 반환합니다.

**사용 시점:** 사용자가 특정 종목 분석을 요청할 때.

**입력:**
- `stock_code` (str): 분석할 종목 코드.
- `config` (Config, 선택): 설정 객체. 기본값 `None`.
- `full_report` (bool, 선택): 전체 보고서 생성 여부. 기본값 `False`.
- `notifier` (NotificationService, 선택): 알림 서비스 객체. 기본값 `None`.

**출력:** `Optional[AnalysisResult]`
분석 결과를 담은 `AnalysisResult` 객체. 분석 실패 시 `None`.

**예시:**

```python
from src.services.analyzer_service import analyze_stock

# 단일 종목 분석
result = analyze_stock("000660")
if result:
    print(f"종목: {result.name} ({result.code})")
    print(f"심리 점수: {result.sentiment_score}")
    print(f"운영 조언: {result.operation_advice}")
```

**참조:** [`analyze_stock`](src/services/analyzer_service.py)

### 2. 다중 종목 분석

**설명:** 종목 리스트를 분석하고 결과 리스트를 반환합니다.

**사용 시점:** 사용자가 한 번에 여러 종목을 분석하려 할 때.

**입력:**
- `stock_codes` (List[str]): 분석할 종목 코드 리스트.
- `config` (Config, 선택): 설정 객체. 기본값 `None`.
- `full_report` (bool, 선택): 각 종목의 전체 보고서 생성 여부. 기본값 `False`.
- `notifier` (NotificationService, 선택): 알림 서비스 객체. 기본값 `None`.

**출력:** `List[AnalysisResult]`
`AnalysisResult` 객체 리스트.

**예시:**

```python
from src.services.analyzer_service import analyze_stocks

# 다중 종목 분석
results = analyze_stocks(["000660", "005930"])
for result in results:
    print(f"종목: {result.name}, 운영 조언: {result.operation_advice}")
```

**참조:** [`analyze_stocks`](src/services/analyzer_service.py)

### 3. 시장 리뷰 실행

**설명:** 전체 시장을 리뷰하고 보고서를 반환합니다.

**사용 시점:** 사용자가 시장 개요, 요약 또는 리뷰를 요청할 때.

**입력:**
- `config` (Config, 선택): 설정 객체. 기본값 `None`.
- `notifier` (NotificationService, 선택): 알림 서비스 객체. 기본값 `None`.

**출력:** `Optional[str]`
시장 리뷰 보고서 문자열. 실패 시 `None`.

**예시:**

```python
from src.services.analyzer_service import perform_market_review

# 시장 리뷰 실행
report = perform_market_review()
if report:
    print(report)
```

**참조:** [`perform_market_review`](src/services/analyzer_service.py)
