import type { CanvasNode, CanvasEdge } from '../../types';

/** Retains the public API, but never emits the upstream's unfinished workflow placeholders. */
export class WorkflowCodeGenerator {
  generate(_nodes: CanvasNode[], _edges: CanvasEdge[], _workflowId: string, _workflowName: string): string {
    throw new Error(
      'Workflow assembly is not implemented by this editor. Export standalone steps and compose a workflow manually in Mastra.',
    );
  }
}
