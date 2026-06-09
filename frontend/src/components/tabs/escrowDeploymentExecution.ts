import {
  EscrowDeploymentExecution,
} from '../../lib/escrow/batches';

const DEPLOYMENT_EXECUTIONS_API = '/api/banking/escrow/deployment-executions';

type DeploymentExecutionRecord = {
  batchUuid: string;
  execution: EscrowDeploymentExecution;
  createdAt: string;
};

function mapExecutionResponse(data: any): EscrowDeploymentExecution {
  return (data?.execution ?? data) as EscrowDeploymentExecution;
}

export async function saveDeploymentExecutionToDb(
  batchUuid: string,
  execution: EscrowDeploymentExecution,
): Promise<EscrowDeploymentExecution> {
  const res = await fetch(DEPLOYMENT_EXECUTIONS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batchUuid,
      execution,
    }),
  });
  const parsed = await res.json().catch(() => null);
  if (res.status === 409 && parsed?.existing) {
    return mapExecutionResponse(parsed.existing);
  }
  if (!res.ok) {
    throw new Error(parsed?.error || `Deployment execution save failed (${res.status})`);
  }
  return mapExecutionResponse(parsed);
}

export async function fetchDeploymentExecutionFromDb(
  batchUuid: string,
): Promise<EscrowDeploymentExecution | null> {
  try {
    const res = await fetch(`${DEPLOYMENT_EXECUTIONS_API}?batchUuid=${encodeURIComponent(batchUuid)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.execution === null || !(data.execution ?? data)?.deploymentId) return null;
    return mapExecutionResponse(data);
  } catch {
    return null;
  }
}
