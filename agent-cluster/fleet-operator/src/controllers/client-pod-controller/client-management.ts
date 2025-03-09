import * as crypto from "crypto";
import { ClientPod } from "../../models/types.js";
import logger from "../../utils/logger.js";
import { ClientPodController } from "./index.js";

/**
 * Handle client identification and pod assignment
 * This is called when a client makes a request through the API Gateway
 */
export async function handleClientRequest(
  this: ClientPodController,
  apiKey: string,
  instanceId: string,
) {
  logger.info(`111`);
  const clientId = this.generateClientId(apiKey, instanceId);
  const name = `${this.podTemplate}-${clientId}`;

  try {
    logger.info(`222`);
    const existingClientPod = await this.k8sClient.getClientPod(name);
    if (existingClientPod) {
      logger.info(`333`);
      const res = await this.updateClientPodStatus(name, {
        ...existingClientPod.status,
        lastActivity: new Date().toISOString(),
      });
      return res;
    }
    logger.info(`ClientPod ${name} not found, creating new pod`);
    const clientPod: ClientPod = {
      apiVersion: "gptme.ai/v1",
      kind: "ClientPod",
      metadata: {
        name,
        namespace: this.namespace,
      },
      spec: {
        clientId,
        model: "default",
        timeout: 3600, // 1 hour default timeout
        resources: {
          cpu: "100m",
          memory: "256Mi",
        },
      },
    };

    logger.info(`Creating new ClientPod ${name} for client ${clientId}`);
    return await this.k8sClient.createClientPod(clientPod);
  } catch (error) {
    logger.error(`Error handling client request: ${error}`);
    throw error;
  }
}

/**
 * Generate a consistent client ID from API key and instance ID
 */
export function generateClientId(
  this: ClientPodController,
  apiKey: string,
  instanceId: string,
): string {
  // Simple hash function for demo purposes
  // In production, you should use a more secure method
  const hash = crypto
    .createHash("sha256")
    .update(`${apiKey}-${instanceId}`)
    .digest("hex")
    .substring(0, 8);

  return hash;
}
