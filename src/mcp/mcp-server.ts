import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { continuityGetInputSchema, handleContinuityGet } from './tools/continuity-get.js'
import { handleMemoryPropose, memoryProposeInputSchema } from './tools/memory-propose.js'
import {
  handleMemoryPendingGet,
  handleMemoryPendingList,
  handleMemoryPromote,
  handleMemoryReject,
  memoryPendingGetInputSchema,
  memoryPendingListInputSchema,
  memoryReviewDecisionInputSchema
} from './tools/memory-review.js'
import { handleProjectIdentify, projectIdentifyInputSchema } from './tools/project-identify.js'

export function createCyreneMcpServer(options: { cwd: string }): McpServer {
  const server = new McpServer({
    name: 'cyrene',
    version: '0.1.0'
  })

  server.registerTool(
    'cyrene_project_identify',
    {
      description: 'Identify the current project namespace used by Cyrene continuity memory.',
      inputSchema: projectIdentifyInputSchema
    },
    async (input) => handleProjectIdentify(input, options.cwd)
  )

  server.registerTool(
    'cyrene_continuity_get',
    {
      description: 'Get compact Cyrene continuity context: relevant memory, response strategy, and principled dissent hints.',
      inputSchema: continuityGetInputSchema
    },
    async (input) => handleContinuityGet(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_propose',
    {
      description: 'Propose a structured Cyrene memory candidate for pending-only review.',
      inputSchema: memoryProposeInputSchema
    },
    async (input) => handleMemoryPropose(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_pending_list',
    {
      description: 'List Cyrene memory candidates awaiting Codex review.',
      inputSchema: memoryPendingListInputSchema
    },
    async (input) => handleMemoryPendingList(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_pending_get',
    {
      description: 'Get one pending Cyrene memory candidate for Codex review.',
      inputSchema: memoryPendingGetInputSchema
    },
    async (input) => handleMemoryPendingGet(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_promote',
    {
      description: 'Promote a pending Cyrene memory candidate after hash-checked Codex review.',
      inputSchema: memoryReviewDecisionInputSchema
    },
    async (input) => handleMemoryPromote(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_reject',
    {
      description: 'Reject a pending Cyrene memory candidate after hash-checked Codex review.',
      inputSchema: memoryReviewDecisionInputSchema
    },
    async (input) => handleMemoryReject(input, options.cwd)
  )

  return server
}

export async function startCyreneMcpServer(options: { cwd: string; transport: 'stdio' }): Promise<void> {
  const server = createCyreneMcpServer({ cwd: options.cwd })
  await server.connect(new StdioServerTransport())
}
