import { buildWeatherWebSummary } from "./intent-router.js";
export function isWeatherRequestText(text) {
  return /\b(weather|forecast|temperature|rain|snow|precipitation)\b/i.test(String(text || ""));
}

const WEATHER_CACHE_TTL_MS = Number.parseInt(process.env.NOVA_WEATHER_CACHE_TTL_MS || "120000", 10);
const WEATHER_FETCH_TIMEOUT_MS = Number.parseInt(process.env.NOVA_WEATHER_FETCH_TIMEOUT_MS || "6000", 10);
const WEATHER_FORECAST_DAYS = Number.parseInt(process.env.NOVA_WEATHER_FORECAST_DAYS || "8", 10);
const weatherReplyCache = new Map();
const WEATHER_DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEATHER_CONFIRM_TTL_MS = Number.parseInt(process.env.NOVA_WEATHER_CONFIRM_TTL_MS || "600000", 10);
const weatherConfirmBySession = new Map();

function cleanupWeatherConfirmStore() {
  const now = Date.now();
  for (const [key, value] of weatherConfirmBySession.entries()) {
    if (!value || now - Number(value.ts || 0) > WEATHER_CONFIRM_TTL_MS) {
      weatherConfirmBySession.delete(key);
    }
  }
}

export function getPendingWeatherConfirm(sessionKey) {
  const key = String(sessionKey || "").trim();
  if (!key) return null;
  cleanupWeatherConfirmStore();
  const value = weatherConfirmBySession.get(key);
  if (!value) return null;
  const prompt = String(value.prompt || "").trim();
  const suggestedLocation = String(value.suggestedLocation || "").trim();
  if (!prompt || !suggestedLocation) return null;
  return { prompt, suggestedLocation, ts: Number(value.ts || 0) };
}

export function setPendingWeatherConfirm(sessionKey, prompt, suggestedLocation) {
  const key = String(sessionKey || "").trim();
  const normalizedPrompt = String(prompt || "").trim();
  const normalizedLocation = String(suggestedLocation || "").trim();
  if (!key || !normalizedPrompt || !normalizedLocation) return;
  weatherConfirmBySession.set(key, {
    prompt: normalizedPrompt,
    suggestedLocation: normalizedLocation,
    ts: Date.now(),
  });
}

export function clearPendingWeatherConfirm(sessionKey) {
  const key = String(sessionKey || "").trim();
  if (!key) return;
  weatherConfirmBySession.delete(key);
}

export function isWeatherConfirmYes(text) {
  const n = String(text || "").trim().toLowerCase();
  if (!n) return false;
  if (isWeatherConfirmNo(n)) return false;
  return /^(yes|yeah|yep|y|correct|right|affirmative|that one|go ahead|please do)\b/.test(n);
}

export function isWeatherConfirmNo(text) {
  const n = String(text || "").trim().toLowerCase();
  return /^(no|nah|nope|n|cancel|stop|not that|wrong)\b/.test(n);
}

function weatherCodeToLabel(code) {
  const normalized = Number.isFinite(Number(code)) ? Number(code) : -1;
  const map = {
    0: "clear skies",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "light rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "light snow",
    73: "moderate snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "light snow showers",
    86: "heavy snow showers",
    95: "thunderstorms",
    96: "thunderstorms with light hail",
    99: "thunderstorms with heavy hail",
  };
  return map[normalized] || "mixed conditions";
}

function stripWeatherAssistantPrefix(text) {
  return String(text || "")
    .replace(/^\s*(?:hey|hi|yo)\s+(?:n[o0]va|nõva)\b[\s,:-]*/i, "")
    .replace(/^\s*(?:n[o0]va|nõva)\b[\s,:-]*/i, "")
    .trim();
}

