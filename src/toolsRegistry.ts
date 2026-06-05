import React from 'react';
import ResizerImage from './pages/tools/ResizerImage';
import ConverterChem from './pages/tools/ConverterChem';
import Mp4ToMp3 from './pages/tools/Mp4ToMp3';

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
    description: 'Extract high-fidelity MP3 audio tracks directly from your MP4 videos.',
    category: 'Audio & Video',
    iconName: 'Music',
    component: Mp4ToMp3,
  },
];


