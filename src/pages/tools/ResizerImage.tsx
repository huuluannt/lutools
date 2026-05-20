import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, RefreshCw, FileImage, Settings, Check } from 'lucide-react';

interface ImageDetails {
  name: string;
  size: number;
  width: number;
  height: number;
  type: string;
}

export default function ResizerImage() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageDetails, setImageDetails] = useState<ImageDetails | null>(null);
  
  // Resizing Controls
  const [width, setWidth] = useState<number>(0);
  const [height, setHeight] = useState<number>(0);
  const [lockAspectRatio, setLockAspectRatio] = useState<boolean>(true);
  const [aspectRatio, setAspectRatio] = useState<number>(1);
  const [quality, setQuality] = useState<number>(90);
  const [format, setFormat] = useState<string>('image/jpeg');
  const [scale, setScale] = useState<number>(100);

  const [processing, setProcessing] = useState<boolean>(false);
  const [resizedSrc, setResizedSrc] = useState<string | null>(null);
  const [resizedSize, setResizedSize] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      loadImage(e.target.files[0]);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadImage(e.dataTransfer.files[0]);
    }
  };

  // Load image
  const loadImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      setImageSrc(src);
      
      const img = new Image();
      img.onload = () => {
        const details: ImageDetails = {
          name: file.name,
          size: file.size,
          width: img.naturalWidth,
          height: img.naturalHeight,
          type: file.type || 'image/jpeg',
        };
        setImageDetails(details);
        setWidth(img.naturalWidth);
        setHeight(img.naturalHeight);
        setAspectRatio(img.naturalWidth / img.naturalHeight);
        setScale(100);
        
        // Reset preview
        setResizedSrc(null);
        setResizedSize(null);
      };
      img.src = src;
      originalImageRef.current = img;
    };
    reader.readAsDataURL(file);
  };

  // Adjust width (maintaining aspect ratio if locked)
  const handleWidthChange = (val: number) => {
    setWidth(val);
    if (lockAspectRatio && aspectRatio) {
      setHeight(Math.round(val / aspectRatio));
    }
  };

  // Adjust height (maintaining aspect ratio if locked)
  const handleHeightChange = (val: number) => {
    setHeight(val);
    if (lockAspectRatio && aspectRatio) {
      setWidth(Math.round(val * aspectRatio));
    }
  };

  // Adjust scale slider
  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    if (imageDetails) {
      const newWidth = Math.round((imageDetails.width * newScale) / 100);
      const newHeight = Math.round((imageDetails.height * newScale) / 100);
      setWidth(newWidth);
      setHeight(newHeight);
    }
  };

  // Run the resizing operation on Canvas
  useEffect(() => {
    if (!imageSrc || width <= 0 || height <= 0) return;

    const delayDebounce = setTimeout(() => {
      generatePreview();
    }, 300); // Debounce to avoid constant high canvas redrawing

    return () => clearTimeout(delayDebounce);
  }, [width, height, format, quality, imageSrc]);

  // Support pasting image from clipboard (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
              loadImage(file);
              e.preventDefault();
              break;
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const generatePreview = () => {
    if (!imageSrc) return;
    setProcessing(true);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // High quality scale settings
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL(format, format === 'image/png' ? undefined : quality / 100);
        setResizedSrc(dataUrl);

        // Estimate size from Base64 length (approx 75% of base64 size)
        const base64Length = dataUrl.split(',')[1].length;
        const sizeInBytes = Math.floor(base64Length * 0.75);
        setResizedSize(sizeInBytes);
      }
      setProcessing(false);
    };
    img.src = imageSrc;
  };

  // Trigger download
  const downloadImage = () => {
    if (!resizedSrc || !imageDetails) return;
    
    const link = document.createElement('a');
    const extension = format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';
    const originalNameWithoutExt = imageDetails.name.substring(0, imageDetails.name.lastIndexOf('.')) || imageDetails.name;
    
    link.download = `${originalNameWithoutExt}_resized.${extension}`;
    link.href = resizedSrc;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Format file sizes elegantly
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const handleReset = () => {
    setImageSrc(null);
    setImageDetails(null);
    setResizedSrc(null);
    setResizedSize(null);
  };

  return (
    <div className="tool-container fade-in">
      {/* Main Tool Workspace */}
      {!imageSrc ? (
        // Dropzone Area
        <div 
          className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            style={{ display: 'none' }} 
          />
          <div className="upload-content">
            <div className="icon-wrapper">
              <Upload size={32} />
            </div>
            <h3>Drag & drop your image here</h3>
            <p>Supports PNG, JPEG, WebP up to 50MB. Processed completely in your browser.</p>
            <p className="paste-hint">or press <strong>Ctrl + V</strong> to paste from clipboard</p>
            <button className="btn-primary">Browse Files</button>
          </div>
        </div>
      ) : (
        // Workspace Grid
        <div className="workspace-grid">
          {/* Controls Column */}
          <div className="panel-controls">
            <div className="panel-section">
              <div className="panel-section-header">
                <Settings size={16} />
                <h2>Resize Options</h2>
              </div>
              
              {/* Presets / Scale slider */}
              <div className="control-group">
                <div className="control-label">
                  <span>Scale Factor</span>
                  <span className="badge">{scale}%</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="200" 
                  value={scale} 
                  onChange={(e) => handleScaleChange(Number(e.target.value))}
                  className="slider"
                />
              </div>

              {/* Dimensions inputs */}
              <div className="dimensions-row">
                <div className="control-group">
                  <label className="control-label">Width (px)</label>
                  <input 
                    type="number" 
                    value={width || ''} 
                    onChange={(e) => handleWidthChange(Number(e.target.value))}
                    min="1"
                    className="text-input"
                  />
                </div>
                
                <div className="aspect-ratio-lock">
                  <button 
                    className={`lock-toggle-btn ${lockAspectRatio ? 'locked' : ''}`}
                    onClick={() => {
                      setLockAspectRatio(!lockAspectRatio);
                      if (!lockAspectRatio && imageDetails) {
                        setAspectRatio(width / height);
                      }
                    }}
                    title="Lock Aspect Ratio"
                  >
                    {lockAspectRatio ? '🔗' : '🔓'}
                  </button>
                </div>

                <div className="control-group">
                  <label className="control-label">Height (px)</label>
                  <input 
                    type="number" 
                    value={height || ''} 
                    onChange={(e) => handleHeightChange(Number(e.target.value))}
                    min="1"
                    className="text-input"
                  />
                </div>
              </div>
            </div>

            {/* Quality & Format Selection */}
            <div className="panel-section">
              <div className="panel-section-header">
                <FileImage size={16} />
                <h2>Format & Quality</h2>
              </div>

              <div className="control-group">
                <label className="control-label">Export Format</label>
                <div className="select-wrapper">
                  <select 
                    value={format} 
                    onChange={(e) => setFormat(e.target.value)}
                    className="select-input"
                  >
                    <option value="image/jpeg">JPEG (.jpg)</option>
                    <option value="image/png">PNG (.png)</option>
                    <option value="image/webp">WebP (.webp)</option>
                  </select>
                </div>
              </div>

              {format !== 'image/png' && (
                <div className="control-group">
                  <div className="control-label">
                    <span>Quality</span>
                    <span className="badge">{quality}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    value={quality} 
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="slider"
                  />
                </div>
              )}
            </div>

            {/* File Info */}
            <div className="panel-section info-panel">
              <h3>Image Statistics</h3>
              <div className="stat-table">
                <div className="stat-row">
                  <span className="stat-label">File Name</span>
                  <span className="stat-value truncate" title={imageDetails?.name}>{imageDetails?.name}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Original Size</span>
                  <span className="stat-value">{imageDetails ? formatBytes(imageDetails.size) : '0 B'}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Original Res</span>
                  <span className="stat-value">{imageDetails?.width} x {imageDetails?.height} px</span>
                </div>
                <div className="divider"></div>
                <div className="stat-row highlight">
                  <span className="stat-label">New Est. Size</span>
                  <span className="stat-value">{resizedSize ? formatBytes(resizedSize) : 'Estimating...'}</span>
                </div>
                <div className="stat-row highlight">
                  <span className="stat-label">New Resolution</span>
                  <span className="stat-value">{width} x {height} px</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="panel-actions">
              <button 
                onClick={handleReset} 
                className="btn-secondary"
              >
                <RefreshCw size={14} />
                <span>Upload New</span>
              </button>
              <button 
                onClick={downloadImage} 
                disabled={processing || !resizedSrc}
                className="btn-primary flex-fill"
              >
                <Download size={14} />
                <span>Download Resized</span>
              </button>
            </div>
          </div>

          {/* Preview Column */}
          <div className="panel-preview">
            <div className="preview-container-box">
              {processing && (
                <div className="preview-loading">
                  <div className="spinner"></div>
                  <span>Processing high-fidelity preview...</span>
                </div>
              )}
              
              <div className="preview-canvas-wrapper">
                {resizedSrc ? (
                  <img 
                    src={resizedSrc} 
                    alt="Resized Preview" 
                    className="resized-preview-img"
                  />
                ) : (
                  <div className="placeholder-preview">
                    <FileImage size={48} strokeWidth={1} />
                    <p>Generating preview...</p>
                  </div>
                )}
              </div>
            </div>
            <div className="preview-bar-label">
              <Check size={14} className="success-icon" />
              <span>Real-time preview rendered safely in browser</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