function normalizeWeatherLocation(locationRaw) {
  return String(locationRaw || "")
    .replace(/^[`"'\u2019\s]+/, "")
    .replace(/[`"'\u2019\s]+$/, "")
    .replace(/[?!.]/g, " ")
    .replace(/\b(today|tomorrow|tonight|right now|now|this week|next week)\b/gi, " ")
    .replace(/\b(please|thanks|thank you)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,\s*$/, "")
    .replace(/^[`"'\u2019]+|[`"'\u2019]+$/g, "");
}

function inferWeatherLocation(text) {
  const raw = stripWeatherAssistantPrefix(text);
  if (!raw) return "";
  const patterns = [
    /\b(?:weather|forecast|temperature|rain|snow|wind|humidity)\s+(?:(?:in|for|at)\s+)?([A-Za-z0-9][A-Za-z0-9\s,.'-]{1,80})/i,
    /\b(?:in|for|at)\s+([A-Za-z0-9][A-Za-z0-9\s,.'-]{1,80})\s+(?:weather|forecast)\b/i,
    /^([A-Za-z0-9][A-Za-z0-9\s,.'-]{1,80})\s+(?:weather|forecast)\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeWeatherLocation(match[1]);
    if (normalized) return normalized;
  }
  return "";
}

function inferWeatherDayOffset(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized.trim()) return 0;
  const inDaysMatch = normalized.match(/\bin\s+([1-7])\s+days?\b/);
  if (inDaysMatch?.[1]) {
    const inDays = Number(inDaysMatch[1]);
    if (Number.isFinite(inDays)) return Math.max(0, Math.min(7, inDays));
  }
  if (/\bright now\b|\bcurrently\b|\bnow\b|\btoday\b|\btonight\b/.test(normalized)) return 0;
  if (/\btomorrow\b/.test(normalized)) return 1;

  const today = new Date().getDay();
  for (let index = 0; index < WEATHER_DAY_NAMES.length; index += 1) {
    const dayName = WEATHER_DAY_NAMES[index];
    const nextPattern = new RegExp(`\\bnext\\s+${dayName}\\b`, "i");
    const basePattern = new RegExp(`\\b${dayName}\\b`, "i");
    if (!nextPattern.test(normalized) && !basePattern.test(normalized)) continue;
    let offset = (index - today + 7) % 7;
    if (offset === 0 && nextPattern.test(normalized)) offset = 7;
    return Math.max(0, Math.min(7, offset));
  }
  return 0;
}

function wantsWeeklyOutlook(text) {
  return /\b(next week|this week|7 day|7-day|week ahead)\b/i.test(String(text || ""));
}

function hasExplicitFutureWeatherTimeframe(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized.trim()) return false;
  if (/\btomorrow\b|\bin\s+[1-7]\s+days?\b/.test(normalized)) return true;
  for (const dayName of WEATHER_DAY_NAMES) {
    const dayPattern = new RegExp(`\\b(?:next\\s+)?${dayName}\\b`, "i");
    if (dayPattern.test(normalized)) return true;
  }
  return false;
}

function isCurrentWeatherRequest(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized.trim()) return false;
  if (wantsWeeklyOutlook(normalized) || hasExplicitFutureWeatherTimeframe(normalized)) return false;
  if (/\b(now|right now|currently|current|today|tonight|temperature now)\b/.test(normalized)) return true;
  return isWeatherRequestText(normalized);
}

function weatherCacheKey(location, dayOffset, weekly, currentOnly) {
  return [String(location || "").toLowerCase(), String(dayOffset), weekly ? "weekly" : "single", currentOnly ? "current" : "forecast"].join("|");
}

function getCachedWeatherReply(key) {
  const entry = weatherReplyCache.get(key);
  if (!entry) return null;
  if (Date.now() - Number(entry.ts || 0) > WEATHER_CACHE_TTL_MS) {
    weatherReplyCache.delete(key);
    return null;
  }
  return String(entry.reply || "");
}

function setCachedWeatherReply(key, reply) {
  weatherReplyCache.set(key, { ts: Date.now(), reply: String(reply || "") });
  if (weatherReplyCache.size <= 120) return;
  const entries = [...weatherReplyCache.entries()].sort((a, b) => Number(a[1]?.ts || 0) - Number(b[1]?.ts || 0));
  const removeCount = Math.max(1, entries.length - 120);
  for (let i = 0; i < removeCount; i += 1) {
    weatherReplyCache.delete(entries[i][0]);
  }
}

function formatWeatherFreshness(isoTime, timezone) {
  const parsed = Date.parse(String(isoTime || ""));
  if (!Number.isFinite(parsed)) return "Freshness: live response.";
  try {
    const label = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: String(timezone || "UTC"),
      timeZoneName: "short",
    }).format(new Date(parsed));
    return `Freshness: updated ${label}.`;
  } catch {
    return "Freshness: live response.";
  }
}

function asRoundedNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function isTransientWeatherStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchTextWithRetry(url, { attempts = 2, timeoutMs = WEATHER_FETCH_TIMEOUT_MS, maxChars = 24_000 } = {}) {
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { Accept: "text/plain,application/json,text/html" },
      });
      if (!response.ok) {
        if (attempt < attempts - 1 && isTransientWeatherStatus(response.status)) continue;
        throw new Error(`status_${response.status}`);
      }
      const text = String(await response.text()).trim();
      if (!text) throw new Error("empty_response");
      if (text.length > maxChars) throw new Error("response_too_large");
      return text;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isLastAttempt = attempt >= attempts - 1;
      if (!isLastAttempt && (isAbort || /status_|response_too_large|empty_response/.test(String(err instanceof Error ? err.message : "")))) {
        continue;
      }
      if (isLastAttempt) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("weather_fetch_failed");
}

async function fetchJsonWithRetry(url, options = {}) {
  const text = await fetchTextWithRetry(url, options);
  return JSON.parse(text);
}

async function fetchWttrQuickStatus(location) {
  const endpoint = `https://wttr.in/${encodeURIComponent(location)}?format=3`;
  try {
    const line = await fetchTextWithRetry(endpoint, { attempts: 2, timeoutMs: WEATHER_FETCH_TIMEOUT_MS, maxChars: 500 });
    if (!line || /unknown location|sorry|error/i.test(line)) return "";
    return line.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

const LOCATION_ALIAS_CANONICAL = {
  nyc: "newyork",
  la: "losangeles",
  sf: "sanfrancisco",
  dc: "washington",
  philly: "philadelphia",
  pgh: "pittsburgh",
  tx: "texas",
  nola: "neworleans",
  vegas: "lasvegas",
  slc: "saltlakecity",
  stl: "stlouis",
  ftlauderdale: "fortlauderdale",
  ftworth: "fortworth",
  sd: "sandiego",
  sj: "sanjose",
  ldn: "london",
  lon: "london",
  man: "manchester",
  bham: "birmingham",
  edi: "edinburgh",
  gla: "glasgow",
  dub: "dublin",
  par: "paris",
  mar: "marseille",
  nic: "nice",
  mad: "madrid",
  bcn: "barcelona",
  val: "valencia",
  sev: "seville",
  lis: "lisbon",
  opo: "porto",
  rom: "rome",
  mil: "milan",
  nap: "naples",
  tur: "turin",
  ber: "berlin",
  muc: "munich",
  ham: "hamburg",
  fra: "frankfurt",
  ams: "amsterdam",
  rtm: "rotterdam",
  bru: "brussels",
  ant: "antwerp",
  zrh: "zurich",
  gva: "geneva",
  vie: "vienna",
  prg: "prague",
  bud: "budapest",
  waw: "warsaw",
  krk: "krakow",
  cph: "copenhagen",
  osl: "oslo",
  sto: "stockholm",
  hel: "helsinki",
  ath: "athens",
  ist: "istanbul",
  ank: "ankara",
  dxb: "dubai",
  auh: "abudhabi",
  doh: "doha",
  ruh: "riyadh",
  jed: "jeddah",
  tlv: "telaviv",
  cai: "cairo",
  cas: "casablanca",
  jnb: "johannesburg",
  jhb: "johannesburg",
  cpt: "capetown",
  nbo: "nairobi",
  lag: "lagos",
  acc: "accra",
  tok: "tokyo",
  tyo: "tokyo",
  osa: "osaka",
  kyo: "kyoto",
  nag: "nagoya",
  sap: "sapporo",
  fuk: "fukuoka",
  sel: "seoul",
  pusan: "busan",
  hkg: "hongkong",
  hk: "hongkong",
  tpe: "taipei",
  pek: "beijing",
  sha: "shanghai",
  szx: "shenzhen",
  can: "guangzhou",
  ckg: "chongqing",
  wuh: "wuhan",
  bkk: "bangkok",
  hkt: "phuket",
  sin: "singapore",
  sgp: "singapore",
  sg: "singapore",
  kul: "kualalumpur",
  kl: "kualalumpur",
  jkt: "jakarta",
  cgk: "jakarta",
  dps: "denpasar",
  mnl: "manila",
  ceb: "cebu",
  han: "hanoi",
  sgn: "hochiminhcity",
  hcmc: "hochiminhcity",
  del: "delhi",
  ncr: "delhi",
  bom: "mumbai",
  mum: "mumbai",
  blr: "bengaluru",
  hyd: "hyderabad",
  maa: "chennai",
  ccu: "kolkata",
  kol: "kolkata",
  amd: "ahmedabad",
  pnq: "pune",
  syd: "sydney",
  mel: "melbourne",
  bne: "brisbane",
  per: "perth",
  adl: "adelaide",
  akl: "auckland",
  wlg: "wellington",
  chc: "christchurch",
  yyz: "toronto",
  yto: "toronto",
  yvr: "vancouver",
  yul: "montreal",
  yow: "ottawa",
  tor: "toronto",
  van: "vancouver",
  mtl: "montreal",
  mex: "mexicocity",
  cdmx: "mexicocity",
  gdl: "guadalajara",
  mty: "monterrey",
  bog: "bogota",
  med: "medellin",
  lim: "lima",
  scl: "santiago",
  bue: "buenosaires",
  bsas: "buenosaires",
  rio: "riodejaneiro",
  sao: "saopaulo",
  sp: "saopaulo",
  poa: "portoalegre",
  mvd: "montevideo",
};

function normalizeLocationTokenForMatch(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  return LOCATION_ALIAS_CANONICAL[normalized] || normalized;
}

const LOCATION_QUALIFIER_TOKENS = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "newhampshire", "newjersey", "newmexico", "newyork",
  "northcarolina", "northdakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhodeisland",
  "southcarolina", "southdakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "westvirginia", "wisconsin", "wyoming", "dc", "us", "usa", "uk", "uae", "canada", "australia",
  "newzealand", "india", "japan", "china", "france", "germany", "italy", "spain", "mexico", "brazil",
  "argentina", "chile", "colombia", "peru", "ireland", "netherlands", "sweden", "norway", "denmark",
  "finland", "poland", "turkey", "israel", "egypt", "southafrica",
]);

function tokenizeLocationTerms(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => normalizeLocationTokenForMatch(token))
    .filter((token) => token.length >= 2);
}

function extractPrimaryLocationPhrase(value) {
  const firstPart = String(value || "").split(",")[0].trim();
  if (!firstPart) return "";
  const terms = firstPart.split(/\s+/g).map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) return "";
  let end = terms.length;
  while (end > 1 && LOCATION_QUALIFIER_TOKENS.has(normalizeLocationTokenForMatch(terms[end - 1]))) {
    end -= 1;
  }
  return terms.slice(0, end).join(" ").trim() || firstPart;
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left) return right.length;
  if (!right) return left.length;
  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[left.length][right.length];
}

