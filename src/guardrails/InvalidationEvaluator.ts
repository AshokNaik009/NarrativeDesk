export interface MarketState {
  prices: Record<string, number>; // coin -> current price
  timestamp: Date;
}

export interface InvalidationResult {
  triggered: boolean;
  reason: string;
}

export function evaluateInvalidation(
  invalidationTrigger: string,
  entryPrice: number,
  coin: string,
  marketState: MarketState
): InvalidationResult {
  const currentPrice = marketState.prices[coin.toUpperCase()];

  if (currentPrice === undefined) {
    return { triggered: false, reason: `no market data available for ${coin}` };
  }

  const trigger = invalidationTrigger.toLowerCase().trim();

  // Check for price-based invalidation: "price drops below X" or "price falls below X"
  const dropBelowMatch = trigger.match(/(?:drops?|falls?|goes?)\s+below\s+\$?([\d,.]+)/);
  if (dropBelowMatch) {
    const threshold = parseFloat(dropBelowMatch[1]!.replace(",", ""));
    if (currentPrice < threshold) {
      return { triggered: true, reason: `price ${currentPrice} dropped below ${threshold}` };
    }
    return { triggered: false, reason: `price ${currentPrice} still above ${threshold}` };
  }

  // Check for "price rises above X" or "price goes above X"
  const riseAboveMatch = trigger.match(/(?:rises?|goes?|moves?)\s+above\s+\$?([\d,.]+)/);
  if (riseAboveMatch) {
    const threshold = parseFloat(riseAboveMatch[1]!.replace(",", ""));
    if (currentPrice > threshold) {
      return { triggered: true, reason: `price ${currentPrice} rose above ${threshold}` };
    }
    return { triggered: false, reason: `price ${currentPrice} still below ${threshold}` };
  }

  // Check for percentage-based: "drops more than X%"
  const pctDropMatch = trigger.match(/(?:drops?|falls?|loses?)\s+(?:more\s+than\s+)?([\d.]+)%/);
  if (pctDropMatch) {
    const pctThreshold = parseFloat(pctDropMatch[1]!);
    const pctChange = ((entryPrice - currentPrice) / entryPrice) * 100;
    if (pctChange > pctThreshold) {
      return { triggered: true, reason: `price dropped ${pctChange.toFixed(1)}%, threshold was ${pctThreshold}%` };
    }
    return { triggered: false, reason: `price change ${pctChange.toFixed(1)}%, threshold ${pctThreshold}% not reached` };
  }

  // Compound invalidation with OR
  if (trigger.includes(" or ")) {
    const parts = trigger.split(/\s+or\s+/);
    for (const part of parts) {
      const subResult = evaluateInvalidation(part.trim(), entryPrice, coin, marketState);
      if (subResult.triggered) {
        return subResult;
      }
    }
    return { triggered: false, reason: "no compound conditions triggered" };
  }

  // Hard 5% stop-loss (always checked)
  const lossPct = ((entryPrice - currentPrice) / entryPrice) * 100;
  if (lossPct >= 5) {
    return { triggered: true, reason: `hard stop-loss: price dropped ${lossPct.toFixed(1)}% from entry` };
  }

  return { triggered: false, reason: `unrecognized invalidation pattern, no trigger conditions met` };
}
