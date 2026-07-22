import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { ExportProgress, MakerClip, MakerSound, MakerText } from './clipMakerTypes';

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const OUTPUT_FPS = 30;
const FONT_URL = 'https://raw.githubusercontent.com/ffmpegwasm/testdata/master/arial.ttf';

function extensionFor(fileName: string, fallback: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? fallback;
}

function seconds(value: number) {
  return Math.max(0, value).toFixed(3);
}

function clipDuration(clip: MakerClip) {
  return Math.max(0.1, clip.trimEnd - clip.trimStart);
}

function soundDuration(sound: MakerSound) {
  return Math.max(0.05, sound.trimEnd - sound.trimStart);
}

function ffmpegColor(color: string) {
  return `0x${color.replace('#', '').padEnd(6, 'F').slice(0, 6)}`;
}

function fadeFilters(fadeIn: number, fadeOut: number, duration: number, audio = false) {
  const filters: string[] = [];
  const boundedFadeIn = Math.min(Math.max(0, fadeIn), duration);
  const boundedFadeOut = Math.min(Math.max(0, fadeOut), duration);
  if (boundedFadeIn > 0) filters.push(`${audio ? 'afade' : 'fade'}=t=in:st=0:d=${seconds(boundedFadeIn)}`);
  if (boundedFadeOut > 0) {
    filters.push(
      `${audio ? 'afade' : 'fade'}=t=out:st=${seconds(Math.max(0, duration - boundedFadeOut))}:d=${seconds(boundedFadeOut)}`,
    );
  }
  return filters;
}

function textAlpha(text: MakerText, end: number) {
  const factors: string[] = [];
  const fadeIn = Math.min(Math.max(0, text.fadeIn), text.duration);
  const fadeOut = Math.min(Math.max(0, text.fadeOut), text.duration);
  if (fadeIn > 0) factors.push(`min(1,max(0,(t-${seconds(text.start)})/${seconds(fadeIn)}))`);
  if (fadeOut > 0) factors.push(`min(1,max(0,(${seconds(end)}-t)/${seconds(fadeOut)}))`);
  return (factors.join('*') || '1').replaceAll(',', '\\,');
}