function locationSimilarityScore(requestedToken, candidateToken) {
  const requested = normalizeLocationTokenForMatch(requestedToken);
  const candidate = normalizeLocationTokenForMatch(candidateToken);
  if (!requested || !candidate) return { score: 0, distance: Number.POSITIVE_INFINITY };
  if (requested === candidate) return { score: 1, distance: 0 };
  const distance = levenshteinDistance(requested, candidate);
  const maxLen = Math.max(1, requested.length, candidate.length);
  return { score: Math.max(0, 1 - distance / maxLen), distance };
}

function assessResolvedLocationConfidence(requestedLocation, place) {
  const requestedPrimary = String(requestedLocation || "").split(",")[0] || "";
  const requestedToken = normalizeLocationTokenForMatch(requestedPrimary);
  const requestedTerms = Array.from(new Set(tokenizeLocationTerms(requestedLocation)));
  if (!requestedToken && requestedTerms.length === 0) {
    return { level: "low", score: 0, distance: Number.POSITIVE_INFINITY };
  }

  const candidateTokens = [
    String(place?.name || ""),
    String(place?.admin1 || ""),
    String(place?.country || ""),
    String(place?.country_code || ""),
  ]
    .map((value) => normalizeLocationTokenForMatch(value))
    .filter(Boolean);
  const candidateTerms = Array.from(
    new Set(
      [
        String(place?.name || ""),
        String(place?.admin1 || ""),
        String(place?.country || ""),
        String(place?.country_code || ""),
      ].flatMap((value) => tokenizeLocationTerms(value)),
    ),
  );
  const comparisonTokens = Array.from(new Set([...candidateTokens, ...candidateTerms]));
  if (comparisonTokens.length === 0) return { level: "low", score: 0, distance: Number.POSITIVE_INFINITY };

  let best = { score: 0, distance: Number.POSITIVE_INFINITY };
  const targetToken = requestedToken || requestedTerms[0] || "";
  for (const token of comparisonTokens) {
    const next = locationSimilarityScore(targetToken, token);
    if (next.score > best.score || (next.score === best.score && next.distance < best.distance)) {
      best = next;
    }
  }

  let coverage = 0;
  if (requestedTerms.length > 0 && candidateTerms.length > 0) {
    let matchedTerms = 0;
    for (const term of requestedTerms) {
      const exact = candidateTerms.includes(term);
      const fuzzy = !exact && candidateTerms.some((candidate) => locationSimilarityScore(term, candidate).score >= 0.88);
      if (exact || fuzzy) matchedTerms += 1;
    }
    coverage = matchedTerms / requestedTerms.length;
  }

  if (requestedTerms.length >= 2 && coverage >= 0.99) {
    return { level: "high", score: Math.max(best.score, 0.99), distance: Math.min(best.distance, 1), coverage };
  }
  if (requestedTerms.length >= 2 && coverage >= 0.66) {
    return { level: "medium", score: Math.max(best.score, 0.8), distance: best.distance, coverage };
  }
  if (best.distance === 0 || best.score >= 0.985) return { level: "high", ...best };
  if (requestedToken.length >= 5 && best.distance <= 2 && best.score >= 0.75) return { level: "medium", ...best };
  if (best.score >= 0.9) return { level: "high", ...best };
  if (best.score >= 0.72) return { level: "medium", ...best };
  if (requestedTerms.length >= 2 && coverage >= 0.5) return { level: "medium", score: best.score, distance: best.distance, coverage };
  return { level: "low", ...best, coverage };
}

