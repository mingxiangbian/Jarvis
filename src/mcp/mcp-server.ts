import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { continuityGetInputSchema, handleContinuityGet } from './tools/continuity-get.js'
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

  return server
}

export async function startCyreneMcpServer(options: { cwd: string; transport: 'stdio' }): Promise<void> {
  const server = createCyreneMcpServer({ cwd: options.cwd })
  await server.connect(new StdioServerTransport())
}
