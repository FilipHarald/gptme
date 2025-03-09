import { ClientPod, ClientPodStatus } from "../../models/types.js";
import logger from "../../utils/logger.js";
import { ClientPodController } from "./index.js";

/**
 * Main reconciliation logic for ClientPod resources
 */
export async function reconcileClientPod(
  this: ClientPodController,
  clientPod: ClientPod,
) {
  if (!clientPod) {
    throw new Error("FATAL: reconcileClientPod called without a ClientPod");
  }
  const name = clientPod.metadata.name;
  const spec = clientPod.spec;
  const podName =
    clientPod?.status?.podName || `${this.podTemplate}-${spec.clientId}`;
  const existingPod = await this.k8sClient.getPod(podName);
  const status = clientPod.status || {
    podName,
    phase: "Unknown",
    lastActivity: new Date().toISOString(),
  };
  if (!existingPod) {
    logger.info(`Creating pod for ClientPod ${name}`);
    const pod = await this.createPodManifest(spec, podName);
    await this.k8sClient.createPod(pod);
    logger.info(`Creating service for pod ${podName}`);
    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels: {
          app: this.podTemplate,
          "gptme.ai/client-id": spec.clientId,
        },
      },
      spec: {
        selector: {
          app: this.podTemplate,
          "gptme.ai/client-id": spec.clientId,
        },
        ports: [
          {
            port: 5000,
            targetPort: 5000,
            name: "http",
          },
        ],
      },
    };
    await this.k8sClient.createService(service);
    logger.info(`Creating IngressRoute for pod ${podName}`);
    await this.k8sClient.createIngressRoute(podName);
  } else {
    logger.info(`Pod ${podName} already exists for ClientPod ${name}`);
    try {
      logger.info(`Ensuring IngressRoute exists for pod ${podName}`);
      await this.k8sClient.createIngressRoute(podName); // TODO: is this necessary?
    } catch (error) {
      if ((error as { code: number })?.code === 409) {
        logger.info(`IngressRoute for pod ${podName} already exists`);
      } else {
        logger.error(
          `Error creating IngressRoute for ${podName}: ${(error as Error).stack}`,
        );
      }
    }
    if (existingPod.status?.phase) {
      status.phase = existingPod.status?.phase;
    }
  }
  await this.updateClientPodStatus(name, status);
}

/**
 * Clean up resources when a ClientPod is deleted
 */
export async function cleanupClientPodResources(
  this: ClientPodController,
  clientPod: ClientPod,
) {
  const status = clientPod.status;
  if (status?.podName) {
    try {
      logger.info(`Deleting pod ${status.podName}`);
      await this.k8sClient.deletePod(status.podName);

      // Also delete the corresponding service
      logger.info(`Deleting service ${status.podName}`);
      await this.k8sClient.deleteService(status.podName);

      // Delete the IngressRoute for the pod
      logger.info(`Deleting IngressRoute for pod ${status.podName}`);
      await this.k8sClient.deleteIngressRoute(status.podName);
    } catch (error) {
      logger.error(`Error deleting pod/service ${status.podName}: ${error}`);
    }
  }
}

/**
 * Update the status of a ClientPod
 */
export async function updateClientPodStatus(
  this: ClientPodController,
  name: string,
  status: Partial<ClientPodStatus>,
): Promise<ClientPod | null> {
  try {
    logger.info(
      `Updating status for ClientPod ${name} with status: ${JSON.stringify(status, null, 2)}`,
    );
    const clientPod = await this.k8sClient.getClientPod(name);
    if (!clientPod) {
      logger.warn(`ClientPod ${name} not found, cannot update status`);
      return null;
    }
    const currentStatus = clientPod.status || {};
    const phaseDiff =
      status.phase !== currentStatus.phase
        ? `${clientPod.spec.clientId}: ${currentStatus.phase} -> ${status.phase}`
        : "";
    const needsUpdate =
      phaseDiff ||
      !currentStatus.lastActivity ||
      new Date().getTime() - new Date(currentStatus.lastActivity).getTime() >
        60_000;

    if (!needsUpdate) {
      return clientPod;
    }

    if (phaseDiff) {
      logger.info(`Updating status for ClientPod ${name}: ${phaseDiff}`);
    }

    const response =
      await this.k8sClient.customApi.patchNamespacedCustomObjectStatus({
        group: "gptme.ai",
        version: "v1",
        namespace: this.namespace,
        plural: "clientpods",
        name,
        body: [
          {
            op: "replace",
            path: "/status",
            value: status,
          },
        ],
      });
    return response.body as ClientPod;
  } catch (error) {
    logger.error(`Error updating ClientPod status: ${error}`);
    throw error;
  }
}
