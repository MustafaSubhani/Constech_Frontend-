import { useEffect, useRef, useState } from "react";

type Props = {
  imageUrl: string;
  sheetWidth: number;
  sheetHeight: number;
  box: [number, number, number, number];
  maxHeight?: number;
  onClick?: () => void;
};

/** The region of the sheet a value was read from, cut out of the sheet raster and centred on the read text. */
export function EvidenceCrop({ imageUrl, sheetWidth, sheetHeight, box, maxHeight = 150, onClick }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(300);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  const sx = natural ? natural.w / sheetWidth : 1;
  const sy = natural ? natural.h / sheetHeight : 1;
  const [bx0, by0, bx1, by1] = [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy];
  const imgW = sheetWidth * sx;
  const imgH = sheetHeight * sy;
  const bw = Math.max(bx1 - bx0, 4);
  const bh = Math.max(by1 - by0, 4);
  const mx = Math.max(40, bw * 0.35);
  const my = Math.max(26, bh * 1.4);
  let cx0 = Math.max(0, bx0 - mx);
  const cy0 = Math.max(0, by0 - my);
  const cx1 = Math.min(imgW, bx1 + mx);
  const cy1 = Math.min(imgH, by1 + my);
  const readable = 0.85;
  let scale = Math.min(width / (cx1 - cx0), 3);
  if (scale < readable) {
    // Long rows (a schedule line) are read from the start: tag and sizes come first.
    scale = readable;
    cx0 = Math.max(0, bx0 - 20);
  }
  let height = (cy1 - cy0) * scale;
  if (height > maxHeight) {
    scale = maxHeight / (cy1 - cy0);
    height = maxHeight;
  }
  const offsetX = Math.max(0, (width - (cx1 - cx0) * scale) / 2);

  return (
    <button type="button" ref={ref} className="evi-crop" style={{ height }} onClick={onClick} title="Show on the sheet">
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        style={{ width: imgW * scale, height: imgH * scale, left: offsetX - cx0 * scale, top: -cy0 * scale }}
      />
    </button>
  );
}
