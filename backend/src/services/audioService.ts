import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { OpusDecoder } from 'opus-decoder';
import WavEncoder from 'wav-encoder';

export interface AudioDecodeOptions {
  sampleRate?: number;
  channels?: number;
  compress?: string | null;
}

type Endian = 'BE' | 'LE';

export class AudioService {
  private splitLengthPrefixedFrames(buffer: Buffer, endian: Endian): Buffer[] | null {
    const frames: Buffer[] = [];
    let offset = 0;

    while (offset + 2 <= buffer.length) {
      const frameLength = endian === 'BE'
        ? buffer.readUInt16BE(offset)
        : buffer.readUInt16LE(offset);
      offset += 2;

      if (frameLength <= 0 || frameLength >= 1500 || offset + frameLength > buffer.length) {
        return null;
      }

      frames.push(buffer.subarray(offset, offset + frameLength));
      offset += frameLength;
    }

    return offset === buffer.length && frames.length > 1 ? frames : null;
  }

  private async decodePackets(
    packets: Buffer[],
    sampleRate: number,
    channels: number
  ): Promise<Float32Array[]> {
    const decoder = new OpusDecoder({
      sampleRate: sampleRate as any,
      channels: channels as any
    });

    try {
      await decoder.ready;
      const channelChunks: Float32Array[][] = Array.from({ length: channels }, () => []);

      for (const packet of packets) {
        const decoded = decoder.decodeFrame(new Uint8Array(packet));
        if (!decoded.channelData || decoded.channelData.length < channels) {
          throw new Error('Opus packet did not produce all expected channels');
        }

        for (let channel = 0; channel < channels; channel += 1) {
          const samples = decoded.channelData[channel];
          if (!samples || samples.length === 0) {
            throw new Error('Opus packet produced no audio samples');
          }
          channelChunks[channel].push(samples);
        }
      }

      return channelChunks.map((chunks) => {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (totalLength === 0) {
          throw new Error('Opus decoding produced no audio samples');
        }
        const merged = new Float32Array(totalLength);
        let position = 0;
        for (const chunk of chunks) {
          merged.set(chunk, position);
          position += chunk.length;
        }
        return merged;
      });
    } finally {
      decoder.free();
    }
  }

  /** Decode uncompressed input only. LZ4 remains isolated until its framing is confirmed. */
  public async decodeOpusToWav(
    opusBuffer: Buffer,
    options: AudioDecodeOptions = {}
  ): Promise<Buffer> {
    if (options.compress) {
      throw new Error('Compressed recording decoding is disabled pending supplier LZ4 framing confirmation');
    }
    if (opusBuffer.length === 0) {
      throw new Error('Cannot decode an empty Opus buffer');
    }

    const sampleRate = options.sampleRate || 16000;
    const channels = options.channels || 2;
    const candidates: Buffer[][] = [];
    const bigEndianFrames = this.splitLengthPrefixedFrames(opusBuffer, 'BE');
    const littleEndianFrames = this.splitLengthPrefixedFrames(opusBuffer, 'LE');
    if (bigEndianFrames) candidates.push(bigEndianFrames);
    if (littleEndianFrames) candidates.push(littleEndianFrames);
    candidates.push([opusBuffer]);

    let lastError: unknown;
    for (const packets of candidates) {
      try {
        const channelData = await this.decodePackets(packets, sampleRate, channels);
        const wavArrayBuffer = await WavEncoder.encode({ sampleRate, channelData });
        const wavBuffer = Buffer.from(wavArrayBuffer);
        if (wavBuffer.length <= 44) {
          throw new Error('WAV output contains no audio payload');
        }
        return wavBuffer;
      } catch (error) {
        lastError = error;
      }
    }

    const reason = lastError instanceof Error ? lastError.message : 'unknown decoder failure';
    throw new Error(`Opus decoding failed: ${reason}`);
  }

  /** Write a complete temporary WAV and atomically publish it only after decoding succeeds. */
  public async processAndSaveWav(
    slicePaths: string[],
    destinationWavPath: string,
    options: AudioDecodeOptions
  ): Promise<string> {
    if (options.compress) {
      throw new Error('LZ4 recording cannot be decoded before supplier framing confirmation');
    }

    const buffers = await Promise.all(slicePaths.map((slicePath) => fs.readFile(slicePath)));
    const wavBuffer = await this.decodeOpusToWav(Buffer.concat(buffers), options);
    const temporaryPath = `${destinationWavPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;

    await fs.mkdir(path.dirname(destinationWavPath), { recursive: true });
    try {
      try {
        await fs.access(destinationWavPath);
        throw new Error('A WAV output already exists for this session');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
      }

      await fs.writeFile(temporaryPath, wavBuffer, { flag: 'wx' });
      await fs.rename(temporaryPath, destinationWavPath);
      return destinationWavPath;
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

export const audioService = new AudioService();
