export interface ComponentSnapshot {
  id: string;
  component: string;
  parentId?: string;
  children?: string[];
  styles?: Record<string, unknown>;
  [property: string]: unknown;
}
export interface MeasureBounds { width: number; height: number; widthMode: 0 | 1 | 2; heightMode: 0 | 1 | 2 }
export interface Size { width: number; height: number }
export type Measurement = (type: string, properties: ComponentSnapshot, bounds: MeasureBounds) => Size;
export interface CoreEvent {
  type: 'create' | 'delete' | 'add' | 'update' | 'remove' | 'action' | 'error';
  surfaceId?: string;
  catalogId?: string;
  items?: Array<{ id: string; parentId?: string; value?: Partial<ComponentSnapshot> }>;
  value?: { version: string; action: { name: string; surfaceId: string; sourceComponentId: string; context: Record<string, unknown>; timestamp: string } };
  code?: number;
  message?: string;
}
export interface SessionOptions {
  /** Surface width and height in A2UI units (2 units per CSS pixel). */
  width?: number;
  height?: number;
  onEvent?: (event: CoreEvent) => void;
  onError?: (error: unknown) => void;
}
export interface Session {
  /** Read-only to consumers; snapshots are replaced by core diffs. */
  readonly surfaces: ReadonlyMap<string, ReadonlyMap<string, ComponentSnapshot>>;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  begin(): void;
  push(decodedText: string): void;
  end(): void;
  render(document: string): void;
  resize(surfaceId: string, width: number, height: number): void;
  change(surfaceId: string, componentId: string, values: Record<string, unknown>): void;
  action(surfaceId: string, componentId: string, context?: Record<string, unknown>): void;
  invalidate(): void;
  dispose(): void;
}
export interface Runtime {
  readonly version: string;
  registerMeasurement(type: string, measurement: Measurement): void;
  setTheme(mode: 'light' | 'dark'): void;
  loadTheme(value: unknown): void;
  loadTokens(value: unknown): void;
  createSession(options?: SessionOptions): Session;
  dispose(): void;
}
export function createRuntime(options?: {
  wasmURL?: string | URL;
  wasmBinary?: Uint8Array;
  onError?: (error: unknown) => void;
}): Promise<Runtime>;
export function applyPatch<T extends Record<string, unknown>>(previous: T, patch: Partial<T>): T;