function buildLocationQueryVariants(location) {
  const base = String(location || "").trim();
  const firstPart = base.split(",")[0].trim();
  const stripped = base.replace(/[^A-Za-z0-9,\s.-]/g, " ").replace(/\s+/g, " ").trim();
  const variants = [base, stripped, firstPart];
  const aliasKey = firstPart.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliasCanonical = LOCATION_ALIAS_CANONICAL[aliasKey];
  if (aliasCanonical) variants.push(aliasCanonical);
  const terms = firstPart.split(/\s+/g).map((term) => term.trim()).filter(Boolean);
  if (terms.length >= 2) {
    const lastTerm = normalizeLocationTokenForMatch(terms[terms.length - 1]);
    if (LOCATION_QUALIFIER_TOKENS.has(lastTerm)) {
      variants.push(terms.slice(0, -1).join(" "));
      if (terms.length >= 3) {
        const beforeLast = normalizeLocationTokenForMatch(terms[terms.length - 2]);
        if (LOCATION_QUALIFIER_TOKENS.has(beforeLast)) {
          variants.push(terms.slice(0, -2).join(" "));
        }
      }
    }
  }
  if (/^[A-Za-z]{6,}$/.test(firstPart)) {
    variants.push(firstPart.slice(0, -1));
  }
  return Array.from(new Set(variants.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 4);
}

function rankGeocodeResultsForRequest(requestedLocation, results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const scored = results.map((place) => {
    const confidence = assessResolvedLocationConfidence(requestedLocation, place);
    const confidenceRank = confidence.level === "high" ? 3 : confidence.level === "medium" ? 2 : 1;
    return {
      place,
      confidence,
      confidenceRank,
      population: Number(place?.population || 0),
      ranking: Number(place?.ranking || 0),
    };
  });
  scored.sort((a, b) => {
    if (b.confidenceRank !== a.confidenceRank) return b.confidenceRank - a.confidenceRank;
    if (b.confidence.score !== a.confidence.score) return b.confidence.score - a.confidence.score;
    if (a.confidence.distance !== b.confidence.distance) return a.confidence.distance - b.confidence.distance;
    if (b.population !== a.population) return b.population - a.population;
    return b.ranking - a.ranking;
  });
  return scored;
}

function pickBestGeocodeResultForRequest(requestedLocation, results) {
  const ranked = rankGeocodeResultsForRequest(requestedLocation, results);
  return Array.isArray(ranked) && ranked.length > 0 ? ranked[0] : null;
}

function formatResolvedLocation(place) {
  const name = String(place?.name || "").trim();
  const admin1 = String(place?.admin1 || "").trim();
  const country = String(place?.country_code || place?.country || "").trim();
  return [name, admin1, country].filter(Boolean).join(", ");
}

function dedupeGeocodeResults(results) {
  const dedupedResults = [];
  const seenPlaces = new Set();
  for (const place of Array.isArray(results) ? results : []) {
    const key = [
      String(place?.name || "").toLowerCase(),
      String(place?.admin1 || "").toLowerCase(),
      String(place?.country_code || "").toLowerCase(),
      String(place?.latitude || ""),
      String(place?.longitude || ""),
    ].join("|");
    if (seenPlaces.has(key)) continue;
    seenPlaces.add(key);
    dedupedResults.push(place);
  }
  return dedupedResults;
}

async function fetchGeocodeResultsByQuery(query, count = 8) {
  const normalized = String(query || "").trim();
  if (!normalized) return [];
  const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodeUrl.searchParams.set("name", normalized);
  geocodeUrl.searchParams.set("count", String(Math.max(1, Math.min(25, Number(count) || 8))));
  geocodeUrl.searchParams.set("language", "en");
  geocodeUrl.searchParams.set("format", "json");
  const geocodePayload = await fetchJsonWithRetry(geocodeUrl.toString(), { attempts: 2, timeoutMs: WEATHER_FETCH_TIMEOUT_MS });
  return Array.isArray(geocodePayload?.results) ? geocodePayload.results : [];
}

function buildFuzzyLocationQueries(location) {
  const primary = extractPrimaryLocationPhrase(location);
  const normalized = String(primary || "").replace(/[^A-Za-z0-9\s.-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const firstToken = normalized.split(/\s+/g)[0] || "";
  if (firstToken.length < 3) return [];

  const queries = [];
  const maxPrefixLen = Math.min(7, firstToken.length);
  for (let len = maxPrefixLen; len >= 3; len -= 1) {
    queries.push(firstToken.slice(0, len));
  }
  return Array.from(new Set(queries.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 5);
}

async function fetchOpenMeteoForecast(location) {
  const locationCandidates = buildLocationQueryVariants(location);
  let geocodeResults = [];
  for (const candidate of locationCandidates) {
    const results = await fetchGeocodeResultsByQuery(candidate, 8);
    geocodeResults.push(...results);
  }

  let dedupedResults = dedupeGeocodeResults(geocodeResults);
  if (dedupedResults.length === 0) {
    const fuzzyQueries = buildFuzzyLocationQueries(location);
    for (const query of fuzzyQueries) {
      const results = await fetchGeocodeResultsByQuery(query, 25);
      geocodeResults.push(...results);
      dedupedResults = dedupeGeocodeResults(geocodeResults);
    }
  }

  const rankedResults = rankGeocodeResultsForRequest(location, dedupedResults) || [];
  const best = rankedResults[0] || null;
  const suggestions = rankedResults
    .slice(0, 3)
    .map((entry) => formatResolvedLocation(entry?.place))
    .filter(Boolean);
  if (!best?.place) return { ok: false, reason: "location_not_found", suggestions };
  const place = best.place;
  if (best.confidence.level === "low") {
    return { ok: false, reason: "low_confidence", suggestions: [formatResolvedLocation(place), ...suggestions].filter(Boolean).slice(0, 3) };
  }

  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, reason: "location_not_found" };

  const isUS = String(place.country_code || "").toUpperCase() === "US";
  const unitTemp = isUS ? "fahrenheit" : "celsius";
  const windSpeed = isUS ? "mph" : "kmh";
  const precip = isUS ? "inch" : "mm";
  const days = Math.max(7, Math.min(10, WEATHER_FORECAST_DAYS));

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(latitude));
  forecastUrl.searchParams.set("longitude", String(longitude));
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
  );
  forecastUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
  );
  forecastUrl.searchParams.set("temperature_unit", unitTemp);
  forecastUrl.searchParams.set("wind_speed_unit", windSpeed);
  forecastUrl.searchParams.set("precipitation_unit", precip);
  forecastUrl.searchParams.set("forecast_days", String(days));

  const forecastPayload = await fetchJsonWithRetry(forecastUrl.toString(), { attempts: 2, timeoutMs: WEATHER_FETCH_TIMEOUT_MS });
  return {
    ok: true,
    place,
    confidenceLevel: best.confidence.level,
    confidenceScore: best.confidence.score,
    payload: forecastPayload,
    locationLabel: formatResolvedLocation(place),
    suggestions: [formatResolvedLocation(place), ...suggestions].filter(Boolean).slice(0, 3),
  };
}

