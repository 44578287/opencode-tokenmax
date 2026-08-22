export type VFile = {
  path: string;
  content: string;
  original: string;
};

export const PROJECT_ROOT = "harbor";

const seed: Record<string, string> = {
  "harbor/README.md": `# Harbor\n\nA tiny TypeScript HTTP router. Used as the OpenCode desktop workspace.\n\n## Scripts\n\n- \`npm test\` — run unit tests\n- \`npm run dev\` — start the sample server\n`,
  "harbor/package.json": `{\n  "name": "harbor",\n  "version": "0.3.1",\n  "type": "module",\n  "scripts": {\n    "dev": "node --experimental-strip-types src/index.ts",\n    "test": "node --test tests/router.test.ts"\n  }\n}\n`,
  "harbor/src/index.ts": `import { createServer } from "node:http";\nimport { Router } from "./router.ts";\nimport { logger } from "./middleware/logger.ts";\nimport { health } from "./handler.ts";\n\nconst router = new Router();\nrouter.use(logger);\nrouter.get("/health", health);\nrouter.get("/v1/ping", () => ({ ok: true, ts: Date.now() }));\n\nconst port = Number(process.env.PORT ?? 8787);\ncreateServer((req, res) => router.handle(req, res)).listen(port);\nconsole.log(\`harbor listening on :\${port}\`);\n`,
  "harbor/src/router.ts": `import type { IncomingMessage, ServerResponse } from "node:http";\nimport type { Handler, Middleware } from "./types.ts";\n\ntype Route = { method: string; path: string; handler: Handler };\n\nexport class Router {\n  private routes: Route[] = [];\n  private stack: Middleware[] = [];\n\n  use(mw: Middleware) {\n    this.stack.push(mw);\n    return this;\n  }\n\n  get(path: string, handler: Handler) {\n    this.routes.push({ method: "GET", path, handler });\n    return this;\n  }\n\n  async handle(req: IncomingMessage, res: ServerResponse) {\n    const url = new URL(req.url ?? "/", "http://harbor.local");\n    const route = this.routes.find((r) => r.method === req.method && r.path === url.pathname);\n    if (!route) {\n      res.statusCode = 404;\n      res.end(JSON.stringify({ error: "not_found" }));\n      return;\n    }\n    let i = 0;\n    const next = async (): Promise<void> => {\n      const mw = this.stack[i++];\n      if (mw) return mw(req, res, next);\n      const body = await route.handler(req);\n      res.setHeader("content-type", "application/json");\n      res.end(JSON.stringify(body));\n    };\n    await next();\n  }\n}\n`,
  "harbor/src/handler.ts": `import type { IncomingMessage } from "node:http";\n\nexport function health(_req: IncomingMessage) {\n  return {\n    ok: true,\n    service: "harbor",\n    uptime: process.uptime(),\n  };\n}\n`,
  "harbor/src/types.ts": `import type { IncomingMessage, ServerResponse } from "node:http";\n\nexport type Handler = (req: IncomingMessage) => Promise<unknown> | unknown;\nexport type Middleware = (\n  req: IncomingMessage,\n  res: ServerResponse,\n  next: () => Promise<void>,\n) => Promise<void> | void;\n`,
  "harbor/src/middleware/logger.ts": `import type { Middleware } from "../types.ts";\n\nexport const logger: Middleware = async (req, _res, next) => {\n  const start = Date.now();\n  await next();\n  const ms = Date.now() - start;\n  console.log(\`\${req.method} \${req.url} \${ms}ms\`);\n};\n`,
  "harbor/tests/router.test.ts": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { Router } from "../src/router.ts";\n\ntest("registers GET routes", () => {\n  const router = new Router();\n  router.get("/health", () => ({ ok: true }));\n  assert.equal(typeof router.handle, "function");\n});\n`,
};

export function seedFiles(): Record<string, VFile> {
  const out: Record<string, VFile> = {};
  for (const [path, content] of Object.entries(seed)) {
    out[path] = { path, content, original: content };
  }
  return out;
}

export function languageOf(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "ts";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "md";
  if (path.endsWith(".css")) return "css";
  return "text";
}

export function treeFromFiles(files: Record<string, VFile>) {
  type Node = { name: string; path: string; kind: "file" | "dir"; children?: Node[] };
  const root: Node = { name: PROJECT_ROOT, path: PROJECT_ROOT, kind: "dir", children: [] };

  for (const filePath of Object.keys(files).sort()) {
    const parts = filePath.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      if (i === 0 && part === root.name) continue;
      const isFile = i === parts.length - 1;
      node.children ??= [];
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: acc,
          kind: isFile ? "file" : "dir",
          children: isFile ? undefined : [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }
  return root;
}

export function changedFiles(files: Record<string, VFile>) {
  return Object.values(files).filter((f) => f.content !== f.original);
}
