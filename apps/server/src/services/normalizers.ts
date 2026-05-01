import { FUZZY_MATCH_THRESHOLD } from "@test-evals/shared";

const ROUTE_ALIASES = new Map([
  ["by mouth", "po"],
  ["oral", "po"],
  ["orally", "po"],
  ["po", "po"],
  ["intravenous", "iv"],
  ["iv", "iv"],
  ["intramuscular", "im"],
  ["im", "im"],
  ["inhaled", "inhaled"],
  ["inhaler", "inhaled"],
  ["topical", "topical"],
  ["sublingual", "sl"],
  ["sl", "sl"],
]);

const FREQUENCY_ALIASES = new Map([
  ["bid", "twice daily"],
  ["twice a day", "twice daily"],
  ["twice daily", "twice daily"],
  ["two times daily", "twice daily"],
  ["tid", "three times daily"],
  ["three times daily", "three times daily"],
  ["three times a day", "three times daily"],
  ["qid", "four times daily"],
  ["four times daily", "four times daily"],
  ["daily", "daily"],
  ["once daily", "daily"],
  ["once a day", "daily"],
  ["every day", "daily"],
  ["q6h", "every 6 hours"],
  ["q 6 h", "every 6 hours"],
  ["every six hours", "every 6 hours"],
  ["every 6 hours", "every 6 hours"],
  ["q8h", "every 8 hours"],
  ["q 8 h", "every 8 hours"],
  ["every eight hours", "every 8 hours"],
  ["every 8 hours", "every 8 hours"],
  ["prn", "as needed"],
  ["as needed", "as needed"],
]);

const TIME_WORDS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["twelve", 12],
]);

const LOW_SIGNAL_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "per",
  "the",
  "these",
  "this",
  "to",
  "up",
  "with",
  "without",
  "about",
  "after",
  "before",
  "during",
  "again",
  "adequate",
  "apply",
  "call",
  "care",
  "counseling",
  "continue",
  "consider",
  "evaluate",
  "improve",
  "keep",
  "maintain",
  "monitor",
  "recheck",
  "reassess",
  "reassessment",
  "return",
  "start",
  "take",
  "try",
  "update",
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9./%\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleStem(token: string): string {
  return token
    .replace(/ies$/g, "y")
    .replace(/ing$/g, "")
    .replace(/ed$/g, "")
    .replace(/s$/g, "");
}

export function contentTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !LOW_SIGNAL_TOKENS.has(token))
    .map(simpleStem);
}

export function normalizeDose(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeText(value)
    .replace(/(\d)\s*(mg|mcg|g|ml|units?|puffs?|tabs?|tablets?|caps?|drops?)/g, "$1 $2")
    .replace(/\bmilligrams?\b/g, "mg")
    .replace(/\bmicrograms?\b/g, "mcg")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function normalizeFrequency(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = normalizeText(value).replace(/\bas required\b/g, "as needed");
  const parts = base.replace(/\bprn\b/g, "as needed");
  for (const [alias, canonical] of FREQUENCY_ALIASES) {
    if (parts === alias || parts.includes(alias)) {
      return parts.includes("as needed") && canonical !== "as needed" ? `${canonical} as needed` : canonical;
    }
  }
  return parts || null;
}

export function normalizeRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = normalizeText(value);
  return ROUTE_ALIASES.get(base) ?? base;
}

export function normalizeBp(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return match ? `${match[1]}/${match[2]}` : normalizeText(value);
}

export function timePhraseToDays(value: string): number | null {
  const text = normalizeText(value);
  const numeric = text.match(/\b(\d+)\s*(day|days|week|weeks|month|months)\b/);
  const word = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(day|days|week|weeks|month|months)\b/);
  const amount = numeric ? Number(numeric[1]) : word ? TIME_WORDS.get(word[1] ?? "") : null;
  const unit = numeric?.[2] ?? word?.[2];
  if (!amount || !unit) return null;
  if (unit.startsWith("day")) return amount;
  if (unit.startsWith("week")) return amount * 7;
  if (unit.startsWith("month")) return amount * 30;
  return null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] ?? 0;
}

