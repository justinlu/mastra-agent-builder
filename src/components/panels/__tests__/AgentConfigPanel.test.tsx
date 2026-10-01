import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentConfigPanel } from '../AgentConfigPanel';
import type { ProjectConfig } from '../../../types';
const state = vi.hoisted(() => ({
  project: null as ProjectConfig | null,
  updateNode: vi.fn(),
}));
vi.mock('../../../hooks', () => ({ useBuilderState: () => state }));
vi.mock('../agent/InstructionTemplates', () => ({
  InstructionTemplates: () => null,
}));

describe('model ID compatibility', () => {
  it('preserves existing IDs and provider while permitting a current custom ID', () => {
    state.project = {
      id: 'p',
      name: 'P',
      edges: [],
      settings: {},
      nodes: [
        {
          id: 'a',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            config: {
              id: 'a',
              name: 'Agent',
              instructions: 'Test',
              model: { provider: 'openai', name: 'gpt-4o-mini' },
              tools: [],
              workflows: [],
              agents: [],
            },
          },
        },
      ],
    };
    render(<AgentConfigPanel nodeId="a" />);
    expect(screen.getByLabelText('Model Name')).toHaveValue('gpt-4o-mini');
    expect(screen.getByLabelText('Provider')).toHaveValue('openai');
    fireEvent.change(screen.getByLabelText('Model Name'), {
      target: { value: 'account-specific-model' },
    });
    expect(screen.getByLabelText('Model Name')).toHaveValue('account-specific-model');
    expect(state.updateNode.mock.lastCall?.[1].data.config.model).toMatchObject({
      provider: 'openai',
      name: 'account-specific-model',
    });
    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: 'anthropic' },
    });
    expect(screen.getByLabelText('Model Name')).toHaveValue('account-specific-model');
  });
});
