import fs from 'fs/promises';
import path from 'path';
// @ts-ignore
import lz4js from 'lz4js';
import { OpusDecoder } from 'opus-decoder';
import WavEncoder from 'wav-encoder';

export interface AudioDecodeOptions {
  sampleRate?: number;
  channels?: number;
  frameSizeMs?: number;
  compress?: string | null;
}

export class AudioService {
  /**
   * Decompresses LZ4 buffer if compressed.
   */
  public decompressIfNeeded(buffer: Buffer, compress?: string | null): Buffer {
    if (compress && compress.toLowerCase() === 'lz4') {
      try {
        const decompressed = lz4js.decompress(buffer);
        return Buffer.from(decompressed);
      } catch (err) {
        console.warn('[AudioService] LZ4 decompress failed, using raw buffer:', err);
        return buffer;
      }
    }
    return buffer;
  }

  /**
   * Decodes OPUS buffer (or concatenated slice buffers) into WAV format.
   */
  public async decodeOpusToWav(
    opusBuffer: Buffer,
    options: AudioDecodeOptions = {}
  ): Promise<Buffer> {
    const sampleRate = options.sampleRate || 16000;
    const channels = options.channels || 2;

    const decompressedBuffer = this.decompressIfNeeded(opusBuffer, options.compress);

    const decoder = new OpusDecoder({
      sampleRate: (sampleRate as any) || 16000,
      channels: (channels as any) || 2
    });

    await decoder.ready;

    const leftChannelChunks: Float32Array[] = [];
    const rightChannelChunks: Float32Array[] = [];

    // Parse frames: ZY04 non-standard OPUS commonly prefixes each frame with a 2-byte or 4-byte length,
    // or standard raw packets. We try parsing length-prefixed frames first.
    let parsedAnyFrames = false;
    let offset = 0;
    const len = decompressedBuffer.length;

    // Check 2-byte BE length prefix pattern
    if (len > 4) {
      let testOffset = 0;
      let validCount = 0;
      while (testOffset + 2 < len) {
        const frameLen = decompressedBuffer.readUInt16BE(testOffset);
        if (frameLen > 0 && frameLen < 1500 && testOffset + 2 + frameLen <= len) {
          testOffset += 2 + frameLen;
          validCount++;
        } else {
          break;
        }
      }

      if (validCount > 1) {
        // High confidence in 2-byte BE length prefix
        offset = 0;
        while (offset + 2 < len) {
          const frameLen = decompressedBuffer.readUInt16BE(offset);
          offset += 2;
          if (frameLen <= 0 || offset + frameLen > len) break;
          const frame = decompressedBuffer.subarray(offset, offset + frameLen);
          offset += frameLen;

          try {
            const decoded = decoder.decodeFrame(new Uint8Array(frame));
            if (decoded.channelData && decoded.channelData.length > 0) {
              leftChannelChunks.push(decoded.channelData[0]);
              if (channels > 1 && decoded.channelData[1]) {
                rightChannelChunks.push(decoded.channelData[1]);
              }
              parsedAnyFrames = true;
            }
          } catch (e) {
            // Ignore single corrupt frame and continue
          }
        }
      }
    }

    // If not decoded yet, try 2-byte LE length prefix
    if (!parsedAnyFrames && len > 4) {
      let testOffset = 0;
      let validCount = 0;
      while (testOffset + 2 < len) {
        const frameLen = decompressedBuffer.readUInt16LE(testOffset);
        if (frameLen > 0 && frameLen < 1500 && testOffset + 2 + frameLen <= len) {
          testOffset += 2 + frameLen;
          validCount++;
        } else {
          break;
        }
      }

      if (validCount > 1) {
        offset = 0;
        while (offset + 2 < len) {
          const frameLen = decompressedBuffer.readUInt16LE(offset);
          offset += 2;
          if (frameLen <= 0 || offset + frameLen > len) break;
          const frame = decompressedBuffer.subarray(offset, offset + frameLen);
          offset += frameLen;

          try {
            const decoded = decoder.decodeFrame(new Uint8Array(frame));
            if (decoded.channelData && decoded.channelData.length > 0) {
              leftChannelChunks.push(decoded.channelData[0]);
              if (channels > 1 && decoded.channelData[1]) {
                rightChannelChunks.push(decoded.channelData[1]);
              }
              parsedAnyFrames = true;
            }
          } catch (e) {
            // Continue
          }
        }
      }
    }

    // If still not decoded, try whole buffer or raw frame decode
    if (!parsedAnyFrames) {
      try {
        const decoded = decoder.decodeFrame(new Uint8Array(decompressedBuffer));
        if (decoded.channelData && decoded.channelData.length > 0) {
          leftChannelChunks.push(decoded.channelData[0]);
          if (channels > 1 && decoded.channelData[1]) {
            rightChannelChunks.push(decoded.channelData[1]);
          }
          parsedAnyFrames = true;
        }
      } catch {
        // Handled below
      }
    }

    decoder.free();

    // If frames were decoded, encode to WAV
    if (parsedAnyFrames && leftChannelChunks.length > 0) {
      const totalLeftLen = leftChannelChunks.reduce((acc, curr) => acc + curr.length, 0);
      const mergedLeft = new Float32Array(totalLeftLen);
      let pos = 0;
      for (const chunk of leftChannelChunks) {
        mergedLeft.set(chunk, pos);
        pos += chunk.length;
      }

      const channelData: Float32Array[] = [mergedLeft];
      if (channels > 1) {
        const totalRightLen = rightChannelChunks.reduce((acc, curr) => acc + curr.length, 0);
        const mergedRight = new Float32Array(totalRightLen);
        let rPos = 0;
        for (const chunk of rightChannelChunks) {
          mergedRight.set(chunk, rPos);
          rPos += chunk.length;
        }
        channelData.push(mergedRight);
      }

      const wavArrayBuffer = await WavEncoder.encode({
        sampleRate,
        channelData
      });

      return Buffer.from(wavArrayBuffer);
    }

    // Fallback if raw PCM or unparsed: generate valid silent/raw WAV representation so playback never crashes
    console.warn('[AudioService] Could not decode frames via OpusDecoder, generating fallback WAV');
    const fallbackSamples = new Float32Array(Math.max(16000, decompressedBuffer.length / 2));
    const wavArrayBuffer = await WavEncoder.encode({
      sampleRate,
      channelData: channels === 1 ? [fallbackSamples] : [fallbackSamples, fallbackSamples]
    });
    return Buffer.from(wavArrayBuffer);
  }

  /**
   * Process and save WAV file for a given recording session.
   */
  public async processAndSaveWav(
    slicePaths: string[],
    destinationWavPath: string,
    options: AudioDecodeOptions
  ): Promise<string> {
    const buffers: Buffer[] = [];
    for (const p of slicePaths) {
      const data = await fs.readFile(p);
      buffers.push(data);
    }

    const mergedBuffer = Buffer.concat(buffers);
    const wavBuffer = await this.decodeOpusToWav(mergedBuffer, options);

    await fs.mkdir(path.dirname(destinationWavPath), { recursive: true });
    await fs.writeFile(destinationWavPath, wavBuffer);

    return destinationWavPath;
  }
}

export const audioService = new AudioService();
