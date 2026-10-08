import type { Send } from "../src/control.ts";
import type { Template } from "./template.ts";

export const INTERNAL_ENDPOINT = "https://backboard.railway.com/graphql/internal";
export const CREATE_QUERY = `mutation CreateTemplate($input: TemplateCreateV2Input!) {
  templateCreateV2(input: $input) { id code name }
}`;

export async function post<T>(endpoint: string, query: string, variables: Record<string, unknown>, token?: string, send: Send = fetch): Promise<T> {
  let response: Response;
  try {
    response = await send(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "railway-cli", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error("Railway template request failed or timed out"); }
  if (!response.ok) throw new Error(`Railway template API HTTP ${response.status}`);
  let body: { data?: T; errors?: unknown[] };
  try { body = await response.json(); }
  catch { throw new Error("Railway template API returned invalid JSON"); }
  if (!body || body.errors?.length || !body.data) throw new Error("Railway template API rejected the request; check API compatibility and workspace permissions");
  return body.data;
}

export async function registerTemplate(config: Template, token: string, workspaceId: string, send: Send = fetch) {
  const created = await post<{ templateCreateV2: { id: string; code: string } }>(INTERNAL_ENDPOINT, CREATE_QUERY, {
    input: { workspaceId, metadata: { name: "Scheduled Railway Service" }, serializedConfig: config },
  }, token, send);
  const { id, code } = created.templateCreateV2;
  const read = await post<{ template: { id: string; code: string; serializedConfig: Template } }>(INTERNAL_ENDPOINT,
    `query ReadTemplate($id: String!) { template(id: $id) { id code serializedConfig } }`, { id }, token, send);
  // Compare actual requested settings, allowing harmless server-side extra fields.
  const expected = Object.values(config.services).sort((a, b) => a.name.localeCompare(b.name));
  const actual = Object.values(read.template.serializedConfig.services).sort((a, b) => a.name.localeCompare(b.name));
  if (read.template.id !== id || read.template.code !== code || actual.length !== expected.length || expected.some((s, i) => {
    const remote = actual[i]!;
    return remote.name !== s.name || remote.source.image !== s.source.image
      || remote.deploy.startCommand !== s.deploy.startCommand
      || remote.deploy.cronSchedule !== s.deploy.cronSchedule
      || remote.deploy.restartPolicyType !== s.deploy.restartPolicyType
      || Object.entries(s.variables).some(([key, variable]) => remote.variables?.[key]?.defaultValue !== variable.defaultValue
        || remote.variables?.[key]?.isOptional !== variable.isOptional);
  })) throw new Error(`Template ${id} was created but read-back verification failed; inspect it before retrying`);
  return { id, code, url: `https://railway.com/deploy/${encodeURIComponent(code)}` };
}

if (import.meta.main) {
  const config = await Bun.file(new URL("../template.json", import.meta.url)).json() as Template;
  if (!process.argv.includes("--create")) {
    console.log(JSON.stringify({ metadata: { name: "Scheduled Railway Service" }, serializedConfig: config }, null, 2));
    console.error("Dry run only. Add --create and set RAILWAY_API_TOKEN plus RAILWAY_WORKSPACE_ID to create a platform template.");
  } else {
    const token = process.env.RAILWAY_API_TOKEN;
    const workspace = process.env.RAILWAY_WORKSPACE_ID;
    if (!token?.trim()) throw new Error("Missing RAILWAY_API_TOKEN (account/workspace token, not a Project Token)");
    if (!workspace || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspace)) throw new Error("Invalid or missing RAILWAY_WORKSPACE_ID");
    const result = await registerTemplate(config, token, workspace);
    await Bun.write("railway-template-result.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  }
}
