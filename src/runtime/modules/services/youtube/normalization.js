export function sanitizeYouTubeTopic(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || "news";
}

export function sanitizeYouTubeSource(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.&'/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}