async function inputHasAudio(ffmpeg: FFmpeg, inputName: string) {
  let hasAudio = false;
  const listener = ({ message }: { message: string }) => {
    if (/Stream #.*Audio:/i.test(message)) hasAudio = true;
  };
  ffmpeg.on('log', listener);
  try {
    await ffmpeg.exec(['-hide_banner', '-i', inputName]);
  } catch {
    // Probing without an output exits non-zero; the stream information is still emitted.
  } finally {
    ffmpeg.off('log', listener);
  }
  return hasAudio;
}

export async function exportClipMakerProject(
  ffmpeg: FFmpeg,
  clips: MakerClip[],
  sounds: MakerSound[],
  texts: MakerText[],
  onProgress: (progress: ExportProgress) => void,
) {
  if (clips.length === 0) throw new Error('Add at least one video or image clip before exporting.');

  const { fetchFile } = await import('@ffmpeg/util');
  const filesToDelete = new Set<string>();
  const totalDuration = clips.reduce((total, clip) => total + clipDuration(clip), 0);
  const activeSounds = sounds.filter((sound) => sound.start < totalDuration && soundDuration(sound) > 0);
  const activeTexts = texts.filter((text) => text.text.trim() && text.start < totalDuration && text.duration > 0);
  const clipInputs: Array<{ name: string; hasAudio: boolean }> = [];
  const commandInputs: string[] = [];

  try {
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const duration = clipDuration(clip);
      const name = `clip_input_${index}.${extensionFor(clip.name, clip.kind === 'image' ? 'png' : 'mp4')}`;
      filesToDelete.add(name);
      onProgress({ stage: `Reading clip ${index + 1} of ${clips.length}…`, progress: 7 + Math.round((index / clips.length) * 24) });
      await ffmpeg.writeFile(name, await fetchFile(clip.file));
      const hasAudio = clip.kind === 'video' ? await inputHasAudio(ffmpeg, name) : false;
      clipInputs.push({ name, hasAudio });
      if (clip.kind === 'image') commandInputs.push('-loop', '1', '-t', seconds(duration), '-i', name);
      else commandInputs.push('-ss', seconds(clip.trimStart), '-t', seconds(duration), '-i', name);
    }

    for (let index = 0; index < activeSounds.length; index += 1) {
      const sound = activeSounds[index];
      const name = `sound_input_${index}.${extensionFor(sound.name, 'mp3')}`;
      filesToDelete.add(name);
      onProgress({ stage: `Reading sound ${index + 1} of ${activeSounds.length}…`, progress: 32 + Math.round((index / Math.max(1, activeSounds.length)) * 7) });
      await ffmpeg.writeFile(name, await fetchFile(sound.file));
      commandInputs.push('-ss', seconds(sound.trimStart), '-t', seconds(soundDuration(sound)), '-i', name);
    }

    if (activeTexts.length > 0) {
      const fontName = 'clip_maker_font.ttf';
      filesToDelete.add(fontName);
      onProgress({ stage: 'Preparing text layers…', progress: 40 });
      await ffmpeg.writeFile(fontName, await fetchFile(FONT_URL));
      for (let index = 0; index < activeTexts.length; index += 1) {
        const textName = `clip_maker_text_${index}.txt`;
        filesToDelete.add(textName);
        await ffmpeg.writeFile(textName, new TextEncoder().encode(activeTexts[index].text));
      }
    }

    const filters: string[] = [];
    const concatInputs: string[] = [];
    clips.forEach((clip, index) => {
      const duration = clipDuration(clip);
      const videoParts = [
        `[${index}:v]trim=duration=${seconds(duration)}`,
        'setpts=PTS-STARTPTS',
        `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease`,
        `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
        'setsar=1',
        `fps=${OUTPUT_FPS}`,
        'format=yuv420p',
        ...fadeFilters(clip.fadeIn, clip.fadeOut, duration),
      ];
      filters.push(`${videoParts.join(',')}[clip_video_${index}]`);

      const audioParts = clipInputs[index].hasAudio
        ? [
            `[${index}:a]atrim=duration=${seconds(duration)}`,
            'asetpts=PTS-STARTPTS',
            'aresample=48000',
            'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
            `volume=${clampVolume(clip.volume).toFixed(3)}`,
            'apad',
            `atrim=duration=${seconds(duration)}`,
            ...fadeFilters(clip.fadeIn, clip.fadeOut, duration, true),
          ]
        : [
            'anullsrc=channel_layout=stereo:sample_rate=48000',
            `atrim=duration=${seconds(duration)}`,
            ...fadeFilters(clip.fadeIn, clip.fadeOut, duration, true),
          ];
      filters.push(`${audioParts.join(',')}[clip_audio_${index}]`);
      concatInputs.push(`[clip_video_${index}][clip_audio_${index}]`);
    });

    filters.push(`${concatInputs.join('')}concat=n=${clips.length}:v=1:a=1[base_video][base_audio]`);
    let videoMap = 'base_video';
    activeTexts.forEach((text, index) => {
      const end = Math.min(totalDuration, text.start + text.duration);
      const nextLabel = `video_text_${index}`;
      const x = clampPosition(text.x);
      const y = clampPosition(text.y);
      filters.push(
        `[${videoMap}]drawtext=fontfile=/clip_maker_font.ttf:textfile=/clip_maker_text_${index}.txt:`
        + `fontcolor=${ffmpegColor(text.color)}:fontsize=${Math.round(text.fontSize)}:`
        + `x=w*${x.toFixed(4)}-text_w/2:`
        + `y=h*${y.toFixed(4)}-text_h/2:`
        + `alpha='${textAlpha(text, end)}':expansion=none:`
        + `enable='between(t\\,${seconds(text.start)}\\,${seconds(end)})'[${nextLabel}]`,
      );
      videoMap = nextLabel;
    });

    const soundLabels: string[] = [];
    activeSounds.forEach((sound, index) => {
      const inputIndex = clips.length + index;
      const duration = soundDuration(sound);
      const delay = Math.max(0, Math.round(sound.start * 1000));
      const parts = [
        `[${inputIndex}:a]atrim=duration=${seconds(duration)}`,
        'asetpts=PTS-STARTPTS',
        'aresample=48000',
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
        `volume=${clampVolume(sound.volume).toFixed(3)}`,
        ...fadeFilters(sound.fadeIn, sound.fadeOut, duration, true),
        `adelay=${delay}|${delay}`,
      ];
      filters.push(`${parts.join(',')}[sound_${index}]`);
      soundLabels.push(`[sound_${index}]`);
    });

    let audioMap = 'base_audio';
    if (soundLabels.length > 0) {
      filters.push(
        `[base_audio]${soundLabels.join('')}amix=inputs=${soundLabels.length + 1}:duration=first:`
        + 'dropout_transition=0:normalize=0[mixed_audio]',
      );
      audioMap = 'mixed_audio';
    }

    const outputName = 'clip_maker_output.mp4';
    filesToDelete.add(outputName);
    const finalCommand = [
      '-y',
      ...commandInputs,
      '-filter_complex', filters.join(';'),
      '-map', `[${videoMap}]`,
      '-map', `[${audioMap}]`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-t', seconds(totalDuration),
      '-movflags', '+faststart',
      outputName,
    ];

    const progressListener = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) {
        onProgress({ stage: 'Rendering video in one pass…', progress: Math.min(95, 44 + Math.round(progress * 51)) });
      }
    };
    onProgress({ stage: 'Rendering video in one pass…', progress: 44 });
    ffmpeg.on('progress', progressListener);
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(finalCommand);
    } finally {
      ffmpeg.off('progress', progressListener);
    }
    if (exitCode !== 0) throw new Error('The final MP4 could not be rendered.');

    onProgress({ stage: 'Finalizing MP4…', progress: 96 });
    const outputData = await ffmpeg.readFile(outputName);
    if (typeof outputData === 'string') throw new Error('The exported MP4 data was invalid.');
    const bytes = new Uint8Array(outputData);
    return new Blob([bytes.buffer], { type: 'video/mp4' });
  } finally {
    for (const fileName of filesToDelete) {
      try { await ffmpeg.deleteFile(fileName); } catch { /* Ignore files not created. */ }
    }
  }
}

function clampPosition(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
