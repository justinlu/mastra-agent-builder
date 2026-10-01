import type { StepBuilderConfig } from '../../types';
import { escapeString, toCamelCase, validateExecuteCode, sanitizeCode } from './codeGenUtils';
import { schemaObject } from './schemaCode';

/**
 * Generates Mastra step code from visual configuration
 */
export class StepCodeGenerator {
  /**
   * Generate createStep() call from step configuration
   */
  generate(config: StepBuilderConfig): string {
    const lines: string[] = [];

    // Import statement
    lines.push(`import { createStep } from '@mastra/core/workflows';`);
    lines.push(`import { z } from 'zod';`);
    lines.push(``);

    for (const direction of ['input', 'output'] as const) {
      const fields = config[`${direction}Schema`] ?? [];
      lines.push(
        `const ${this.getSchemaVarName(config.id, direction)} = ${fields.length ? schemaObject(fields) : 'z.any()'};`,
      );
    }
    lines.push('');

    // Generate step
    lines.push(`export const ${this.getStepVarName(config.id)} = createStep({`);
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
        throw new Error(`Invalid execute code for step ${config.id}: ${validation.error}`);
      } else {
        // Sanitize and include the code
        const sanitized = sanitizeCode(config.executeCode);
        lines.push(`  execute: ${sanitized},`);
      }
    } else {
      // Default execute function
      lines.push(`  execute: async ({ inputData }) => {`);
      lines.push(`    // TODO: Implement step logic`);
      lines.push(`    throw new Error('Step not implemented');`);
      lines.push(`  },`);
    }

    lines.push(`});`);

    return lines.join('\n');
  }

  /**
   * Generate variable name for step
   */
  private getStepVarName(id: string): string {
    return toCamelCase(id) + 'Step';
  }

  /**
   * Generate variable name for schema
   */
  private getSchemaVarName(id: string, type: 'input' | 'output'): string {
    return toCamelCase(id) + type.charAt(0).toUpperCase() + type.slice(1) + 'Schema';
  }
}