export function stringSimilarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLength = Math.max(left.length, right.length);
  return Math.max(0, 1 - levenshtein(left, right) / maxLength);
}

export function tokenSetRatio(a: string, b: string): number {
  const leftTokens = new Set(normalizeText(a).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const precision = intersection.length / leftTokens.size;
  const recall = intersection.length / rightTokens.size;
  const overlap = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return Math.max(overlap, stringSimilarity([...leftTokens].sort().join(" "), [...rightTokens].sort().join(" ")));
}

export function fuzzyMatch(a: string, b: string, threshold = FUZZY_MATCH_THRESHOLD): boolean {
  return tokenSetRatio(a, b) >= threshold;
}

export function transcriptHasSupport(transcript: string, value: string, threshold = FUZZY_MATCH_THRESHOLD): boolean {
  const needle = normalizeText(value);
  const haystack = normalizeText(transcript);
  if (!needle) return true;
  if (haystack.includes(needle)) return true;

  const needleTokens = needle.split(" ").filter(Boolean);
  const words = haystack.split(" ").filter(Boolean);
  const windowSize = Math.max(needleTokens.length + 3, 4);
  for (let index = 0; index < words.length; index += 1) {
    const window = words.slice(index, index + windowSize).join(" ");
    if (tokenSetRatio(needle, window) >= threshold) return true;
  }

  const needleContent = contentTokens(needle);
  if (needleContent.length > 0) {
    const haystackTokens = new Set(contentTokens(haystack));
    const present = needleContent.filter((token) => haystackTokens.has(token)).length;
    const requiredCoverage = needleContent.length <= 2 ? 1 : 0.6;
    if (present / needleContent.length >= requiredCoverage) return true;
  }

  return false;
}

export function routeHasSupport(transcript: string, route: string): boolean {
  const normalized = normalizeRoute(route);
  const text = normalizeText(transcript);
  if (!normalized) return true;
  if (transcriptHasSupport(transcript, normalized)) return true;
  if (normalized === "po") return /\b(take|takes|taking|tablet|tablets|capsule|capsules|pill|pills|oral|mouth)\b/.test(text);
  if (normalized === "topical") return /\b(apply|cream|ointment|skin|wound|dressing|topical)\b/.test(text);
  if (normalized === "inhaled") return /\b(inhaler|puff|puffs|nebulizer|nebulized|inhale|inhaled)\b/.test(text);
  if (normalized === "iv") return /\b(iv|intravenous)\b/.test(text);
  if (normalized === "im") return /\b(im|intramuscular|shot|injection)\b/.test(text);
  if (normalized === "sl") return /\b(sl|sublingual|under tongue)\b/.test(text);
  return false;
}

export function frequencyHasSupport(transcript: string, frequency: string): boolean {
  const normalized = normalizeFrequency(frequency);
  const text = normalizeText(transcript);
  if (!normalized) return true;
  if (transcriptHasSupport(transcript, normalized)) return true;
  const aliasGroups = [
    ["twice daily", ["bid", "twice a day", "two times daily", "up to twice a day"]],
    ["three times daily", ["tid", "three times a day"]],
    ["four times daily", ["qid", "four times a day"]],
    ["every 4 hours", ["q4h", "q 4 h", "every four hours"]],
    ["every 6 hours", ["q6h", "q 6 h", "every six hours"]],
    ["every 8 hours", ["q8h", "q 8 h", "every eight hours"]],
    ["as needed", ["prn", "when needed", "as needed"]],
    ["daily", ["once daily", "once a day", "every day"]],
  ] as const;
  return aliasGroups.some(
    ([canonical, aliases]) =>
      normalized.includes(canonical) && aliases.some((alias) => text.includes(normalizeText(alias))),
  );
}
