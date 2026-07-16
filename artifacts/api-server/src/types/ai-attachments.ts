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
