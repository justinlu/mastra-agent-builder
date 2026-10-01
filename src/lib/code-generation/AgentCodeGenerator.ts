import type { AgentBuilderConfig } from '../../types';
import { escapeString, escapeBackticks, toCamelCase } from './codeGenUtils';

/** Emits the current Mastra Agent API. Project validation rejects unmapped settings. */
export class AgentCodeGenerator {
  generate(config: AgentBuilderConfig): string {
    const lines = [`import { Agent } from '@mastra/core/agent';`];
    if (config.memory && config.memory.type !== 'none') {
      lines.push(`import { Memory } from '@mastra/memory';`);
    }
    if (config.tools?.length) {
      lines.push(`import { ${config.tools.map((id) => toCamelCase(id) + 'Tool').join(', ')} } from '../tools';`);
    }
    if (config.workflows?.length) {
      lines.push(
        `import { ${config.workflows.map((id) => toCamelCase(id) + 'Workflow').join(', ')} } from '../workflows';`,
      );
    }
    lines.push('', `export const ${toCamelCase(config.id)}Agent = new Agent({`);
    lines.push(`  id: '${escapeString(config.id)}',`, `  name: '${escapeString(config.name)}',`);
    lines.push(`  instructions: \`${escapeBackticks(config.instructions)}\`,`);
    if (config.description) lines.push(`  description: '${escapeString(config.description)}',`);
    // Mastra's model router supports provider/model strings; no provider SDK imports are needed.
    lines.push(`  model: '${escapeString(config.model.provider.toLowerCase() + '/' + config.model.name)}',`);
    for (const kind of ['tools', 'workflows'] as const) {
      if (config[kind]?.length) {
        const suffix = kind === 'tools' ? 'Tool' : 'Workflow';
        lines.push(`  ${kind}: {`);
        config[kind].forEach((id) => lines.push(`    '${escapeString(id)}': ${toCamelCase(id)}${suffix},`));
        lines.push('  },');
      }
    }
    if (config.memory && config.memory.type !== 'none') {
      if (config.memory.type !== 'buffer')
        throw new Error(`Memory type "${config.memory.type}" has no automatic current-Mastra mapping`);
      lines.push(
        '  // Legacy buffer memory maps to Mastra message history.',
        '  memory: new Memory({',
        '    options: {',
      );
      lines.push(`      lastMessages: ${config.memory.retrieval?.lastMessages ?? config.memory.maxMessages ?? 10},`);
      lines.push('      semanticRecall: false,', '      generateTitle: false,', '    },', '  }),');
    }
    if (config.maxRetries !== undefined) lines.push(`  maxRetries: ${config.maxRetries},`);
    const { temperature, topP, maxTokens, stopSequences, frequencyPenalty, presencePenalty } = config.model;
    const settings = {
      temperature,
      topP,
      maxOutputTokens: maxTokens,
      stopSequences,
      frequencyPenalty,
      presencePenalty,
    };
    const modelSettings = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
    const maxSteps = config.defaultGenerateOptions?.maxSteps ?? config.defaultStreamOptions?.maxSteps;
    if (Object.keys(modelSettings).length || maxSteps !== undefined) {
      lines.push('  defaultOptions: {');
      if (Object.keys(modelSettings).length) lines.push(`    modelSettings: ${JSON.stringify(modelSettings)},`);
      if (maxSteps !== undefined) lines.push(`    maxSteps: ${maxSteps},`);
      lines.push('  },');
    }
    lines.push('});');
    return lines.join('\n');
  }
}
