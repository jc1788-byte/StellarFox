import React, { useEffect, useState, useCallback } from 'react';

export interface HeatmapPoint {
  x: number;
  y: number;
  intensity: number; // 0-1
}

export interface HeatmapVisualizationProps {
  width: number;
  height: number;
  points: HeatmapPoint[];
  colorScheme?: 'thermal' | 'viridis' | 'plasma';
  opacity?: number;
  maxRadius?: number;
  blurAmount?: number;
  containerClassName?: string;
  canvasClassName?: string;
}

/**
 * Heatmap visualization component
 * Renders an interactive heatmap overlay based on click/interaction data
 */
export const HeatmapVisualization: React.FC<HeatmapVisualizationProps> = ({
  width,
  height,
  points,
  colorScheme = 'thermal',
  opacity = 0.7,
  maxRadius = 50,
  blurAmount = 15,
  containerClassName = '',
  canvasClassName = '',
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Color mapping functions
  const getColor = (intensity: number, scheme: string): string => {
    const t = Math.max(0, Math.min(1, intensity));

    switch (scheme) {
      case 'thermal':
        if (t < 0.25) return `rgb(${0}, ${0}, ${255 * (t / 0.25)})`;
        if (t < 0.5) return `rgb(${0}, ${255 * ((t - 0.25) / 0.25)}, ${255})`;
        if (t < 0.75)
          return `rgb(${255 * ((t - 0.5) / 0.25)}, ${255}, ${255 * (1 - (t - 0.5) / 0.25)})`;
        return `rgb(${255}, ${255 * (1 - (t - 0.75) / 0.25)}, ${0})`;

      case 'viridis':
        if (t < 0.25) return `rgb(${68 * (t / 0.25)}, ${1 + 83 * (t / 0.25)}, ${84})`;
        if (t < 0.5)
          return `rgb(${68 + 102 * ((t - 0.25) / 0.25)}, ${84 + 94 * ((t - 0.25) / 0.25)}, ${54 + 103 * ((t - 0.25) / 0.25)})`;
        if (t < 0.75)
          return `rgb(${170 + 85 * ((t - 0.5) / 0.25)}, ${178 - 35 * ((t - 0.5) / 0.25)}, ${157 + 98 * ((t - 0.5) / 0.25)})`;
        return `rgb(${255}, ${143 + 112 * ((t - 0.75) / 0.25)}, ${255})`;

      case 'plasma':
      default:
        if (t < 0.25) return `rgb(${13 + 242 * (t / 0.25)}, ${0}, ${130 + 125 * (t / 0.25)})`;
        if (t < 0.5)
          return `rgb(${255}, ${0 + 204 * ((t - 0.25) / 0.25)}, ${5})`;
        if (t < 0.75)
          return `rgb(${255}, ${204 + 51 * ((t - 0.5) / 0.25)}, ${0})`;
        return `rgb(${255}, ${255}, ${0 + 102 * ((t - 0.75) / 0.25)})`;
    }
  };

  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Create gradient for each point
    for (const point of points) {
      const radius = maxRadius * (1 - Math.max(0, 1 - point.intensity));

      const gradient = ctx.createRadialGradient(
        point.x,
        point.y,
        0,
        point.x,
        point.y,
        radius,
      );

      const color = getColor(point.intensity, colorScheme);
      gradient.addColorStop(0, color.replace(')', `, ${opacity * point.intensity})`).replace('rgb', 'rgba'));
      gradient.addColorStop(1, color.replace(')', ', 0)').replace('rgb', 'rgba'));

      ctx.fillStyle = gradient;
      ctx.fillRect(
        point.x - radius,
        point.y - radius,
        radius * 2,
        radius * 2,
      );
    }

    // Apply blur if supported
    if (blurAmount > 0) {
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(canvas, 0, 0);
    }
  }, [points, width, height, colorScheme, opacity, maxRadius, blurAmount]);

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  return (
    <div className={containerClassName} style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={canvasClassName}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/**
 * Heatmap grid visualization - shows click density in grid cells
 */
export const HeatmapGrid: React.FC<{
  width: number;
  height: number;
  gridData: Record<string, number>;
  gridSize?: number;
  colorScheme?: string;
  maxValue?: number;
}> = ({
  width,
  height,
  gridData,
  gridSize = 50,
  colorScheme = 'thermal',
  maxValue,
}) => {
  const [normalisedData, setNormalisedData] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    const max =
      maxValue ||
      Math.max(...Object.values(gridData).map((v) => typeof v === 'number' ? v : 0), 1);

    const normalised: Record<string, number> = {};
    for (const [key, value] of Object.entries(gridData)) {
      normalised[key] = typeof value === 'number' ? value / max : 0;
    }
    setNormalisedData(normalised);
  }, [gridData, maxValue]);

  const getColor = (intensity: number): string => {
    const t = Math.max(0, Math.min(1, intensity));

    if (colorScheme === 'thermal') {
      if (t < 0.25) return `rgba(0, 0, 255, ${0.5 * (t / 0.25)})`;
      if (t < 0.5) return `rgba(0, 255, 255, ${0.5 + 0.2 * ((t - 0.25) / 0.25)})`;
      if (t < 0.75)
        return `rgba(255, 255, 0, ${0.7 - 0.2 * ((t - 0.5) / 0.25)})`;
      return `rgba(255, 0, 0, ${0.7})`;
    }

    return `rgba(255, ${255 * (1 - t)}, 0, ${0.3 + 0.5 * t})`;
  };

  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        width,
        height,
        gap: 0,
      }}
    >
      {Array.from({ length: rows * cols }).map((_, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const key = `${col},${row}`;
        const intensity = normalisedData[key] || 0;

        return (
          <div
            key={key}
            style={{
              backgroundColor: getColor(intensity),
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
            title={`Intensity: ${(intensity * 100).toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
};

/**
 * Analytics dashboard component for visualizing heatmaps
 */
export const HeatmapDashboard: React.FC<{
  pageUrl: string;
  date: Date;
  interactionType?: 'click' | 'scroll' | 'hover' | 'move';
}> = ({ pageUrl, date, interactionType = 'click' }) => {
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHeatmapData = async () => {
      try {
        const dateStr = date.toISOString().split('T')[0];
        const response = await fetch(
          `/api/analytics/heatmap/aggregate/${encodeURIComponent(pageUrl)}?date=${dateStr}&interactionType=${interactionType}`,
        );

        if (!response.ok) {
          throw new Error('Failed to fetch heatmap data');
        }

        const data = await response.json();
        setHeatmapData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchHeatmapData();
  }, [pageUrl, date, interactionType]);

  if (loading) {
    return <div className="p-4">Loading heatmap data...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">Error: {error}</div>;
  }

  if (!heatmapData) {
    return <div className="p-4">No heatmap data available</div>;
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">
        Heatmap - {pageUrl} ({interactionType})
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        {heatmapData.sample_count} interactions recorded
      </p>
      <HeatmapGrid
        width={800}
        height={600}
        gridData={heatmapData.heatmap_json}
        gridSize={heatmapData.grid_size}
        colorScheme="thermal"
      />
    </div>
  );
};

export default HeatmapVisualization;
