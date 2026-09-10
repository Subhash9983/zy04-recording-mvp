export interface ParsedSerial {
  raw: string;
  value: number;
  sliceIndex: number;
  isLastSlice: boolean;
  formattedHex: string;
}

/**
 * Parses the supplier serial field.
 * Low 16 bits represent the slice sequence number (1-based).
 * High 16 bits contain flags (0x0001 indicates last/end slice).
 */
export function parseSerial(serialInput: string | number): ParsedSerial {
  const rawStr = String(serialInput).trim();
  let num: number;

  if (rawStr.startsWith('0x') || rawStr.startsWith('0X')) {
    num = parseInt(rawStr, 16);
  } else if (/^[0-9a-fA-F]{8}$/.test(rawStr)) {
    num = parseInt(rawStr, 16);
  } else {
    num = parseInt(rawStr, 10);
  }

  if (isNaN(num)) {
    num = 1;
  }

  const sliceIndex = num & 0xffff;
  const highBits = (num >>> 16) & 0xffff;
  const isLastSlice = (highBits & 0x0001) === 1 || highBits > 0;

  const formattedHex = '0x' + num.toString(16).padStart(8, '0');

  return {
    raw: rawStr,
    value: num,
    sliceIndex,
    isLastSlice,
    formattedHex
  };
}
