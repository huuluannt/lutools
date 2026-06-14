import { useState, useEffect, useRef } from 'react';
import { Upload, Music, Download, RefreshCw, FileVideo, AlertCircle, X, Check } from 'lucide-react';
import Mp3EncoderWorker from './mp3Encoder.worker?worker';

interface AudioDetails {
  duration: number;
  sampleRate: number;
  channels: number;
}

export default function Mp4ToMp3() {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [bitrate, setBitrate] = useState<number>(192); // Default to 192kbps
  
  // Status states
  const [status, setStatus] = useState<'idle' | 'reading' | 'decoding' | 'encoding' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Output details
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [outputSize, setOutputSize] = useState<number | null>(null);
  const [outputName, setOutputName] = useState<string | null>(null);
  const [audioDetails, setAudioDetails] = useState<AudioDetails | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // Clean up URL and Worker on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [audioUrl]);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      selectFile(e.target.files[0]);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      selectFile(e.dataTransfer.files[0]);
    }
  };

  // Support pasting file from clipboard (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('video') !== -1) {
            const fileObj = items[i].getAsFile();
            if (fileObj) {
              selectFile(fileObj);
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

  const selectFile = (selectedFile: File) => {
    const isVideoType = selectedFile.type.startsWith('video/');
    const hasVideoExtension = /\.(mp4|m4v|mkv)$/i.test(selectedFile.name);
    
    if (!isVideoType && !hasVideoExtension) {
      setErrorMsg('Please select a valid MP4 or MKV video file.');
      setStatus('error');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setStatus('idle');
    setErrorMsg(null);
    setAudioUrl(null);
    setOutputSize(null);
    setOutputName(null);
    setAudioDetails(null);
    setProgress(0);
  };

  // Format helper functions
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const cancelConversion = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setStatus('idle');
    setProgress(0);
  };

  const startConversion = async () => {
    if (!file) return;

    try {
      setErrorMsg(null);
      setProgress(0);
      setStatus('reading');

      // 1. Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // 2. Decode Audio Data
      setStatus('decoding');
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      let decodedBuffer: AudioBuffer;
      try {
        decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.error('Audio decoding error:', err);
        throw new Error('This video file does not have a supported audio track or the format is invalid.');
      } finally {
        await audioCtx.close();
      }

      const numChannels = Math.min(decodedBuffer.numberOfChannels, 2);
      const sampleRate = decodedBuffer.sampleRate;
      const duration = decodedBuffer.duration;

      setAudioDetails({
        duration,
        sampleRate,
        channels: numChannels,
      });

      // 3. Start Encoding with Web Worker
      setStatus('encoding');
      
      const leftChannel = decodedBuffer.getChannelData(0);
      const rightChannel = numChannels === 2 ? decodedBuffer.getChannelData(1) : null;

      // Initialize Web Worker
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      
      workerRef.current = new Mp3EncoderWorker();

      // Hook worker events
      workerRef.current.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data.type === 'progress') {
          setProgress(data.progress);
        } else if (data.type === 'done') {
          const blob = new Blob(data.mp3Data, { type: 'audio/mp3' });
          const url = URL.createObjectURL(blob);
          
          setAudioUrl(url);
          setOutputSize(blob.size);
          const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          setOutputName(`${originalName}.mp3`);
          setStatus('done');
          
          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
        } else if (data.type === 'error') {
          throw new Error(data.error);
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('Worker error:', err);
        throw new Error('An error occurred during audio encoding.');
      };

      // Transfer buffers to worker for speed and memory efficiency
      workerRef.current.postMessage({
        leftChannel,
        rightChannel,
        sampleRate,
        numChannels,
        kbps: bitrate
      }, [leftChannel.buffer, ...(rightChannel ? [rightChannel.buffer] : [])]);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'An error occurred during conversion.');
      setStatus('error');
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    }
  };

  const handleReset = () => {
    setFile(null);
    setStatus('idle');
    setErrorMsg(null);
    setAudioUrl(null);
    setOutputSize(null);
    setOutputName(null);
    setAudioDetails(null);
    setProgress(0);
  };

  return (
    <div className="tool-container fade-in">
      <div className="workspace-grid">
        
        {/* LEFT COLUMN: UPLOAD & CONVERSION */}
        <div className="panel-controls">
          <div className="panel-section" style={{ padding: '24px', gap: '20px' }}>
            
            {!file ? (
              // Dropzone Area
              <div 
                className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{ minHeight: '260px', padding: '30px 20px' }}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="video/mp4, video/m4v, video/x-matroska, .mp4, .mkv" 
                  style={{ display: 'none' }} 
                />
                <div className="upload-content">
                  <div className="icon-wrapper" style={{ width: '48px', height: '48px', marginBottom: '4px' }}>
                    <Upload size={24} />
                  </div>
                  <h3 style={{ fontSize: '15px' }}>Drag & drop your MP4 or MKV file here</h3>
                  <p style={{ fontSize: '12px' }}>Processed completely inside your browser.</p>
                  <p className="paste-hint" style={{ fontSize: '11px' }}>or press <strong>Ctrl + V</strong> to paste from clipboard</p>
                  <button className="btn-secondary" style={{ height: '34px', padding: '0 16px', fontSize: '12.5px', marginTop: '4px' }}>Browse Files</button>
                </div>
              </div>
            ) : (
              // File Info Panel
              <div className="control-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label className="control-label" style={{ fontWeight: 600 }}>Selected File</label>
                  <button 
                    onClick={handleReset} 
                    className="lock-toggle-btn"
                    style={{ width: '24px', height: '24px', backgroundColor: 'transparent' }}
                    title="Remove file"
                  >
                    <X size={14} />
                  </button>
                </div>
                
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: '12px', 
                  borderRadius: 'var(--radius-md)', 
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-light)'
                }}>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    <FileVideo size={28} strokeWidth={1.5} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontSize: '13.5px', fontWeight: 500 }} title={file.name}>
                      {file.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Size: {formatBytes(file.size)}
                    </div>
                  </div>
                </div>

                {/* Warning for large files */}
                {file.size > 80 * 1024 * 1024 && (
                  <div style={{ 
                    display: 'flex', 
                    gap: '8px', 
                    padding: '10px 12px', 
                    borderRadius: 'var(--radius-sm)', 
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    marginTop: '12px',
                    fontSize: '11.5px',
                    color: '#b45309'
                  }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>Large file detected. Extraction in browser may take a moment.</span>
                  </div>
                )}
              </div>
            )}

            {/* Bitrate Selection (Only when file is selected and not converting) */}
            {file && status !== 'reading' && status !== 'decoding' && status !== 'encoding' && (
              <div className="control-group">
                <label className="control-label">MP3 Quality (Bitrate)</label>
                <div className="select-wrapper">
                  <select 
                    value={bitrate} 
                    onChange={(e) => setBitrate(Number(e.target.value))}
                    className="select-input"
                    style={{ height: '38px', fontSize: '13.5px' }}
                  >
                    <option value={128}>128 kbps (Standard - Smaller size)</option>
                    <option value={192}>192 kbps (Medium quality - Recommended)</option>
                    <option value={256}>256 kbps (High quality - Clean audio)</option>
                    <option value={320}>320 kbps (Extreme quality - Largest size)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Convert Button & Progress Panel */}
            {file && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {status === 'idle' && (
                  <button 
                    onClick={startConversion} 
                    className="btn-primary"
                    style={{ width: '100%', height: '42px', fontSize: '14px' }}
                  >
                    Convert to MP3
                  </button>
                )}

                {/* Progress bar container */}
                {(status === 'reading' || status === 'decoding' || status === 'encoding') && (
                  <div style={{ 
                    padding: '16px', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid var(--border-light)',
                    backgroundColor: 'var(--bg-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                        {status === 'reading' && 'Reading video file...'}
                        {status === 'decoding' && 'Decoding audio track...'}
                        {status === 'encoding' && `Encoding MP3 (${progress}%)`}
                      </span>
                      {status === 'encoding' && (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>{progress}%</span>
                      )}
                    </div>
                    
                    <div style={{ 
                      width: '100%', 
                      height: '6px', 
                      backgroundColor: 'var(--bg-tertiary)', 
                      borderRadius: '3px',
                      overflow: 'hidden'
                    }}>
                      <div style={{ 
                        height: '100%', 
                        backgroundColor: 'var(--text-primary)', 
                        width: `${status === 'encoding' ? progress : status === 'decoding' ? 20 : 5}%`,
                        transition: 'width 0.2s ease-out'
                      }}></div>
                    </div>

                    <button 
                      onClick={cancelConversion} 
                      className="btn-secondary"
                      style={{ 
                        height: '32px', 
                        padding: '0 12px', 
                        fontSize: '11.5px', 
                        alignSelf: 'flex-end', 
                        marginTop: '4px',
                        borderColor: '#ef4444',
                        color: '#ef4444'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Error Box */}
                {status === 'error' && errorMsg && (
                  <div style={{ 
                    display: 'flex', 
                    gap: '8px', 
                    padding: '12px', 
                    borderRadius: 'var(--radius-md)', 
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    fontSize: '12.5px',
                    color: '#dc2626'
                  }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>Conversion Failed</div>
                      <div style={{ marginTop: '2px', fontSize: '11.5px' }}>{errorMsg}</div>
                      <button 
                        onClick={handleReset} 
                        className="btn-secondary"
                        style={{ height: '28px', padding: '0 10px', fontSize: '11px', marginTop: '8px', borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                )}

                {/* Done/Reset state */}
                {status === 'done' && (
                  <button 
                    onClick={handleReset} 
                    className="btn-secondary"
                    style={{ width: '100%', height: '42px', fontSize: '14px' }}
                  >
                    <RefreshCw size={14} />
                    <span>Convert Another File</span>
                  </button>
                )}
              </div>
            )}

          </div>
        </div>

        {/* RIGHT COLUMN: RESULTS */}
        <div className="panel-preview">
          <div className="preview-container-box" style={{ minHeight: '380px' }}>
            
            {status !== 'done' ? (
              // Idle/Processing Placeholder
              <div className="placeholder-preview" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ 
                  width: '56px', 
                  height: '56px', 
                  borderRadius: '50%', 
                  backgroundColor: 'var(--bg-primary)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-light)',
                  margin: '0 auto 16px'
                }}>
                  <Music size={24} strokeWidth={1.5} />
                </div>
                <h3 style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 600 }}>MP3 Output Results</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '280px', margin: '8px auto 0', lineHeight: 1.5 }}>
                  Once converted, your high-fidelity MP3 track details, playable audio, and download action will appear here.
                </p>
              </div>
            ) : (
              // Conversion Done Results View
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* Success Banner */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  color: '#059669', 
                  fontSize: '13.5px', 
                  fontWeight: 600 
                }}>
                  <Check size={16} style={{ color: '#059669' }} />
                  <span>Audio extracted successfully!</span>
                </div>

                {/* Title */}
                <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }} className="truncate" title={outputName || ''}>
                    {outputName}
                  </h3>
                </div>

                {/* HTML5 Audio Player */}
                {audioUrl && (
                  <div style={{ 
                    padding: '8px', 
                    borderRadius: 'var(--radius-md)', 
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'center'
                  }}>
                    <audio 
                      src={audioUrl} 
                      controls 
                      style={{ width: '100%', height: '36px' }}
                    />
                  </div>
                )}

                {/* Statistics Table */}
                <div className="panel-section info-panel" style={{ border: 'none', backgroundColor: 'var(--bg-primary)', padding: '16px', boxShadow: 'none' }}>
                  <h4 style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Track Statistics
                  </h4>
                  
                  <div className="stat-table">
                    <div className="stat-row">
                      <span className="stat-label">Output Format</span>
                      <span className="stat-value">MP3 (MPEG Audio Layer III)</span>
                    </div>
                    {audioDetails && (
                      <>
                        <div className="stat-row">
                          <span className="stat-label">Duration</span>
                          <span className="stat-value">{formatDuration(audioDetails.duration)}</span>
                        </div>
                        <div className="stat-row">
                          <span className="stat-label">Sample Rate</span>
                          <span className="stat-value">{audioDetails.sampleRate / 1000} kHz</span>
                        </div>
                        <div className="stat-row">
                          <span className="stat-label">Audio Channels</span>
                          <span className="stat-value">{audioDetails.channels === 2 ? 'Stereo (2ch)' : 'Mono (1ch)'}</span>
                        </div>
                      </>
                    )}
                    <div className="stat-row">
                      <span className="stat-label">Selected Bitrate</span>
                      <span className="stat-value">{bitrate} kbps</span>
                    </div>
                    <div className="divider"></div>
                    <div className="stat-row highlight">
                      <span className="stat-label">Output File Size</span>
                      <span className="stat-value">{outputSize ? formatBytes(outputSize) : 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Download Button */}
                {audioUrl && outputName && (
                  <a 
                    href={audioUrl} 
                    download={outputName}
                    className="btn-primary"
                    style={{ 
                      textDecoration: 'none', 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      height: '42px', 
                      fontSize: '13.5px',
                      fontWeight: 500,
                      marginTop: '8px'
                    }}
                  >
                    <Download size={15} />
                    <span>Download MP3</span>
                  </a>
                )}

              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
