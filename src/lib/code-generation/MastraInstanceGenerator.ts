import type { ProjectConfig } from '../../types';
import { escapeString, toCamelCase } from './codeGenUtils';

/** Current Mastra bootstrap shared by export and optional browser preview. */
export class MastraInstanceGenerator {
  generate(project: ProjectConfig): string {
    const lines = [`import { Mastra } from '@mastra/core/mastra';`];
    const storage = project.settings.storage?.type ?? 'memory';
    lines.push(
      storage === 'libsql'
        ? `import { LibSQLStore } from '@mastra/libsql';`
        : `import { InMemoryStore } from '@mastra/core/storage';`,
    );
    const logger = project.settings.logger?.type ?? 'console';
    lines.push(
      logger === 'pino'
        ? `import { PinoLogger } from '@mastra/loggers';`
        : `import { ConsoleLogger } from '@mastra/core/logger';`,
    );
    const tracing =
      project.settings.telemetry?.enabled || project.nodes.some((n) => (n.data.config as any)?.enableTracing);
    if (tracing) lines.push(`import { Observability, MastraStorageExporter } from '@mastra/observability';`);
    for (const type of ['agent', 'tool'] as const) {
      const configs = project.nodes.filter((node) => node.type === type).map((node) => node.data.config as any);
      if (configs.length)
        lines.push(
          `import { ${configs.map((config) => toCamelCase(config.id) + (type === 'agent' ? 'Agent' : 'Tool')).join(', ')} } from './${type}s';`,
        );
    }
    lines.push('', 'export const mastra = new Mastra({');
    for (const type of ['agent', 'tool'] as const) {
      const configs = project.nodes.filter((node) => node.type === type).map((node) => node.data.config as any);
      if (configs.length) {
        lines.push(`  ${type}s: {`);
        configs.forEach((config) =>
          lines.push(
            `    '${escapeString(config.id)}': ${toCamelCase(config.id)}${type === 'agent' ? 'Agent' : 'Tool'},`,
          ),
        );
        lines.push('  },');
      }
    }
    if (storage === 'libsql') {
      const url = project.settings.storage?.config?.url ?? 'file:./mastra.db';
      lines.push(`  storage: new LibSQLStore({ id: 'mastra-storage', url: ${JSON.stringify(url)} }),`);
    } else {
      lines.push(`  storage: new InMemoryStore(),`);
    }
    lines.push(
      `  logger: new ${logger === 'pino' ? 'PinoLogger' : 'ConsoleLogger'}(${JSON.stringify({ name: project.name, ...project.settings.logger?.config })}),`,
    );
    if (tracing) {
      lines.push(
        '  // Trace locally to the selected storage; no hosted exporter is configured.',
        '  observability: new Observability({',
        '    configs: {',
        `      default: { serviceName: ${JSON.stringify(project.name)}, exporters: [new MastraStorageExporter()] },`,
        '    },',
        '  }),',
      );
    }
    lines.push('});');
    return lines.join('\n');
  }
}
