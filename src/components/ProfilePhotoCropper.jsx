import { useEffect, useMemo, useRef, useState } from "react";

function displayMetrics(meta, zoom) {
  if (!meta?.width || !meta?.height) return { width: 1, height: 1 };
  const baseScale = Math.max(1 / meta.width, 1 / meta.height);
  return {
    width: meta.width * baseScale * zoom,
    height: meta.height * baseScale * zoom,
  };
}

function clampOffset(offset, meta, zoom) {
  const metrics = displayMetrics(meta, zoom);
  const maxX = Math.max(0, (metrics.width - 1) / 2);
  const maxY = Math.max(0, (metrics.height - 1) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, Number(offset?.x || 0))),
    y: Math.max(-maxY, Math.min(maxY, Number(offset?.y || 0))),
  };
}

function loadFallbackImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, close: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Non riesco a leggere la foto selezionata."));
    };
    image.src = url;
  });
}

async function createCroppedBlob(file, { zoom, offset }, outputSize = 720, quality = 0.84) {
  let sourceData = null;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      sourceData = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {
      sourceData = null;
    }
  }
  if (!sourceData) sourceData = await loadFallbackImage(file);

  const { source, width, height, close } = sourceData;
  const safeZoom = Math.max(1, Number(zoom || 1));
  const baseScale = Math.max(1 / width, 1 / height);
  const scale = baseScale * safeZoom;
  const cropSize = Math.min(width, height, 1 / scale);
  const safeOffset = clampOffset(offset, { width, height }, safeZoom);

  let sx = width / 2 - (0.5 + safeOffset.x) / scale;
  let sy = height / 2 - (0.5 + safeOffset.y) / scale;
  sx = Math.max(0, Math.min(width - cropSize, sx));
  sy = Math.max(0, Math.min(height - cropSize, sy));

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    close?.();
    throw new Error("Il browser non riesce a ritagliare la foto.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#111111";
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, outputSize, outputSize);
  close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error("Non riesco a creare la foto WebP.");
  return { blob, width: outputSize, height: outputSize, originalBytes: file.size, compressedBytes: blob.size };
}

export default function ProfilePhotoCropper({ file, saving = false, onCancel, onConfirm }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [meta, setMeta] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMeta(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError("");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      URL.revokeObjectURL(url);
      document.body.style.overflow = previousOverflow;
    };
  }, [file]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !saving && !processing) onCancel?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, saving, processing]);

  const metrics = useMemo(() => displayMetrics(meta, zoom), [meta, zoom]);
  const busy = saving || processing;

  function changeZoom(value) {
    const nextZoom = Math.max(1, Math.min(4, Number(value || 1)));
    setZoom(nextZoom);
    setOffset((current) => clampOffset(current, meta, nextZoom));
  }

  function pointerDown(event) {
    if (!meta || busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function pointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || busy) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const dx = (event.clientX - drag.x) / rect.width;
    const dy = (event.clientY - drag.y) / rect.width;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    setOffset((current) => clampOffset({ x: current.x + dx, y: current.y + dy }, meta, zoom));
  }

  function pointerUp(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  async function confirmCrop() {
    if (!meta || busy) return;
    setProcessing(true);
    setError("");
    try {
      const result = await createCroppedBlob(file, { zoom, offset });
      await onConfirm?.(result);
    } catch (cropError) {
      setError(cropError?.message || "Non riesco a ritagliare la foto.");
    } finally {
      setProcessing(false);
    }
  }

  if (!file) return null;

  return (
    <div className="profile-crop-modal" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title">
      <button type="button" className="profile-crop-backdrop" aria-label="Chiudi" onClick={() => !busy && onCancel?.()} />
      <div className="profile-crop-card">
        <div className="profile-crop-head">
          <div>
            <span className="eyebrow">Foto profilo</span>
            <h2 id="profile-crop-title">Scegli l’inquadratura</h2>
            <p>Trascina la foto e usa lo zoom. Quello che vedi nel riquadro sarà il tuo avatar.</p>
          </div>
          <button type="button" className="profile-crop-close" onClick={() => !busy && onCancel?.()} disabled={busy} aria-label="Chiudi">×</button>
        </div>

        <div
          ref={viewportRef}
          className="profile-crop-viewport"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Anteprima foto profilo"
              draggable="false"
              onLoad={(event) => {
                const nextMeta = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
                setMeta(nextMeta);
                setOffset({ x: 0, y: 0 });
              }}
              style={meta ? {
                width: `${metrics.width * 100}%`,
                height: `${metrics.height * 100}%`,
                left: `${50 + offset.x * 100}%`,
                top: `${50 + offset.y * 100}%`,
              } : undefined}
            />
          )}
          <div className="profile-crop-shade" aria-hidden="true" />
          <div className="profile-crop-grid" aria-hidden="true"><i /><i /><b /><b /></div>
        </div>

        <div className="profile-crop-controls">
          <label>
            <span>Zoom</span>
            <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(event) => changeZoom(event.target.value)} disabled={!meta || busy} />
          </label>
          <button type="button" className="ghost-btn slim" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} disabled={busy}>Reimposta</button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="profile-crop-actions">
          <button type="button" className="ghost-btn" onClick={() => onCancel?.()} disabled={busy}>Annulla</button>
          <button type="button" className="primary-btn" onClick={confirmCrop} disabled={!meta || busy}>{busy ? "Salvataggio…" : "Usa questa foto"}</button>
        </div>
      </div>
    </div>
  );
}
