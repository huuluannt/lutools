import { useState, useEffect } from 'react';
import { Copy, Check, FlaskConical } from 'lucide-react';

interface ConversionOption {
  id: string;
  name: string;
  fromUnit: string;
  toUnit: string;
  requiredParams: ('molarMass' | 'density' | 'volume' | 'gasStandard')[];
}

export default function ConverterChem() {
  const [inputValue, setInputValue] = useState<string>('1');
  const [selectedConversion, setSelectedConversion] = useState<string>('mass-to-mol');
  
  // Extra Constants
  const [molarMass, setMolarMass] = useState<number>(58.44); // Default NaCl (g/mol)
  const [density, setDensity] = useState<number>(1.0); // Default water-like (g/ml)
  const [volume, setVolume] = useState<number>(1000); // Default 1000 ml (1 L)
  const [gasStandard, setGasStandard] = useState<number>(22.4); // STP default

  const [result, setResult] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Conversion Options Registry
  const conversions: ConversionOption[] = [
    {
      id: 'mass-to-mol',
      name: 'Khối lượng (g) ➔ Mol',
      fromUnit: 'g',
      toUnit: 'mol',
      requiredParams: ['molarMass'],
    },
    {
      id: 'mol-to-mass',
      name: 'Mol ➔ Khối lượng (g)',
      fromUnit: 'mol',
      toUnit: 'g',
      requiredParams: ['molarMass'],
    },
    {
      id: 'percent-to-cm',
      name: 'Nồng độ % ➔ Nồng độ cM',
      fromUnit: '%',
      toUnit: 'M',
      requiredParams: ['molarMass', 'density'],
    },
    {
      id: 'cm-to-percent',
      name: 'Nồng độ cM ➔ Nồng độ %',
      fromUnit: 'M',
      toUnit: '%',
      requiredParams: ['molarMass', 'density'],
    },
    {
      id: 'gas-vol-to-mol',
      name: 'Thể tích khí (L) ➔ Mol',
      fromUnit: 'L',
      toUnit: 'mol',
      requiredParams: ['gasStandard'],
    },
    {
      id: 'mol-to-gas-vol',
      name: 'Mol ➔ Thể tích khí (L)',
      fromUnit: 'mol',
      toUnit: 'L',
      requiredParams: ['gasStandard'],
    },
    {
      id: 'sol-vol-to-mass',
      name: 'Thể tích dung dịch (ml) ➔ Khối lượng (g)',
      fromUnit: 'ml',
      toUnit: 'g',
      requiredParams: ['density'],
    },
    {
      id: 'mass-to-sol-vol',
      name: 'Khối lượng dung dịch (g) ➔ Thể tích (ml)',
      fromUnit: 'g',
      toUnit: 'ml',
      requiredParams: ['density'],
    },
    {
      id: 'mol-to-cm',
      name: 'Mol chất tan ➔ Nồng độ cM',
      fromUnit: 'mol',
      toUnit: 'M',
      requiredParams: ['volume'],
    },
    {
      id: 'cm-to-mol',
      name: 'Nồng độ cM ➔ Mol chất tan',
      fromUnit: 'M',
      toUnit: 'mol',
      requiredParams: ['volume'],
    },
  ];

  const currentOption = conversions.find(c => c.id === selectedConversion) || conversions[0];

  // Perform calculation
  useEffect(() => {
    const val = parseFloat(inputValue);
    if (isNaN(val)) {
      setResult('Invalid value');
      return;
    }

    let calculated = 0;

    switch (selectedConversion) {
      case 'mass-to-mol':
        calculated = val / molarMass;
        break;
      case 'mol-to-mass':
        calculated = val * molarMass;
        break;
      case 'percent-to-cm':
        // CM = (10 * C% * D) / M
        calculated = (10 * val * density) / molarMass;
        break;
      case 'cm-to-percent':
        // C% = (CM * M) / (10 * D)
        calculated = (val * molarMass) / (10 * density);
        break;
      case 'gas-vol-to-mol':
        calculated = val / gasStandard;
        break;
      case 'mol-to-gas-vol':
        calculated = val * gasStandard;
        break;
      case 'sol-vol-to-mass':
        calculated = val * density;
        break;
      case 'mass-to-sol-vol':
        calculated = val / density;
        break;
      case 'mol-to-cm':
        // Volume entered in ml, convert to L for cM (n / V_L)
        calculated = val / (volume / 1000);
        break;
      case 'cm-to-mol':
        // n = cM * V_L
        calculated = val * (volume / 1000);
        break;
      default:
        calculated = 0;
    }

    // Format output beautifully
    if (calculated === 0) {
      setResult('0');
    } else if (Math.abs(calculated) < 0.0001 || Math.abs(calculated) > 99999) {
      setResult(calculated.toExponential(5));
    } else {
      // Limit to 5 decimal places and trim trailing zeros
      setResult(Number(calculated.toFixed(5)).toString());
    }
  }, [inputValue, selectedConversion, molarMass, density, volume, gasStandard]);

  // Support pasting numeric value from clipboard (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        // Attempt to parse pasted text as float
        const parsed = parseFloat(text.trim());
        if (!isNaN(parsed)) {
          setInputValue(parsed.toString());
          e.preventDefault();
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleCopy = () => {
    if (!result || result === 'Invalid value') return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="tool-container fade-in">
      {/* Main Tool Workspace */}
      <div className="workspace-grid" style={{ gridTemplateColumns: '1fr', maxWidth: '640px', margin: '0 auto' }}>
        <div className="panel-section" style={{ padding: '28px', gap: '20px' }}>
          
          {/* ROW 1: INPUT FIELD */}
          <div className="control-group">
            <div className="control-label">
              <span>Giá trị cần chuyển đổi ({currentOption.fromUnit})</span>
              <span className="badge">Nhập số</span>
            </div>
            <input
              id="chem-input-val"
              type="text"
              className="text-input"
              style={{ height: '42px', fontSize: '15px' }}
              placeholder={`Nhập giá trị (${currentOption.fromUnit})...`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <p className="paste-hint" style={{ fontSize: '11.5px', marginTop: '2px' }}>
              Bấm <strong>Ctrl + V</strong> bất kỳ đâu để dán nhanh giá trị số
            </p>
          </div>

          {/* ROW 2: CONVERSION DROPLIST */}
          <div className="control-group">
            <label className="control-label" htmlFor="chem-conv-select">Đại lượng convert</label>
            <div className="select-wrapper">
              <select
                id="chem-conv-select"
                className="select-input"
                style={{ height: '42px', fontSize: '14.5px' }}
                value={selectedConversion}
                onChange={(e) => setSelectedConversion(e.target.value)}
              >
                {conversions.map((conv) => (
                  <option key={conv.id} value={conv.id}>
                    {conv.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* DYNAMIC ROW: EXTRA CONSTANT REQUIRED PARAMETERS */}
          {currentOption.requiredParams.length > 0 && (
            <div className="panel-section" style={{ backgroundColor: 'var(--bg-tertiary)', border: 'none', padding: '16px', borderRadius: 'var(--radius-md)', gap: '12px' }}>
              <h3 style={{ fontSize: '12.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FlaskConical size={14} />
                Hằng số hóa lý yêu cầu
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                {/* Molar Mass */}
                {currentOption.requiredParams.includes('molarMass') && (
                  <div className="control-group">
                    <label className="control-label" style={{ fontSize: '11.5px' }}>Khối lượng mol M (g/mol)</label>
                    <input
                      type="number"
                      className="text-input"
                      style={{ height: '34px', fontSize: '13px' }}
                      value={molarMass || ''}
                      onChange={(e) => setMolarMass(parseFloat(e.target.value) || 0)}
                      min="0.1"
                      step="0.01"
                    />
                  </div>
                )}

                {/* Density */}
                {currentOption.requiredParams.includes('density') && (
                  <div className="control-group">
                    <label className="control-label" style={{ fontSize: '11.5px' }}>Khối lượng riêng D (g/ml)</label>
                    <input
                      type="number"
                      className="text-input"
                      style={{ height: '34px', fontSize: '13px' }}
                      value={density || ''}
                      onChange={(e) => setDensity(parseFloat(e.target.value) || 0)}
                      min="0.01"
                      step="0.01"
                    />
                  </div>
                )}

                {/* Solution Volume */}
                {currentOption.requiredParams.includes('volume') && (
                  <div className="control-group">
                    <label className="control-label" style={{ fontSize: '11.5px' }}>Thể tích dung dịch (ml)</label>
                    <input
                      type="number"
                      className="text-input"
                      style={{ height: '34px', fontSize: '13px' }}
                      value={volume || ''}
                      onChange={(e) => setVolume(parseFloat(e.target.value) || 0)}
                      min="1"
                    />
                  </div>
                )}

                {/* Gas Standard */}
                {currentOption.requiredParams.includes('gasStandard') && (
                  <div className="control-group">
                    <label className="control-label" style={{ fontSize: '11.5px' }}>Điều kiện khí (L/mol)</label>
                    <select
                      className="select-input"
                      style={{ height: '34px', fontSize: '13px', padding: '0 8px' }}
                      value={gasStandard}
                      onChange={(e) => setGasStandard(parseFloat(e.target.value))}
                    >
                      <option value={22.4}>STP cũ: 22.4 L/mol (0°C, 1 atm)</option>
                      <option value={24.79}>IUPAC mới: 24.79 L/mol (25°C, 1 bar)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ROW 3: RESULT FIELD WITH COPY BUTTON */}
          <div className="control-group">
            <label className="control-label">Kết quả ({currentOption.toUnit})</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div 
                className="text-input" 
                style={{ 
                  flex: 1, 
                  height: '46px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-light)',
                  fontWeight: 600,
                  fontSize: '18px',
                  color: result === 'Invalid value' ? 'red' : 'var(--text-primary)',
                  userSelect: 'all',
                  padding: '0 16px',
                  overflowX: 'auto',
                  whiteSpace: 'nowrap'
                }}
              >
                {result}
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ width: '46px', height: '46px', padding: 0, borderRadius: 'var(--radius-sm)' }}
                onClick={handleCopy}
                disabled={!result || result === 'Invalid value'}
                title="Sao chép kết quả"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
