import { FastMCP, FastMCPSession, UserError, imageContent } from "./FastMCP.js";
import { z } from "zod";
import { test, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getRandomPort } from "get-port-please";
import { setTimeout as delay } from "timers/promises";
import {
  ErrorCode,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  McpError,
  PingRequestSchema,
  Root,
} from "@modelcontextprotocol/sdk/types.js";

const runWithTestServer = async ({
  run,
  client: createClient,
  server: createServer,
}: {
  server?: () => Promise<FastMCP>;
  client?: () => Promise<Client>;
  run: ({
    client,
    server,
  }: {
    client: Client;
    server: FastMCP;
    session: FastMCPSession;
  }) => Promise<void>;
}) => {
  const port = await getRandomPort();

  const server = createServer
    ? await createServer()
    : new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

  await server.start({
    transportType: "sse",
    sse: {
      endpoint: "/sse",
      port,
    },
  });

  try {
    const client = createClient
      ? await createClient()
      : new Client(
          {
            name: "example-client",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        );

    const transport = new SSEClientTransport(
      new URL(`http://localhost:${port}/sse`),
    );

    const session = await new Promise<FastMCPSession>((resolve) => {
      server.on("connect", (event) => {
        resolve(event.session);
      });

      client.connect(transport);
    });

    await run({ client, server, session });
  } finally {
    await server.stop();
  }

  return port;
};

test("adds tools", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args) => {
          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(await client.listTools()).toEqual({
        tools: [
          {
            name: "add",
            description: "Add two numbers",
            inputSchema: {
              additionalProperties: false,
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        ],
      });
    },
  });
});

test("calls a tool", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args) => {
          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [{ type: "text", text: "3" }],
      });
    },
  });
});

test("returns a list", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async () => {
          return {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          };
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      });
    },
  });
});

test("returns an image", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async () => {
          return imageContent({
            buffer: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
              "base64",
            ),
          });
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            mimeType: "image/png",
          },
        ],
      });
    },
  });
});

test("handles UserError errors", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async () => {
          throw new UserError("Something went wrong");
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [{ type: "text", text: "Something went wrong" }],
        isError: true,
      });
    },
  });
});

test("calling an unknown tool throws McpError with MethodNotFound code", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      return server;
    },
    run: async ({ client }) => {
      try {
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(McpError);

        // @ts-expect-error - we know that error is an McpError
        expect(error.code).toBe(ErrorCode.MethodNotFound);
      }
    },
  });
});

test("tracks tool progress", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args, { reportProgress }) => {
          reportProgress({
            progress: 0,
            total: 10,
          });

          await delay(100);

          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      const onProgress = vi.fn();

      await client.callTool(
        {
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        },
        undefined,
        {
          onprogress: onProgress,
        },
      );

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith({
        progress: 0,
        total: 10,
      });
    },
  });
});

test("sets logging levels", async () => {
  await runWithTestServer({
    run: async ({ client, session }) => {
      await client.setLoggingLevel("debug");

      expect(session.loggingLevel).toBe("debug");

      await client.setLoggingLevel("info");

      expect(session.loggingLevel).toBe("info");
    },
  });
});

test("sends logging messages to the client", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args, { log }) => {
          log.debug("debug message", {
            foo: "bar",
          });
          log.error("error message");
          log.info("info message");
          log.warn("warn message");

          return String(args.a + args.b);
        },
      });

      return server;
    },
    run: async ({ client }) => {
      const onLog = vi.fn();

      client.setNotificationHandler(
        LoggingMessageNotificationSchema,
        (message) => {
          if (message.method === "notifications/message") {
            onLog({
              level: message.params.level,
              ...(message.params.data ?? {}),
            });
          }
        },
      );

      await client.callTool({
        name: "add",
        arguments: {
          a: 1,
          b: 2,
        },
      });

      expect(onLog).toHaveBeenCalledTimes(4);
      expect(onLog).toHaveBeenNthCalledWith(1, {
        level: "debug",
        message: "debug message",
        context: {
          foo: "bar",
        },
      });
      expect(onLog).toHaveBeenNthCalledWith(2, {
        level: "error",
        message: "error message",
      });
      expect(onLog).toHaveBeenNthCalledWith(3, {
        level: "info",
        message: "info message",
      });
      expect(onLog).toHaveBeenNthCalledWith(4, {
        level: "warning",
        message: "warn message",
      });
    },
  });
});

