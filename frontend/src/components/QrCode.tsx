import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export function QrCode({ value, size = 260 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#0E1116', light: '#FFFFFF' },
    }).catch(() => {});
  }, [value, size]);

  return <canvas ref={canvasRef} style={{ borderRadius: 12 }} />;
}
