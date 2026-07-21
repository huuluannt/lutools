export interface Mp3Frame {
  offset: number;
  length: number;
  start: number;
  duration: number;
}

export interface Mp3Analysis {
  frames: Mp3Frame[];
  duration: number;
  sampleRate: number;
  channels: 1 | 2;
  averageBitrate: number;
  bitrateMode: 'CBR' | 'VBR';
  metadataEnd: number;
}

export interface TrimmedMp3 {
  blob: Blob;
  start: number;
  end: number;
  duration: number;
  frameCount: number;
}

interface FrameHeader {
  version: 1 | 2 | 2.5;
  layer: 1 | 2 | 3;
  bitrate: number;
  sampleRate: number;
  padding: number;
  channels: 1 | 2;
  hasCrc: boolean;
  frameLength: number;
  samplesPerFrame: number;
}

interface RawFrame extends Mp3Frame {
  header: FrameHeader;
}

const MPEG1_BITRATES = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
} as const;

const MPEG2_BITRATES = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;

const SAMPLE_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  2.5: [11025, 12000, 8000],
} as const;

function parseFrameHeader(data: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > data.length || data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (data[offset + 1] >> 3) & 0x03;
  const layerBits = (data[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (data[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (data[offset + 2] >> 2) & 0x03;
  const padding = (data[offset + 2] >> 1) & 0x01;
  const emphasis = data[offset + 3] & 0x03;

  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3 || emphasis === 2) {
    return null;
  }

  const version: FrameHeader['version'] = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as FrameHeader['layer'];
  const rates = version === 1 ? MPEG1_BITRATES[layer] : MPEG2_BITRATES[layer];
  const bitrate = rates[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;

  let frameLength: number;
  if (layer === 1) {
    frameLength = Math.floor((12 * bitrate * 1000) / sampleRate + padding) * 4;
  } else if (layer === 3 && version !== 1) {
    frameLength = Math.floor((72 * bitrate * 1000) / sampleRate) + padding;
  } else {
    frameLength = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
  }

  if (frameLength < 4 || offset + frameLength > data.length) {
    return null;
  }

  return {
    version,
    layer,
    bitrate,
    sampleRate,
    padding,
    channels: ((data[offset + 3] >> 6) & 0x03) === 3 ? 1 : 2,
    hasCrc: (data[offset + 1] & 0x01) === 0,
    frameLength,
    samplesPerFrame,
  };
}

function headersMatch(a: FrameHeader, b: FrameHeader) {
  return a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate;
}

function readId3v2End(data: Uint8Array) {
  let offset = 0;

  while (
    offset + 10 <= data.length &&
    data[offset] === 0x49 &&
    data[offset + 1] === 0x44 &&
    data[offset + 2] === 0x33
  ) {
    const flags = data[offset + 5];
    const size =
      (data[offset + 6] & 0x7f) * 0x200000 +
      (data[offset + 7] & 0x7f) * 0x4000 +
      (data[offset + 8] & 0x7f) * 0x80 +
      (data[offset + 9] & 0x7f);
    const tagLength = 10 + size + ((flags & 0x10) !== 0 ? 10 : 0);

    if (offset + tagLength > data.length) break;
    offset += tagLength;
  }

  return offset;
}

function hasText(data: Uint8Array, offset: number, text: string) {
  if (offset < 0 || offset + text.length > data.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (data[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function isVbrMetadataFrame(data: Uint8Array, frame: RawFrame) {
  if (frame.header.layer !== 3) return false;

  const sideInfoLength = frame.header.version === 1
    ? (frame.header.channels === 1 ? 17 : 32)
    : (frame.header.channels === 1 ? 9 : 17);
  const xingOffset = frame.offset + 4 + (frame.header.hasCrc ? 2 : 0) + sideInfoLength;
  const vbriOffset = frame.offset + 4 + 32;

  return hasText(data, xingOffset, 'Xing') || hasText(data, xingOffset, 'Info') || hasText(data, vbriOffset, 'VBRI');
}

function findFirstFrame(data: Uint8Array, start: number, audioEnd: number) {
  const scanEnd = Math.min(audioEnd - 4, start + 1024 * 1024);

  for (let offset = start; offset <= scanEnd; offset += 1) {
    const header = parseFrameHeader(data, offset);
    if (!header) continue;

    const nextOffset = offset + header.frameLength;
    if (nextOffset >= audioEnd - 3) return offset;

    const nextHeader = parseFrameHeader(data, nextOffset);
    if (nextHeader && headersMatch(header, nextHeader)) return offset;
  }

  return -1;
}

export function analyzeMp3(buffer: ArrayBuffer): Mp3Analysis {
  const data = new Uint8Array(buffer);
  const metadataEnd = readId3v2End(data);
  const hasId3v1 = data.length >= 128 && hasText(data, data.length - 128, 'TAG');
  const audioEnd = hasId3v1 ? data.length - 128 : data.length;
  const firstFrameOffset = findFirstFrame(data, metadataEnd, audioEnd);

  if (firstFrameOffset < 0) {
    throw new Error('This file does not contain a supported MP3 audio stream.');
  }

  const firstHeader = parseFrameHeader(data, firstFrameOffset);
  if (!firstHeader) {
    throw new Error('The MP3 frame header could not be read.');
  }

  const rawFrames: RawFrame[] = [];
  let offset = firstFrameOffset;
  let time = 0;

  while (offset + 4 <= audioEnd) {
    const header = parseFrameHeader(data, offset);

    if (!header || !headersMatch(firstHeader, header) || offset + header.frameLength > audioEnd) {
      let recoveredOffset = -1;
      const recoveryEnd = Math.min(audioEnd - 4, offset + 4096);
      for (let candidate = offset + 1; candidate <= recoveryEnd; candidate += 1) {
        const recoveredHeader = parseFrameHeader(data, candidate);
        if (recoveredHeader && headersMatch(firstHeader, recoveredHeader)) {
          recoveredOffset = candidate;
          break;
        }
      }
      if (recoveredOffset < 0) break;
      offset = recoveredOffset;
      continue;
    }

    const frameDuration = header.samplesPerFrame / header.sampleRate;
    rawFrames.push({
      offset,
      length: header.frameLength,
      start: time,
      duration: frameDuration,
      header,
    });
    time += frameDuration;
    offset += header.frameLength;
  }

  if (rawFrames.length < 2) {
    throw new Error('The MP3 file is too short or incomplete.');
  }

  if (isVbrMetadataFrame(data, rawFrames[0])) {
    rawFrames.shift();
  }

  if (rawFrames.length === 0) {
    throw new Error('No audio frames were found after the MP3 metadata.');
  }

  time = 0;
  const frames = rawFrames.map<Mp3Frame>((frame) => {
    const normalizedFrame = {
      offset: frame.offset,
      length: frame.length,
      start: time,
      duration: frame.duration,
    };
    time += frame.duration;
    return normalizedFrame;
  });

  const audioBytes = frames.reduce((total, frame) => total + frame.length, 0);
  const bitrates = new Set(rawFrames.map((frame) => frame.header.bitrate));

  return {
    frames,
    duration: time,
    sampleRate: firstHeader.sampleRate,
    channels: firstHeader.channels,
    averageBitrate: Math.round((audioBytes * 8) / time / 1000),
    bitrateMode: bitrates.size > 1 ? 'VBR' : 'CBR',
    metadataEnd,
  };
}

function boundaryTime(analysis: Mp3Analysis, index: number) {
  return index >= analysis.frames.length ? analysis.duration : analysis.frames[index].start;
}

function nearestBoundary(analysis: Mp3Analysis, requestedTime: number) {
  const target = Math.max(0, Math.min(requestedTime, analysis.duration));
  let low = 0;
  let high = analysis.frames.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaryTime(analysis, middle) < target) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return 0;
  const previous = low - 1;
  return Math.abs(boundaryTime(analysis, low) - target) < Math.abs(boundaryTime(analysis, previous) - target)
    ? low
    : previous;
}

export function trimMp3(
  buffer: ArrayBuffer,
  analysis: Mp3Analysis,
  requestedStart: number,
  requestedEnd: number,
): TrimmedMp3 {
  let startIndex = nearestBoundary(analysis, requestedStart);
  let endIndex = nearestBoundary(analysis, requestedEnd);

  if (startIndex >= analysis.frames.length) startIndex = analysis.frames.length - 1;
  if (endIndex <= startIndex) endIndex = Math.min(analysis.frames.length, startIndex + 1);

  const parts: BlobPart[] = [];
  if (analysis.metadataEnd > 0) {
    parts.push(buffer.slice(0, analysis.metadataEnd));
  }

  let segmentStart = analysis.frames[startIndex].offset;
  let segmentEnd = segmentStart + analysis.frames[startIndex].length;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const frame = analysis.frames[index];
    if (frame.offset === segmentEnd) {
      segmentEnd += frame.length;
    } else {
      parts.push(buffer.slice(segmentStart, segmentEnd));
      segmentStart = frame.offset;
      segmentEnd = frame.offset + frame.length;
    }
  }
  parts.push(buffer.slice(segmentStart, segmentEnd));

  const start = boundaryTime(analysis, startIndex);
  const end = boundaryTime(analysis, endIndex);

  return {
    blob: new Blob(parts, { type: 'audio/mpeg' }),
    start,
    end,
    duration: end - start,
    frameCount: endIndex - startIndex,
  };
}
