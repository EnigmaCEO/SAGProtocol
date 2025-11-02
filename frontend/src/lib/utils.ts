export function formatTs(s: number): string {
  return new Date(s * 1000).toLocaleString();
}

export function getCoverageColor(coverage: number): string {
  if (coverage < 100) return "red";
  if (coverage <= 105) return "yellow";
  return "green";
}
