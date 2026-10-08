export type Environment = Record<string, string | undefined>;
export type Send = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Deployment = { id: string; status: string; deploymentStopped: boolean };
type Instance = { activeDeployments: Deployment[]; latestDeployment: Deployment | null };
const ENDPOINT = "https://backboard.railway.com/graphql/v2";
export const TARGET_QUERY = `query Target($serviceId: String!, $environmentId: String!) {
  serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
    activeDeployments { id status deploymentStopped }
    latestDeployment { id status deploymentStopped }
  }
}`;
export const START_MUTATION = `mutation Start($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}`;
export const STOP_MUTATION = `mutation Stop($id: String!) { deploymentStop(id: $id) }`;

export async function control(action: "start" | "stop", env: Environment, send: Send = fetch): Promise<string> {
  for (const key of ["TARGET_SERVICE_ID", "TARGET_ENVIRONMENT_ID", "RAILWAY_PROJECT_TOKEN"]) {
    if (!env[key]?.trim()) throw new Error(`Missing ${key}`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ["TARGET_SERVICE_ID", "TARGET_ENVIRONMENT_ID"]) {
    if (!uuid.test(env[key]!)) throw new Error(`Invalid ${key}: expected a UUID`);
  }
  if (env.TARGET_SERVICE_ID === env.RAILWAY_SERVICE_ID) throw new Error("Function cannot target itself");
  const variables = { serviceId: env.TARGET_SERVICE_ID!, environmentId: env.TARGET_ENVIRONMENT_ID! };
  async function request<T>(query: string, input: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await send(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Project-Access-Token": env.RAILWAY_PROJECT_TOKEN! },
        body: JSON.stringify({ query, variables: input }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Railway API request failed or timed out");
    }
    if (!response.ok) throw new Error(`Railway API HTTP ${response.status}`);
    let body: { data?: T; errors?: unknown[] };
    try { body = await response.json(); }
    catch { throw new Error("Railway API returned invalid JSON"); }
    if (!body || body.errors?.length || !body.data) throw new Error("Railway API rejected the operation or returned no data");
    return body.data;
  }
  const { serviceInstance } = await request<{ serviceInstance: Instance }>(
    TARGET_QUERY, variables,
  );
  const pending = new Set(["QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING", "WAITING"]);
  if (serviceInstance.latestDeployment && pending.has(serviceInstance.latestDeployment.status)) {
    if (action === "start") return "deployment already in progress";
    throw new Error("Cannot stop while a deployment is in progress; retry after it finishes");
  }
  const running = serviceInstance.activeDeployments.filter(d => !d.deploymentStopped);
  if (action === "stop") {
    if (running.length === 0) return "already stopped";
    for (const deployment of running) {
      const result = await request<{ deploymentStop: boolean }>(STOP_MUTATION, { id: deployment.id });
      if (result.deploymentStop !== true) throw new Error("Stop request was rejected");
    }
    return `stop requested for ${running.length} deployment(s)`;
  }
  if (running.length > 0) return "already running";
  const started = await request<{ serviceInstanceDeployV2: string }>(START_MUTATION, variables);
  if (typeof started.serviceInstanceDeployV2 !== "string" || !started.serviceInstanceDeployV2) {
    throw new Error("Start request was rejected");
  }
  return "start requested";
}
