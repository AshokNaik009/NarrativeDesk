import { Event } from "../types.js";

// Cache previous stablecoin supplies to detect spikes
const stablecoinCache: Record<string, { supply: number; timestamp: number }> = {};

const STABLECOIN_SPIKE_THRESHOLD = 500_000_000; // $500M in 24h
const DEX_VOLUME_SPIKE_THRESHOLD = 5_000_000_000; // $5B daily

/**
 * Fetch current stablecoin supply from DefiLlama.
 * Returns events for supply increases > $500M (spike detection).
 */
export async function fetchStablecoinSupply(): Promise<Event[]> {
  const events: Event[] = [];

  try {
    const response = await fetch("https://stablecoins.llama.fi/stablecoins?includeLiquidations=false");

    if (!response.ok) {
      console.warn(`[DefiLlama Stablecoins] Failed: ${response.statusText}`);
      return events;
    }

    const data = (await response.json()) as any;
    const now = Date.now();

    // Extract stablecoin data from response
    if (data.stablecoins && Array.isArray(data.stablecoins)) {
      for (const coin of data.stablecoins) {
        const name = coin.name as string;
        const supply = coin.circulating_supply
          ? parseFloat(coin.circulating_supply)
          : coin.peggedUSD || 0;

        if (supply <= 0) continue;

        // Check if we have cached data for this coin
        const cached = stablecoinCache[name];
        let emitSignal = false;

        if (cached) {
          const delta = supply - cached.supply;
          // Spike = increase > $500M
          if (delta > STABLECOIN_SPIKE_THRESHOLD) {
            emitSignal = true;
            console.log(
              `[DefiLlama Stablecoins] Spike: ${name} +$${(delta / 1e9).toFixed(2)}B`
            );
          }
        }

        // Update cache
        stablecoinCache[name] = { supply, timestamp: now };

        if (emitSignal) {
          const event: Event = {
            type: "StablecoinMintSpike",
            source: "DefiLlama",
            symbol: name,
            headline: undefined,
            rawPayload: {
              asset: name,
              metric: supply,
              direction: "up",
              delta: supply - (cached?.supply || 0),
              timestamp: new Date(),
            },
          };

          events.push(event);
        }
      }
    }
  } catch (err) {
    console.error("[DefiLlama Stablecoins] Error:", err);
  }

  return events;
}

/**
 * Fetch DEX volume from DefiLlama.
 * Returns events for volume > $5B daily (spike detection).
 */
export async function fetchDexVolume(): Promise<Event[]> {
  const events: Event[] = [];

  const dexes = ["uniswap", "curve", "aave"];

  for (const dex of dexes) {
    try {
      const response = await fetch(
        `https://api.llama.fi/summary/dexs/${dex}?dataType=dailyVolume`
      );

      if (!response.ok) {
        console.warn(`[DefiLlama DEX] ${dex} failed: ${response.statusText}`);
        continue;
      }

      const data = (await response.json()) as any;

      if (data.totalDataChart && Array.isArray(data.totalDataChart)) {
        // Latest entry is most recent volume
        const latestEntry = data.totalDataChart[data.totalDataChart.length - 1];
        if (latestEntry) {
          const volume = latestEntry[1]; // [timestamp, volume]

          if (volume > DEX_VOLUME_SPIKE_THRESHOLD) {
            const event: Event = {
              type: "DexVolumeSpike",
              source: "DefiLlama",
              symbol: dex.toUpperCase(),
              headline: undefined,
              rawPayload: {
                asset: dex,
                metric: volume,
                direction: "up",
                timestamp: new Date(),
              },
            };

            events.push(event);
            console.log(
              `[DefiLlama DEX] Volume spike: ${dex} $${(volume / 1e9).toFixed(2)}B`
            );
          }
        }
      }
    } catch (err) {
      console.error(`[DefiLlama DEX] Error fetching ${dex}:`, err);
    }
  }

  return events;
}
