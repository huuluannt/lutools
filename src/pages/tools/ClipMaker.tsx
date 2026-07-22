import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
  Type,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { exportClipMakerProject } from './clipMakerExport';
import { createClipMakerProjectFile, readClipMakerProjectFile } from './clipMakerProject';
import type {
  ExportProgress,
  MakerClip,
  MakerSelection,
  MakerSound,
  MakerText,
} from './clipMakerTypes';

type DragAction = 'move' | 'trim-start' | 'trim-end';
type DragObjectType = 'clip' | 'sound' | 'text';

interface TimelineDrag {
  type: DragObjectType;
  id: string;
  action: DragAction;
  originX: number;
  start: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
}

interface ClipSegment {
  clip: MakerClip;
  start: number;
  end: number;
  duration: number;
}

interface PreviewTextDrag {
  id: string;
}

const FFMPEG_CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const FFMPEG_MULTI_THREAD_CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/umd';
const MIN_OBJECT_DURATION = 0.2;

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  const secondsText = remaining.toFixed(2).padStart(5, '0');
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secondsText}`
    : `${minutes}:${secondsText}`;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: 'loadedmetadata' | 'loadeddata' | 'seeked',
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The browser took too long to read this media file.'));
    }, 20000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      media.removeEventListener(eventName, handleReady);
      media.removeEventListener('error', handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('This media format or codec cannot be previewed by your browser.'));
    };

    media.addEventListener(eventName, handleReady, { once: true });
    media.addEventListener('error', handleError, { once: true });
  });
}

async function loadVideoClip(file: File, url: string): Promise<MakerClip> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForMediaEvent(video, 'loadedmetadata');
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Video duration could not be detected.');
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForMediaEvent(video, 'loadeddata');

    const thumbnailTime = Math.min(Math.max(0, video.duration * 0.08), Math.max(0, video.duration - 0.05));
    if (thumbnailTime > 0.01) {
      const seeked = waitForMediaEvent(video, 'seeked');
      video.currentTime = thumbnailTime;
      await seeked;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 135;
    const context = canvas.getContext('2d');
    let thumbnail = '';
    if (context && video.videoWidth > 0 && video.videoHeight > 0) {
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.fillStyle = '#0a0a0c';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      thumbnail = canvas.toDataURL('image/jpeg', 0.72);
    }

    return {
      id: createId('clip'),
      kind: 'video',
      file,
      url,
      name: file.name,
      thumbnail,
      sourceDuration: video.duration,
      trimStart: 0,
      trimEnd: video.duration,
      fadeIn: 0,
      fadeOut: 0,
      volume: 1,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function loadImageClip(file: File, url: string): Promise<MakerClip> {
  const image = new Image();
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('This image could not be loaded.'));
  });

  return {
    id: createId('clip'),
    kind: 'image',
    file,
    url,
    name: file.name,
    thumbnail: url,
    sourceDuration: 60,
    trimStart: 0,
    trimEnd: 5,
    fadeIn: 0,
    fadeOut: 0,
    volume: 1,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

async function createAudioPeaks(file: File, count = 72) {
  try {
    const audioContext = new AudioContext();
    try {
      const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      const samples = audioBuffer.getChannelData(0);
      const bucketSize = Math.max(1, Math.floor(samples.length / count));
      const peaks: number[] = [];
      let maximum = 0;
      for (let index = 0; index < count; index += 1) {
        const start = index * bucketSize;
        const end = Math.min(samples.length, start + bucketSize);
        const step = Math.max(1, Math.floor((end - start) / 100));
        let peak = 0;
        for (let sample = start; sample < end; sample += step) peak = Math.max(peak, Math.abs(samples[sample] ?? 0));
        peaks.push(peak);
        maximum = Math.max(maximum, peak);
      }
      return peaks.map((peak) => maximum > 0 ? peak / maximum : 0.15);
    } finally {
      await audioContext.close();
    }
  } catch {
    return Array.from({ length: count }, (_, index) => 0.25 + Math.abs(Math.sin(index * 0.71)) * 0.65);
  }
}

async function loadSound(file: File, url: string, start: number): Promise<MakerSound> {
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.src = url;
  try {
    await waitForMediaEvent(audio, 'loadedmetadata');
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error('Audio duration could not be detected.');
    return {
      id: createId('sound'),
      file,
      url,
      name: file.name,
      sourceDuration: audio.duration,
      trimStart: 0,
      trimEnd: audio.duration,
      start,
      fadeIn: 0,
      fadeOut: 0,
      volume: 1,
      peaks: await createAudioPeaks(file),
    };
  } finally {
    audio.removeAttribute('src');
    audio.load();
  }
}

function clipDuration(clip: MakerClip) {
  return Math.max(MIN_OBJECT_DURATION, clip.trimEnd - clip.trimStart);
}

function soundDuration(sound: MakerSound) {
  return Math.max(MIN_OBJECT_DURATION, sound.trimEnd - sound.trimStart);
}

function fadeOpacity(localTime: number, duration: number, fadeIn: number, fadeOut: number) {
  const fadeInOpacity = fadeIn > 0 ? clamp(localTime / fadeIn, 0, 1) : 1;
  const fadeOutOpacity = fadeOut > 0 ? clamp((duration - localTime) / fadeOut, 0, 1) : 1;
  return Math.min(fadeInOpacity, fadeOutOpacity);
}

export default function ClipMaker() {
  const [clips, setClips] = useState<MakerClip[]>([]);
  const [sounds, setSounds] = useState<MakerSound[]>([]);
  const [texts, setTexts] = useState<MakerText[]>([]);
  const [selection, setSelection] = useState<MakerSelection>(null);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(64);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress>({ stage: '', progress: 0 });
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);

  const clipInputRef = useRef<HTMLInputElement>(null);
  const soundInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TimelineDrag | null>(null);
  const previewTextDragRef = useRef<PreviewTextDrag | null>(null);
  const soundRefs = useRef(new Map<string, HTMLAudioElement>());
  const objectUrlsRef = useRef(new Set<string>());
  const outputUrlRef = useRef<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const clockStartTimeRef = useRef(0);
  const clockStartPlayheadRef = useRef(0);

  const clipSegments = useMemo<ClipSegment[]>(() => {
    return clips.reduce<ClipSegment[]>((segments, clip) => {
      const start = segments.at(-1)?.end ?? 0;
      const duration = clipDuration(clip);
      return [...segments, { clip, start, end: start + duration, duration }];
    }, []);
  }, [clips]);
  const totalDuration = clipSegments.at(-1)?.end ?? 0;
  const timelineDuration = Math.max(12, totalDuration);
  const timelineWidth = Math.max(720, timelineDuration * pixelsPerSecond);
  const tickStep = pixelsPerSecond >= 90 ? 1 : pixelsPerSecond >= 55 ? 2 : 5;
  const rulerTicks = useMemo(
    () => Array.from({ length: Math.ceil(timelineDuration / tickStep) + 1 }, (_, index) => index * tickStep),
    [tickStep, timelineDuration],
  );

  const currentSegment = useMemo(() => {
    if (clipSegments.length === 0) return null;
    return clipSegments.find((segment) => playhead >= segment.start && playhead < segment.end)
      ?? clipSegments.at(-1)
      ?? null;
  }, [clipSegments, playhead]);
  const activeTexts = texts.filter((text) => playhead >= text.start && playhead < text.start + text.duration);
  const currentClipOpacity = currentSegment
    ? fadeOpacity(
        playhead - currentSegment.start,
        currentSegment.duration,
        currentSegment.clip.fadeIn,
        currentSegment.clip.fadeOut,
      )
    : 1;

  const selectedClip = selection?.type === 'clip' ? clips.find((clip) => clip.id === selection.id) ?? null : null;
  const selectedSound = selection?.type === 'sound' ? sounds.find((sound) => sound.id === selection.id) ?? null : null;
  const selectedText = selection?.type === 'text' ? texts.find((text) => text.id === selection.id) ?? null : null;
  const selectedSegment = selectedClip ? clipSegments.find((segment) => segment.clip.id === selectedClip.id) : null;

  const invalidateOutput = useCallback(() => {
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    outputUrlRef.current = null;
    setOutputUrl(null);
    setOutputBlob(null);
  }, []);

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      ffmpegRef.current?.terminate();
      ffmpegRef.current = null;
    };
  }, []);

  const seekTo = useCallback((requestedTime: number) => {
    const nextTime = clamp(requestedTime, 0, totalDuration);
    setPlayhead(nextTime);
    if (isPlaying) {
      clockStartTimeRef.current = performance.now();
      clockStartPlayheadRef.current = nextTime;
    }
  }, [isPlaying, totalDuration]);

  useEffect(() => {
    if (!isPlaying || totalDuration <= 0) return;
    let frame = 0;
    let lastRender = 0;
    const tick = (now: number) => {
      const nextTime = clockStartPlayheadRef.current + (now - clockStartTimeRef.current) / 1000;
      if (nextTime >= totalDuration) {
        setPlayhead(totalDuration);
        setIsPlaying(false);
        return;
      }
      if (now - lastRender >= 32) {
        setPlayhead(nextTime);
        lastRender = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying, totalDuration]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !currentSegment || currentSegment.clip.kind !== 'video') return;
    const expectedTime = currentSegment.clip.trimStart + clamp(playhead - currentSegment.start, 0, currentSegment.duration);
    if (Math.abs(video.currentTime - expectedTime) > 0.22) video.currentTime = expectedTime;
    video.volume = clamp(currentClipOpacity * currentSegment.clip.volume, 0, 1);
    if (isPlaying) {
      if (video.paused) void video.play().catch(() => setIsPlaying(false));
    } else if (!video.paused) {
      video.pause();
    }
  }, [currentClipOpacity, currentSegment, isPlaying, playhead]);

  useEffect(() => {
    sounds.forEach((sound) => {
      const audio = soundRefs.current.get(sound.id);
      if (!audio) return;
      const duration = soundDuration(sound);
      const localTime = playhead - sound.start;
      const active = localTime >= 0 && localTime < duration;
      if (!active) {
        audio.pause();
        return;
      }

      const expectedTime = sound.trimStart + localTime;
      if (Math.abs(audio.currentTime - expectedTime) > 0.25) audio.currentTime = expectedTime;
      const fadeInVolume = sound.fadeIn > 0 ? clamp(localTime / sound.fadeIn, 0, 1) : 1;
      const remaining = duration - localTime;
      const fadeOutVolume = sound.fadeOut > 0 ? clamp(remaining / sound.fadeOut, 0, 1) : 1;
      audio.volume = clamp(sound.volume * Math.min(fadeInVolume, fadeOutVolume), 0, 1);
      if (isPlaying) {
        if (audio.paused) void audio.play().catch(() => undefined);
      } else if (!audio.paused) {
        audio.pause();
      }
    });
  }, [isPlaying, playhead, sounds]);

  const togglePlayback = () => {
    if (totalDuration <= 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const start = playhead >= totalDuration - 0.01 ? 0 : playhead;
    setPlayhead(start);
    clockStartPlayheadRef.current = start;
    clockStartTimeRef.current = performance.now();
    if (start === playhead && currentSegment?.clip.kind === 'video') {
      const video = previewVideoRef.current;
      if (video) {
        video.currentTime = currentSegment.clip.trimStart + clamp(start - currentSegment.start, 0, currentSegment.duration);
        void video.play().catch(() => undefined);
      }
    }
    sounds.forEach((sound) => {
      const localTime = start - sound.start;
      if (localTime >= 0 && localTime < soundDuration(sound)) {
        const audio = soundRefs.current.get(sound.id);
        if (audio) void audio.play().catch(() => undefined);
      }
    });
    setIsPlaying(true);
  };

  const importClips = async (files: FileList | File[]) => {
    setIsImporting(true);
    setErrorMessage(null);
    const imported: MakerClip[] = [];
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) continue;
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.add(url);
        try {
          imported.push(isImage ? await loadImageClip(file, url) : await loadVideoClip(file, url));
        } catch (error) {
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(url);
          throw error;
        }
      }
      if (imported.length === 0) throw new Error('Choose at least one supported video or image file.');
      invalidateOutput();
      setClips((current) => [...current, ...imported]);
      setSelection({ type: 'clip', id: imported.at(-1)!.id });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The visual clips could not be imported.');
    } finally {
      setIsImporting(false);
    }
  };

  const importSounds = async (files: FileList | File[]) => {
    if (totalDuration <= 0) return;
    setIsImporting(true);
    setErrorMessage(null);
    const imported: MakerSound[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/')) continue;
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.add(url);
        try {
          const sound = await loadSound(file, url, Math.min(playhead, Math.max(0, totalDuration - MIN_OBJECT_DURATION)));
          sound.trimEnd = Math.min(sound.trimEnd, Math.max(MIN_OBJECT_DURATION, totalDuration - sound.start));
          imported.push(sound);
        } catch (error) {
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(url);
          throw error;
        }
      }
      if (imported.length === 0) throw new Error('Choose at least one supported audio file.');
      invalidateOutput();
      setSounds((current) => [...current, ...imported]);
      setSelection({ type: 'sound', id: imported.at(-1)!.id });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The sound could not be imported.');
    } finally {
      setIsImporting(false);
    }
  };

  const addText = () => {
    if (totalDuration <= 0) return;
    const start = Math.min(playhead, Math.max(0, totalDuration - MIN_OBJECT_DURATION));
    const text: MakerText = {
      id: createId('text'),
      text: 'Your text',
      start,
      duration: Math.min(3, Math.max(MIN_OBJECT_DURATION, totalDuration - start)),
      color: '#ffffff',
      fontSize: 30,
      fadeIn: 0,
      fadeOut: 0,
      x: 0.5,
      y: 0.5,
    };
    invalidateOutput();
    setTexts((current) => [...current, text]);
    setSelection({ type: 'text', id: text.id });
  };

  const revokeAsset = (url: string) => {
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  const deleteSelected = () => {
    if (!selection) return;
    invalidateOutput();
    if (selection.type === 'clip') {
      const removed = clips.find((clip) => clip.id === selection.id);
      if (removed) revokeAsset(removed.url);
      const nextClips = clips.filter((clip) => clip.id !== selection.id);
      const nextDuration = nextClips.reduce((total, clip) => total + clipDuration(clip), 0);
      setClips(nextClips);
      setPlayhead((current) => Math.min(current, nextDuration));
      if (nextDuration === 0) {
        sounds.forEach((sound) => revokeAsset(sound.url));
        setSounds([]);
        setTexts([]);
        setIsPlaying(false);
      }
    } else if (selection.type === 'sound') {
      const removed = sounds.find((sound) => sound.id === selection.id);
      if (removed) revokeAsset(removed.url);
      setSounds((current) => current.filter((sound) => sound.id !== selection.id));
    } else {
      setTexts((current) => current.filter((text) => text.id !== selection.id));
    }
    setSelection(null);
  };

  const resetProject = () => {
    setIsPlaying(false);
    clips.forEach((clip) => revokeAsset(clip.url));
    sounds.forEach((sound) => revokeAsset(sound.url));
    invalidateOutput();
    setClips([]);
    setSounds([]);
    setTexts([]);
    setSelection(null);
    setPlayhead(0);
    setErrorMessage(null);
    setExportProgress({ stage: '', progress: 0 });
  };

  const saveProject = () => {
    if (clips.length === 0) return;
    setErrorMessage(null);
    try {
      const projectFile = createClipMakerProjectFile(clips, sounds, texts, pixelsPerSecond);
      const url = URL.createObjectURL(projectFile);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `clip-maker-${date}.luclip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The project could not be saved.');
    }
  };

  const openProject = async (file: File) => {
    setIsImporting(true);
    setIsPlaying(false);
    setErrorMessage(null);
    const newUrls: string[] = [];
    try {
      const { manifest, assets } = await readClipMakerProjectFile(file);
      const openedClips = manifest.clips.map(({ assetIndex, ...clip }) => {
        const asset = assets[assetIndex];
        const url = URL.createObjectURL(asset);
        newUrls.push(url);
        return {
          ...clip,
          file: asset,
          url,
          fadeIn: Number.isFinite(clip.fadeIn) ? clip.fadeIn : 0,
          fadeOut: Number.isFinite(clip.fadeOut) ? clip.fadeOut : 0,
          volume: Number.isFinite(clip.volume) ? clamp(clip.volume, 0, 1) : 1,
          thumbnail: clip.kind === 'image' ? url : clip.thumbnail,
        };
      });
      const openedSounds = manifest.sounds.map(({ assetIndex, ...sound }) => {
        const asset = assets[assetIndex];
        const url = URL.createObjectURL(asset);
        newUrls.push(url);
        return {
          ...sound,
          file: asset,
          url,
          volume: Number.isFinite(sound.volume) ? clamp(sound.volume, 0, 1) : 1,
        };
      });
      const openedTexts = manifest.texts.map((text) => ({
        ...text,
        fadeIn: Number.isFinite(text.fadeIn) ? text.fadeIn : 0,
        fadeOut: Number.isFinite(text.fadeOut) ? text.fadeOut : 0,
        x: Number.isFinite(text.x) ? clamp(text.x, 0, 1) : 0.5,
        y: Number.isFinite(text.y) ? clamp(text.y, 0, 1) : 0.5,
      }));

      clips.forEach((clip) => revokeAsset(clip.url));
      sounds.forEach((sound) => revokeAsset(sound.url));
      newUrls.forEach((url) => objectUrlsRef.current.add(url));
      invalidateOutput();
      setClips(openedClips);
      setSounds(openedSounds);
      setTexts(openedTexts);
      setPixelsPerSecond(clamp(manifest.pixelsPerSecond || 64, 36, 128));
      setSelection(null);
      setPlayhead(0);
      setExportProgress({ stage: '', progress: 0 });
    } catch (error) {
      newUrls.forEach((url) => URL.revokeObjectURL(url));
      setErrorMessage(error instanceof Error ? error.message : 'The project could not be opened.');
    } finally {
      setIsImporting(false);
    }
  };

  const beginTimelineDrag = (
    type: DragObjectType,
    id: string,
    action: DragAction,
    event: React.PointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ type, id });

    if (type === 'clip') {
      const clip = clips.find((item) => item.id === id);
      if (!clip) return;
      dragRef.current = {
        type,
        id,
        action,
        originX: event.clientX,
        start: 0,
        duration: clipDuration(clip),
        trimStart: clip.trimStart,
        trimEnd: clip.trimEnd,
      };
    } else if (type === 'sound') {
      const sound = sounds.find((item) => item.id === id);
      if (!sound) return;
      dragRef.current = {
        type,
        id,
        action,
        originX: event.clientX,
        start: sound.start,
        duration: soundDuration(sound),
        trimStart: sound.trimStart,
        trimEnd: sound.trimEnd,
      };
    } else {
      const text = texts.find((item) => item.id === id);
      if (!text) return;
      dragRef.current = {
        type,
        id,
        action,
        originX: event.clientX,
        start: text.start,
        duration: text.duration,
        trimStart: 0,
        trimEnd: text.duration,
      };
    }
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (event.clientX - drag.originX) / pixelsPerSecond;
      invalidateOutput();

      if (drag.type === 'clip') {
        if (drag.action === 'move') {
          const viewport = timelineViewportRef.current;
          if (!viewport) return;
          const bounds = viewport.getBoundingClientRect();
          const pointerTime = (event.clientX - bounds.left + viewport.scrollLeft) / pixelsPerSecond;
          setClips((current) => {
            const currentIndex = current.findIndex((clip) => clip.id === drag.id);
            if (currentIndex < 0) return current;
            let targetIndex = current.length - 1;
            let cursor = 0;
            for (let index = 0; index < current.length; index += 1) {
              const duration = clipDuration(current[index]);
              if (pointerTime < cursor + duration / 2) {
                targetIndex = index;
                break;
              }
              cursor += duration;
            }
            if (targetIndex === currentIndex) return current;
            const reordered = [...current];
            const [dragged] = reordered.splice(currentIndex, 1);
            reordered.splice(targetIndex, 0, dragged);
            return reordered;
          });
          return;
        }
        setClips((current) => current.map((clip) => {
          if (clip.id !== drag.id) return clip;
          if (drag.action === 'trim-start') {
            const trimStart = clamp(drag.trimStart + delta, 0, drag.trimEnd - MIN_OBJECT_DURATION);
            const duration = drag.trimEnd - trimStart;
            return { ...clip, trimStart, fadeIn: Math.min(clip.fadeIn, duration), fadeOut: Math.min(clip.fadeOut, duration) };
          }
          if (drag.action === 'trim-end') {
            const trimEnd = clamp(drag.trimEnd + delta, drag.trimStart + MIN_OBJECT_DURATION, clip.sourceDuration);
            const duration = trimEnd - drag.trimStart;
            return { ...clip, trimEnd, fadeIn: Math.min(clip.fadeIn, duration), fadeOut: Math.min(clip.fadeOut, duration) };
          }
          return clip;
        }));
      } else if (drag.type === 'sound') {
        setSounds((current) => current.map((sound) => {
          if (sound.id !== drag.id) return sound;
          if (drag.action === 'move') {
            return { ...sound, start: clamp(drag.start + delta, 0, Math.max(0, totalDuration - drag.duration)) };
          }
          if (drag.action === 'trim-start') {
            const adjustedDelta = clamp(
              delta,
              Math.max(-drag.start, -drag.trimStart),
              drag.duration - MIN_OBJECT_DURATION,
            );
            return {
              ...sound,
              start: drag.start + adjustedDelta,
              trimStart: drag.trimStart + adjustedDelta,
            };
          }
          const maximumEnd = Math.min(sound.sourceDuration, drag.trimStart + Math.max(MIN_OBJECT_DURATION, totalDuration - drag.start));
          return { ...sound, trimEnd: clamp(drag.trimEnd + delta, drag.trimStart + MIN_OBJECT_DURATION, maximumEnd) };
        }));
      } else {
        setTexts((current) => current.map((text) => {
          if (text.id !== drag.id) return text;
          if (drag.action === 'move') {
            return { ...text, start: clamp(drag.start + delta, 0, Math.max(0, totalDuration - drag.duration)) };
          }
          if (drag.action === 'trim-start') {
            const adjustedDelta = clamp(delta, -drag.start, drag.duration - MIN_OBJECT_DURATION);
            const duration = drag.duration - adjustedDelta;
            return {
              ...text,
              start: drag.start + adjustedDelta,
              duration,
              fadeIn: Math.min(text.fadeIn, duration),
              fadeOut: Math.min(text.fadeOut, duration),
            };
          }
          const duration = clamp(drag.duration + delta, MIN_OBJECT_DURATION, totalDuration - drag.start);
          return { ...text, duration, fadeIn: Math.min(text.fadeIn, duration), fadeOut: Math.min(text.fadeOut, duration) };
        }));
      }
    };

    const handleUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [invalidateOutput, pixelsPerSecond, totalDuration]);

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const x = event.clientX - bounds.left + viewport.scrollLeft;
    seekTo(x / pixelsPerSecond);
  };

  const moveTextOnPreview = (id: string, event: React.PointerEvent<HTMLDivElement>) => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    invalidateOutput();
    setTexts((current) => current.map((text) => text.id === id ? { ...text, x, y } : text));
  };

  const beginPreviewTextDrag = (id: string, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    previewTextDragRef.current = { id };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection({ type: 'text', id });
    moveTextOnPreview(id, event);
  };

  const updateSelectedClip = (updates: Partial<MakerClip>) => {
    if (!selectedClip) return;
    invalidateOutput();
    setClips((current) => current.map((clip) => clip.id === selectedClip.id ? { ...clip, ...updates } : clip));
  };

  const updateSelectedSound = (updates: Partial<MakerSound>) => {
    if (!selectedSound) return;
    invalidateOutput();
    setSounds((current) => current.map((sound) => sound.id === selectedSound.id ? { ...sound, ...updates } : sound));
  };

  const updateSelectedText = (updates: Partial<MakerText>) => {
    if (!selectedText) return;
    invalidateOutput();
    setTexts((current) => current.map((text) => text.id === selectedText.id ? { ...text, ...updates } : text));
  };

  const canSplit = (() => {
    if (selection?.type === 'clip' && selectedSegment) {
      return playhead > selectedSegment.start + MIN_OBJECT_DURATION
        && playhead < selectedSegment.end - MIN_OBJECT_DURATION;
    }
    if (selection?.type === 'sound' && selectedSound) {
      return playhead > selectedSound.start + MIN_OBJECT_DURATION
        && playhead < selectedSound.start + soundDuration(selectedSound) - MIN_OBJECT_DURATION;
    }
    if (selection?.type === 'text' && selectedText) {
      return playhead > selectedText.start + MIN_OBJECT_DURATION
        && playhead < selectedText.start + selectedText.duration - MIN_OBJECT_DURATION;
    }
    return false;
  })();

  const splitSelected = () => {
    if (!selection || !canSplit) return;
    invalidateOutput();

    if (selection.type === 'clip' && selectedClip && selectedSegment) {
      const splitSourceTime = selectedClip.trimStart + playhead - selectedSegment.start;
      const rightId = createId('clip');
      const rightUrl = URL.createObjectURL(selectedClip.file);
      objectUrlsRef.current.add(rightUrl);
      setClips((current) => {
        const index = current.findIndex((clip) => clip.id === selectedClip.id);
        if (index < 0) return current;
        const leftDuration = splitSourceTime - selectedClip.trimStart;
        const rightDuration = selectedClip.trimEnd - splitSourceTime;
        const left = {
          ...selectedClip,
          trimEnd: splitSourceTime,
          fadeIn: Math.min(selectedClip.fadeIn, leftDuration),
          fadeOut: 0,
        };
        const right = {
          ...selectedClip,
          id: rightId,
          url: rightUrl,
          trimStart: splitSourceTime,
          fadeIn: 0,
          fadeOut: Math.min(selectedClip.fadeOut, rightDuration),
        };
        const next = [...current];
        next.splice(index, 1, left, right);
        return next;
      });
      setSelection({ type: 'clip', id: rightId });
      return;
    }

    if (selection.type === 'sound' && selectedSound) {
      const localTime = playhead - selectedSound.start;
      const splitSourceTime = selectedSound.trimStart + localTime;
      const rightId = createId('sound');
      const rightUrl = URL.createObjectURL(selectedSound.file);
      objectUrlsRef.current.add(rightUrl);
      setSounds((current) => {
        const index = current.findIndex((sound) => sound.id === selectedSound.id);
        if (index < 0) return current;
        const leftDuration = splitSourceTime - selectedSound.trimStart;
        const rightDuration = selectedSound.trimEnd - splitSourceTime;
        const left = {
          ...selectedSound,
          trimEnd: splitSourceTime,
          fadeIn: Math.min(selectedSound.fadeIn, leftDuration),
          fadeOut: 0,
        };
        const right = {
          ...selectedSound,
          id: rightId,
          url: rightUrl,
          start: playhead,
          trimStart: splitSourceTime,
          fadeIn: 0,
          fadeOut: Math.min(selectedSound.fadeOut, rightDuration),
        };
        const next = [...current];
        next.splice(index, 1, left, right);
        return next;
      });
      setSelection({ type: 'sound', id: rightId });
      return;
    }

    if (selection.type === 'text' && selectedText) {
      const leftDuration = playhead - selectedText.start;
      const rightId = createId('text');
      const right = {
        ...selectedText,
        id: rightId,
        start: playhead,
        duration: selectedText.duration - leftDuration,
        fadeIn: 0,
        fadeOut: Math.min(selectedText.fadeOut, selectedText.duration - leftDuration),
      };
      setTexts((current) => {
        const index = current.findIndex((text) => text.id === selectedText.id);
        if (index < 0) return current;
        const next = [...current];
        next.splice(index, 1, {
          ...selectedText,
          duration: leftDuration,
          fadeIn: Math.min(selectedText.fadeIn, leftDuration),
          fadeOut: 0,
        }, right);
        return next;
      });
      setSelection({ type: 'text', id: rightId });
    }
  };

  const loadFfmpeg = async () => {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current;
    const canUseMultipleThreads = window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
    setExportProgress({
      stage: canUseMultipleThreads
        ? 'Loading the faster multi-core export engine…'
        : 'Loading the compatible export engine…',
      progress: 3,
    });
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);
    let ffmpeg = new FFmpeg();
    try {
      if (canUseMultipleThreads) {
        const [coreURL, wasmURL, workerURL] = await Promise.all([
          toBlobURL(`${FFMPEG_MULTI_THREAD_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
          toBlobURL(`${FFMPEG_MULTI_THREAD_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
          toBlobURL(`${FFMPEG_MULTI_THREAD_CORE_URL}/ffmpeg-core.worker.js`, 'text/javascript'),
        ]);
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
      } else {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
      }
      ffmpegRef.current = ffmpeg;
      return ffmpeg;
    } catch (error) {
      ffmpeg.terminate();
      if (!canUseMultipleThreads) throw error;

      setExportProgress({ stage: 'Using the compatible export engine…', progress: 3 });
      ffmpeg = new FFmpeg();
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpegRef.current = ffmpeg;
        return ffmpeg;
      } catch (fallbackError) {
        ffmpeg.terminate();
        throw fallbackError;
      }
    }
  };

  const exportProject = async () => {
    if (clips.length === 0 || exporting) return;
    setIsPlaying(false);
    invalidateOutput();
    setErrorMessage(null);
    setExporting(true);
    try {
      const ffmpeg = await loadFfmpeg();
      const blob = await exportClipMakerProject(ffmpeg, clips, sounds, texts, setExportProgress);
      const url = URL.createObjectURL(blob);
      outputUrlRef.current = url;
      setOutputBlob(blob);
      setOutputUrl(url);
      setExportProgress({ stage: 'Your MP4 is ready', progress: 100 });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The MP4 could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="tool-container clip-maker-tool fade-in">
      <div className="tool-header clip-maker-heading">
        <p className="tool-subtitle">Build a complete video, save the editable project locally, and export a finished MP4.</p>
        <div className="clip-maker-toolbar">
          <input
            ref={projectInputRef}
            type="file"
            accept=".luclip,application/x-lutools-clip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openProject(file);
              event.target.value = '';
            }}
          />
          <input
            ref={clipInputRef}
            type="file"
            accept="video/*,image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void importClips(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={soundInputRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void importSounds(event.target.files);
              event.target.value = '';
            }}
          />
          <button type="button" className="btn-secondary clip-maker-toolbar-button" onClick={() => clipInputRef.current?.click()} disabled={isImporting || exporting}>
            <Film size={15} /> Add Video / Image
          </button>
          <button type="button" className="btn-secondary clip-maker-toolbar-button" onClick={() => soundInputRef.current?.click()} disabled={clips.length === 0 || isImporting || exporting}>
            <Music2 size={15} /> Add Sound
          </button>
          <button type="button" className="btn-secondary clip-maker-toolbar-button" onClick={addText} disabled={clips.length === 0 || exporting}>
            <Type size={15} /> Add Text
          </button>
          <button
            type="button"
            className="btn-secondary clip-maker-toolbar-button"
            onClick={splitSelected}
            disabled={!canSplit || exporting}
            title="Split the selected object at the playhead"
          >
            <Scissors size={15} /> Split
          </button>
          <button type="button" className="btn-secondary clip-maker-toolbar-button clip-maker-project-button" onClick={() => projectInputRef.current?.click()} disabled={isImporting || exporting}>
            <FolderOpen size={15} /> Open Project
          </button>
          <button type="button" className="btn-secondary clip-maker-toolbar-button clip-maker-project-button" onClick={saveProject} disabled={clips.length === 0 || isImporting || exporting}>
            <Save size={15} /> Save Project
          </button>
          <span className="clip-maker-toolbar-spacer" />
          {clips.length > 0 && (
            <button type="button" className="clip-maker-reset" onClick={resetProject} disabled={exporting}>
              <RotateCcw size={14} /> Reset
            </button>
          )}
          <button type="button" className="btn-primary clip-maker-export-button" onClick={() => void exportProject()} disabled={clips.length === 0 || exporting || isImporting}>
            {exporting ? <span className="trim-button-spinner" /> : <Download size={15} />}
            {exporting ? 'Exporting…' : 'Export MP4'}
          </button>
        </div>
      </div>

      {errorMessage && <div className="clip-maker-error" role="alert"><AlertCircle size={16} /><span>{errorMessage}</span><button type="button" onClick={() => setErrorMessage(null)}>Dismiss</button></div>}

      {clips.length === 0 ? (
        <div
          className="clip-maker-empty"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files.length) void importClips(event.dataTransfer.files);
          }}
        >
          <div className="clip-maker-empty-icon"><Scissors size={28} /></div>
          <h2>Start your first video</h2>
          <p>Add videos or images. Visual clips are automatically placed one after another on the timeline.</p>
          <button type="button" className="btn-primary" onClick={() => clipInputRef.current?.click()} disabled={isImporting}>
            <Upload size={16} /> {isImporting ? 'Importing…' : 'Choose Video or Images'}
          </button>
          <span>MP4, WebM, MOV, JPG, PNG, WebP and browser-supported media</span>
        </div>
      ) : (
        <>
          <div className="clip-maker-workspace">
            <section className="clip-maker-preview-panel">
              <div ref={previewStageRef} className="clip-maker-preview-stage">
                {currentSegment?.clip.kind === 'video' ? (
                  <video
                    key={currentSegment.clip.id}
                    ref={previewVideoRef}
                    src={currentSegment.clip.url}
                    className="clip-maker-preview-media"
                    style={{ opacity: currentClipOpacity }}
                    playsInline
                    preload="auto"
                  />
                ) : currentSegment?.clip.kind === 'image' ? (
                  <img src={currentSegment.clip.url} className="clip-maker-preview-media" style={{ opacity: currentClipOpacity }} alt="Current visual clip" />
                ) : null}
                {activeTexts.map((text) => (
                  <div
                    key={text.id}
                    className={`clip-maker-text-overlay ${selection?.type === 'text' && selection.id === text.id ? 'selected' : ''}`}
                    style={{
                      color: text.color,
                      fontSize: `${text.fontSize}px`,
                      left: `${text.x * 100}%`,
                      top: `${text.y * 100}%`,
                      opacity: fadeOpacity(playhead - text.start, text.duration, text.fadeIn, text.fadeOut),
                    }}
                    title="Drag to position text"
                    onPointerDown={(event) => beginPreviewTextDrag(text.id, event)}
                    onPointerMove={(event) => {
                      if (previewTextDragRef.current?.id === text.id) moveTextOnPreview(text.id, event);
                    }}
                    onPointerUp={() => { previewTextDragRef.current = null; }}
                    onPointerCancel={() => { previewTextDragRef.current = null; }}
                  >
                    {text.text}
                  </div>
                ))}
              </div>
              <div className="clip-maker-preview-controls">
                <button type="button" className="clip-maker-play" onClick={togglePlayback} aria-label={isPlaying ? 'Pause preview' : 'Play preview'}>
                  {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                </button>
                <strong>{formatTime(playhead)}</strong>
                <div className="clip-maker-preview-scrubber">
                  <input
                    type="range"
                    min="0"
                    max={Math.max(totalDuration, 0.01)}
                    step="0.01"
                    value={Math.min(playhead, totalDuration)}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    aria-label="Preview playhead"
                  />
                </div>
                <span>{formatTime(totalDuration)}</span>
              </div>
            </section>

            <aside className="clip-maker-inspector">
              <div className="clip-maker-inspector-title">
                <span>Inspector</span>
                {selection && <button type="button" onClick={deleteSelected} title="Delete selected object"><Trash2 size={14} /></button>}
              </div>

              {!selection && (
                <div className="clip-maker-inspector-empty">
                  <Plus size={21} />
                  <p>Select an object on the timeline to edit its properties.</p>
                </div>
              )}

              {selectedClip && selectedSegment && (
                <div className="clip-maker-inspector-body">
                  <div className="clip-maker-object-heading">
                    {selectedClip.kind === 'video' ? <Film size={17} /> : <ImageIcon size={17} />}
                    <div><strong>{selectedClip.name}</strong><span>{selectedClip.kind === 'video' ? 'Video clip' : 'Image clip'}</span></div>
                  </div>
                  <div className="clip-maker-property-grid">
                    <div><span>Timeline start</span><strong>{formatTime(selectedSegment.start)}</strong></div>
                    <div><span>Duration</span><strong>{formatTime(selectedSegment.duration)}</strong></div>
                    <div><span>Source in</span><strong>{formatTime(selectedClip.trimStart)}</strong></div>
                    <div><span>Source out</span><strong>{formatTime(selectedClip.trimEnd)}</strong></div>
                  </div>
                  <label className="clip-maker-field">
                    <span>Fade in <strong>{selectedClip.fadeIn.toFixed(1)}s</strong></span>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10, selectedSegment.duration)}
                      step="0.1"
                      value={selectedClip.fadeIn}
                      onChange={(event) => updateSelectedClip({ fadeIn: Number(event.target.value) })}
                    />
                  </label>
                  <label className="clip-maker-field">
                    <span>Fade out <strong>{selectedClip.fadeOut.toFixed(1)}s</strong></span>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10, selectedSegment.duration)}
                      step="0.1"
                      value={selectedClip.fadeOut}
                      onChange={(event) => updateSelectedClip({ fadeOut: Number(event.target.value) })}
                    />
                  </label>
                  {selectedClip.kind === 'video' && (
                    <label className="clip-maker-field">
                      <span>Volume <strong>{Math.round(selectedClip.volume * 100)}%</strong></span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedClip.volume}
                        onChange={(event) => updateSelectedClip({ volume: Number(event.target.value) })}
                      />
                    </label>
                  )}
                  <p className="clip-maker-inspector-hint">Drag the clip body to reorder it. Drag either handle to trim, or place the playhead inside it and use Split.</p>
                </div>
              )}

              {selectedSound && (
                <div className="clip-maker-inspector-body">
                  <div className="clip-maker-object-heading sound"><Volume2 size={17} /><div><strong>{selectedSound.name}</strong><span>Sound layer</span></div></div>
                  <div className="clip-maker-property-grid">
                    <div><span>Start</span><strong>{formatTime(selectedSound.start)}</strong></div>
                    <div><span>Duration</span><strong>{formatTime(soundDuration(selectedSound))}</strong></div>
                  </div>
                  <label className="clip-maker-field">
                    <span>Fade in <strong>{selectedSound.fadeIn.toFixed(1)}s</strong></span>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10, soundDuration(selectedSound))}
                      step="0.1"
                      value={selectedSound.fadeIn}
                      onChange={(event) => updateSelectedSound({ fadeIn: Number(event.target.value) })}
                    />
                  </label>
                  <label className="clip-maker-field">
                    <span>Fade out <strong>{selectedSound.fadeOut.toFixed(1)}s</strong></span>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10, soundDuration(selectedSound))}
                      step="0.1"
                      value={selectedSound.fadeOut}
                      onChange={(event) => updateSelectedSound({ fadeOut: Number(event.target.value) })}
                    />
                  </label>
                  <label className="clip-maker-field">
                    <span>Volume <strong>{Math.round(selectedSound.volume * 100)}%</strong></span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={selectedSound.volume}
                      onChange={(event) => updateSelectedSound({ volume: Number(event.target.value) })}
                    />
                  </label>
                  <p className="clip-maker-inspector-hint">Drag the sound body to move it. Drag either edge to trim, or place the playhead inside it and use Split.</p>
                </div>
              )}

              {selectedText && (
                <div className="clip-maker-inspector-body">
                  <div className="clip-maker-object-heading text"><Type size={17} /><div><strong>Text overlay</strong><span>{formatTime(selectedText.start)} · {formatTime(selectedText.duration)}</span></div></div>
                  <label className="clip-maker-field">
                    <span>Content</span>
                    <textarea value={selectedText.text} rows={3} onChange={(event) => updateSelectedText({ text: event.target.value })} />
                  </label>
                  <div className="clip-maker-inline-fields">
                    <label className="clip-maker-field"><span>Color</span><input type="color" value={selectedText.color} onChange={(event) => updateSelectedText({ color: event.target.value })} /></label>
                    <label className="clip-maker-field"><span>Size</span><input type="number" min="18" max="120" value={selectedText.fontSize} onChange={(event) => updateSelectedText({ fontSize: clamp(Number(event.target.value), 18, 120) })} /></label>
                  </div>
                  <label className="clip-maker-field">
                    <span>Fade in <strong>{selectedText.fadeIn.toFixed(1)}s</strong></span>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10, selectedText.duration)}
                      step="0.1"
                      value={selectedText.fadeIn}
                      onChange={(event) => updateSelectedText({ fadeIn: Number(event.target.value) })}
                    />
                  </label>
                  <label className="clip-maker-field">
                    <span>Fade out <strong>{selectedText.fadeOut.toFixed(1)}s</strong></span>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10, selectedText.duration)}
                      step="0.1"
                      value={selectedText.fadeOut}
                      onChange={(event) => updateSelectedText({ fadeOut: Number(event.target.value) })}
                    />
                  </label>
                  <p className="clip-maker-inspector-hint">Drag text on the preview to position it. Drag its timeline block to move or trim it, or place the playhead inside it and use Split.</p>
                </div>
              )}
            </aside>
          </div>

          {isImporting && <div className="clip-maker-notice"><div className="spinner" /> Importing and analyzing media…</div>}
          <section className="clip-maker-timeline-panel">
            <div className="clip-maker-timeline-topbar">
              <div><strong>Timeline</strong><span>{clips.length} clip{clips.length === 1 ? '' : 's'} · {sounds.length} sound{sounds.length === 1 ? '' : 's'} · {texts.length} text</span></div>
              <div className="clip-maker-zoom">
                <button type="button" onClick={() => setPixelsPerSecond((value) => Math.max(36, value - 14))} aria-label="Zoom timeline out"><ZoomOut size={14} /></button>
                <span>{Math.round(pixelsPerSecond / 0.64)}%</span>
                <button type="button" onClick={() => setPixelsPerSecond((value) => Math.min(128, value + 14))} aria-label="Zoom timeline in"><ZoomIn size={14} /></button>
              </div>
            </div>

            <div className="clip-maker-timeline-grid">
              <div className="clip-maker-track-labels">
                <div className="ruler-label" />
                <div><Film size={13} /> Clips</div>
                <div><Music2 size={13} /> Sound</div>
                <div><Type size={13} /> Text</div>
              </div>
              <div ref={timelineViewportRef} className="clip-maker-timeline-viewport" onPointerDown={handleTimelinePointerDown}>
                <div className="clip-maker-timeline-content" style={{ width: `${timelineWidth}px` }}>
                  <div className="clip-maker-ruler">
                    {rulerTicks.map((tick) => <span key={tick} style={{ left: `${tick * pixelsPerSecond}px` }}>{formatTime(tick).replace(/\.00$/, '')}</span>)}
                  </div>
                  <div className="clip-maker-track clip-track">
                    {clipSegments.map((segment) => (
                      <div
                        key={segment.clip.id}
                        className={`clip-maker-block visual ${selection?.type === 'clip' && selection.id === segment.clip.id ? 'selected' : ''}`}
                        style={{ left: `${segment.start * pixelsPerSecond}px`, width: `${segment.duration * pixelsPerSecond}px`, backgroundImage: segment.clip.thumbnail ? `linear-gradient(rgba(0,0,0,.22), rgba(0,0,0,.22)), url(${segment.clip.thumbnail})` : undefined }}
                        onPointerDown={(event) => beginTimelineDrag('clip', segment.clip.id, 'move', event)}
                      >
                        <button type="button" className="clip-maker-handle left" onPointerDown={(event) => beginTimelineDrag('clip', segment.clip.id, 'trim-start', event)} aria-label="Trim clip start" />
                        <span>{segment.clip.kind === 'image' ? <ImageIcon size={12} /> : <Film size={12} />}{segment.clip.name}</span>
                        <button type="button" className="clip-maker-handle right" onPointerDown={(event) => beginTimelineDrag('clip', segment.clip.id, 'trim-end', event)} aria-label="Trim clip end" />
                      </div>
                    ))}
                  </div>
                  <div className="clip-maker-track sound-track">
                    {sounds.map((sound) => (
                      <div
                        key={sound.id}
                        className={`clip-maker-block sound ${selection?.type === 'sound' && selection.id === sound.id ? 'selected' : ''}`}
                        style={{ left: `${sound.start * pixelsPerSecond}px`, width: `${soundDuration(sound) * pixelsPerSecond}px` }}
                        onPointerDown={(event) => beginTimelineDrag('sound', sound.id, 'move', event)}
                      >
                        <button type="button" className="clip-maker-handle left" onPointerDown={(event) => beginTimelineDrag('sound', sound.id, 'trim-start', event)} aria-label="Trim sound start" />
                        <div className="clip-maker-waveform" aria-hidden="true">{sound.peaks.map((peak, index) => <i key={index} style={{ height: `${Math.max(12, peak * 88)}%` }} />)}</div>
                        <span><Music2 size={11} />{sound.name}</span>
                        <button type="button" className="clip-maker-handle right" onPointerDown={(event) => beginTimelineDrag('sound', sound.id, 'trim-end', event)} aria-label="Trim sound end" />
                      </div>
                    ))}
                  </div>
                  <div className="clip-maker-track text-track">
                    {texts.map((text) => (
                      <div
                        key={text.id}
                        className={`clip-maker-block text ${selection?.type === 'text' && selection.id === text.id ? 'selected' : ''}`}
                        style={{ left: `${text.start * pixelsPerSecond}px`, width: `${text.duration * pixelsPerSecond}px` }}
                        onPointerDown={(event) => beginTimelineDrag('text', text.id, 'move', event)}
                      >
                        <button type="button" className="clip-maker-handle left" onPointerDown={(event) => beginTimelineDrag('text', text.id, 'trim-start', event)} aria-label="Trim text start" />
                        <span><Type size={11} />{text.text || 'Empty text'}</span>
                        <button type="button" className="clip-maker-handle right" onPointerDown={(event) => beginTimelineDrag('text', text.id, 'trim-end', event)} aria-label="Trim text end" />
                      </div>
                    ))}
                  </div>
                  <div className="clip-maker-playhead" style={{ left: `${playhead * pixelsPerSecond}px` }} aria-hidden="true"><span /></div>
                </div>
              </div>
            </div>
          </section>

          {sounds.map((sound) => (
            <audio
              key={sound.id}
              ref={(element) => {
                if (element) soundRefs.current.set(sound.id, element);
                else soundRefs.current.delete(sound.id);
              }}
              src={sound.url}
              preload="auto"
            />
          ))}

          {(exporting || outputUrl) && (
            <section className="clip-maker-export-panel" aria-live="polite">
              <div className="clip-maker-export-status">
                {outputUrl ? <CheckCircle2 size={18} /> : <div className="spinner" />}
                <div><strong>{exportProgress.stage}</strong><span>{outputBlob ? `${formatBytes(outputBlob.size)} · 1280 × 720 MP4` : 'Keep this tab open while your project renders.'}</span></div>
                <b>{exportProgress.progress}%</b>
              </div>
              <div className="clip-maker-export-progress"><div style={{ width: `${exportProgress.progress}%` }} /></div>
              {outputUrl && outputBlob && (
                <div className="clip-maker-output">
                  <video src={outputUrl} controls playsInline preload="metadata" />
                  <a href={outputUrl} download="clip-maker-export.mp4" className="btn-primary"><Download size={15} /> Download MP4</a>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
