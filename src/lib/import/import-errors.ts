export class EncryptedImportError extends Error {
  constructor(message = "Encrypted documents are not supported.") {
    super(message);
    this.name = "EncryptedImportError";
  }
}

export class ImportAbortedError extends Error {
  constructor(message = "Import parsing was aborted.") {
    super(message);
    this.name = "ImportAbortedError";
  }
}

export function isEncryptedImportError(error: unknown): boolean {
  if (error instanceof EncryptedImportError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return /encrypted|password|passphrase|encryption/i.test(error.message);
}
