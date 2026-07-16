export const AI_ATTACHMENT_LIMITS = {
  maxFilesPerRequest:  5,
  maxFileSizeBytes:    10 * 1024 * 1024,
  maxTotalSizeBytes:   20 * 1024 * 1024,
  maxFilenameLength:   200,
} as const;