function isWeatherWebFallbackReliable(location, summary) {
  const text = String(summary || "").toLowerCase();
  if (!text.trim()) return false;
  const hasNumericTemps = /(?:\bhigh around\b|\blow around\b|\b\d{1,3}\s*(?:degrees?|\u00B0)\b|\b\d{1,3}\s*[fc]\b)/i.test(text);
  if (!hasNumericTemps) return false;
  const locationTokens = String(location || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  if (locationTokens.length === 0) return true;
  return locationTokens.some((token) => text.includes(token));
}

function buildSingleDayForecastReply({ locationLabel, payload, dayOffset, preferCurrent }) {
  const timezone = String(payload?.timezone || "UTC");
  const current = payload?.current || {};
  const daily = payload?.daily || {};
  const dailyUnits = payload?.daily_units || {};
  const currentUnits = payload?.current_units || {};
  const currentTime = String(current?.time || new Date().toISOString());

  if (preferCurrent && dayOffset === 0 && Number.isFinite(Number(current?.temperature_2m))) {
    const temp = asRoundedNumber(current.temperature_2m);
    const feels = asRoundedNumber(current?.apparent_temperature);
    const humidity = asRoundedNumber(current?.relative_humidity_2m);
    const wind = asRoundedNumber(current?.wind_speed_10m);
    const condition = weatherCodeToLabel(current?.weather_code);
    const tempUnit = String(currentUnits?.temperature_2m || "");
    const windUnit = String(currentUnits?.wind_speed_10m || "");
    const parts = [
      temp !== null ? `${locationLabel} right now: ${temp}${tempUnit}, ${condition}.` : `${locationLabel} right now: ${condition}.`,
      feels !== null ? `Feels like ${feels}${tempUnit}.` : "",
      humidity !== null ? `Humidity ${humidity}%.` : "",
      wind !== null ? `Wind ${wind} ${windUnit}.` : "",
      formatWeatherFreshness(currentTime, timezone),
      "Confidence: high (Open-Meteo live conditions).",
    ].filter(Boolean);
    return parts.join(" ");
  }

  const times = Array.isArray(daily?.time) ? daily.time : [];
  if (times.length === 0) return "";
  const index = Math.max(0, Math.min(times.length - 1, dayOffset));
  const dateIso = String(times[index] || "");
  const high = Array.isArray(daily?.temperature_2m_max) ? asRoundedNumber(daily.temperature_2m_max[index]) : null;
  const low = Array.isArray(daily?.temperature_2m_min) ? asRoundedNumber(daily.temperature_2m_min[index]) : null;
  const code = Array.isArray(daily?.weather_code) ? daily.weather_code[index] : null;
  const rainChance = Array.isArray(daily?.precipitation_probability_max)
    ? asRoundedNumber(daily.precipitation_probability_max[index])
    : null;
  const wind = Array.isArray(daily?.wind_speed_10m_max) ? asRoundedNumber(daily.wind_speed_10m_max[index]) : null;

  let weekday = "Selected day";
  try {
    weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(
      new Date(`${dateIso}T12:00:00`),
    );
  } catch {
    weekday = "Selected day";
  }

  const tempUnit = String(dailyUnits?.temperature_2m_max || currentUnits?.temperature_2m || "");
  const windUnit = String(dailyUnits?.wind_speed_10m_max || currentUnits?.wind_speed_10m || "");
  const condition = weatherCodeToLabel(code);
  const parts = [
    `${locationLabel} on ${weekday}: ${condition}${high !== null && low !== null ? `, high ${high}${tempUnit}, low ${low}${tempUnit}` : ""}.`,
    Number.isFinite(Number(rainChance)) ? `Rain chance up to ${Number(rainChance)}%.` : "",
    Number.isFinite(Number(wind)) ? `Wind up to ${Number(wind)} ${windUnit}.` : "",
    formatWeatherFreshness(currentTime, timezone),
    "Confidence: high (Open-Meteo forecast).",
  ].filter(Boolean);
  return parts.join(" ");
}

function buildWeeklyForecastReply({ locationLabel, payload }) {
  const timezone = String(payload?.timezone || "UTC");
  const daily = payload?.daily || {};
  const dailyUnits = payload?.daily_units || {};
  const times = Array.isArray(daily?.time) ? daily.time : [];
  if (times.length === 0) return "";

  const maxRows = Math.min(7, times.length);
  const tempUnit = String(dailyUnits?.temperature_2m_max || "");
  const lines = [];
  for (let i = 0; i < maxRows; i += 1) {
    const dateIso = String(times[i] || "");
    let weekday = `Day ${i + 1}`;
    try {
      weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(
        new Date(`${dateIso}T12:00:00`),
      );
    } catch {}
    const high = Array.isArray(daily?.temperature_2m_max) ? asRoundedNumber(daily.temperature_2m_max[i]) : null;
    const low = Array.isArray(daily?.temperature_2m_min) ? asRoundedNumber(daily.temperature_2m_min[i]) : null;
    const code = Array.isArray(daily?.weather_code) ? daily.weather_code[i] : null;
    const rain = Array.isArray(daily?.precipitation_probability_max) ? asRoundedNumber(daily.precipitation_probability_max[i]) : null;
    const condition = weatherCodeToLabel(code);
    const rainChunk = Number.isFinite(Number(rain)) ? `, rain ${Number(rain)}%` : "";
    const tempRange = high !== null && low !== null ? `${high}${tempUnit}/${low}${tempUnit}` : "temp range unavailable";
    lines.push(`${weekday}: ${condition}, ${tempRange}${rainChunk}`);
  }

  const currentTime = String(payload?.current?.time || new Date().toISOString());
  return [
    `${locationLabel} next 7 days:`,
    ...lines,
    formatWeatherFreshness(currentTime, timezone),
    "Confidence: high (Open-Meteo forecast).",
  ].join("\n");
}

export async function tryWeatherFastPathReply({
  text,
  runtimeTools,
  availableTools,
  canRunWebSearch,
  forcedLocation = "",
  bypassConfirmation = false,
}) {
  if (!isWeatherRequestText(text)) return { reply: "", source: "" };
  const location = String(forcedLocation || "").trim() || inferWeatherLocation(text);
  if (!location) {
    return {
      reply: "Share the city (and state/country if needed), and I will return the weather right away.",
      source: "validation",
    };
  }

  const dayOffset = inferWeatherDayOffset(text);
  const weekly = wantsWeeklyOutlook(text);
  const currentOnly = isCurrentWeatherRequest(text);
  const cacheKey = weatherCacheKey(location, dayOffset, weekly, currentOnly);
  const cached = getCachedWeatherReply(cacheKey);
  if (cached) return { reply: cached, source: "cache" };

  let openMeteo = null;
  let openMeteoUnavailable = false;
  try {
    openMeteo = await fetchOpenMeteoForecast(location);
    if (openMeteo?.ok) {
      if (!bypassConfirmation && openMeteo.confidenceLevel === "medium") {
        return {
          reply: `I want to confirm location before I run weather. Did you mean ${openMeteo.locationLabel}? Reply "yes" or "no".`,
          source: "clarify",
          needsConfirmation: true,
          suggestedLocation: openMeteo.locationLabel,
        };
      }
      const reply = weekly
        ? buildWeeklyForecastReply({
            locationLabel: openMeteo.locationLabel,
            payload: openMeteo.payload,
          })
        : buildSingleDayForecastReply({
            locationLabel: openMeteo.locationLabel,
            payload: openMeteo.payload,
            dayOffset,
            preferCurrent: currentOnly,
          });
      if (reply) {
        setCachedWeatherReply(cacheKey, reply);
        return { reply, source: "open-meteo" };
      }
    }
    if (openMeteo && !openMeteo.ok) {
      const suggestions = Array.isArray(openMeteo.suggestions) ? openMeteo.suggestions.filter(Boolean) : [];
      const topSuggestion = suggestions[0] || "";
      if (!bypassConfirmation && topSuggestion) {
        return {
          reply: `I'm not fully confident about "${location}". Did you mean ${topSuggestion}? Reply "yes" or "no".`,
          source: "clarify",
          needsConfirmation: true,
          suggestedLocation: topSuggestion,
        };
      }
      return {
        reply: `I couldn't confidently resolve "${location}". Share city + state/country and I will run it immediately.`,
        source: "validation",
      };
    }
  } catch {
    openMeteoUnavailable = true;
  }

  if (openMeteoUnavailable && currentOnly && !weekly && dayOffset === 0) {
    const wttrLine = await fetchWttrQuickStatus(location);
    if (wttrLine) {
      const wttrReply = `${wttrLine}. Freshness: updated moments ago. Confidence: medium (wttr quick status).`;
      setCachedWeatherReply(cacheKey, wttrReply);
      return { reply: wttrReply, source: "wttr" };
    }
  }

  if (openMeteoUnavailable && canRunWebSearch && typeof runtimeTools?.executeToolUse === "function") {
    const searchQuery = weekly
      ? `${location} weather next 7 days`
      : dayOffset > 0
        ? `${location} weather forecast in ${dayOffset} days`
        : `${location} current weather`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await runtimeTools.executeToolUse(
          { id: `tool_weather_fast_${Date.now()}_${attempt}`, name: "web_search", input: { query: searchQuery }, type: "tool_use" },
          availableTools,
        );
        const content = String(result?.content || "").trim();
        if (!content || /^web_search error/i.test(content)) continue;
        const readable = buildWeatherWebSummary(searchQuery, content);
        if (!readable || !isWeatherWebFallbackReliable(location, readable)) continue;
        const safeReply = `${readable}\nFreshness: source timestamp may vary by result.\nConfidence: medium (web weather snippets).`;
        setCachedWeatherReply(cacheKey, safeReply);
        return { reply: safeReply, source: "web_search", toolCall: "web_search" };
      } catch {
        // Continue to next fallback step.
      }
    }
  }

  return {
    reply: `Weather services were temporarily unavailable for ${location}. Please retry in a moment.`,
    source: "fallback",
  };
}
