import type { ToolBuilderConfig } from '../../types';
import { escapeString, toCamelCase, validateExecuteCode, sanitizeCode } from './codeGenUtils';
import { schemaObject } from './schemaCode';

/**
 * Generates Mastra tool code from visual configuration
 */
export class ToolCodeGenerator {
  /**
   * Generate createTool() call from tool configuration
   */
  generate(config: ToolBuilderConfig): string {
    const lines: string[] = [];

    // Import statement
    lines.push(`import { createTool } from '@mastra/core/tools';`);
    lines.push(`import { z } from 'zod';`);
    lines.push(``);

    for (const direction of ['input', 'output'] as const) {
      const fields = config[`${direction}Schema`] ?? [];
      lines.push(
        `const ${this.getSchemaVarName(config.id, direction)} = ${fields.length ? schemaObject(fields) : direction === 'input' ? 'z.object({})' : 'z.any()'};`,
      );
    }
    lines.push('');

    // Generate tool
    lines.push(`export const ${this.getToolVarName(config.id)} = createTool({`);
    lines.push(`  id: '${escapeString(config.id)}',`);

    if (config.description) {
      lines.push(`  description: '${escapeString(config.description)}',`);
    }

    lines.push(`  inputSchema: ${this.getSchemaVarName(config.id, 'input')},`);
    lines.push(`  outputSchema: ${this.getSchemaVarName(config.id, 'output')},`);

    for (const kind of ['resume', 'suspend'] as const) {
      if (config[`${kind}Schema`]?.length) lines.push(`  ${kind}Schema: ${schemaObject(config[`${kind}Schema`]!)},`);
    }

    // Add execute function
    if (config.executeCode) {
      // Validate execute code for security
      const validation = validateExecuteCode(config.executeCode);
      if (!validation.isValid) {
        throw new Error(`Invalid execute code for tool ${config.id}: ${validation.error}`);
      } else {
        // Sanitize and include the code
        const sanitized = sanitizeCode(config.executeCode);
        lines.push(`  execute: ${sanitized},`);
      }
    } else {
      // Default execute function
      lines.push(`  execute: async (inputData) => {`);
      lines.push(`    // TODO: Implement tool logic`);
      lines.push(`    throw new Error('Tool not implemented');`);
      lines.push(`  },`);
    }

    // Add require approval flag
    if (config.requireApproval) {
      lines.push(`  requireApproval: true,`);
    }

    lines.push(`});`);

    return lines.join('\n');
  }

  /**
   * Generate variable name for tool
   */
  private getToolVarName(id: string): string {
    return toCamelCase(id) + 'Tool';
  }

  /**
   * Generate variable name for schema
   */
  private getSchemaVarName(id: string, type: 'input' | 'output'): string {
    return toCamelCase(id) + type.charAt(0).toUpperCase() + type.slice(1) + 'Schema';
  }
}
