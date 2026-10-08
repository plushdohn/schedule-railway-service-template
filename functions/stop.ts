// Railway Function: stop an existing service, then exit. No build or dependencies.
type Deployment = { id: string; status: string; deploymentStopped: boolean };

try {
  const serviceId = Bun.env.TARGET_SERVICE_ID;
  const environmentId = Bun.env.TARGET_ENVIRONMENT_ID;
  const token = Bun.env.RAILWAY_PROJECT_TOKEN;
  for (const key of ["TARGET_SERVICE_ID", "TARGET_ENVIRONMENT_ID", "RAILWAY_PROJECT_TOKEN"]) {
    if (!Bun.env[key]?.trim()) throw new Error(`Missing ${key}`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(serviceId!) || !uuid.test(environmentId!)) throw new Error("Target service/environment IDs must be UUIDs");
  if (serviceId === Bun.env.RAILWAY_SERVICE_ID) throw new Error("Function cannot target itself");

  async function request<T>(query: string, variables: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await fetch("https://backboard.railway.com/graphql/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Project-Access-Token": token! },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error("Railway API request failed or timed out"); }
    if (!response.ok) throw new Error(`Railway API HTTP ${response.status}`);
    let body: { data?: T; errors?: unknown[] };
    try { body = await response.json(); }
    catch { throw new Error("Railway API returned invalid JSON"); }
    // Do not log raw responses: upstream errors could contain credentials.
    if (!body || body.errors?.length || !body.data) throw new Error("Railway API rejected the operation or returned no data");
    return body.data;
  }

  const { serviceInstance } = await request<{ serviceInstance: {
    activeDeployments: Deployment[]; latestDeployment: Deployment | null;
  } }>(`query Target($serviceId: String!, $environmentId: String!) {
    serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
      activeDeployments { id status deploymentStopped }
      latestDeployment { id status deploymentStopped }
    }
  }`, { serviceId: serviceId!, environmentId: environmentId! });

  if (serviceInstance.latestDeployment && ["QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING", "WAITING"].includes(serviceInstance.latestDeployment.status)) {
    throw new Error("Cannot stop while a deployment is in progress; retry after it finishes");
  }
  const running = serviceInstance.activeDeployments.filter(deployment => !deployment.deploymentStopped);
  for (const deployment of running) {
    const result = await request<{ deploymentStop: boolean }>(
      `mutation Stop($id: String!) { deploymentStop(id: $id) }`, { id: deployment.id },
    );
    if (result.deploymentStop !== true) throw new Error("Stop request was rejected");
  }
  console.log(running.length ? `Service stop requested for ${running.length} deployment(s)` : "Service already stopped; nothing to stop");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Stop Function failed");
  process.exitCode = 1;
}

export {};
