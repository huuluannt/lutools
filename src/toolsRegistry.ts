import React from 'react';
import ResizerImage from './pages/tools/ResizerImage';
import ConverterChem from './pages/tools/ConverterChem';

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
];

