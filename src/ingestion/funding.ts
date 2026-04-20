import { config } from "../config.js";
import { Event } from "../types.js";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const SYMBOL_MAP: Record<string, string> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
};

interface BinanceFundingResponse {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

/**
 * Fetch current funding rates for BTC, ETH, SOL from Binance fapi endpoint.
 * Returns events only for symbols with fundingRate > 0.0001 (0.01% threshold).
 */
export async function fetchFundingRates(): Promise<Event[]> {
  const events: Event[] = [];

  for (const symbol of SYMBOLS) {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`
      );

      if (!response.ok) {
        console.warn(`[Funding] Failed to fetch ${symbol}: ${response.statusText}`);
        continue;
      }

      const data = (await response.json()) as BinanceFundingResponse[];

      if (!data || data.length === 0) {
        console.warn(`[Funding] No data for ${symbol}`);
        continue;
      }

      const fundingData = data[0];
      if (!fundingData) {
        console.warn(`[Funding] No funding data for ${symbol}`);
        continue;
      }

      const fundingRate = parseFloat(fundingData.fundingRate);

      // Only emit if funding rate exceeds threshold (0.01% = 0.0001)
      if (Math.abs(fundingRate) > 0.0001) {
        const cleanSymbol = SYMBOL_MAP[symbol] || symbol;

        const event: Event = {
          type: "FundingRateSpike",
          source: "Binance",
          symbol: cleanSymbol,
          headline: undefined,
          rawPayload: {
            symbol,
            fundingRate,
            fundingTime: fundingData.fundingTime,
            timestamp: new Date(),
          },
        };

        events.push(event);
        console.log(
          `[Funding] Signal: ${cleanSymbol} funding rate ${(fundingRate * 100).toFixed(4)}%`
        );
      }
    } catch (err) {
      console.error(`[Funding] Error fetching ${symbol}:`, err);
    }
  }

  return events;
}
