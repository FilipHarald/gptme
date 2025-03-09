import logger from "../logger.js";
import { K8sClientContext } from "./k8s-client-types.js";

export const ingressRouteOperations = {
  /**
   * Get an IngressRoute by name
   */
  async getIngressRoute(
    this: K8sClientContext,
    name: string,
  ): Promise<unknown> {
    try {
      const customObjectsApi = this.customApi;
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: "traefik.io",
        version: "v1alpha1",
        namespace: this.namespace,
        plural: "ingressroutes",
        name: name,
      });
      return response.body;
    } catch (error) {
      if (
        (
          error as {
            code?: number;
          }
        )?.code === 404
      ) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Create an IngressRoute for a specific pod
   */
  async createIngressRoute(
    this: K8sClientContext,
    podName: string,
  ): Promise<unknown> {
    try {
      // Define the IngressRoute object
      const ingressRoute = {
        apiVersion: "traefik.io/v1alpha1",
        kind: "IngressRoute",
        metadata: {
          name: `route-${podName}`,
          namespace: this.namespace,
          labels: {
            app: "gptme-agent",
            "gptme.ai/managed-by": "fleet-operator",
          },
        },
        spec: {
          entryPoints: ["web"],
          routes: [
            {
              kind: "Rule",
              match: `PathPrefix(\`/agents/${podName}\`)`,
              middlewares: [
                {
                  name: "strip-agents-prefix",
                  namespace: this.namespace,
                },
              ],
              services: [
                {
                  name: podName,
                  namespace: this.namespace,
                  port: 5000,
                },
              ],
            },
          ],
        },
      };

      // Create the IngressRoute
      const customObjectsApi = this.customApi;
      const response = await customObjectsApi.createNamespacedCustomObject({
        group: "traefik.io",
        version: "v1alpha1",
        namespace: this.namespace,
        plural: "ingressroutes",
        body: ingressRoute,
      });

      logger.info(`Created IngressRoute for pod ${podName}`);
      return response.body;
    } catch (error) {
      if (
        (
          error as {
            code?: number;
          }
        )?.code === 409
      ) {
        logger.info(`IngressRoute for pod ${podName} already exists`);
      } else {
        throw error;
      }
    }
  },

  /**
   * Delete an IngressRoute by pod name
   */
  async deleteIngressRoute(
    this: K8sClientContext,
    podName: string,
  ): Promise<unknown> {
    try {
      const ingressRouteName = `route-${podName}`;
      const customObjectsApi = this.customApi;
      const response = await customObjectsApi.deleteNamespacedCustomObject({
        group: "traefik.io",
        version: "v1alpha1",
        namespace: this.namespace,
        plural: "ingressroutes",
        name: ingressRouteName,
      });
      logger.info(`Deleted IngressRoute for pod ${podName}`);
      return response.body;
    } catch (error) {
      // Ignore NotFound errors
      if (
        (
          error as {
            code?: number;
          }
        ).code === 404
      ) {
        logger.info(
          `IngressRoute for pod ${podName} not found, skipping deletion`,
        );
      } else {
        logger.error(
          `Error deleting IngressRoute for pod ${podName}: ${error}`,
        );
        throw error;
      }
    }
  },
};