test("adds resources", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return {
            text: "Example log content",
          };
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(await client.listResources()).toEqual({
        resources: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            mimeType: "text/plain",
          },
        ],
      });
    },
  });
});

test("clients reads a resource", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return {
            text: "Example log content",
          };
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.readResource({
          uri: "file:///logs/app.log",
        }),
      ).toEqual({
        contents: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            text: "Example log content",
            mimeType: "text/plain",
          },
        ],
      });
    },
  });
});

test("clients reads a resource that returns multiple resources", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return [
            {
              text: "a",
            },
            {
              text: "b",
            },
          ];
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.readResource({
          uri: "file:///logs/app.log",
        }),
      ).toEqual({
        contents: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            text: "a",
            mimeType: "text/plain",
          },
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            text: "b",
            mimeType: "text/plain",
          },
        ],
      });
    },
  });
});

test("adds prompts", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addPrompt({
        name: "git-commit",
        description: "Generate a Git commit message",
        arguments: [
          {
            name: "changes",
            description: "Git diff or description of changes",
            required: true,
          },
        ],
        load: async (args) => {
          return `Generate a concise but descriptive commit message for these changes:\n\n${args.changes}`;
        },
      });

      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.getPrompt({
          name: "git-commit",
          arguments: {
            changes: "foo",
          },
        }),
      ).toEqual({
        description: "Generate a Git commit message",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Generate a concise but descriptive commit message for these changes:\n\nfoo",
            },
          },
        ],
      });

      expect(await client.listPrompts()).toEqual({
        prompts: [
          {
            name: "git-commit",
            description: "Generate a Git commit message",
            arguments: [
              {
                name: "changes",
                description: "Git diff or description of changes",
                required: true,
              },
            ],
          },
        ],
      });
    },
  });
});

test("uses events to notify server of client connect/disconnect", async () => {
  const port = await getRandomPort();

  const server = new FastMCP({
    name: "Test",
    version: "1.0.0",
  });

  const onConnect = vi.fn();
  const onDisconnect = vi.fn();

  server.on("connect", onConnect);
  server.on("disconnect", onDisconnect);

  await server.start({
    transportType: "sse",
    sse: {
      endpoint: "/sse",
      port,
    },
  });

  const client = new Client(
    {
      name: "example-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const transport = new SSEClientTransport(
    new URL(`http://localhost:${port}/sse`),
  );

  await client.connect(transport);

  await delay(100);

  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onDisconnect).toHaveBeenCalledTimes(0);

  expect(server.sessions).toEqual([expect.any(FastMCPSession)]);

  await client.close();

  await delay(100);

  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onDisconnect).toHaveBeenCalledTimes(1);

  await server.stop();
});

