export type ClipKind = 'video' | 'image';
export type ExportOrientation = 'landscape' | 'portrait';

export interface MakerClip {
  id: string;
  kind: ClipKind;
  file: File;
  url: string;
  name: string;
  thumbnail: string;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  width: number;
  height: number;
}

export interface MakerSound {
  id: string;
  file: File;
  url: string;
  name: string;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  start: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  peaks: number[];
}

export interface MakerText {
  id: string;
  text: string;
  start: number;
  duration: number;
  color: string;
  fontSize: number;
  fadeIn: number;
  fadeOut: number;
  x: number;
  y: number;
}

export type MakerSelection =
  | { type: 'clip'; id: string }
  | { type: 'sound'; id: string }
  | { type: 'text'; id: string }
  | null;

export interface ExportProgress {
  stage: string;
  progress: number;
}
