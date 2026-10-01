/** Credential-free integration check of the exact downloadable project artifact. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { generateProjectFiles } from '../src/lib/code-generation/ProjectGenerator';
import type { ProjectConfig, SchemaField } from '../src/types';

const field = (name: string, type: SchemaField['type']): SchemaField => ({
  id: name,
  name,
  type,
  optional: false,
});
const project: ProjectConfig = {
  id: 'compatibility-test',
  name: 'Compatibility test',
  edges: [],
  settings: {
    storage: { type: 'libsql', config: { url: ':memory:' } },
    logger: { type: 'pino', config: { level: 'error' } },
    telemetry: { enabled: true },
  },
  nodes: [
    {
      id: 'agent',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        type: 'agent',
        config: {
          id: 'test-agent',
          name: 'Test agent',
          instructions: 'Deterministic fixture; no model invocation.',
          model: {
            provider: 'openai',
            name: 'gpt-4o-mini',
            temperature: 0,
            maxTokens: 64,
            stopSequences: ['DONE'],
          },
          tools: ['echo-url', 'no-args'],
          workflows: [],
          agents: [],
          memory: { type: 'buffer', maxMessages: 7 },
          maxRetries: 0,
          defaultGenerateOptions: { maxSteps: 2 },
        },
      },
    },
    {
      id: 'tool',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        type: 'tool',
        config: {
          id: 'echo-url',
          description: 'Returns data without a network call',
          inputSchema: [field('message', 'string')],
          outputSchema: [field('message', 'string'), field('url', 'string')],
          executeCode: `async ({ message }) => {\n  // Preserve URL and comment text exactly.\n  return { message, url: 'https://example.com/a//b' };\n}`,
        },
      },
    },
    {
      id: 'no-args',
      type: 'tool',
      position: { x: 0, y: 0 },
      data: {
        type: 'tool',
        config: {
          id: 'no-args',
          description: 'Parameterless deterministic tool',
          inputSchema: [],
          outputSchema: [field('ok', 'boolean')],
          executeCode: 'async () => ({ ok: true })',
        },
      },
    },
    {
      id: 'step',
      type: 'step',
      position: { x: 0, y: 0 },
      data: {
        type: 'step',
        config: {
          id: 'double-value',
          description: 'Deterministic step',
          inputSchema: [field('value', 'number')],
          outputSchema: [field('value', 'number')],
          executeCode: 'async ({ inputData }) => ({ value: inputData.value * 2 })',
        },
      },
    },
  ],
};
const directory = resolve('.generated-test');
await mkdir(directory, { recursive: true });
const files = generateProjectFiles(project);
for (const file of files) {
  const target = resolve(directory, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
const memoryProject: ProjectConfig = {
  ...project,
  name: 'In-memory compatibility test',
  settings: { storage: { type: 'memory' }, logger: { type: 'console', config: { level: 'error' } } },
};
for (const file of generateProjectFiles(memoryProject)) {
  const target = resolve(directory, 'variants/memory', file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
// No inherited API credentials or hosted tracing environment may reach this child.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/(API_KEY|TOKEN|SECRET|PASSWORD|OTEL_|LANGFUSE|LANGSMITH|MASTRA_CLOUD)/i.test(key),
  ),
);
// Mastra CLI's supported opt-out prevents PostHog initialization, before any command.
env.MASTRA_TELEMETRY_DISABLED = '1';
env.XDG_CONFIG_HOME = resolve(directory, '.config');
await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
function run(command: string, args: string[], cwd = directory) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}
run('npm', ['install', '--no-audit', '--no-fund']);
run('npm', ['run', 'type-check']);
run('npm', ['run', 'type-check'], resolve(directory, 'variants/memory'));
await writeFile(
  resolve(directory, 'runtime-check.ts'),
  `
import assert from 'node:assert/strict';
import { mastra } from './src/mastra/index.ts';
import { mastra as memoryMastra } from './variants/memory/src/mastra/index.ts';
import { echoUrlTool } from './src/mastra/tools/echo-url.ts';
import { noArgsTool } from './src/mastra/tools/no-args.ts';
import { doubleValueStep } from './src/mastra/steps/double-value.ts';
import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
const agent = mastra.getAgentById('test-agent');
assert.equal(agent.id, 'test-agent');
const options = await agent.getDefaultOptions();
assert.equal(options.modelSettings.temperature, 0);
assert.equal(options.modelSettings.maxOutputTokens, 64);
assert.equal(options.maxSteps, 2);
const result = await echoUrlTool.execute({ message: 'ok' }, {});
assert.deepEqual(result, { message: 'ok', url: 'https://example.com/a//b' });
const memory = await agent.getMemory();
assert.ok(memory);
const thread = await memory.createThread({ threadId: 'fixture-thread', resourceId: 'fixture-resource' });
assert.equal(thread.id, 'fixture-thread');
const volatileMemory = await memoryMastra.getAgentById('test-agent').getMemory();
assert.equal((await volatileMemory.createThread({ threadId: 'volatile-thread', resourceId: 'fixture-resource' })).id, 'volatile-thread');
const workflow = createWorkflow({ id: 'test-only-workflow', inputSchema: z.object({ value: z.number() }), outputSchema: z.object({ value: z.number() }) }).then(doubleValueStep).commit();
const run = await workflow.createRun();
const stepResult = await run.start({ inputData: { value: 21 } });
assert.equal(stepResult.status, 'success');
assert.deepEqual(stepResult.result, { value: 42 });
const mock = createMockModel({ mockText: 'done', version: 'v2' });
let sawToolResult = false;
const response = (props) => {
  assert.equal(props.tools.find(tool => tool.name === 'no-args').inputSchema.type, 'object');
  const hasResult = props.prompt.some(message => message.role === 'tool');
  if (hasResult) {
    sawToolResult = true;
    assert.ok(JSON.stringify(props.prompt).includes('from-model'));
  }
  return hasResult
    ? { content: [{ type: 'text', text: 'done' }], finishReason: 'stop' }
    : { content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'echo-url', input: JSON.stringify({ message: 'from-model' }) }], finishReason: 'tool-calls' };
};
mock.doGenerate = async props => ({ ...response(props), warnings: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
mock.doStream = async props => {
  const next = response(props);
  const chunks = [{ type: 'stream-start', warnings: [] }];
  if (next.finishReason === 'tool-calls') chunks.push(next.content[0]);
  else chunks.push({ type: 'text-start', id: 'text-1' }, { type: 'text-delta', id: 'text-1', delta: 'done' }, { type: 'text-end', id: 'text-1' });
  chunks.push({ type: 'finish', finishReason: next.finishReason, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  return { stream: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }) };
};
const mockAgent = new Agent({ id: 'mock-agent', name: 'Mock', instructions: 'Use the echo-url tool', model: mock, tools: { 'echo-url': echoUrlTool, 'no-args': noArgsTool }, defaultOptions: options });
const generated = await mockAgent.generate('Use the tool, then say done');
assert.equal(generated.text, 'done');
assert.equal(sawToolResult, true);
sawToolResult = false;
const streamed = await mockAgent.stream('Use the tool, then say done');
let streamedText = '';
for await (const text of streamed.textStream) streamedText += text;
assert.equal(streamedText, 'done');
assert.equal(sawToolResult, true);
console.log('PASS: generated registration/options, tool execution, LibSQL memory, standalone step, mock Agent.generate/stream tool loop; zero external model calls');
await mastra.getStorage()?.close?.();
`,
);
const tsx = resolve('node_modules/tsx/dist/loader.mjs');
run(process.execPath, ['--import', tsx, 'runtime-check.ts']);
run('npm', ['run', 'build']);
const port = 43119;
const server = spawn(process.execPath, ['.mastra/output/index.mjs'], {
  cwd: directory,
  env: { ...env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk;
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk;
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Built server exited: ' + serverOutput);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/agents`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const agents = await response.json();
        if (!JSON.stringify(agents).includes('test-agent')) throw new Error('Generated agent missing from API');
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local process only. */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Built server API did not become ready: ' + serverOutput);
  console.log('PASS: built Mastra server starts and GET /api/agents exposes the generated agent');
} finally {
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) resolve();
    else {
      server.once('exit', () => resolve());
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve();
      }, 3000).unref();
    }
  });
}
// Make it easy to audit the exact dependency resolution used by this run.
const lock = JSON.parse(await readFile(resolve(directory, 'package-lock.json'), 'utf8'));
console.log(
  'Verified generated project:',
  directory,
  'core',
  lock.packages['node_modules/@mastra/core'].version,
  'CLI',
  lock.packages['node_modules/mastra'].version,
);
