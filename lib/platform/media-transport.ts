export type MediaUploadProgress = { loaded: number; total: number; ratio: number };

export interface MediaTransport<TTarget, TResult = void> {
  readonly id: string;
  put(input: {
    file: File;
    target: TTarget;
    onProgress?: (progress: MediaUploadProgress) => void;
  }): Promise<TResult>;
}
