import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProjectConfig } from '../../../types';
import { CodePreview } from '../CodePreview';

const state = vi.hoisted(() => ({ project: null as ProjectConfig | null }));
vi.mock('../../../hooks', () => ({ useBuilderState: () => state }));
vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: string }) => <pre>{children}</pre>,
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  vscDarkPlus: {},
}));

describe('CodePreview generation errors and recovery', () => {
  it('renders an actionable error without crashing or exporting; recovers after correction', () => {
    state.project = {
      id: 'p',
      name: 'Test',
      nodes: [
        {
          id: 'parallel-1',
          type: 'parallel',
          position: { x: 0, y: 0 },
          data: { type: 'logic', config: { logicType: 'loop' } },
        },
      ],
      edges: [],
      settings: {},
    };
    const view = render(<CodePreview />);
    expect(screen.getByRole('alert')).toHaveTextContent('workflow/control-flow');
    expect(screen.queryByRole('button', { name: 'Export Project' })).not.toBeInTheDocument();
    expect(state.project.nodes).toHaveLength(1);
    state.project = { ...state.project, nodes: [] };
    view.rerender(<CodePreview />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export Project' }));
    expect(screen.getByText('Choose format and select files to export')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Choose format and select files to export')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export Project' }));
    expect(screen.getByText('Choose format and select files to export')).toBeInTheDocument();
  });
});
