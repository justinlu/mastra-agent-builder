import type { ProjectConfig } from '../../types';
import { AgentCodeGenerator } from './AgentCodeGenerator';
import { ToolCodeGenerator } from './ToolCodeGenerator';
import { StepCodeGenerator } from './StepCodeGenerator';
import { MastraInstanceGenerator } from './MastraInstanceGenerator';
import { toCamelCase } from './codeGenUtils';
import { validateProjectCompatibility } from './compatibility';

export interface CodeFile {
  path: string;
  content: string;
}

// Verified together. Upgrade these deliberately and rerun check:generated.
export const MASTRA_VERSIONS = {
  '@mastra/core': '1.73.0',
  mastra: '1.32.0',
  '@mastra/memory': '1.34.0',
  '@mastra/libsql': '1.24.1',
  '@mastra/loggers': '1.3.4',
  '@mastra/observability': '1.18.3',
  zod: '4.1.9',
} as const;

/** The single project assembly path used by ZIP/code export and WebContainer preview. */
export function generateProjectFiles(project: ProjectConfig): CodeFile[] {
  const issues = validateProjectCompatibility(project);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length)
    throw new Error(errors.map((issue) => `${issue.nodeId || 'Project'}: ${issue.message}`).join('\n'));
  const files: CodeFile[] = [];
  const generators = {
    agent: new AgentCodeGenerator(),
    tool: new ToolCodeGenerator(),
    step: new StepCodeGenerator(),
  };
  for (const type of ['agent', 'tool', 'step'] as const) {
    const nodes = project.nodes.filter((node) => node.type === type);
    const exports: string[] = [];
    for (const node of nodes) {
      const config = node.data.config as any;
      files.push({
        path: `src/mastra/${type}s/${config.id}.ts`,
        content: generators[type].generate(config),
      });
      exports.push(
        `export { ${toCamelCase(config.id)}${type[0].toUpperCase() + type.slice(1)} } from './${config.id}';`,
      );
    }
    if (exports.length)
      files.push({
        path: `src/mastra/${type}s/index.ts`,
        content: exports.join('\n'),
      });
  }
  files.push({
    path: 'src/mastra/index.ts',
    content: new MastraInstanceGenerator().generate(project),
  });
  const dependencies: Record<string, string> = {
    '@mastra/core': MASTRA_VERSIONS['@mastra/core'],
    mastra: MASTRA_VERSIONS.mastra,
    zod: MASTRA_VERSIONS.zod,
  };
  if (
    project.nodes.some(
      (node) =>
        node.type === 'agent' &&
        (node.data.config as any).memory?.type &&
        (node.data.config as any).memory.type !== 'none',
    )
  )
    dependencies['@mastra/memory'] = MASTRA_VERSIONS['@mastra/memory'];
  if (project.settings.storage?.type === 'libsql') dependencies['@mastra/libsql'] = MASTRA_VERSIONS['@mastra/libsql'];
  if (project.settings.logger?.type === 'pino') dependencies['@mastra/loggers'] = MASTRA_VERSIONS['@mastra/loggers'];
  if (project.settings.telemetry?.enabled || project.nodes.some((node) => (node.data.config as any).enableTracing))
    dependencies['@mastra/observability'] = MASTRA_VERSIONS['@mastra/observability'];
  files.push({
    path: 'package.json',
    content: JSON.stringify(
      {
        name:
          (project.settings.projectName || project.name || 'mastra-project')
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-|-$/g, '') || 'mastra-project',
        version: '1.0.0',
        private: true,
        type: 'module',
        engines: { node: '>=22.13.0' },
        scripts: {
          dev: 'mastra dev',
          build: 'mastra build',
          start: 'mastra start',
          'type-check': 'tsc --noEmit',
        },
        dependencies,
        devDependencies: { typescript: '5.8.3', '@types/node': '22.10.5' },
      },
      null,
      2,
    ),
  });
  files.push({
    path: 'tsconfig.json',
    content: JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          esModuleInterop: true,
          types: ['node'],
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  });
  const providerEnv: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    groq: 'GROQ_API_KEY',
    cohere: 'COHERE_API_KEY',
  };
  const envKeys = new Set<string>();
  project.nodes
    .filter((node) => node.type === 'agent')
    .forEach((node) => envKeys.add(providerEnv[(node.data.config as any).model.provider]));
  Object.keys(project.settings.environmentVariables ?? {}).forEach((key) => {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) envKeys.add(key);
  });
  files.push({
    path: '.env.example',
    content: [...envKeys].map((key) => `${key}=`).join('\n') + '\nMASTRA_TELEMETRY_DISABLED=1\n',
  });
  files.push({
    path: '.gitignore',
    content: 'node_modules/\n.mastra/\n.env\n.env.*\n!.env.example\n*.db\n*.db-*\n',
  });
  files.push({
    path: 'README.md',
    content: `# ${project.name}\n\nGenerated with Mastra core ${MASTRA_VERSIONS['@mastra/core']} and CLI ${MASTRA_VERSIONS.mastra}.\n\nRequires Node.js 22.13 or newer. Run npm install, copy .env.example to .env and set your own provider keys, then npm run type-check and npm run dev. Studio opens at http://localhost:4111. For deployment: npm run build, then npm start. Keep .env and database files private. Mastra CLI analytics can be disabled with MASTRA_TELEMETRY_DISABLED=1 in the process environment (for example MASTRA_TELEMETRY_DISABLED=1 npm run dev on POSIX shells). The generated .env.example also includes this opt-out; our CI and browser preview set it explicitly before CLI startup.\n\nAgents and tools are registered in src/mastra/index.ts. Steps are exported as standalone primitives; this editor does not assemble them into executable workflows. Canvas connections never substitute for the agent's explicit Tools configuration.\n\nBuffer memory uses message history in the selected project storage. Supply stable memory.resource and memory.thread values when calling an agent directly. In-memory storage disappears on restart; local LibSQL persists to its configured file. Provider/model availability and credentials are checked by Mastra when called, not by this editor.\n\nCustom execute code runs with your Node process's permissions. The editor's basic checks are not a sandbox. Browser WebContainer preview is optional, needs a compatible browser/runtime, and has separate StackBlitz commercial licensing requirements. Native Node export is the verified execution path.\n${issues.length ? '\n## Migration notes\n\n' + issues.map((issue) => '- ' + issue.message).join('\n') + '\n' : ''}`,
  });
  return files;
}
