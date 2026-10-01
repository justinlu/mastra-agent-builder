import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Code, Copy, Download, Check, FileCode, Package, ChevronDown } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useBuilderState } from '../../hooks';
import { generateProjectFiles } from '../../lib/code-generation';
import { ExportDialog } from '../export';
import { FileExplorer } from './FileExplorer';

interface CodeFile {
  path: string;
  content: string;
}

// Helper function to determine language from file extension
function getLanguageFromFile(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'sql':
      return 'sql';
    case 'py':
      return 'python';
    case 'sh':
      return 'bash';
    default:
      return 'text';
  }
}

export function CodePreview() {
  const { project } = useBuilderState();
  const [selectedFile, setSelectedFile] = useState<string>('src/mastra/index.ts');
  const [copied, setCopied] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportHandler, setExportHandler] = useState<(() => void) | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const onExportReady = useCallback((handler: () => void, exporting: boolean, canExportFiles: boolean) => {
    setExportHandler(() => handler);
    setIsExporting(exporting);
    setCanExport(canExportFiles);
  }, []);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowExportDialog(false);
      }
    };

    if (showExportDialog) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }

    return undefined;
  }, [showExportDialog]);

  const generation = useMemo(() => {
    if (!project) return { files: [] as CodeFile[], error: '' };
    try {
      return { files: generateProjectFiles(project), error: '' };
    } catch (error) {
      return {
        files: [] as CodeFile[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [project]);
  const codeFiles = generation.files;

  const currentFile = codeFiles.find((f) => f.path === selectedFile);

  const handleCopy = async () => {
    if (currentFile) {
      await navigator.clipboard.writeText(currentFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadAll = () => {
    // For now, just download current file
    // TODO: Implement ZIP download in Phase 6
    if (currentFile) {
      const blob = new Blob([currentFile.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFile.path.split('/').pop() || 'file.ts';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>No project loaded</p>
      </div>
    );
  }

  if (generation.error) {
    return (
      <div className="p-6 overflow-auto" role="alert">
        <h2 className="font-semibold mb-3">Fix configuration before export</h2>
        <p className="text-sm mb-3">Your project is preserved. These settings cannot be faithfully generated:</p>
        <pre className="whitespace-pre-wrap text-sm">{generation.error}</pre>
      </div>
    );
  }

  if (codeFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Code className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Add nodes to the canvas to generate code</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Code className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Generated Code</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-all duration-200 shadow-sm hover:shadow-md text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-primary" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy
              </>
            )}
          </button>
          <button
            onClick={handleDownloadAll}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-all duration-200 shadow-sm hover:shadow-md text-foreground"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowExportDialog(!showExportDialog)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <Package className="h-4 w-4" />
              Export Project
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${showExportDialog ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Export Dropdown */}
            {showExportDialog && (
              <div className="absolute top-full right-0 mt-2 w-[45rem] max-w-[95vw] h-[700px] max-h-[90vh] bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col backdrop-blur-sm">
                <div className="p-4 flex-shrink-0 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Export Project</h2>
                      <p className="text-sm text-muted-foreground">Choose format and select files to export</p>
                    </div>
                    <button
                      onClick={() => {
                        if (exportHandler) {
                          exportHandler();
                        }
                      }}
                      disabled={isExporting || !canExport}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      <Package className="h-4 w-4" />
                      {isExporting ? 'Exporting...' : 'Export'}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 p-4">
                  <ExportDialog
                    files={codeFiles}
                    projectName={project?.settings?.projectName || 'mastra-project'}
                    onClose={() => setShowExportDialog(false)}
                    onExportReady={onExportReady}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content area with file explorer and code view */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Explorer Sidebar */}
        <FileExplorer files={codeFiles} selectedFile={selectedFile} onSelectFile={setSelectedFile} />

        {/* Code content area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* File header */}
          <div className="p-3 border-b border-border bg-secondary/20 flex-shrink-0">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{selectedFile}</span>
              {currentFile && (
                <span className="text-xs text-muted-foreground">{currentFile.content.split('\n').length} lines</span>
              )}
            </div>
          </div>

          {/* Code content */}
          <div className="flex-1 overflow-auto bg-secondary/30 min-w-0">
            {currentFile ? (
              <div className="w-full overflow-x-auto" style={{ maxWidth: '100%', width: '100%' }}>
                <SyntaxHighlighter
                  language={getLanguageFromFile(currentFile.path)}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    padding: '1rem',
                    fontSize: '0.875rem',
                    lineHeight: '1.5',
                    background: 'transparent',
                    minWidth: '100%',
                    width: 'max-content',
                    maxWidth: 'none',
                    overflow: 'auto',
                  }}
                  showLineNumbers={true}
                  wrapLines={false}
                  wrapLongLines={false}
                  PreTag={({ children, ...props }) => (
                    <pre {...props} style={{ margin: 0, overflow: 'auto', maxWidth: '100%' }}>
                      {children}
                    </pre>
                  )}
                >
                  {currentFile.content}
                </SyntaxHighlighter>
              </div>
            ) : (
              <div className="text-center text-muted-foreground p-8">File not found</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border bg-secondary/50 text-xs text-muted-foreground flex-shrink-0">
        {codeFiles.length} file{codeFiles.length !== 1 ? 's' : ''} generated •{' '}
        {currentFile && `${currentFile.content.split('\n').length} lines`}
      </div>
    </div>
  );
}
