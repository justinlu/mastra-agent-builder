import { describe, it, expect } from 'vitest';
import { generateProjectFiles, MASTRA_VERSIONS } from '../ProjectGenerator';
import { validateProjectCompatibility, validatePreviewCompatibility } from '../compatibility';
import { schemaObject } from '../schemaCode';
import { ToolCodeGenerator } from '../ToolCodeGenerator';
import { sanitizeCode } from '../codeGenUtils';
import { FileSystemGenerator } from '../../web-container/FileSystemGenerator';
import { WorkflowCodeGenerator } from '../WorkflowCodeGenerator';
import { createMockAgentNode, createMockToolNode } from '../../../test/testUtils';
import type { ProjectConfig, AgentBuilderConfig } from '../../../types';
import type { FileSystemTree } from '@webcontainer/api';

const project = (): ProjectConfig => ({
  id: 'test',
  name: 'Test',
  nodes: [
    createMockAgentNode({
      data: {
        type: 'agent',
        config: {
          id: 'test-agent',
          name: 'Test',
          instructions: 'Test',
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          tools: [],
          workflows: [],
          agents: [],
        },
      },
    }),
  ],
  edges: [],
  settings: { storage: { type: 'memory' } },
});
const agent = (p: ProjectConfig) => p.nodes[0].data.config as AgentBuilderConfig;
function flatten(tree: FileSystemTree, base = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([name, value]) =>
      'directory' in value
        ? Object.entries(flatten(value.directory, base + name + '/'))
        : 'file' in value && 'contents' in value.file
          ? [
              [
                base + name,
                typeof value.file.contents === 'string'
                  ? value.file.contents
                  : new TextDecoder().decode(value.file.contents),
              ],
            ]
          : [],
    ),
  );
}

