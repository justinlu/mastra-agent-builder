import type { FileSystemTree } from '@webcontainer/api';
import type { ProjectConfig, ApiKeysConfig } from '../../types';
import { validatePreviewCompatibility } from '../code-generation/compatibility';
import { generateProjectFiles } from '../code-generation/ProjectGenerator';

/** Uses the exact same source/dependencies as downloadable projects. */
export class FileSystemGenerator {
  generateWebContainerFiles(project: ProjectConfig, apiKeys: ApiKeysConfig): FileSystemTree {
    const errors = validatePreviewCompatibility(project).filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(errors.map((issue) => issue.message).join('\n'));
    const files: FileSystemTree = {};
    for (const file of generateProjectFiles(project)) {
      const parts = file.path.split('/');
      const name = parts.pop()!;
      let directory = files;
      for (const part of parts) {
        if (!directory[part]) directory[part] = { directory: {} };
        directory = (directory[part] as { directory: FileSystemTree }).directory;
      }
      directory[name] = { file: { contents: file.content } };
    }
    const keys: Record<string, string | undefined> = {
      OPENAI_API_KEY: apiKeys.openai,
      ANTHROPIC_API_KEY: apiKeys.anthropic,
      GOOGLE_GENERATIVE_AI_API_KEY: apiKeys.google,
    };
    // JSON quoting prevents newline / comment injection into dotenv values.
    files['.env'] = {
      file: {
        contents:
          Object.entries(keys)
            .filter(([, value]) => value)
            .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
            .join('\n') + '\nPORT=4111\nMASTRA_TELEMETRY_DISABLED=1\n',
      },
    };
    return files;
  }
}
