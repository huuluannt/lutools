import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileVideo,
  Film,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

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

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

interface TimeInputError {
  field: TimeField;
  message: string;
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'];
const FFMPEG_CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

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

function getExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function mimeTypeForExtension(extension: string) {
  if (extension === 'webm') return 'video/webm';
  if (extension === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'loadeddata' | 'seeked') {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The browser took too long to read this video.'));
    }, 20000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, handleReady);
      video.removeEventListener('error', handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('This video format or codec cannot be previewed by your browser.'));
    };

    video.addEventListener(eventName, handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

async function inspectVideo(sourceUrl: string, thumbnailCount = 10) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;

  try {
    await waitForVideoEvent(video, 'loadedmetadata');
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('The video duration could not be detected.');
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, 'loadeddata');
    }

    const info: VideoInfo = {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    const thumbnails: string[] = [];

    if (context && info.width > 0 && info.height > 0) {
      for (let index = 0; index < thumbnailCount; index += 1) {
        const requestedTime = thumbnailCount === 1
          ? 0
          : (index / (thumbnailCount - 1)) * Math.max(0, info.duration - 0.05);

        if (Math.abs(video.currentTime - requestedTime) > 0.01) {
          const seeked = waitForVideoEvent(video, 'seeked');
          video.currentTime = requestedTime;
          await seeked;
        }

        const scale = Math.max(canvas.width / info.width, canvas.height / info.height);
        const drawWidth = info.width * scale;
        const drawHeight = info.height * scale;
        context.fillStyle = '#0a0a0c';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          video,
          (canvas.width - drawWidth) / 2,
          (canvas.height - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
        thumbnails.push(canvas.toDataURL('image/jpeg', 0.68));
      }
    }

    return { info, thumbnails };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

export default function TrimVideo() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ToolStatus>('empty');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [startInput, setStartInput] = useState('0:00.00');
  const [endInput, setEndInput] = useState('0:00.00');
  const [timeInputError, setTimeInputError] = useState<TimeInputError | null>(null);
  const [processStage, setProcessStage] = useState('');
  const [progress, setProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const outputUrlRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const loadIdRef = useRef(0);
  const playbackStopRef = useRef(0);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const duration = videoInfo?.duration ?? 0;
  const minimumSelection = Math.min(0.1, duration || 0.1);

  const clearOutput = useCallback(() => {
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    outputUrlRef.current = null;
    setOutputUrl(null);
    setOutputBlob(null);
    setStatus((currentStatus) => currentStatus === 'done' ? 'ready' : currentStatus);
  }, []);

  const pauseVideo = useCallback(() => {
    videoRef.current?.pause();
    setPlaybackMode(null);
  }, []);

  const resetTool = useCallback(() => {
    loadIdRef.current += 1;
    pauseVideo();
    clearOutput();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
    setFile(null);
    setVideoInfo(null);
    setThumbnails([]);
    setSelection({ start: 0, end: 0 });
    setStartInput('0:00.00');
    setEndInput('0:00.00');
    setSourceUrl(null);
    setErrorMessage(null);
    setTimeInputError(null);
    setCurrentTime(0);
    setProgress(0);
    setProcessStage('');
    setStatus('empty');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [clearOutput, pauseVideo]);

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      ffmpegRef.current?.terminate();
      ffmpegRef.current = null;
    };
  }, []);

  const selectFile = useCallback(async (selectedFile: File) => {
    const extension = getExtension(selectedFile.name);
    const isVideo = selectedFile.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(extension);
    if (!isVideo || !VIDEO_EXTENSIONS.includes(extension)) {
      setErrorMessage('Please choose an MP4, WebM, MOV, or M4V video.');
      setStatus('error');
      return;
    }

    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    pauseVideo();
    clearOutput();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    const nextSourceUrl = URL.createObjectURL(selectedFile);
    sourceUrlRef.current = nextSourceUrl;
    setSourceUrl(nextSourceUrl);
    setFile(selectedFile);
    setVideoInfo(null);
    setThumbnails([]);
    setErrorMessage(null);
    setTimeInputError(null);
    setCurrentTime(0);
    setStatus('loading');

    try {
      const inspectedVideo = await inspectVideo(nextSourceUrl);
      if (loadIdRef.current !== loadId) return;

      setVideoInfo(inspectedVideo.info);
      setThumbnails(inspectedVideo.thumbnails);
      setSelection({ start: 0, end: inspectedVideo.info.duration });
      setStartInput(formatTime(0));
      setEndInput(formatTime(inspectedVideo.info.duration));
      setStatus('ready');
    } catch (error) {
      if (loadIdRef.current !== loadId) return;
      URL.revokeObjectURL(nextSourceUrl);
      sourceUrlRef.current = null;
      setSourceUrl(null);
      setFile(null);
      setErrorMessage(error instanceof Error ? error.message : 'The video could not be loaded.');
      setStatus('error');
    }
  }, [clearOutput, pauseVideo]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const pastedFile = Array.from(event.clipboardData?.files ?? []).find((item) => {
        const extension = getExtension(item.name);
        return item.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(extension);
      });
      if (pastedFile) {
        event.preventDefault();
        void selectFile(pastedFile);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [selectFile]);

  const updateSelection = useCallback((nextSelection: Selection) => {
    const video = videoRef.current;
    if (video && !video.paused) {
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
      const timeline = timelineRef.current;
      if (!drag || !timeline || duration <= 0) return;

      const width = timeline.getBoundingClientRect().width;
      if (width <= 0) return;
      const delta = ((event.clientX - drag.originX) / width) * duration;

      if (drag.mode === 'start') {
        updateSelection({
          start: clamp(drag.originStart + delta, 0, drag.originEnd - minimumSelection),
          end: drag.originEnd,
        });
      } else {
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

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const timeline = timelineRef.current;
    if (!timeline || duration <= 0) return;
    const bounds = timeline.getBoundingClientRect();
    const video = videoRef.current;
    const isPlaying = Boolean(video && !video.paused);
    const latestPlayableTime = isPlaying ? Math.max(0, duration - 0.01) : duration;
    const time = clamp(((event.clientX - bounds.left) / bounds.width) * duration, 0, latestPlayableTime);

    if (video) {
      if (isPlaying) {
        playbackStopRef.current = duration;
        setPlaybackMode('current');
      }
      video.currentTime = time;
    }
    setCurrentTime(time);
  };

  const handleHandleKeyDown = (mode: DragMode, event: React.KeyboardEvent<HTMLButtonElement>) => {
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

  const togglePlayback = async (mode: Exclude<PlaybackMode, null>) => {
    const video = videoRef.current;
    if (!video) return;

    if (!video.paused && playbackMode === mode) {
      pauseVideo();
      return;
    }

    pauseVideo();
    const playbackStart = mode === 'start'
      ? selection.start
      : mode === 'end'
        ? Math.max(0, selection.end - 10)
        : clamp(currentTime, 0, Math.max(0, duration - 0.01));
    playbackStopRef.current = mode === 'current' ? duration : selection.end;
    video.currentTime = playbackStart;
    setCurrentTime(playbackStart);

    try {
      await video.play();
      setPlaybackMode(mode);
    } catch {
      setErrorMessage('Playback could not start in this browser.');
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused && video.currentTime >= playbackStopRef.current - 0.015) {
      video.pause();
      video.currentTime = playbackStopRef.current;
      setPlaybackMode(null);
    }
    setCurrentTime(video.currentTime);
  };

  const loadFfmpeg = async () => {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current;

    setProcessStage('Loading the video engine for the first time…');
    setProgress(4);
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress: nextProgress }) => {
      if (Number.isFinite(nextProgress)) {
        setProgress(clamp(Math.round(nextProgress * 100), 1, 99));
      }
    });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegRef.current = ffmpeg;
      return ffmpeg;
    } catch (error) {
      ffmpeg.terminate();
      throw error;
    }
  };

  const handleTrim = async () => {
    if (!file || !videoInfo) return;
    pauseVideo();
    clearOutput();
    setStatus('trimming');
    setErrorMessage(null);
    setProgress(0);

    const extension = getExtension(file.name);
    const inputName = `input.${extension}`;
    const outputName = `output.${extension}`;
    let ffmpeg: FFmpeg | null = null;

    try {
      ffmpeg = await loadFfmpeg();
      const { fetchFile } = await import('@ffmpeg/util');
      setProcessStage('Preparing your video…');
      setProgress(8);
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      setProcessStage('Trimming without re-encoding…');
      setProgress(10);
      const command = [
        '-y',
        '-ss', selection.start.toFixed(3),
        '-i', inputName,
        '-t', (selection.end - selection.start).toFixed(3),
        '-map', '0:v?',
        '-map', '0:a?',
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
      ];
      if (extension === 'mp4' || extension === 'mov' || extension === 'm4v') {
        command.push('-movflags', '+faststart');
      }
      command.push(outputName);

      const exitCode = await ffmpeg.exec(command);
      if (exitCode !== 0) throw new Error('The video engine could not trim this file.');

      const outputData = await ffmpeg.readFile(outputName);
      if (typeof outputData === 'string') throw new Error('The trimmed video data was invalid.');
      const outputBytes = new Uint8Array(outputData);
      const blob = new Blob([outputBytes.buffer], { type: mimeTypeForExtension(extension) });
      const nextOutputUrl = URL.createObjectURL(blob);
      outputUrlRef.current = nextOutputUrl;
      setOutputBlob(blob);
      setOutputUrl(nextOutputUrl);
      setProgress(100);
      setProcessStage('Complete');
      setStatus('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The selected video could not be trimmed.');
      setStatus('error');
    } finally {
      if (ffmpeg?.loaded) {
        try { await ffmpeg.deleteFile(inputName); } catch { /* File may not exist after a failed write. */ }
        try { await ffmpeg.deleteFile(outputName); } catch { /* File may not exist after a failed trim. */ }
      }
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

  const extension = file ? getExtension(file.name) : 'mp4';
  const outputName = file ? `${file.name.replace(/\.[^.]+$/, '')}-trimmed.${extension}` : 'trimmed-video.mp4';
  const startPercent = duration > 0 ? (selection.start / duration) * 100 : 0;
  const endPercent = duration > 0 ? (selection.end / duration) * 100 : 100;
  const playheadPercent = duration > 0 ? (clamp(currentTime, 0, duration) / duration) * 100 : 0;

  return (
    <div className="tool-container trim-tool video-trim-tool fade-in">
      <div className="tool-header">
        <p className="tool-subtitle">Choose a video segment visually, preview each boundary, and trim it without re-encoding.</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
        className="trim-file-input"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0];
          if (selectedFile) void selectFile(selectedFile);
          event.target.value = '';
        }}
      />

      {(status === 'empty' || (status === 'error' && !file)) && (
        <div
          className={`upload-zone trim-upload-zone video-trim-upload-zone ${dragActive ? 'drag-active' : ''}`}
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
              <h3>Drop your video here</h3>
              <p>or click to choose a file from your device</p>
            </div>
            <span className="trim-upload-badge"><Film size={13} /> MP4 · WebM · MOV · M4V</span>
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
            <strong>Preparing video timeline</strong>
            <span>Reading duration and creating preview frames…</span>
          </div>
        </div>
      )}

      {file && videoInfo && sourceUrl && status !== 'loading' && (
        <div className="trim-editor video-trim-editor">
          <div className="trim-file-row">
            <div className="trim-file-icon"><FileVideo size={21} /></div>
            <div className="trim-file-copy">
              <strong title={file.name}>{file.name}</strong>
              <span>{formatBytes(file.size)} · {formatTime(duration, false)} · {videoInfo.width} × {videoInfo.height} · {extension.toUpperCase()}</span>
            </div>
            <button
              type="button"
              className="trim-icon-button"
              onClick={resetTool}
              disabled={status === 'trimming'}
              aria-label="Remove video"
              title="Remove video"
            >
              <X size={16} />
            </button>
          </div>

          <div className="video-trim-preview-shell">
            <video
              ref={videoRef}
              src={sourceUrl}
              className="video-trim-preview"
              preload="auto"
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onPause={() => setPlaybackMode(null)}
              onEnded={() => setPlaybackMode(null)}
            />
            <div className="video-trim-preview-time">{formatTime(currentTime)} / {formatTime(duration)}</div>
          </div>

          <div className="trim-waveform-section video-trim-timeline-section">
            <div className="trim-waveform-topline">
              <span>Timeline · click anywhere to place the red playhead</span>
              <span><ShieldCheck size={13} /> Private · video stays on your device</span>
            </div>

            <div
              ref={timelineRef}
              className="video-trim-timeline"
              onPointerDown={handleTimelinePointerDown}
              aria-label="Video trim timeline"
            >
              <div className="video-trim-thumbnails" aria-hidden="true">
                {thumbnails.map((thumbnail, index) => (
                  <img key={`${thumbnail.slice(-20)}-${index}`} src={thumbnail} alt="" />
                ))}
              </div>
              <div className="video-trim-mask video-trim-mask-left" style={{ width: `${startPercent}%` }} />
              <div className="video-trim-mask video-trim-mask-right" style={{ width: `${Math.max(0, 100 - endPercent)}%` }} />
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
              <label htmlFor="video-trim-start-time">Start</label>
              <input
                id="video-trim-start-time"
                className={`trim-time-input ${timeInputError?.field === 'start' ? 'invalid' : ''}`}
                value={startInput}
                inputMode="decimal"
                spellCheck={false}
                aria-invalid={timeInputError?.field === 'start'}
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
              <label htmlFor="video-trim-end-time">End</label>
              <input
                id="video-trim-end-time"
                className={`trim-time-input ${timeInputError?.field === 'end' ? 'invalid' : ''}`}
                value={endInput}
                inputMode="decimal"
                spellCheck={false}
                aria-invalid={timeInputError?.field === 'end'}
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
            <div className="trim-time-input-error" role="alert">
              <AlertCircle size={13} /> {timeInputError.message}
            </div>
          )}

          <div className="trim-actions video-trim-actions">
            <div className="trim-playback-controls">
              <button type="button" className={`trim-play-button ${playbackMode === 'current' ? 'active' : ''}`} onClick={() => void togglePlayback('current')}>
                {playbackMode === 'current' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{playbackMode === 'current' ? 'Pause Current' : 'Play Current'}</span>
              </button>
              <button type="button" className={`trim-play-button ${playbackMode === 'start' ? 'active' : ''}`} onClick={() => void togglePlayback('start')}>
                {playbackMode === 'start' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{playbackMode === 'start' ? 'Pause Start' : 'Play Start'}</span>
              </button>
              <button type="button" className={`trim-play-button ${playbackMode === 'end' ? 'active' : ''}`} onClick={() => void togglePlayback('end')}>
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
              {status === 'trimming' ? 'Trimming…' : 'Trim Video'}
            </button>
          </div>

          <div className="video-trim-quality-note">
            <ShieldCheck size={14} /> Original video and audio streams are copied without re-encoding. Cut points snap to the nearest video keyframe.
          </div>

          {status === 'trimming' && (
            <div className="video-trim-progress" aria-live="polite">
              <div className="video-trim-progress-copy">
                <span>{processStage}</span>
                <strong>{progress}%</strong>
              </div>
              <div className="video-trim-progress-track"><div style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          {errorMessage && status === 'error' && (
            <div className="trim-editor-error" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
              <button type="button" onClick={() => setStatus('ready')}>Dismiss</button>
            </div>
          )}

          {status === 'done' && outputBlob && outputUrl && (
            <div className="video-trim-result" aria-live="polite">
              <div className="trim-result-heading">
                <div className="trim-success-icon"><CheckCircle2 size={19} /></div>
                <div>
                  <strong>Your trimmed video is ready</strong>
                  <span>{formatTime(selection.end - selection.start)} · {formatBytes(outputBlob.size)} · original stream quality</span>
                </div>
              </div>
              <video src={outputUrl} controls playsInline preload="metadata" className="video-trim-result-preview" />
              <div className="trim-result-actions">
                <button type="button" className="btn-secondary" onClick={clearOutput}>
                  <RefreshCw size={15} /> Adjust trim
                </button>
                <a href={outputUrl} download={outputName} className="btn-primary trim-download-button">
                  <Download size={15} /> Download Video
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
