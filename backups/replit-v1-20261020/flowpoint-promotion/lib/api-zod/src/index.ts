import { z } from "zod";

export const HealthCheckResponse = z.object({
  status: z.string(),
});

export type HealthCheckResponseType = z.infer<typeof HealthCheckResponse>;
