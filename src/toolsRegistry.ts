import React from 'react';
import ResizerImage from './pages/tools/ResizerImage';
import ConverterChem from './pages/tools/ConverterChem';
import Mp4ToMp3 from './pages/tools/Mp4ToMp3';
import AudioToMp3 from './pages/tools/AudioToMp3';
import TrimMp3 from './pages/tools/TrimMp3';
import TrimVideo from './pages/tools/TrimVideo';

export interface Tool {
  id: string;
  name: string;
  path: string;
  description: string;
  category: string;
  iconName: string; // Lucide icon name
  component: React.ComponentType;
}

export const toolsRegistry: Tool[] = [
  {
    id: 'resizer-image',
    name: 'Resizer Image',
    path: '/resizerimage',
    description: 'Resize, compress, and convert your images with high quality and custom dimensions.',
    category: 'Image & Design',
    iconName: 'Image',
    component: ResizerImage,
  },
  {
    id: 'converter-chem',
    name: 'ConverterChem',
    path: '/converterchem',
    description: 'Convert between cM, %, volume, mass, and mol with physical solution properties.',
    category: 'Chemistry & Calculation',
    iconName: 'FlaskConical',
    component: ConverterChem,
  },
  {
    id: 'mp4-to-mp3',
    name: 'MP4 to MP3',
    path: '/mp4tomp3',
    description: 'Extract high-fidelity MP3 audio tracks directly from your MP4 or MKV videos.',
    category: 'Audio & Video',
    iconName: 'Music',
    component: Mp4ToMp3,
  },
  {
    id: 'audio-to-mp3',
    name: 'Audio to MP3',
    path: '/audiotomp3',
    description: 'Convert audio files (M4A, WAV, AAC, FLAC, and more) to high-quality MP3 directly in the browser.',
    category: 'Audio & Video',
    iconName: 'Volume2',
    component: AudioToMp3,
  },
  {
    id: 'trim-mp3',
    name: 'Trim MP3',
    path: '/trimmp3',
    description: 'Trim MP3 audio precisely with a visual waveform and no loss in sound quality.',
    category: 'Audio & Video',
    iconName: 'Scissors',
    component: TrimMp3,
  },
  {
    id: 'trim-video',
    name: 'Trim Video',
    path: '/trimvideo',
    description: 'Trim video visually with thumbnail previews while preserving the original stream quality.',
    category: 'Audio & Video',
    iconName: 'Clapperboard',
    component: TrimVideo,
  },
];
