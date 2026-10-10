export const PHOTO_MAX_DIMENSION = 1280;
export const PHOTO_JPEG_QUALITY = 0.8;
export const PHOTO_MIN_BYTES = 1024;
export const PHOTO_MAX_BYTES = 3_500_000;

export type PhotoSlot = "top" | "tray";

export interface ImageSource {
  width: number;
  height: number;
  source: CanvasImageSource;
  release: () => void;
}

export interface ImageCodec {
  decode: (file: Blob) => Promise<ImageSource>;
  encode: (
    source: CanvasImageSource,
    width: number,
    height: number,
    contentType: "image/jpeg",
    quality: number,
  ) => Promise<Blob>;
}

export interface Dimensions {
  width: number;
  height: number;
}

export function fitWithinDimensions(
  width: number,
  height: number,
  maxDimension = PHOTO_MAX_DIMENSION,
): Dimensions {
  if (width <= 0 || height <= 0 || maxDimension <= 0) {
    throw new Error("Photo dimensions must be positive.");
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeBrowserImage(file: Blob): Promise<ImageSource> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The selected photo could not be read."));
      image.src = objectUrl;
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    source: image,
    release: () => URL.revokeObjectURL(objectUrl),
  };
}

async function encodeBrowserImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  contentType: "image/jpeg",
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Photo processing is unavailable in this browser.");
  }
  context.drawImage(source, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("The selected photo could not be compressed."));
        }
      },
      contentType,
      quality,
    );
  });
}

const browserCodec: ImageCodec = {
  decode: decodeBrowserImage,
  encode: encodeBrowserImage,
};

export async function resizePhoto(file: Blob, codec: ImageCodec = browserCodec): Promise<Blob> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    throw new Error("Choose a JPEG or PNG photo.");
  }
  const decoded = await codec.decode(file);
  try {
    const dimensions = fitWithinDimensions(decoded.width, decoded.height);
    const photo = await codec.encode(
      decoded.source,
      dimensions.width,
      dimensions.height,
      "image/jpeg",
      PHOTO_JPEG_QUALITY,
    );
    if (photo.size < PHOTO_MIN_BYTES) {
      throw new Error("This photo is too small. Take another photo.");
    }
    if (photo.size > PHOTO_MAX_BYTES) {
      throw new Error("This photo is too large. Take another photo closer to the waste.");
    }
    return photo;
  } finally {
    decoded.release();
  }
}

export type SlotUploadStatus = "idle" | "uploading" | "uploaded" | "error";

export interface SlotUploadState {
  status: SlotUploadStatus;
  progress: number;
  key?: string;
}

export interface UploadState {
  top: SlotUploadState;
  tray: SlotUploadState;
  error?: string;
}

export type UploadAction =
  | { type: "start" }
  | { type: "progress"; slot: PhotoSlot; progress: number }
  | { type: "success"; slot: PhotoSlot; key: string }
  | { type: "failure"; slot: PhotoSlot; message: string }
  | { type: "reset" };

export function initialUploadState(): UploadState {
  return {
    top: { status: "idle", progress: 0 },
    tray: { status: "idle", progress: 0 },
  };
}

export function reduceUploadState(state: UploadState, action: UploadAction): UploadState {
  if (action.type === "reset") {
    return initialUploadState();
  }
  if (action.type === "start") {
    return {
      top: { status: "uploading", progress: 0 },
      tray: { status: "uploading", progress: 0 },
    };
  }
  if (action.type === "progress") {
    return {
      ...state,
      [action.slot]: {
        ...state[action.slot],
        status: "uploading",
        progress: Math.max(0, Math.min(100, Math.round(action.progress))),
      },
    };
  }
  if (action.type === "success") {
    return {
      ...state,
      [action.slot]: { status: "uploaded", progress: 100, key: action.key },
    };
  }
  return {
    ...state,
    [action.slot]: { ...state[action.slot], status: "error" },
    error: action.message,
  };
}

export function uploadIsComplete(state: UploadState): boolean {
  return state.top.status === "uploaded" && state.tray.status === "uploaded";
}

export function combinedProgress(state: UploadState): number {
  return Math.round((state.top.progress + state.tray.progress) / 2);
}
