const OLE_CFB_SIGNATURE = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

export function hasOleCompoundFileSignature(buffer: Buffer): boolean {
  if (buffer.byteLength < OLE_CFB_SIGNATURE.byteLength) {
    return false;
  }
  for (let index = 0; index < OLE_CFB_SIGNATURE.byteLength; index += 1) {
    if (buffer[index] !== OLE_CFB_SIGNATURE[index]) {
      return false;
    }
  }
  return true;
}