test("handles multiple clients", async () => {
  const port = await getRandomPort();

  const server = new FastMCP({
    name: "Test",
    version: "1.0.0",
  });

  await server.start({
    transportType: "sse",
    sse: {
      endpoint: "/sse",
      port,
    },
  });

  const client1 = new Client(
    {
      name: "example-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const transport1 = new SSEClientTransport(
    new URL(`http://localhost:${port}/sse`),
  );

  await client1.connect(transport1);

  const client2 = new Client(
    {
      name: "example-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const transport2 = new SSEClientTransport(
    new URL(`http://localhost:${port}/sse`),
  );

  await client2.connect(transport2);

  await delay(100);

  expect(server.sessions).toEqual([
    expect.any(FastMCPSession),
    expect.any(FastMCPSession),
  ]);

  await server.stop();
});

test("session knows about client capabilities", async () => {
  await runWithTestServer({
    client: async () => {
      const client = new Client(
        {
          name: "example-client",
          version: "1.0.0",
        },
        {
          capabilities: {
            roots: {
              listChanged: true,
            },
          },
        },
      );

      client.setRequestHandler(ListRootsRequestSchema, () => {
        return {
          roots: [
            {
              uri: "file:///home/user/projects/frontend",
              name: "Frontend Repository",
            },
          ],
        };
      });

      return client;
    },
    run: async ({ session }) => {
      expect(session.clientCapabilities).toEqual({
        roots: {
          listChanged: true,
        },
      });
    },
  });
});

test("session knows about roots", async () => {
  await runWithTestServer({
    client: async () => {
      const client = new Client(
        {
          name: "example-client",
          version: "1.0.0",
        },
        {
          capabilities: {
            roots: {
              listChanged: true,
            },
          },
        },
      );

      client.setRequestHandler(ListRootsRequestSchema, () => {
        return {
          roots: [
            {
              uri: "file:///home/user/projects/frontend",
              name: "Frontend Repository",
            },
          ],
        };
      });

      return client;
    },
    run: async ({ session }) => {
      expect(session.roots).toEqual([
        {
          uri: "file:///home/user/projects/frontend",
          name: "Frontend Repository",
        },
      ]);
    },
  });
});

test("session listens to roots changes", async () => {
  let clientRoots: Root[] = [
    {
      uri: "file:///home/user/projects/frontend",
      name: "Frontend Repository",
    },
  ];

  await runWithTestServer({
    client: async () => {
      const client = new Client(
        {
          name: "example-client",
          version: "1.0.0",
        },
        {
          capabilities: {
            roots: {
              listChanged: true,
            },
          },
        },
      );

      client.setRequestHandler(ListRootsRequestSchema, () => {
        return {
          roots: clientRoots,
        };
      });

      return client;
    },
    run: async ({ session, client }) => {
      expect(session.roots).toEqual([
        {
          uri: "file:///home/user/projects/frontend",
          name: "Frontend Repository",
        },
      ]);

      clientRoots.push({
        uri: "file:///home/user/projects/backend",
        name: "Backend Repository",
      });

      await client.sendRootsListChanged();

      const onRootsChanged = vi.fn();

      session.on("rootsChanged", onRootsChanged);

      await delay(100);

      expect(session.roots).toEqual([
        {
          uri: "file:///home/user/projects/frontend",
          name: "Frontend Repository",
        },
        {
          uri: "file:///home/user/projects/backend",
          name: "Backend Repository",
        },
      ]);

      expect(onRootsChanged).toHaveBeenCalledTimes(1);
      expect(onRootsChanged).toHaveBeenCalledWith({
        roots: [
          {
            uri: "file:///home/user/projects/frontend",
            name: "Frontend Repository",
          },
          {
            uri: "file:///home/user/projects/backend",
            name: "Backend Repository",
          },
        ],
      });
    },
  });
});

test("session sends pings to the client", async () => {
  await runWithTestServer({
    run: async ({ client }) => {
      const onPing = vi.fn().mockReturnValue({});

      client.setRequestHandler(PingRequestSchema, onPing);

      await delay(2000);

      expect(onPing).toHaveBeenCalledTimes(1);
    },
  });
});

test("completes prompt arguments", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addPrompt({
        name: "countryPoem",
        description: "Writes a poem about a country",
        load: async ({ name }) => {
          return `Hello, ${name}!`;
        },
        arguments: [
          {
            name: "name",
            description: "Name of the country",
            required: true,
            complete: async (value) => {
              if (value === "Germ") {
                return {
                  values: ["Germany"],
                };
              }

              return {
                values: [],
              };
            },
          },
        ],
      });

      return server;
    },
    run: async ({ client }) => {
      const response = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "countryPoem",
        },
        argument: {
          name: "name",
          value: "Germ",
        },
      });

      expect(response).toEqual({
        completion: {
          values: ["Germany"],
        },
      });
    },
  });
});

test("adds automatic prompt argument completion when enum is provided", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addPrompt({
        name: "countryPoem",
        description: "Writes a poem about a country",
        load: async ({ name }) => {
          return `Hello, ${name}!`;
        },
        arguments: [
          {
            name: "name",
            description: "Name of the country",
            required: true,
            enum: ["Germany", "France", "Italy"],
          },
        ],
      });

      return server;
    },
    run: async ({ client }) => {
      const response = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "countryPoem",
        },
        argument: {
          name: "name",
          value: "Germ",
        },
      });

      expect(response).toEqual({
        completion: {
          values: ["Germany"],
          total: 1,
        },
      });
    },
  });
});

test("completes template resource arguments", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });

      server.addResourceTemplate({
        uriTemplate: "issue:///{issueId}",
        name: "Issue",
        mimeType: "text/plain",
        arguments: [
          {
            name: "issueId",
            description: "ID of the issue",
            complete: async (value) => {
              if (value === "123") {
                return {
                  values: ["123456"],
                };
              }

              return {
                values: [],
              };
            },
          },
        ],
      });

      return server;
    },
    run: async ({ client }) => {
      const response = await client.complete({
        ref: {
          type: "ref/resource",
          uri: "issue:///{issueId}",
        },
        argument: {
          name: "issueId",
          value: "123",
        },
      });

      expect(response).toEqual({
        completion: {
          values: ["123456"],
        },
      });
    },
  });
});
