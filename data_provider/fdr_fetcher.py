# -*- coding: utf-8 -*-
"""
FinanceDataReader 데이터 소스 — 한국/미국 주식, 환율, 지수

KR 포크 (2026-08-02): yfinance의 불안정성 대체용.
- 한국 주식: 005930 / 000660.KS (자동 변환)
- 미국 주식: AAPL 등
- 지수: KS11(KOSPI), KQ11(KOSDAQ), S&P500 등
- 환율: USD/KRW

문서: https://github.com/FinanceData/FinanceDataReader
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pandas as pd

from data_provider.base import (
    BaseFetcher,
    DataFetchError,
    STANDARD_COLUMNS,
    summarize_exception,
    _is_kr_market,
    _is_us_market,
)

logger = logging.getLogger(__name__)

try:
    import FinanceDataReader as fdr
except ImportError:  # pragma: no cover - optional dependency
    fdr = None


def _normalize_fdr_code(stock_code: str) -> str:
    """종목 코드를 FinanceDataReader 형식으로 변환.

    - 005930.KS / 005930.KQ / 005930 → 005930 (한국)
    - AAPL / AAPL.US → AAPL (미국)
    - 나머지는 그대로
    """
    code = str(stock_code or "").strip().upper()
    if "." in code:
        base, suffix = code.rsplit(".", 1)
        if suffix in ("KS", "KQ"):
            return base
        if suffix == "US":
            return base
    return code


class FinanceDataReaderFetcher(BaseFetcher):
    """
    FinanceDataReader 기반 데이터 소스 (한국/미국 안정적)
    """

    name = "FinanceDataReaderFetcher"
    priority = int(os.getenv("FDR_PRIORITY", "0"))  # 최우선

    def __init__(self):
        super().__init__()
        if fdr is None:
            logger.warning("[FDR] FinanceDataReader 미설치 — pip install finance-datareader")

    # ── 추상 메서드 구현 ──
    def _fetch_raw_data(self, stock_code: str, start_date: str, end_date: str) -> pd.DataFrame:
        """FinanceDataReader로 원시 데이터 조회 (Open/High/Low/Close/Volume/Change)."""
        if fdr is None:
            raise DataFetchError("FinanceDataReader 미설치")

        code = _normalize_fdr_code(stock_code)
        try:
            df = fdr.DataReader(code, start_date, end_date)
        except Exception as exc:  # noqa: BLE001
            raise DataFetchError(f"[{self.name}] {stock_code} 조회 실패: {exc}") from exc

        if df is None or df.empty:
            raise DataFetchError(f"FinanceDataReader 데이터 없음: {stock_code}")

        # 인덱스(날짜)를 컬럼으로
        df = df.reset_index()
        return df

    def _normalize_data(self, df: pd.DataFrame, stock_code: str) -> pd.DataFrame:
        """표준 컬럼(date/open/high/low/close/volume/amount/pct_chg)으로 변환."""
        df = df.copy()

        # FDR 컬럼: Open/High/Low/Close/Volume/Change (인덱스는 Date)
        column_mapping = {
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
        df = df.rename(columns=column_mapping)

        if "date" not in df.columns and len(df.columns):
            index_col = df.columns[0]
            df = df.rename(columns={index_col: "date"})

        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], errors="coerce")

        # Change 컬럼이 있으면 pct_chg로 사용 (FDR이 직접 제공)
        if "Change" in df.columns:
            df["pct_chg"] = df["Change"] * 100
        elif "close" in df.columns:
            df["pct_chg"] = df["close"].pct_change() * 100
        if "pct_chg" in df.columns:
            df["pct_chg"] = df["pct_chg"].fillna(0).round(2)

        # 거래대금 (없으면 추정)
        if "amount" not in df.columns:
            if "volume" in df.columns and "close" in df.columns:
                df["amount"] = df["volume"] * df["close"]
            else:
                df["amount"] = 0

        df["code"] = stock_code

        keep_cols = ["code"] + STANDARD_COLUMNS
        existing_cols = [col for col in keep_cols if col in df.columns]
        df = df[existing_cols]
        return df

    # ── 실시간 시세 (BaseFetcher의 기본 구현 오버라이드) ──
    def get_realtime_quote(self, stock_code: str) -> Optional[Any]:
        """FinanceDataReader 최근 종가 기반 실시간 시세 (시가/고가/저가 포함)."""
        if fdr is None:
            return None

        code = _normalize_fdr_code(stock_code)
        try:
            # 최근 5영업일 조회 (실시간이 아닌 마지막 종가 기반 — FDR 특성)
            end = datetime.now().strftime("%Y-%m-%d")
            start = (datetime.now() - timedelta(days=10)).strftime("%Y-%m-%d")
            df = fdr.DataReader(code, start, end)
            if df is None or df.empty:
                logger.warning("[FDR] %s 실시간 시세 데이터 없음", stock_code)
                return None

            last = df.iloc[-1]
            prev_close = df["Close"].iloc[-2] if len(df) >= 2 else last["Close"]

            from data_provider.realtime_types import UnifiedRealtimeQuote

            change = float(last["Close"]) - float(prev_close)
            change_pct = (change / float(prev_close)) * 100 if prev_close else 0.0

            quote = UnifiedRealtimeQuote(
                code=stock_code,
                name="",
                source="fdr",
                fetched_at=datetime.now().isoformat(),
                market="kr" if _is_kr_market(stock_code) else ("us" if _is_us_market(stock_code) else "global"),
                currency="KRW" if _is_kr_market(stock_code) else "USD",
                data_quality="partial",
                price=float(last["Close"]),
                change_pct=round(change_pct, 2),
                change_amount=round(change, 2),
                open_price=float(last.get("Open", 0) or 0),
                high=float(last.get("High", 0) or 0),
                low=float(last.get("Low", 0) or 0),
                pre_close=float(prev_close),
                volume=int(last.get("Volume", 0) or 0),
                missing_fields=["amount", "pe_ratio", "pb_ratio"],
            )
            return quote
        except Exception as exc:  # noqa: BLE001
            error_type, error_reason = summarize_exception(exc)
            logger.warning("[FDR] %s 실시간 시세 조회 실패: %s (%s)", stock_code, error_reason, error_type)
            return None

    def is_available(self) -> bool:
        return fdr is not None
