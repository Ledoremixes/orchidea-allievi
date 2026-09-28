const FFMPEG_SCRIPT = "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js";
const FFMPEG_CORE = "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js";

let ffmpegInstance = null;
let ffmpegLoadingPromise = null;

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-orchidea-video-optimizer="${src}"]`);
    if (existing) {
      if (window.FFmpeg?.createFFmpeg) resolve();
      else existing.addEventListener("load", resolve, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.orchideaVideoOptimizer = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Impossibile caricare il motore di compressione video."));
    document.head.appendChild(script);
  });
}

async function getFfmpeg(onProgress) {
  if (ffmpegInstance?.isLoaded?.()) {
    if (onProgress) ffmpegInstance.setProgress(({ ratio }) => onProgress(Math.max(0, Math.min(1, ratio || 0))));
    return ffmpegInstance;
  }

  if (!ffmpegLoadingPromise) {
    ffmpegLoadingPromise = (async () => {
      await loadExternalScript(FFMPEG_SCRIPT);
      if (!window.FFmpeg?.createFFmpeg) throw new Error("Motore di compressione video non disponibile.");
      const instance = window.FFmpeg.createFFmpeg({ log: false, corePath: FFMPEG_CORE });
      await instance.load();
      ffmpegInstance = instance;
      return instance;
    })().finally(() => {
      ffmpegLoadingPromise = null;
    });
  }

  const instance = await ffmpegLoadingPromise;
  if (onProgress) instance.setProgress(({ ratio }) => onProgress(Math.max(0, Math.min(1, ratio || 0))));
  return instance;
}

function extensionOf(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match?.[1] || "mp4";
}

function safeBaseName(name = "video") {
  return String(name)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "video";
}

export function formatFileSize(bytes = 0) {
  const value = Number(bytes || 0);
  if (value < 1024 * 1024) return `${Math.max(0, value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export async function optimizeVideoFile(file, { enabled = true, onProgress } = {}) {
  if (!file || !enabled) return { file, optimized: false, reason: "disabled" };

  // I file già piccoli non vengono ricodificati: il guadagno sarebbe minimo e si evitano attese inutili.
  const MIN_SIZE = 8 * 1024 * 1024;
  if (file.size <= MIN_SIZE) return { file, optimized: false, reason: "already-small" };

  // ffmpeg.wasm lavora in memoria. Sopra questa soglia rischieremmo di bloccare soprattutto tablet/telefoni.
  const MAX_BROWSER_TRANSCODE = 280 * 1024 * 1024;
  if (file.size > MAX_BROWSER_TRANSCODE) {
    return { file, optimized: false, reason: "too-large-for-browser" };
  }

  const ffmpeg = await getFfmpeg(onProgress);
  const inputExt = extensionOf(file.name);
  const stamp = Date.now();
  const inputName = `orchidea-input-${stamp}.${inputExt}`;
  const outputName = `orchidea-output-${stamp}.mp4`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    ffmpeg.FS("writeFile", inputName, bytes);
    await ffmpeg.run(
      "-i", inputName,
      "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      outputName,
    );

    const result = ffmpeg.FS("readFile", outputName);
    const blob = new Blob([result.buffer], { type: "video/mp4" });

    // Se per uno strano caso la ricodifica pesa di più, conserviamo l'originale.
    if (!blob.size || blob.size >= file.size * 0.98) {
      return { file, optimized: false, reason: "not-smaller" };
    }

    const optimizedFile = new File(
      [blob],
      `${safeBaseName(file.name)}-ottimizzato.mp4`,
      { type: "video/mp4", lastModified: Date.now() },
    );

    return {
      file: optimizedFile,
      optimized: true,
      originalSize: file.size,
      optimizedSize: optimizedFile.size,
      savingRatio: 1 - optimizedFile.size / file.size,
    };
  } finally {
    try { ffmpeg.FS("unlink", inputName); } catch {}
    try { ffmpeg.FS("unlink", outputName); } catch {}
    if (onProgress) onProgress(1);
  }
}

function waitForMediaEvent(target, eventName, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timeout durante la lettura del video."));
    }, timeout);
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Non riesco a leggere il video selezionato.")); };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

export async function createVideoThumbnailDataUrl(file) {
  if (!file) return null;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;

  try {
    video.src = objectUrl;
    await waitForMediaEvent(video, "loadedmetadata");
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.min(Math.max(duration * 0.08, 0.15), Math.max(duration - 0.1, 0.15));
    await waitForMediaEvent(video, "seeked");

    const width = Math.max(1, video.videoWidth || 640);
    const height = Math.max(1, video.videoHeight || 360);
    const maxWidth = 640;
    const ratio = Math.min(1, maxWidth / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(width * ratio));
    canvas.height = Math.max(2, Math.round(height * ratio));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.68);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
