export function isDemoMode(): boolean {
  const env = process.env["NODE_ENV"];
  const dbUrl = process.env["DATABASE_URL"];
  if (env === "production" && dbUrl) return false;
  if (env === "production") return false;
  return true;
}
