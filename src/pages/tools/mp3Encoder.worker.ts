import * as lamejs from '@breezystack/lamejs';

self.onmessage = function (e: MessageEvent) {
  const { leftChannel, rightChannel, sampleRate, numChannels, kbps = 192 } = e.data;

  try {
    const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
    const mp3Data: Uint8Array[] = [];

    // Convert Float32Array to Int16Array
    const convertFloat32ToInt16 = (buffer: Float32Array) => {
      const l = buffer.length;
      const buf = new Int16Array(l);
      for (let i = 0; i < l; i++) {
        // Clamp to [-1.0, 1.0] to prevent clipping
        const s = Math.max(-1, Math.min(1, buffer[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return buf;
    };

    const leftInt16 = convertFloat32ToInt16(leftChannel);
    const rightInt16 = rightChannel ? convertFloat32ToInt16(rightChannel) : null;

    const sampleBlockSize = 1152;
    const totalSamples = leftInt16.length;
    let processed = 0;
    let lastProgressReported = -1;

    while (processed < totalSamples) {
      const chunkSize = Math.min(sampleBlockSize, totalSamples - processed);
      const leftChunk = leftInt16.subarray(processed, processed + chunkSize);
      
      let mp3buf: Uint8Array;
      if (numChannels === 2 && rightInt16) {
        const rightChunk = rightInt16.subarray(processed, processed + chunkSize);
        mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        mp3buf = encoder.encodeBuffer(leftChunk);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      processed += chunkSize;

      // Report progress periodically (throttle updates to avoid flooding main thread)
      const progress = Math.round((processed / totalSamples) * 100);
      if (progress !== lastProgressReported) {
        self.postMessage({ type: 'progress', progress });
        lastProgressReported = progress;
      }
    }

    // Flush encoder to write final frames
    const mp3buf = encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    self.postMessage({ type: 'done', mp3Data });
  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
};
