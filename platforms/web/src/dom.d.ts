import type { Runtime, Session, ComponentSnapshot, CoreEvent, Size, MeasureBounds } from './index.js';
export interface ComponentContext {
  document: Document;
  measuring: boolean;
  change(values: Record<string, unknown>): void;
  action(): void;
}
export interface ComponentView {
  element: HTMLElement;
  childrenElement?: HTMLElement;
  update(snapshot: ComponentSnapshot): void;
  dispose?(): void;
}
export type ComponentFactory = (context: ComponentContext) => ComponentView;
export const defaultComponents: Readonly<Record<string, ComponentFactory>>;
export function createDOMRenderer(runtime: Runtime, container: HTMLElement, options?: {
  height?: number;
  components?: Record<string, ComponentFactory>;
  /** Custom measurements return A2UI units, not CSS pixels. */
  measure?: Record<string, (node: ComponentSnapshot, bounds: MeasureBounds) => Size>;
  onAction?: (action: NonNullable<CoreEvent['value']>) => void;
  onEvent?: (event: CoreEvent) => void;
  onError?: (error: unknown) => void;
}): { session: Session; render(text: string): void; dispose(): void };
