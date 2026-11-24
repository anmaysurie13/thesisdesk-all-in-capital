/**
 * OpenRouter list prices (USD per token), read from https://openrouter.ai/api/v1/models on 24 Nov 2026.
 * Used ONLY when the provider response carries no cost; such rows are labelled costSource="estimate".
 */
export const PRICES: Record<string, { in: number; out: number }> = {
  "google/gemini-3.8-flash": { in: 0.000000825, out: 0.000004125 },
  "google/gemini-3.6-flash": { in: 0.00000075, out: 0.00000375 },
  "google/gemini-3.5-flash-lite": { in: 0.0000003, out: 0.0000025 },
  "google/gemini-3.1-flash-lite": { in: 0.00000025, out: 0.0000015 },
};
export const PRICES_CHECKED_AT = "2026-11-24";

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES[model];
  return p ? inputTokens * p.in + outputTokens * p.out : null;
}

/** INR conversion for display only; set FX in settings, never used for caps (caps are USD). */
export const USD_INR_DISPLAY = 84;
