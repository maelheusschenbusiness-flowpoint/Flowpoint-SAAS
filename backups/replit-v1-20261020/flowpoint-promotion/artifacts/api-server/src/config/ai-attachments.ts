export const AI_ATTACHMENT_LIMITS = {
  maxFilesPerRequest:  5,
  maxFileSizeBytes:    10 * 1024 * 1024,
  maxTotalSizeBytes:   20 * 1024 * 1024,
  maxFilenameLength:   200,
} as const;

// ── Step 3C — Image limits ────────────────────────────────────────────────────

export const AI_IMAGE_LIMITS = {
  maxImageBytes:       5 * 1024 * 1024,    // 5 MB per image
  maxImagesPerRequest: 4,
  maxImageWidth:       4096,
  maxImageHeight:      4096,
  maxTotalImageBytes:  12 * 1024 * 1024,   // 12 MB total across all images
} as const;

export const AI_ATTACHMENT_PARSE_LIMITS = {
  maxCharsPerAttachment:   100_000,
  maxTotalExtractedChars:  200_000,
  maxCsvRows:              10_000,
  maxSpreadsheetRows:      10_000,
  maxSpreadsheetColumns:   50,
  maxSpreadsheetSheets:    3,
  maxPdfPages:             50,
  maxJsonDepth:            10,
} as const;
