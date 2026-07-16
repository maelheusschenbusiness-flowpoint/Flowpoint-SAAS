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

export type ParseErrorCode =
  | "ATTACHMENT_FORMAT_NOT_SUPPORTED_YET"
  | "ATTACHMENT_PARSE_FAILED"
  | "ATTACHMENT_JSON_INVALID"
  | "ATTACHMENT_CSV_INVALID"
  | "ATTACHMENT_EXTRACTED_CONTENT_TOO_LARGE"
  | "ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT"
  | "ATTACHMENT_PDF_ENCRYPTED"
  | "ATTACHMENT_DOCX_EMPTY"
  | "ATTACHMENT_TABLE_EMPTY";

export type ParseError = {
  code:       ParseErrorCode;
  message:    string;
  httpStatus: 400 | 413 | 415 | 422;
};