describe('current Mastra project generation', () => {
  it('pins runnable CLI scripts, modern imports, agent IDs, barrels and tsconfig', () => {
    const files = Object.fromEntries(generateProjectFiles(project()).map((file) => [file.path, file.content]));
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['@mastra/core']).toBe(MASTRA_VERSIONS['@mastra/core']);
    expect(pkg.dependencies.mastra).toBe('1.32.0');
    expect(pkg.scripts.dev).toBe('mastra dev');
    expect(pkg.scripts.build).toBe('mastra build');
    expect(files['tsconfig.json']).toContain('Bundler');
    expect(files['src/mastra/agents/index.ts']).toContain('export');
    expect(files['src/mastra/agents/test-agent.ts']).toContain("from '@mastra/core/agent'");
    expect(files['src/mastra/agents/test-agent.ts']).toContain("id: 'test-agent'");
    expect(files['src/mastra/index.ts']).not.toContain('telemetry:');
  });

  it('uses identical files for browser preview and export; credentials stay out of export', () => {
    const p = project();
    const exported = generateProjectFiles(p);
    const browser = flatten(
      new FileSystemGenerator().generateWebContainerFiles(p, {
        openai: 'example\nINJECTED=yes',
      }),
    );
    for (const file of exported) expect(browser[file.path]).toBe(file.content);
    expect(browser['.env']).toContain('OPENAI_API_KEY="example\\nINJECTED=yes"');
    expect(exported.some((file) => file.path === '.env')).toBe(false);
    expect(exported.map((file) => file.content).join('\n')).not.toContain('INJECTED');
  });

  it('preserves explicitly attached tools and model settings including zero', () => {
    const p = project();
    p.nodes.push(
      createMockToolNode({
        data: {
          type: 'tool',
          config: {
            id: 'test-tool',
            description: 'Test tool',
            executeCode: 'async (inputData) => inputData',
          },
        },
      }),
    );
    agent(p).tools = ['test-tool'];
    agent(p).model.temperature = 0;
    agent(p).model.maxTokens = 100;
    const files = generateProjectFiles(p);
    const code = files.find((file) => file.path === 'src/mastra/agents/test-agent.ts')!.content;
    expect(code).toContain("'test-tool': testToolTool");
    expect(code).toContain('"temperature":0');
    expect(code).toContain('"maxOutputTokens":100');
    expect(files.find((file) => file.path === 'src/mastra/tools/index.ts')!.content).toContain('testToolTool');
  });

  it('converts buffer memory to a real Memory instance and adds required package', () => {
    const p = project();
    agent(p).memory = { type: 'buffer', maxMessages: 20 };
    const files = generateProjectFiles(p);
    expect(files.find((f) => f.path.endsWith('/test-agent.ts'))!.content).toContain('memory: new Memory(');
    expect(files.find((f) => f.path.endsWith('/test-agent.ts'))!.content).toContain('lastMessages: 20');
    expect(JSON.parse(files.find((f) => f.path === 'package.json')!.content).dependencies['@mastra/memory']).toBe(
      '1.34.0',
    );
  });

  it.each(['summary', 'token', 'vector', 'custom'] as const)(
    'rejects unmappable %s memory instead of dropping it',
    (type) => {
      const p = project();
      agent(p).memory = { type };
      expect(() => generateProjectFiles(p)).toThrow('no faithful automatic mapping');
      expect(agent(p).memory!.type).toBe(type);
    },
  );

  it('reports missing attachments, unsupported workflow nodes and connections', () => {
    const p = project();
    agent(p).tools = ['missing'];
    expect(() => generateProjectFiles(p)).toThrow('no matching Tool node');
    agent(p).tools = [];
    p.nodes.push({
      ...createMockToolNode({
        data: {
          type: 'tool',
          config: {
            id: 'test-tool',
            description: 'Test tool',
            executeCode: 'async (inputData) => inputData',
          },
        },
      }),
      type: 'parallel',
    });
    expect(() => generateProjectFiles(p)).toThrow('workflow/control-flow');
    p.nodes.pop();
    p.nodes.push(
      createMockToolNode({
        data: {
          type: 'tool',
          config: {
            id: 'test-tool',
            description: 'Test tool',
            executeCode: 'async (inputData) => inputData',
          },
        },
      }),
    );
    p.edges.push({ id: 'line', source: p.nodes[0].id, target: p.nodes[1].id });
    expect(() => generateProjectFiles(p)).toThrow('canvas connection alone');
    agent(p).tools = ['test-tool'];
    expect(() => generateProjectFiles(p)).not.toThrow();
  });

  it.each(['../escape', 'bad id', 'name.ts', ''])('rejects unsafe resource filename %s', (id) => {
    const p = project();
    agent(p).id = id;
    expect(() => generateProjectFiles(p)).toThrow('Use a nonempty ID');
  });

  it('rejects reserved barrel IDs and always emits unique artifact paths', () => {
    const p = project();
    const files = generateProjectFiles(p);
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
    agent(p).id = 'index';
    expect(() => generateProjectFiles(p)).toThrow('reserved');
    agent(p).id = 'INDEX';
    expect(() => generateProjectFiles(p)).toThrow('reserved');
  });

  it('rejects duplicate IDs and generated symbol collisions', () => {
    const p = project();
    p.nodes.push({ ...structuredClone(p.nodes[0]), id: 'second-agent' });
    expect(() => generateProjectFiles(p)).toThrow('Duplicate resource ID');
    (p.nodes[1].data.config as AgentBuilderConfig).id = 'test_agent';
    expect(() => generateProjectFiles(p)).toThrow('collides');
  });

  it('distinguishes browser-only limitations from valid Node exports', () => {
    const p = project();
    p.settings.storage = { type: 'libsql' };
    expect(validateProjectCompatibility(p).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validatePreviewCompatibility(p).some((i) => i.message.includes('native Node'))).toBe(true);
    expect(() => new FileSystemGenerator().generateWebContainerFiles(p, {})).toThrow('LibSQL');
    p.settings.storage = { type: 'memory' };
    agent(p).model.provider = 'groq';
    expect(() => generateProjectFiles(p)).not.toThrow();
    expect(() => new FileSystemGenerator().generateWebContainerFiles(p, {})).toThrow('API-key dialog');
  });

  it('never truncates strings, regexes, comments or template literals', () => {
    const code = `async () => {\n  // preserve this comment\n  const url = 'https://example.com/a//b';\n  const pattern = /a\\/\\/b/;\n  return { url, note: \`/* literal */\`, match: pattern.test(url) };\n}`;
    expect(sanitizeCode(code)).toBe(code);
  });

  it('uses object-shaped input for parameterless tools', () => {
    const code = new ToolCodeGenerator().generate({
      id: 'no-args',
      description: 'No arguments',
      executeCode: 'async () => ({ ok: true })',
    });
    expect(code).toContain('InputSchema = z.object({})');
  });

  it('rejects stale defaults after a visual schema type change', () => {
    expect(() =>
      schemaObject([
        {
          id: 'x',
          name: 'count',
          type: 'number',
          optional: false,
          defaultValue: '5',
        },
      ]),
    ).toThrow('default value must match type number');
  });

  it('rejects duplicate names and incompatible or malformed validation rules', () => {
    const field = {
      id: 'x',
      name: 'count',
      type: 'number' as const,
      optional: false,
    };
    expect(() => schemaObject([field, field])).toThrow('duplicate field name');
    expect(() => schemaObject([{ ...field, validation: [{ type: 'email' }] }])).toThrow('requires a string');
    expect(() => schemaObject([{ ...field, validation: [{ type: 'min', value: '5' }] }])).toThrow('finite number');
    expect(() =>
      schemaObject([
        {
          ...field,
          type: 'string',
          validation: [{ type: 'regex', value: '[' }],
        },
      ]),
    ).toThrow('regular expression');
  });

  it('preserves nested schemas and valid defaults without coercion', () => {
    const code = schemaObject([
      {
        id: 'x',
        name: 'profile',
        type: 'object',
        optional: false,
        children: [
          {
            id: 'n',
            name: 'age',
            type: 'number',
            optional: false,
            defaultValue: 5,
          },
        ],
      },
    ]);
    expect(code).toContain('"profile": z.object');
    expect(code).toContain('"age": z.number().default(5)');
  });

  it('retains unfinished workflow API as an explicit error, including cycles', () => {
    expect(() => new WorkflowCodeGenerator().generate([], [], 'workflow', 'Workflow')).toThrow('not implemented');
  });
});
