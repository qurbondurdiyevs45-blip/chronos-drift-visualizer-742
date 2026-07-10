<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let driftData: { 
    serviceName: string; 
    driftNs: number; 
    jitter: number; 
    sampleRate: number;
    color: string;
  };

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let animationFrame: number;
  let history: number[] = new Array(60).fill(0);

  $: scaledDrift = (driftData.driftNs / 1000).toFixed(3);
  $: jitterMs = (driftData.jitter / 1000000).toFixed(4);

  function drawSparkline() {
    if (!ctx) return;
    
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    
    history.push(driftData.driftNs);
    if (history.length > width) history.shift();

    ctx.beginPath();
    ctx.strokeStyle = driftData.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';

    const max = Math.max(...history.map(Math.abs), 100);
    const mid = height / 2;

    history.forEach((val, i) => {
      const x = i;
      const y = mid - (val / max) * (height / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
    
    // Gradient fill
    ctx.lineTo(history.length - 1, height);
    ctx.lineTo(0, height);
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `${driftData.color}44`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();

    animationFrame = requestAnimationFrame(drawSparkline);
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { alpha: true })!;
    drawSparkline();
  });

  onDestroy(() => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
  });
</script>

<div class="drift-card" style="--accent: {driftData.color}">
  <div class="header">
    <span class="service-name">{driftData.serviceName}</span>
    <span class="status-pill">Live</span>
  </div>

  <div class="metrics-grid">
    <div class="metric">
      <label>CLOCK DRIFT</label>
      <div class="value">{scaledDrift} <span class="unit">μs</span></div>
    </div>
    <div class="metric">
      <label>EXEC JITTER</label>
      <div class="value">{jitterMs} <span class="unit">ms</span></div>
    </div>
  </div>

  <canvas 
    bind:this={canvas} 
    width="300" 
    height="80"
    class="sparkline"
  ></canvas>

  <div class="footer">
    <span>Sampling: {driftData.sampleRate}Hz</span>
    <span class="precision">Zig-Parser Optimized</span>
  </div>
</div>

<style>
  .drift-card {
    background: rgba(15, 15, 20, 0.85);
    border-left: 4px solid var(--accent);
    border-radius: 4px;
    padding: 1rem;
    color: #e0e0e0;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    width: 320px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .service-name {
    font-weight: 700;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .status-pill {
    background: #1aed9c22;
    color: #1aed9c;
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 10px;
    border: 1px solid #1aed9c44;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  label {
    display: block;
    font-size: 0.6rem;
    color: #888;
    margin-bottom: 0.25rem;
  }

  .value {
    font-size: 1.25rem;
    font-weight: 300;
  }

  .unit {
    font-size: 0.75rem;
    color: var(--accent);
  }

  .sparkline {
    width: 100%;
    height: 80px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
    display: block;
  }

  .footer {
    margin-top: 0.75rem;
    display: flex;
    justify-content: space-between;
    font-size: 0.6rem;
    color: #555;
  }

  .precision {
    color: #aaa;
    font-style: italic;
  }
</style>