export const UINT32_MAX = 0xffffffff;

export interface ParsedSerial {
  raw: string;
  value: number;
  sliceNumber: number;
  highBits: number;
  isLastSlice: boolean;
  formattedHex: string;
}

export class SerialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerialValidationError';
  }
}

/** Parse the supplier serial field as a strict decimal uint32 string. */
export function parseSerial(serialInput: string): ParsedSerial {
  const raw = serialInput.trim();

  if (!/^\d+$/.test(raw)) {
    throw new SerialValidationError('serial must be a decimal uint32 string');
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new SerialValidationError('serial must be between 0 and 4294967295');
  }

  const sliceNumber = value & 0xffff;
  if (sliceNumber === 0) {
    throw new SerialValidationError('serial slice number must start from 1');
  }

  const highBits = value >>> 16;
  const isLastSlice = ((highBits >>> 0) & 0x0001) === 1;

  return {
    raw,
    value,
    sliceNumber,
    highBits,
    isLastSlice,
    formattedHex: `0x${value.toString(16).padStart(8, '0')}`
  };
}
