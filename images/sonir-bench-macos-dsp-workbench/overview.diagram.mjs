// 全体の構成図。組むのは make writing-diagrams（overview.svg / overview.png はその生成物）
export const size = { width: 1200, height: 660 };

export default function (d) {
  d.box('app', { x: 40, y: 40, w: 300, h: 84, title: 'Any app', sub: 'Spotify / Apple Music / Qobuz / browser' });
  d.box('device', { x: 440, y: 40, w: 360, h: 84, title: 'Sonir Bench virtual device', sub: 'AudioServerPlugIn in coreaudiod · unity volume', style: 'accent' });

  d.box('daemon', { x: 40, y: 220, w: 1120, h: 250, title: 'daemon (Rust, headless)', style: 'container' });
  d.box('entry', { x: 60, y: 276, w: 170, h: 110, title: 'Entry monitor', sub: ['bit depth / on-grid', 'per 1 s window'], titleSize: 16, style: 'soft' });
  d.box('up', { x: 260, y: 276, w: 170, h: 110, title: 'Upsample 16×', sub: ['to 705.6k / 768k', 'f32 → f64'], titleSize: 16, style: 'soft' });
  d.box('graph', { x: 460, y: 276, w: 220, h: 110, title: 'Your graph', sub: ['A / B, gapless switch', 'validated before it plays'], titleSize: 16, style: 'strong' });
  d.box('exit', { x: 710, y: 276, w: 190, h: 110, title: 'Exit rate', sub: ['down or up to', 'what the DAC takes'], titleSize: 16, style: 'soft' });
  d.box('out', { x: 930, y: 276, w: 210, h: 110, title: 'Output stage', sub: ['true-peak metering', 'changes nothing by default'], titleSize: 16, style: 'soft' });

  d.box('ui', { x: 40, y: 556, w: 300, h: 84, title: 'UI (Tauri + React)', sub: 'separate process' });
  d.box('dac', { x: 930, y: 556, w: 210, h: 84, title: 'DAC', sub: 'PCM, or DSD over DoP' });

  // 音の経路
  d.arrow({ from: { box: 'app', side: 'right' }, to: { box: 'device', side: 'left' } });
  d.arrow({ from: { box: 'device', side: 'bottom' }, to: { box: 'daemon', side: 'top', at: 620 } });
  d.label('opened as a normal input device', { x: 634, y: 180 });
  d.arrow({ from: { box: 'entry', side: 'right' }, to: { box: 'up', side: 'left' } });
  d.arrow({ from: { box: 'up', side: 'right' }, to: { box: 'graph', side: 'left' } });
  d.arrow({ from: { box: 'graph', side: 'right' }, to: { box: 'exit', side: 'left' } });
  d.arrow({ from: { box: 'exit', side: 'right' }, to: { box: 'out', side: 'left' } });
  d.arrow({ from: { box: 'daemon', side: 'bottom', at: 1035 }, to: { box: 'dac', side: 'top' } });
  d.label('Resampling filters are user-designed and run as partitioned FFT convolution.', { x: 60, y: 440 });

  // 出口クロックの帰り道（サンプルは通らない）
  d.arrow({
    from: { box: 'daemon', side: 'top', at: 1100 },
    to: { box: 'device', side: 'right' },
    via: [[1100, 82]],
    dashed: true,
    color: 'accent',
  });
  d.label('exit clock: frames the DAC took + host time', { x: 1086, y: 150, anchor: 'end', color: 'accent' });
  d.label('(shared memory, no samples)', { x: 1086, y: 170, anchor: 'end', color: 'accent' });

  // UI との口
  d.arrow({ from: { box: 'ui', side: 'top', at: 190 }, to: { box: 'daemon', side: 'bottom', at: 190 }, both: true });
  d.label('WebSocket: JSON-RPC + telemetry', { x: 206, y: 506 });
  d.label('numbers only, never waveforms', { x: 206, y: 526 });
}
