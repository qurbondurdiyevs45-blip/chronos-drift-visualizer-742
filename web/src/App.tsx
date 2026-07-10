import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DriftVisualizer } from './components/DriftVisualizer';
import { SystemControls } from './components/SystemControls';
import { MetricsSidebar } from './components/MetricsSidebar';
import { useSocket } from './hooks/useSocket';

interface DriftPacket {
  serviceId: string;
  timestamp: number;
  jitter: number;
  drift: number;
  vector: [number, number, number];
}

const App: React.FC = () => {
  const [data, setData] = useState<DriftPacket[]>([]);
  const [threshold, setThreshold] = useState<number>(0.5);
  const [isLive, setIsLive] = useState<boolean>(true);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { lastMessage, readyState } = useSocket(`${protocol}//${window.location.host}/ws/v1/drift`);

  useEffect(() => {
    if (lastMessage && isLive) {
      const packet: DriftPacket = JSON.parse(lastMessage.data);
      setData((prev) => {
        const next = [...prev, packet];
        return next.slice(-2000); // Maintain buffer window
      });
    }
  }, [lastMessage, isLive]);

  const stats = useMemo(() => {
    if (data.length === 0) return { avgDrift: 0, peakJitter: 0, activeNodes: 0 };
    const nodes = new Set(data.map(d => d.serviceId));
    const avg = data.reduce((acc, d) => acc + Math.abs(d.drift), 0) / data.length;
    const max = Math.max(...data.map(d => d.jitter));
    return { avgDrift: avg, peakJitter: max, activeNodes: nodes.size };
  }, [data]);

  const handleReset = () => {
    setData([]);
  };

  return (
    <div className="chronos-drift-root">
      <header className="app-header">
        <div className="brand">
          <div className="logo-glyph" />
          <h1>CHRONOS DRIFT <span>VISUALIZER</span></h1>
        </div>
        <div className="connection-status">
          <span className={`status-dot ${readyState === 1 ? 'online' : 'offline'}`} />
          {readyState === 1 ? 'LIVE TELEMETRY' : 'CONNECTING TO ZIG-ENGINE...'}
        </div>
      </header>

      <main className="dashboard-layout">
        <div className="viz-container">
          <DriftVisualizer 
            dataset={data} 
            threshold={threshold}
            highlightedService={selectedService}
            onNodeClick={setSelectedService}
          />
          
          <div className="overlay-controls">
            <div className="control-group">
              <label>DRIFT THRESHOLD (ms)</label>
              <input 
                type="range" 
                min="0" 
                max="5" 
                step="0.01" 
                value={threshold} 
                onChange={(e) => setThreshold(parseFloat(e.target.value))} 
              />
              <span className="value-display">{threshold.toFixed(2)}ms</span>
            </div>
            
            <div className="action-buttons">
              <button 
                className={isLive ? 'btn-active' : ''} 
                onClick={() => setIsLive(!isLive)}
              >
                {isLive ? 'PAUSE' : 'RESUME'}
              </button>
              <button onClick={handleReset}>FLUSH CACHE</button>
            </div>
          </div>
        </div>

        <MetricsSidebar 
          stats={stats}
          data={data}
          selectedService={selectedService}
          onServiceSelect={setSelectedService}
        />
      </main>

      <SystemControls />

      <style>{`
        .chronos-drift-root {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: #050505;
          color: #00ff9d;
          font-family: 'JetBrains Mono', monospace;
          overflow: hidden;
        }
        .app-header {
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          border-bottom: 1px solid #1a1a1a;
          background: rgba(10, 10, 10, 0.8);
          backdrop-filter: blur(10px);
          z-index: 10;
        }
        .brand h1 {
          font-size: 18px;
          letter-spacing: 2px;
          margin: 0;
        }
        .brand span {
          color: #444;
        }
        .dashboard-layout {
          flex: 1;
          display: flex;
          position: relative;
        }
        .viz-container {
          flex: 1;
          position: relative;
          background: radial-gradient(circle at center, #0a0a0a 0%, #000 100%);
        }
        .overlay-controls {
          position: absolute;
          bottom: 24px;
          left: 24px;
          background: rgba(0, 0, 0, 0.8);
          padding: 16px;
          border: 1px solid #333;
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .control-group label {
          font-size: 10px;
          color: #888;
        }
        .value-display {
          font-size: 12px;
          text-align: right;
        }
        .action-buttons {
          display: flex;
          gap: 10px;
        }
        button {
          background: #111;
          border: 1px solid #333;
          color: #00ff9d;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 10px;
          transition: all 0.2s;
        }
        button:hover {
          background: #222;
          border-color: #00ff9d;
        }
        .btn-active {
          background: #00ff9d;
          color: #000;
        }
        .status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 8px;
        }
        .status-dot.online {
          background: #00ff9d;
          box-shadow: 0 0 10px #00ff9d;
        }
        .status-dot.offline {
          background: #ff4444;
        }
        input[type=range] {
          accent-color: #00ff9d;
        }
      `}</style>
    </div>
  );
};

export default App;