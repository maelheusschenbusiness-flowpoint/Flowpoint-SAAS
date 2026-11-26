import { isProductionMarketingHostname } from "../shared/marketing-host";

export function shouldSetNoindex(
  hostname: string,
  nodeEnvironment = process.env.NODE_ENV,
): boolean {
  if (nodeEnvironment !== "production") return true;
  return !isProductionMarketingHostname(hostname);
}
