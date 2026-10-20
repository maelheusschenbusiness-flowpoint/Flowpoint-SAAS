export type AIAttachmentReference = {
  fileId: string;
};

export type ResolvedAIAttachment = {
  id:               string;
  orgId:            string;
  name:             string;
  declaredMimeType: string;
  sizeBytes:        number;
  contentBase64:    string;
  extension:        string;
};

export type AttachmentErrorCode =
  | "INVALID_ATTACHMENTS"
  | "TOO_MANY_ATTACHMENTS"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_TYPE_NOT_ALLOWED"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENTS_TOTAL_TOO_LARGE"
  | "ATTACHMENT_CONTENT_INVALID";

export type AttachmentError = {
  code:       AttachmentErrorCode;
  message:    string;
  httpStatus: 400 | 404 | 413;
};

// ── Step 3B — Normalised attachment after local parsing ───────────────────────

export type AttachmentCategory = "text" | "json" | "csv" | "spreadsheet" | "docx" | "pdf";

export type NormalizedAttachment = {
  id:            string;
  name:          string;
  mimeType:      string;
  category:      AttachmentCategory;
  extractedText: string;
  metadata: {
    pageCount?:   number;
    sheetCount?:  number;
    rowCount?:    number;
    columnCount?: number;
    truncated:    boolean;
    charCount:    number;
  };
  estimatedTokens: number;
};

// ── Step 3C — Image attachments ──────────────────────────────────────────────

export type NormalizedImageAttachment = {
  id:       string;
  name:     string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  category: "image";
  image: {
    dataBase64: string;   // raw base64, never logged
    width?:     number;
    height?:    number;
  };
  metadata: {
    sizeBytes:    number;
    parser:       "image-native";
    truncated:    false;
    extractionMs: number;
  };
  estimatedTokens: number;
};

export type ParseErrorCode =
  | "ATTACHMENT_FORMAT_NOT_SUPPORTED_YET"
  | "ATTACHMENT_PARSE_FAILED"
  | "ATTACHMENT_JSON_INVALID"
  | "ATTACHMENT_JSON_TOO_DEEP"
  | "ATTACHMENT_CSV_INVALID"
  | "ATTACHMENT_TABLE_EMPTY"
  | "ATTACHMENT_SPREADSHEET_INVALID"
  | "ATTACHMENT_SPREADSHEET_EMPTY"
  | "ATTACHMENT_DOCX_INVALID"
  | "ATTACHMENT_DOCX_EMPTY"
  | "ATTACHMENT_EXTRACTED_CONTENT_TOO_LARGE"
  | "ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT"
  | "ATTACHMENT_PDF_ENCRYPTED"
  | "ATTACHMENT_PARSER_UNAVAILABLE"
  // Step 3C — image-specific codes
  | "ATTACHMENT_IMAGE_INVALID"
  | "ATTACHMENT_IMAGE_MIME_MISMATCH"
  | "ATTACHMENT_IMAGE_TOO_LARGE"
  | "ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE";

export type ParseError = {
  code:       ParseErrorCode;
  message:    string;
  httpStatus: 400 | 413 | 415 | 422 | 503;
};
