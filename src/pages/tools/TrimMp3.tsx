import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { analyzeMp3, trimMp3 } from './mp3TrimUtils';
import type { Mp3Analysis, TrimmedMp3 } from './mp3TrimUtils';

type ToolStatus = 'empty' | 'loading' | 'ready' | 'trimming' | 'done' | 'error';
type DragMode = 'start' | 'end';
type PlaybackMode = 'current' | 'start' | 'end' | null;
type TimeField = 'start' | 'end';

interface Selection {
  start: number;
  end: number;
}

interface DragState {
  mode: DragMode;
  originX: number;
  originStart: number;
  originEnd: number;
}

interface TimeInputError {
  field: TimeField;
  message: string;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatTime(seconds: number, precise = true) {
  if (!Number.isFinite(seconds)) return '0:00.00';
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const secondsText = precise
    ? remainingSeconds.toFixed(2).padStart(5, '0')
    : Math.floor(remainingSeconds).toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secondsText}`
    : `${minutes}:${secondsText}`;
}

function parseTimeInput(value: string) {
  const normalizedValue = value.trim().replace(',', '.');
  if (!normalizedValue) return null;

  const parts = normalizedValue.split(':');
  if (parts.length > 3 || parts.some((part) => part.trim() === '')) return null;
  const values = parts.map(Number);
  if (values.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (values.length === 1) return values[0];
  if (values.length === 2) {
    if (values[1] >= 60) return null;
    return values[0] * 60 + values[1];
  }
  if (values[1] >= 60 || values[2] >= 60) return null;
  return values[0] * 3600 + values[1] * 60 + values[2];
}

function createWaveformPeaks(audioBuffer: AudioBuffer, pointCount = 1400) {
  const peaks = new Float32Array(pointCount);
  const bucketSize = Math.max(1, Math.floor(audioBuffer.length / pointCount));
  const sampleStep = Math.max(1, Math.floor(bucketSize / 180));
  let globalPeak = 0;

  for (let point = 0; point < pointCount; point += 1) {
    const bucketStart = point * bucketSize;
    const bucketEnd = Math.min(audioBuffer.length, bucketStart + bucketSize);
    let peak = 0;

    for (let sample = bucketStart; sample < bucketEnd; sample += sampleStep) {
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
        peak = Math.max(peak, Math.abs(audioBuffer.getChannelData(channel)[sample] ?? 0));
      }
    }

    peaks[point] = peak;
    globalPeak = Math.max(globalPeak, peak);
  }

  if (globalPeak > 0) {
    for (let index = 0; index < peaks.length; index += 1) {
      peaks[index] /= globalPeak;
    }
  }

  return peaks;
}

export default function TrimMp3() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ToolStatus>('empty');
  const [analysis, setAnalysis] = useState<Mp3Analysis | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [output, setOutput] = useState<TrimmedMp3 | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [startInput, setStartInput] = useState('0:00.00');
  const [endInput, setEndInput] = useState('0:00.00');
  const [timeInputError, setTimeInputError] = useState<TimeInputError | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const outputUrlRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const loadIdRef = useRef(0);
  const playbackStopRef = useRef(0);

  const duration = analysis?.duration ?? 0;
  const minimumSelection = analysis?.frames[0]?.duration ?? 0.05;

  const clearOutput = useCallback(() => {
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    outputUrlRef.current = null;
    setOutputUrl(null);
    setOutput(null);
    setStatus((currentStatus) => currentStatus === 'done' ? 'ready' : currentStatus);
  }, []);

  const pauseAudio = useCallback(() => {
    audioRef.current?.pause();
    setPlaybackMode(null);
  }, []);

  const resetTool = useCallback(() => {
    loadIdRef.current += 1;
    pauseAudio();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    sourceUrlRef.current = null;
    outputUrlRef.current = null;
    bufferRef.current = null;
    setFile(null);
    setAnalysis(null);
    setPeaks(null);
    setSelection({ start: 0, end: 0 });
    setStartInput('0:00.00');
    setEndInput('0:00.00');
    setSourceUrl(null);
    setOutputUrl(null);
    setOutput(null);
    setErrorMessage(null);
    setTimeInputError(null);
    setCurrentTime(0);
    setStatus('empty');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [pauseAudio]);

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    };
  }, []);

  const selectFile = useCallback(async (selectedFile: File) => {
    const isMp3 = selectedFile.type === 'audio/mpeg' || selectedFile.type === 'audio/mp3' || /\.mp3$/i.test(selectedFile.name);
    if (!isMp3) {
      setErrorMessage('Please choose a valid MP3 file.');
      setStatus('error');
      return;
    }

    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    pauseAudio();
    clearOutput();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
    bufferRef.current = null;
    setSourceUrl(null);
    setFile(selectedFile);
    setAnalysis(null);
    setPeaks(null);
    setErrorMessage(null);
    setCurrentTime(0);
    setStatus('loading');

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const mp3Analysis = analyzeMp3(arrayBuffer);
      const decodeContext = new AudioContext();
      let audioBuffer: AudioBuffer;

      try {
        audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
      } finally {
        await decodeContext.close();
      }

      if (loadIdRef.current !== loadId) return;

      const nextSourceUrl = URL.createObjectURL(selectedFile);
      bufferRef.current = arrayBuffer;
      sourceUrlRef.current = nextSourceUrl;
      setSourceUrl(nextSourceUrl);
      setAnalysis(mp3Analysis);
      setPeaks(createWaveformPeaks(audioBuffer));
      setSelection({ start: 0, end: mp3Analysis.duration });
      setStartInput(formatTime(0));
      setEndInput(formatTime(mp3Analysis.duration));
      setStatus('ready');
    } catch (error) {
      if (loadIdRef.current !== loadId) return;
      const message = error instanceof Error ? error.message : 'The MP3 file could not be loaded.';
      bufferRef.current = null;
      setFile(null);
      setErrorMessage(message);
      setStatus('error');
    }
  }, [clearOutput, pauseAudio]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pastedFile = Array.from(event.clipboardData?.files ?? []).find((item) => /\.mp3$/i.test(item.name) || item.type === 'audio/mpeg');
      if (pastedFile) {
        event.preventDefault();
        void selectFile(pastedFile);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [selectFile]);

  const updateSelection = useCallback((nextSelection: Selection) => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      playbackStopRef.current = duration;
      setPlaybackMode('current');
    }
    clearOutput();
    setTimeInputError(null);
    setStartInput(formatTime(nextSelection.start));
    setEndInput(formatTime(nextSelection.end));
    setSelection(nextSelection);
  }, [clearOutput, duration]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const track = waveformRef.current;
      if (!drag || !track || duration <= 0) return;

      const width = track.getBoundingClientRect().width;
      if (width <= 0) return;
      const delta = ((event.clientX - drag.originX) / width) * duration;

      if (drag.mode === 'start') {
        updateSelection({
          start: clamp(drag.originStart + delta, 0, drag.originEnd - minimumSelection),
          end: drag.originEnd,
        });
      } else if (drag.mode === 'end') {
        updateSelection({
          start: drag.originStart,
          end: clamp(drag.originEnd + delta, drag.originStart + minimumSelection, duration),
        });
      }
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      document.body.classList.remove('trim-is-dragging');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.classList.remove('trim-is-dragging');
    };
  }, [duration, minimumSelection, updateSelection]);

  const beginDrag = useCallback((mode: DragMode, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      originX: event.clientX,
      originStart: selection.start,
      originEnd: selection.end,
    };
    document.body.classList.add('trim-is-dragging');
  }, [selection]);

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!waveformRef.current || duration <= 0) return;
    const bounds = waveformRef.current.getBoundingClientRect();
    const audio = audioRef.current;
    const isPlaying = Boolean(audio && !audio.paused);
    const latestPlayableTime = isPlaying ? Math.max(0, duration - 0.01) : duration;
    const time = clamp(((event.clientX - bounds.left) / bounds.width) * duration, 0, latestPlayableTime);
    if (audio) {
      if (isPlaying) {
        playbackStopRef.current = duration;
        setPlaybackMode('current');
      }
      audio.currentTime = time;
    }
    setCurrentTime(time);
  };

  const handleHandleKeyDown = (mode: 'start' | 'end', event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const step = event.shiftKey ? 1 : 0.1;

    if (mode === 'start') {
      updateSelection({
        start: clamp(selection.start + direction * step, 0, selection.end - minimumSelection),
        end: selection.end,
      });
    } else {
      updateSelection({
        start: selection.start,
        end: clamp(selection.end + direction * step, selection.start + minimumSelection, duration),
      });
    }
  };

  const commitTimeInput = (field: TimeField) => {
    const value = field === 'start' ? startInput : endInput;
    const parsedTime = parseTimeInput(value);
    let validationMessage: string | null = null;

    if (parsedTime === null) {
      validationMessage = 'Use seconds, mm:ss, or hh:mm:ss.';
    } else if (parsedTime > duration) {
      validationMessage = `Time cannot be later than ${formatTime(duration)}.`;
    } else if (field === 'start' && parsedTime > selection.end - minimumSelection) {
      validationMessage = 'Start must be earlier than End.';
    } else if (field === 'end' && parsedTime < selection.start + minimumSelection) {
      validationMessage = 'End must be later than Start.';
    }

    if (validationMessage || parsedTime === null) {
      setTimeInputError({ field, message: validationMessage ?? 'Enter a valid time.' });
      if (field === 'start') setStartInput(formatTime(selection.start));
      else setEndInput(formatTime(selection.end));
      return;
    }

    setTimeInputError(null);
    updateSelection(field === 'start'
      ? { start: parsedTime, end: selection.end }
      : { start: selection.start, end: parsedTime });
  };

  const handleTimeInputKeyDown = (field: TimeField, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTimeInput(field);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (field === 'start') setStartInput(formatTime(selection.start));
      else setEndInput(formatTime(selection.end));
      setTimeInputError(null);
      event.currentTarget.blur();
    }
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || duration <= 0) return;
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);

    const barCount = Math.max(1, Math.min(peaks.length, Math.floor(bounds.width / 3)));
    const barStep = bounds.width / barCount;
    const barWidth = Math.max(1, barStep * 0.55);
    const centerY = bounds.height / 2;

    for (let index = 0; index < barCount; index += 1) {
      const peakIndex = Math.min(peaks.length - 1, Math.floor((index / barCount) * peaks.length));
      const barHeight = Math.max(2, peaks[peakIndex] * (bounds.height - 24));
      const time = (index / Math.max(1, barCount - 1)) * duration;
      context.fillStyle = time >= selection.start && time <= selection.end ? '#0a0a0c' : '#cfcfd4';
      context.fillRect(index * barStep, centerY - barHeight / 2, barWidth, barHeight);
    }
  }, [duration, peaks, selection.end, selection.start]);

  useEffect(() => {
    drawWaveform();
    const resizeObserver = new ResizeObserver(drawWaveform);
    if (waveformRef.current) resizeObserver.observe(waveformRef.current);
    return () => resizeObserver.disconnect();
  }, [drawWaveform]);

  const togglePlayback = async (mode: Exclude<PlaybackMode, null>) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused && playbackMode === mode) {
      pauseAudio();
      return;
    }

    pauseAudio();
    const playbackStart = mode === 'start'
      ? selection.start
      : mode === 'end'
        ? Math.max(0, selection.end - 10)
        : clamp(currentTime, 0, Math.max(0, duration - 0.01));
    playbackStopRef.current = mode === 'current' ? duration : selection.end;
    audio.currentTime = playbackStart;
    setCurrentTime(playbackStart);

    try {
      await audio.play();
      setPlaybackMode(mode);
    } catch {
      setErrorMessage('Playback could not start in this browser.');
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused && audio.currentTime >= playbackStopRef.current - 0.015) {
      audio.pause();
      audio.currentTime = playbackStopRef.current;
      setPlaybackMode(null);
    }
    setCurrentTime(audio.currentTime);
  };

  const handleTrim = async () => {
    if (!bufferRef.current || !analysis) return;
    pauseAudio();
    clearOutput();
    setStatus('trimming');
    setErrorMessage(null);

    await new Promise<void>((resolve) => window.setTimeout(resolve, 30));

    try {
      const trimmed = trimMp3(bufferRef.current, analysis, selection.start, selection.end);
      const nextOutputUrl = URL.createObjectURL(trimmed.blob);
      outputUrlRef.current = nextOutputUrl;
      setOutput(trimmed);
      setOutputUrl(nextOutputUrl);
      setSelection({ start: trimmed.start, end: trimmed.end });
      setStartInput(formatTime(trimmed.start));
      setEndInput(formatTime(trimmed.end));
      setCurrentTime(trimmed.start);
      setStatus('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The selected audio could not be trimmed.');
      setStatus('error');
    }
  };

  const handleDrag = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(event.type === 'dragenter' || event.type === 'dragover');
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) void selectFile(droppedFile);
  };

  const outputName = file ? `${file.name.replace(/\.mp3$/i, '')}-trimmed.mp3` : 'trimmed.mp3';
  const startPercent = duration > 0 ? (selection.start / duration) * 100 : 0;
  const endPercent = duration > 0 ? (selection.end / duration) * 100 : 100;
  const playheadPercent = duration > 0 ? (clamp(currentTime, 0, duration) / duration) * 100 : 0;

  return (
    <div className="tool-container trim-tool fade-in">
      <div className="tool-header">
        <p className="tool-subtitle">Select the part you want, then create a new MP3 without re-encoding or quality loss.</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,.mp3"
        className="trim-file-input"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0];
          if (selectedFile) void selectFile(selectedFile);
          event.target.value = '';
        }}
      />

      {(status === 'empty' || (status === 'error' && !file)) && (
        <div
          className={`upload-zone trim-upload-zone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
          }}
        >
          <div className="upload-content">
            <div className="icon-wrapper"><Upload size={25} /></div>
            <div>
              <h3>Drop your MP3 here</h3>
              <p>or click to choose a file from your device</p>
            </div>
            <span className="trim-upload-badge"><Music2 size={13} /> MP3 only</span>
            <p className="paste-hint">You can also press <strong>Ctrl + V</strong> to paste</p>
            {errorMessage && (
              <div className="trim-inline-error" role="alert">
                <AlertCircle size={15} /> {errorMessage}
              </div>
            )}
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div className="trim-loading-card" aria-live="polite">
          <div className="spinner" />
          <div>
            <strong>Preparing waveform</strong>
            <span>Reading the MP3 securely in your browser…</span>
          </div>
        </div>
      )}

      {file && analysis && peaks && status !== 'loading' && (
        <div className="trim-editor">
          <div className="trim-file-row">
            <div className="trim-file-icon"><FileAudio size={21} /></div>
            <div className="trim-file-copy">
              <strong title={file.name}>{file.name}</strong>
              <span>
                {formatBytes(file.size)} · {formatTime(duration, false)} · {analysis.averageBitrate} kbps {analysis.bitrateMode} · {(analysis.sampleRate / 1000).toFixed(1)} kHz · {analysis.channels === 2 ? 'Stereo' : 'Mono'}
              </span>
            </div>
            <button type="button" className="trim-icon-button" onClick={resetTool} aria-label="Remove MP3" title="Remove MP3">
              <X size={16} />
            </button>
          </div>

          <div className="trim-waveform-section">
            <div className="trim-waveform-topline">
              <span>Waveform · click anywhere to place the red playhead</span>
              <span><ShieldCheck size={13} /> Private · stays on your device</span>
            </div>

            <div
              ref={waveformRef}
              className="trim-waveform"
              onPointerDown={handleTrackPointerDown}
              aria-label="MP3 trim timeline"
            >
              <canvas ref={canvasRef} className="trim-waveform-canvas" />
              <div
                className="trim-selection"
                style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
              >
                <button
                  type="button"
                  className="trim-handle trim-handle-start"
                  aria-label={`Trim start at ${formatTime(selection.start)}`}
                  onPointerDown={(event) => beginDrag('start', event)}
                  onKeyDown={(event) => handleHandleKeyDown('start', event)}
                ><span /></button>
                <button
                  type="button"
                  className="trim-handle trim-handle-end"
                  aria-label={`Trim end at ${formatTime(selection.end)}`}
                  onPointerDown={(event) => beginDrag('end', event)}
                  onKeyDown={(event) => handleHandleKeyDown('end', event)}
                ><span /></button>
              </div>
              <div className="trim-playhead" style={{ left: `${playheadPercent}%` }} aria-hidden="true" />
            </div>

            <div className="trim-timeline-labels" aria-hidden="true">
              <span>{formatTime(0, false)}</span>
              <span>{formatTime(duration / 2, false)}</span>
              <span>{formatTime(duration, false)}</span>
            </div>
          </div>

          <div className="trim-readouts">
            <div className="trim-time-card">
              <label htmlFor="trim-start-time">Start</label>
              <input
                id="trim-start-time"
                className={`trim-time-input ${timeInputError?.field === 'start' ? 'invalid' : ''}`}
                value={startInput}
                inputMode="decimal"
                spellCheck={false}
                aria-invalid={timeInputError?.field === 'start'}
                aria-describedby={timeInputError?.field === 'start' ? 'trim-time-error' : undefined}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setStartInput(event.target.value);
                  setTimeInputError(null);
                }}
                onBlur={() => commitTimeInput('start')}
                onKeyDown={(event) => handleTimeInputKeyDown('start', event)}
              />
            </div>
            <div className="trim-time-card trim-time-card-duration">
              <span>Selected duration</span>
              <strong>{formatTime(selection.end - selection.start)}</strong>
            </div>
            <div className="trim-time-card">
              <label htmlFor="trim-end-time">End</label>
              <input
                id="trim-end-time"
                className={`trim-time-input ${timeInputError?.field === 'end' ? 'invalid' : ''}`}
                value={endInput}
                inputMode="decimal"
                spellCheck={false}
                aria-invalid={timeInputError?.field === 'end'}
                aria-describedby={timeInputError?.field === 'end' ? 'trim-time-error' : undefined}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setEndInput(event.target.value);
                  setTimeInputError(null);
                }}
                onBlur={() => commitTimeInput('end')}
                onKeyDown={(event) => handleTimeInputKeyDown('end', event)}
              />
            </div>
          </div>

          {timeInputError && (
            <div id="trim-time-error" className="trim-time-input-error" role="alert">
              <AlertCircle size={13} /> {timeInputError.message}
            </div>
          )}

          <div className="trim-actions">
            <div className="trim-playback-controls">
              <button
                type="button"
                className={`trim-play-button ${playbackMode === 'current' ? 'active' : ''}`}
                onClick={() => void togglePlayback('current')}
              >
                {playbackMode === 'current' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{playbackMode === 'current' ? 'Pause Current' : 'Play Current'}</span>
              </button>
              <button
                type="button"
                className={`trim-play-button ${playbackMode === 'start' ? 'active' : ''}`}
                onClick={() => void togglePlayback('start')}
              >
                {playbackMode === 'start' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{playbackMode === 'start' ? 'Pause Start' : 'Play Start'}</span>
              </button>
              <button
                type="button"
                className={`trim-play-button ${playbackMode === 'end' ? 'active' : ''}`}
                onClick={() => void togglePlayback('end')}
              >
                {playbackMode === 'end' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{playbackMode === 'end' ? 'Pause End' : 'Play End'}</span>
              </button>
              <div className="trim-current-time">
                <span>Current</span>
                <strong>{formatTime(currentTime)}</strong>
              </div>
            </div>
            <button type="button" className="btn-primary trim-submit" onClick={() => void handleTrim()} disabled={status === 'trimming'}>
              {status === 'trimming' ? <span className="trim-button-spinner" /> : <Scissors size={16} />}
              {status === 'trimming' ? 'Trimming…' : 'Trim MP3'}
            </button>
          </div>

          {sourceUrl && (
            <audio
              ref={audioRef}
              src={sourceUrl}
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onPause={() => setPlaybackMode(null)}
              onEnded={() => setPlaybackMode(null)}
            />
          )}

          {errorMessage && status === 'error' && (
            <div className="trim-editor-error" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
              <button type="button" onClick={() => setStatus('ready')}>Dismiss</button>
            </div>
          )}

          {status === 'done' && output && outputUrl && (
            <div className="trim-result" aria-live="polite">
              <div className="trim-result-heading">
                <div className="trim-success-icon"><CheckCircle2 size={19} /></div>
                <div>
                  <strong>Your trimmed MP3 is ready</strong>
                  <span>{formatTime(output.duration)} · {formatBytes(output.blob.size)} · original audio quality</span>
                </div>
              </div>
              <audio src={outputUrl} controls preload="metadata" className="trim-result-audio" />
              <div className="trim-result-actions">
                <button type="button" className="btn-secondary" onClick={clearOutput}>
                  <RefreshCw size={15} /> Adjust trim
                </button>
                <a href={outputUrl} download={outputName} className="btn-primary trim-download-button">
                  <Download size={15} /> Download MP3
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
