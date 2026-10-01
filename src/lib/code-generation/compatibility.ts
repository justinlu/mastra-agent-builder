import type { ProjectConfig, AgentBuilderConfig, SchemaField } from '../../types';
import type { ValidationError } from '../validators/nodeValidators';
import { toCamelCase, validateExecuteCode } from './codeGenUtils';
import { schemaObject } from './schemaCode';

/** Fail closed where the original editor has no implemented executable mapping. */
export function validateProjectCompatibility(project: ProjectConfig): ValidationError[] {
  const issues: ValidationError[] = [];
  const add = (nodeId: string, field: string, message: string, severity: ValidationError['severity'] = 'error') =>
    issues.push({ nodeId, field, message, severity });
  const ids = new Map<string, string>();
  const symbols = new Map<string, string>();
  const paths = new Set<string>();
  const toolIds = new Set(project.nodes.filter((n) => n.type === 'tool').map((n) => (n.data.config as any)?.id));
  for (const node of project.nodes) {
    const config = node.data?.config as any;
    if (!['agent', 'tool', 'step'].includes(node.type)) {
      add(
        node.id,
        'type',
        `${node.type} nodes cannot be exported or previewed: workflow/control-flow compilation is not implemented`,
      );
      continue;
    }
    if (!config || typeof config.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(config.id)) {
      add(node.id, 'id', 'Use a nonempty ID containing letters, numbers, hyphens or underscores (no paths or spaces)');
      continue;
    }
    if (config.id.toLowerCase() === 'index')
      add(node.id, 'id', 'The resource ID "index" is reserved for generated barrel files');
    const portablePath = node.type + '/' + config.id.toLowerCase();
    if (paths.has(portablePath))
      add(node.id, 'id', `ID "${config.id}" collides with a filename on case-insensitive filesystems`);
    paths.add(portablePath);
    if (ids.has(config.id)) add(node.id, 'id', `Duplicate resource ID "${config.id}"`);
    ids.set(config.id, node.id);
    const symbol = toCamelCase(config.id) + node.type;
    if (symbols.has(symbol)) add(node.id, 'id', `ID "${config.id}" collides with another generated identifier`);
    symbols.set(symbol, node.id);
    if (node.type === 'agent') {
      const agent = config as AgentBuilderConfig;
      if (!agent.name?.trim()) add(node.id, 'name', 'Agent name is required');
      if (typeof agent.instructions !== 'string') add(node.id, 'instructions', 'Agent instructions must be a string');
      if (
        !agent.model?.name?.trim() ||
        !['openai', 'anthropic', 'google', 'mistral', 'groq', 'cohere'].includes(agent.model?.provider)
      ) {
        add(
          node.id,
          'model',
          'Select a supported provider and a nonempty model ID; custom model factories require manual code',
        );
      }
      for (const tool of agent.tools ?? [])
        if (!toolIds.has(tool)) add(node.id, 'tools', `Attached tool "${tool}" has no matching Tool node`);
      if (new Set(agent.tools).size !== (agent.tools?.length ?? 0))
        add(node.id, 'tools', 'A tool is attached more than once');
      if (agent.workflows?.length)
        add(node.id, 'workflows', 'Workflow references cannot be resolved: workflow assembly is not implemented');
      if (agent.agents?.length)
        add(node.id, 'agents', 'Agent delegation references are not implemented by this editor');
      if (agent.memory?.type && !['none', 'buffer'].includes(agent.memory.type))
        add(
          node.id,
          'memory',
          `Legacy ${agent.memory.type} memory has no faithful automatic mapping; use buffer history or implement it in code`,
        );
      if (
        agent.memory?.storage ||
        agent.memory?.threadConfig ||
        agent.memory?.retrieval?.similarityThreshold !== undefined ||
        agent.memory?.retrieval?.maxResults !== undefined
      )
        add(
          node.id,
          'memory',
          'Per-agent storage, thread policies and semantic retrieval need manual configuration; buffer history uses project storage',
        );
      if (
        agent.memory?.maxMessages !== undefined &&
        (!Number.isInteger(agent.memory.maxMessages) || agent.memory.maxMessages < 0)
      )
        add(node.id, 'memory', 'Memory message count must be a nonnegative integer');
      if (
        agent.memory?.retrieval?.lastMessages !== undefined &&
        (!Number.isInteger(agent.memory.retrieval.lastMessages) || agent.memory.retrieval.lastMessages < 0)
      )
        add(node.id, 'memory', 'Last messages must be a nonnegative integer');
      for (const field of ['temperature', 'topP', 'maxTokens', 'frequencyPenalty', 'presencePenalty'] as const) {
        if (agent.model?.[field] !== undefined && !Number.isFinite(agent.model[field]))
          add(node.id, `model.${field}`, `${field} must be a finite number`);
      }
      if (agent.maxRetries !== undefined && (!Number.isInteger(agent.maxRetries) || agent.maxRetries < 0))
        add(node.id, 'maxRetries', 'Retry count must be a nonnegative integer');
      if (
        agent.model?.maxTokens !== undefined &&
        (!Number.isInteger(agent.model.maxTokens) || agent.model.maxTokens < 1)
      )
        add(node.id, 'model.maxTokens', 'Maximum tokens must be a positive integer');
      for (const defaults of [agent.defaultGenerateOptions, agent.defaultStreamOptions]) {
        if (defaults?.maxSteps !== undefined && (!Number.isInteger(defaults.maxSteps) || defaults.maxSteps < 1))
          add(node.id, 'defaultOptions', 'Maximum steps must be a positive integer');
      }
      if (agent.model?.fallbacks?.length)
        add(node.id, 'model.fallbacks', 'Model fallback chains are not implemented by this editor');
      const generate = agent.defaultGenerateOptions;
      const stream = agent.defaultStreamOptions;
      if (generate?.maxSteps !== undefined && stream?.maxSteps !== undefined && generate.maxSteps !== stream.maxSteps)
        add(
          node.id,
          'defaultOptions',
          'Current Mastra uses one defaultOptions.maxSteps; generation and streaming values must agree',
        );
      if (generate?.onStepFinish || stream?.onStepFinish)
        add(node.id, 'defaultOptions', 'Custom lifecycle callbacks need manual code');
      for (const field of ['scorers', 'voice', 'inputProcessors', 'outputProcessors'] as const) {
        if (Array.isArray(agent[field]) ? agent[field].length : agent[field])
          add(node.id, field, `${field} configuration is not implemented by this editor`);
      }
    } else {
      if (node.type === 'tool' && !config.description?.trim())
        add(node.id, 'description', 'Tool description is required');
      const result = validateExecuteCode(config.executeCode ?? '');
      if (!result.isValid) add(node.id, 'executeCode', result.error ?? 'Invalid execute code');
      // Do not silently reinterpret arbitrary user code. Explain legacy callback contracts.
      if (node.type === 'step' && /^\s*(?:async\s*)?\(\s*\{\s*(?:input|context)\b/.test(config.executeCode ?? ''))
        add(
          node.id,
          'executeCode',
          'Mastra step callbacks receive { inputData }; migrate the legacy input/context parameter',
        );
      if (
        node.type === 'tool' &&
        /^\s*(?:async\s*)?\(\s*\{\s*context\b/.test(config.executeCode ?? '') &&
        !config.inputSchema?.some((f: SchemaField) => f.name === 'context')
      )
        add(
          node.id,
          'executeCode',
          'Mastra tool callbacks receive input directly, then execution context as a second argument; migrate legacy { context }',
        );
      for (const kind of ['input', 'output', 'resume', 'suspend'] as const) {
        const fields = config[`${kind}Schema`];
        if (fields) {
          try {
            schemaObject(fields);
          } catch (error) {
            add(node.id, `${kind}Schema`, String(error));
          }
        }
      }
      for (const field of [
        'condition',
        'loopConfig',
        'parallelSteps',
        'sleepConfig',
        'mapConfig',
        'eventConfig',
        'nestedWorkflowId',
      ])
        if (config[field]) add(node.id, field, `${field} workflow composition is not implemented`);
    }
  }
  for (const edge of project.edges) {
    const source = project.nodes.find((n) => n.id === edge.source);
    const target = project.nodes.find((n) => n.id === edge.target);
    const agent = source?.type === 'agent' ? source : target?.type === 'agent' ? target : undefined;
    const tool = source?.type === 'tool' ? source : target?.type === 'tool' ? target : undefined;
    if (!source || !target) add(edge.source, 'edges', 'Connection references a missing node');
    else if (agent && tool && (agent.data.config as AgentBuilderConfig).tools?.includes((tool.data.config as any).id)) {
      // This line only visualizes an explicit configured attachment.
    } else
      add(
        edge.source,
        'edges',
        agent && tool
          ? 'Attach the tool in the agent Tools panel; a canvas connection alone has no executable mapping'
          : 'Canvas execution connections cannot be exported: workflow assembly is not implemented',
      );
  }
  const settings = project.settings ?? {};
  if (settings.storage && !['memory', 'libsql'].includes(settings.storage.type))
    add(
      '',
      'storage',
      `${settings.storage.type} storage needs a manually configured adapter; choose memory or local LibSQL`,
    );
  if (settings.storage?.config && Object.keys(settings.storage.config).some((key) => key !== 'url'))
    add(
      '',
      'storage',
      'Only the local LibSQL URL is supported; credentials and custom storage options need manual setup',
    );
  if (
    settings.storage?.type === 'libsql' &&
    settings.storage.config?.url &&
    !/^(file:|:memory:$)/.test(settings.storage.config.url)
  )
    add('', 'storage', 'Remote LibSQL needs authentication setup; use a local file: URL or :memory: for this export');
  if (settings.logger?.type === 'custom') add('', 'logger', 'Custom logger factories need manual code');
  if (
    settings.telemetry?.enabled &&
    ((settings.telemetry.provider && settings.telemetry.provider !== 'opentelemetry') ||
      (settings.telemetry.config && Object.keys(settings.telemetry.config).length))
  )
    add(
      '',
      'telemetry',
      'Hosted/custom telemetry exporters need manual configuration; the built-in tracing option stores traces locally',
    );
  if (settings.telemetry?.enabled || project.nodes.some((n) => (n.data.config as any)?.enableTracing))
    add(
      '',
      'telemetry',
      'Legacy telemetry/tracing is migrated to Mastra local-storage tracing, without a hosted OpenTelemetry exporter',
      'warning',
    );
  if (settings.entryPoints?.workflows?.length) add('', 'entryPoints', 'Workflow entry points cannot be resolved');
  if (settings.entryPoints?.agents?.length)
    add('', 'entryPoints', 'Entry-point filtering is not implemented; all configured agents are registered');
  if (settings.environmentVariables && Object.keys(settings.environmentVariables).length)
    add(
      '',
      'environmentVariables',
      'Environment variable names are exported as empty placeholders; set values locally in .env',
      'warning',
    );
  return issues;
}

/** Browser preview has additional limits; it must not silently alter Node exports. */
export function validatePreviewCompatibility(project: ProjectConfig): ValidationError[] {
  const issues = validateProjectCompatibility(project);
  if (project.settings.storage?.type === 'libsql')
    issues.push({
      nodeId: '',
      field: 'storage',
      severity: 'error',
      message:
        'LibSQL uses native Node dependencies not verified in WebContainers. Export and run on Node.js, or explicitly select In-Memory storage for browser preview',
    });
  for (const node of project.nodes) {
    if (node.type === 'agent') {
      const provider = (node.data.config as AgentBuilderConfig).model?.provider;
      if (provider && !['openai', 'anthropic', 'google'].includes(provider))
        issues.push({
          nodeId: node.id,
          field: 'model',
          severity: 'error',
          message: `The browser API-key dialog does not support ${provider}; export and set the provider key in your own Node environment`,
        });
    }
  }
  return issues;
}
