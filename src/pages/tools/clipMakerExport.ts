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

async function inputHasAudio(ffmpeg: FFmpeg, inputName: string) {
  let hasAudio = false;
  const listener = ({ message }: { message: string }) => {
    if (/Stream #.*Audio:/i.test(message)) hasAudio = true;
  };

  ffmpeg.on('log', listener);
  try {
    await ffmpeg.exec(['-hide_banner', '-i', inputName]);
  } catch {
    // FFmpeg exits non-zero when probing without an output; stream logs are still available.
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
  const videoFilter = [
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${OUTPUT_FPS}`,
    'format=yuv420p',
  ].join(',');

  try {
    const segmentNames: string[] = [];

    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const inputName = `clip_input_${index}.${extensionFor(clip.name, clip.kind === 'image' ? 'png' : 'mp4')}`;
      const segmentName = `clip_segment_${index}.mp4`;
      const duration = clipDuration(clip);
      filesToDelete.add(inputName);
      filesToDelete.add(segmentName);
      segmentNames.push(segmentName);

      onProgress({
        stage: `Preparing clip ${index + 1} of ${clips.length}…`,
        progress: 8 + Math.round((index / clips.length) * 42),
      });
      await ffmpeg.writeFile(inputName, await fetchFile(clip.file));

      const commonOutput = [
        '-t', seconds(duration),
        '-vf', videoFilter,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-ar', '48000',
        '-ac', '2',
        '-shortest',
        '-movflags', '+faststart',
        segmentName,
      ];

      let command: string[];
      if (clip.kind === 'image') {
        command = [
          '-y',
          '-loop', '1',
          '-i', inputName,
          '-f', 'lavfi',
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
          '-map', '0:v:0',
          '-map', '1:a:0',
          ...commonOutput,
        ];
      } else {
        const hasAudio = await inputHasAudio(ffmpeg, inputName);
        if (hasAudio) {
          command = [
            '-y',
            '-ss', seconds(clip.trimStart),
            '-i', inputName,
            '-map', '0:v:0',
            '-map', '0:a:0',
            '-af', 'apad',
            ...commonOutput,
          ];
        } else {
          command = [
            '-y',
            '-ss', seconds(clip.trimStart),
            '-i', inputName,
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
            '-map', '0:v:0',
            '-map', '1:a:0',
            ...commonOutput,
          ];
        }
      }

      const exitCode = await ffmpeg.exec(command);
      if (exitCode !== 0) throw new Error(`Clip ${index + 1} could not be prepared for export.`);
    }

    const concatName = 'clip_maker_concat.txt';
    const baseName = 'clip_maker_base.mp4';
    filesToDelete.add(concatName);
    filesToDelete.add(baseName);
    const concatList = segmentNames.map((name) => `file '${name}'`).join('\n');
    await ffmpeg.writeFile(concatName, new TextEncoder().encode(concatList));
    onProgress({ stage: 'Joining visual clips…', progress: 52 });
    const concatExitCode = await ffmpeg.exec([
      '-y', '-f', 'concat', '-safe', '0', '-i', concatName, '-c', 'copy', baseName,
    ]);
    if (concatExitCode !== 0) throw new Error('The visual clips could not be joined.');

    const activeSounds = sounds.filter((sound) => sound.start < totalDuration && soundDuration(sound) > 0);
    const activeTexts = texts.filter((text) => text.text.trim() && text.start < totalDuration && text.duration > 0);
    const finalInputs: string[] = ['-i', baseName];

    for (let index = 0; index < activeSounds.length; index += 1) {
      const sound = activeSounds[index];
      const inputName = `sound_input_${index}.${extensionFor(sound.name, 'mp3')}`;
      filesToDelete.add(inputName);
      await ffmpeg.writeFile(inputName, await fetchFile(sound.file));
      finalInputs.push('-i', inputName);
    }

    if (activeTexts.length > 0) {
      const fontName = 'clip_maker_font.ttf';
      filesToDelete.add(fontName);
      onProgress({ stage: 'Preparing text overlays…', progress: 61 });
      await ffmpeg.writeFile(fontName, await fetchFile(FONT_URL));
      for (let index = 0; index < activeTexts.length; index += 1) {
        const textName = `clip_maker_text_${index}.txt`;
        filesToDelete.add(textName);
        await ffmpeg.writeFile(textName, new TextEncoder().encode(activeTexts[index].text));
      }
    }

    const filters: string[] = [];
    let videoMap = '0:v:0';
    activeTexts.forEach((text, index) => {
      const nextLabel = `video_text_${index}`;
      const end = Math.min(totalDuration, text.start + text.duration);
      filters.push(
        `[${videoMap}]drawtext=fontfile=/clip_maker_font.ttf:textfile=/clip_maker_text_${index}.txt:` +
        `fontcolor=${ffmpegColor(text.color)}:fontsize=${Math.round(text.fontSize)}:` +
        `x=(w-text_w)/2:y=(h-text_h)/2:expansion=none:` +
        `enable='between(t\\,${seconds(text.start)}\\,${seconds(end)})'[${nextLabel}]`,
      );
      videoMap = nextLabel;
    });

    const soundLabels: string[] = [];
    activeSounds.forEach((sound, index) => {
      const duration = soundDuration(sound);
      const fadeIn = Math.min(sound.fadeIn, duration);
      const fadeOut = Math.min(sound.fadeOut, duration);
      const delay = Math.max(0, Math.round(sound.start * 1000));
      const parts = [
        `[${index + 1}:a]atrim=start=${seconds(sound.trimStart)}:end=${seconds(sound.trimEnd)}`,
        'asetpts=PTS-STARTPTS',
        'aresample=48000',
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
      ];
      if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${seconds(fadeIn)}`);
      if (fadeOut > 0) parts.push(`afade=t=out:st=${seconds(Math.max(0, duration - fadeOut))}:d=${seconds(fadeOut)}`);
      parts.push(`adelay=${delay}|${delay}[sound_${index}]`);
      filters.push(parts.join(','));
      soundLabels.push(`[sound_${index}]`);
    });

    let audioMap = '0:a:0';
    if (soundLabels.length > 0) {
      filters.push(
        `[0:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[base_audio]`,
      );
      filters.push(
        `[base_audio]${soundLabels.join('')}amix=inputs=${soundLabels.length + 1}:duration=first:` +
        'dropout_transition=0:normalize=0[mixed_audio]',
      );
      audioMap = 'mixed_audio';
    }

    const outputName = 'clip_maker_output.mp4';
    filesToDelete.add(outputName);
    const finalCommand = ['-y', ...finalInputs];
    if (filters.length > 0) finalCommand.push('-filter_complex', filters.join(';'));
    finalCommand.push('-map', activeTexts.length > 0 ? `[${videoMap}]` : videoMap);
    finalCommand.push('-map', soundLabels.length > 0 ? `[${audioMap}]` : audioMap);
    if (activeTexts.length > 0) {
      finalCommand.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24');
    } else {
      finalCommand.push('-c:v', 'copy');
    }
    finalCommand.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', seconds(totalDuration),
      '-movflags', '+faststart',
      outputName,
    );

    onProgress({ stage: 'Rendering text and audio layers…', progress: 68 });
    const finalExitCode = await ffmpeg.exec(finalCommand);
    if (finalExitCode !== 0) throw new Error('The final MP4 could not be rendered.');

    onProgress({ stage: 'Finalizing MP4…', progress: 96 });
    const outputData = await ffmpeg.readFile(outputName);
    if (typeof outputData === 'string') throw new Error('The exported MP4 data was invalid.');
    const bytes = new Uint8Array(outputData);
    return new Blob([bytes.buffer], { type: 'video/mp4' });
  } finally {
    for (const fileName of filesToDelete) {
      try { await ffmpeg.deleteFile(fileName); } catch { /* Ignore cleanup for files not created. */ }
    }
  }
}
