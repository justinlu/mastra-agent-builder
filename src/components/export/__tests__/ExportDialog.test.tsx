import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { showToast } from '../../ui';
import { ExportDialog } from '../ExportDialog';
vi.mock('../../ui', () => ({ showToast: vi.fn() }));

describe('ExportDialog latest state', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });
  it('uses the newly selected format and selected files in the parent export action', async () => {
    let exportNow = () => {};
    const onReady = vi.fn((handler) => {
      exportNow = handler;
    });
    render(
      <ExportDialog
        files={[
          { path: 'a.ts', content: 'alpha' },
          { path: 'b.ts', content: 'beta' },
        ]}
        onExportReady={onReady}
      />,
    );
    fireEvent.click(screen.getByText('Clipboard'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    await act(async () => {
      exportNow();
    });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('beta');
    expect(writeText.mock.calls[0][0]).not.toContain('alpha');
    expect(onReady.mock.calls.length).toBeLessThan(15);
  });
  it('refreshes file content on same-size project changes', async () => {
    let exportNow = () => {};
    const onReady = (handler: () => void) => {
      exportNow = handler;
    };
    const view = render(<ExportDialog files={[{ path: 'a.ts', content: 'before' }]} onExportReady={onReady} />);
    fireEvent.click(screen.getByText('Clipboard'));
    view.rerender(<ExportDialog files={[{ path: 'a.ts', content: 'after' }]} onExportReady={onReady} />);
    await act(async () => {
      exportNow();
    });
    expect(writeText.mock.calls[0][0]).toContain('after');
    expect(writeText.mock.calls[0][0]).not.toContain('before');
  });
  it('stops on folder-creation failure instead of writing into a different directory', async () => {
    let exportNow = () => {};
    const getFileHandle = vi.fn();
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi
        .fn()
        .mockResolvedValue({
          getDirectoryHandle: vi.fn().mockRejectedValue(new Error('no write access')),
          getFileHandle,
        }),
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ExportDialog
        files={[{ path: 'src/mastra/index.ts', content: 'fixture' }]}
        onExportReady={(handler) => {
          exportNow = handler;
        }}
      />,
    );
    fireEvent.click(screen.getByText('Folder'));
    await act(async () => {
      exportNow();
    });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'Failed to save files. Please try again.'));
    expect(getFileHandle).not.toHaveBeenCalled();
    log.mockRestore();
    Reflect.deleteProperty(window, 'showDirectoryPicker');
  });
});
