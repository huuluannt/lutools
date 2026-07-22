import type { ExportOrientation, MakerClip, MakerSound, MakerText } from './clipMakerTypes';

const PROJECT_MAGIC = 'LUCLIP1\n';
const PROJECT_MIME = 'application/x-lutools-clip';
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

interface ProjectAsset {
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

interface ProjectClip extends Omit<MakerClip, 'file' | 'url'> {
  assetIndex: number;
}

interface ProjectSound extends Omit<MakerSound, 'file' | 'url'> {
  assetIndex: number;
}

export interface ClipMakerProjectManifest {
  version: 1;
  createdAt: string;
  pixelsPerSecond: number;
  orientation: ExportOrientation;
  assets: ProjectAsset[];
  clips: ProjectClip[];
  sounds: ProjectSound[];
  texts: MakerText[];
}

export interface OpenedClipMakerProject {
  manifest: ClipMakerProjectManifest;
  assets: File[];
}

function addAsset(file: File, files: File[], assets: ProjectAsset[]) {
  const existingIndex = files.indexOf(file);
  if (existingIndex >= 0) return existingIndex;
  files.push(file);
  assets.push({
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
  });
  return files.length - 1;
}

export function createClipMakerProjectFile(
  clips: MakerClip[],
  sounds: MakerSound[],
  texts: MakerText[],
  pixelsPerSecond: number,
  orientation: ExportOrientation,
) {
  const files: File[] = [];
  const assets: ProjectAsset[] = [];
  const manifest: ClipMakerProjectManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    pixelsPerSecond,
    orientation,
    assets,
    clips: clips.map(({ file, url, ...clip }) => {
      void url;
      return {
        ...clip,
        thumbnail: clip.kind === 'image' ? '' : clip.thumbnail,
        assetIndex: addAsset(file, files, assets),
      };
    }),
    sounds: sounds.map(({ file, url, ...sound }) => {
      void url;
      return {
        ...sound,
        assetIndex: addAsset(file, files, assets),
      };
    }),
    texts: texts.map((text) => ({ ...text })),
  };

  const encoder = new TextEncoder();
  const magic = encoder.encode(PROJECT_MAGIC);
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, manifestBytes.byteLength, true);
  return new Blob([magic, lengthBytes, manifestBytes, ...files], { type: PROJECT_MIME });
}

function isValidManifest(value: unknown): value is ClipMakerProjectManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<ClipMakerProjectManifest>;
  return manifest.version === 1
    && Array.isArray(manifest.assets)
    && Array.isArray(manifest.clips)
    && Array.isArray(manifest.sounds)
    && Array.isArray(manifest.texts)
    && manifest.assets.every((asset) => (
      asset
      && typeof asset.name === 'string'
      && typeof asset.type === 'string'
      && Number.isFinite(asset.size)
      && asset.size >= 0
    ));
}

export async function readClipMakerProjectFile(file: File): Promise<OpenedClipMakerProject> {
  if (file.size < PROJECT_MAGIC.length + 4) throw new Error('This is not a valid Clip Maker project file.');
  const header = new Uint8Array(await file.slice(0, PROJECT_MAGIC.length + 4).arrayBuffer());
  const magic = new TextDecoder().decode(header.slice(0, PROJECT_MAGIC.length));
  if (magic !== PROJECT_MAGIC) throw new Error('This is not a valid Clip Maker project file.');

  const manifestLength = new DataView(header.buffer, header.byteOffset + PROJECT_MAGIC.length, 4).getUint32(0, true);
  if (manifestLength <= 0 || manifestLength > MAX_MANIFEST_BYTES) throw new Error('The project information is invalid or too large.');
  const mediaStart = PROJECT_MAGIC.length + 4 + manifestLength;
  if (mediaStart > file.size) throw new Error('The project file is incomplete.');

  let manifest: unknown;
  try {
    manifest = JSON.parse(await file.slice(PROJECT_MAGIC.length + 4, mediaStart).text());
  } catch {
    throw new Error('The project information could not be read.');
  }
  if (!isValidManifest(manifest)) throw new Error('This Clip Maker project version is not supported.');

  let offset = mediaStart;
  const assets = manifest.assets.map((asset) => {
    const end = offset + asset.size;
    if (end > file.size) throw new Error(`The media file "${asset.name}" is incomplete.`);
    const assetFile = new File([file.slice(offset, end, asset.type)], asset.name, {
      type: asset.type,
      lastModified: asset.lastModified,
    });
    offset = end;
    return assetFile;
  });

  const invalidReference = [...manifest.clips, ...manifest.sounds]
    .some((item) => !Number.isInteger(item.assetIndex) || !assets[item.assetIndex]);
  if (invalidReference) throw new Error('The project contains a missing media reference.');
  return { manifest, assets };
}
