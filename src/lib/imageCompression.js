function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossibile leggere l’immagine selezionata."));
    };
    image.src = url;
  });
}

export async function compressImageToWebP(file, options = {}) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Seleziona un file immagine valido.");
  }

  const maxWidth = Number(options.maxWidth || 960);
  const maxHeight = Number(options.maxHeight || 1200);
  const quality = Number(options.quality ?? 0.82);

  let source;
  let sourceWidth;
  let sourceHeight;
  let closeSource = null;

  if (typeof createImageBitmap === "function") {
    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
      sourceWidth = source.width;
      sourceHeight = source.height;
      closeSource = () => source.close?.();
    } catch {
      source = null;
    }
  }

  if (!source) {
    source = await loadImageElement(file);
    sourceWidth = source.naturalWidth || source.width;
    sourceHeight = source.naturalHeight || source.height;
  }

  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    closeSource?.();
    throw new Error("Il browser non riesce a elaborare l’immagine.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#111111";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  closeSource?.();

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });

  if (!blob) {
    throw new Error("Conversione WebP non riuscita.");
  }

  return {
    blob,
    width,
    height,
    originalBytes: file.size,
    compressedBytes: blob.size,
  };
}
