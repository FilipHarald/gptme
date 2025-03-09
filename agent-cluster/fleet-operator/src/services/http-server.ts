import express, { NextFunction, Request, Response } from "express";
import { ClientPodController } from "../controllers/client-pod-controller/index.js";
import logger from "../utils/logger.js";

export class HttpServer {
  private app: express.Application;
  private clientPodController: ClientPodController;
  private port: number;

  constructor(clientPodController: ClientPodController, port: number = 8080) {
    this.app = express();
    this.clientPodController = clientPodController;
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());

    // Request logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check endpoints
    this.app.get("/healthz", (req: Request, res: Response) => {
      res.status(200).send("OK");
    });

    this.app.get("/readyz", (req: Request, res: Response) => {
      res.status(200).send("Ready");
    });

    // Traefik forwardAuth route for direct pod routing
    this.app.all(
      "/api/v1/:apiKey/instances/:instanceId",
      async (req: Request, res: Response) => {
        try {
          const apiKey = req.params.apiKey;
          if (!apiKey) {
            res.status(401).json({ error: "API key is required" });
            return;
          }
          const instanceId = req.params.instanceId;
          const clientPod = await this.clientPodController.handleClientRequest(
            apiKey,
            instanceId,
          );
          logger.info(`ClientPod main: ${JSON.stringify(clientPod, null, 2)}`);
          logger.info(`ClientPod main: ${Object.keys(clientPod ?? {})}`);
          if (
            !clientPod?.status?.phase ||
            (!clientPod?.status?.podName && !clientPod?.metadata?.name)
          ) {
            res.status(202).json({
              message: "Pod is being provisioned",
              status: clientPod?.status?.phase,
              podName: clientPod?.status?.podName ?? clientPod?.metadata?.name,
            });
            return;
          }
          const podName = clientPod.status.podName ?? clientPod.metadata.name;

          const podServiceUrl = `http://agents.gptme.localhost/agents/${podName}`;
          res.status(200).json({
            podName,
            status: clientPod.status.phase,
            podServiceUrl,
          });
        } catch (error) {
          logger.error(`Error handling route request: ${error}`);
          res.status(500).json({ error: "Internal server error" });
        }
      },
    );

    // Admin endpoints for managing client pods
    this.app.get(
      "/api/v1/:apiKey/admin/pods",
      async (req: Request, res: Response) => {
        try {
          const k8sClient = this.clientPodController["k8sClient"];
          const clientPods = await k8sClient.listClientPods();
          res.json(clientPods);
          return;
        } catch (error) {
          logger.error(`Error listing client pods: ${error}`);
          res.status(500).json({ error: "Internal server error" });
          return;
        }
      },
    );

    this.app.delete(
      "/api/v1/:apiKey/admin/pods/:name",
      async (req: Request, res: Response) => {
        try {
          const k8sClient = this.clientPodController["k8sClient"];
          await k8sClient.deleteClientPod(req.params.name);
          res.status(204).send();
          return;
        } catch (error) {
          logger.error(`Error deleting client pod: ${error}`);
          res.status(500).json({ error: "Internal server error" });
          return;
        }
      },
    );
  }

  start() {
    return new Promise<void>((resolve) => {
      this.app.listen(this.port, () => {
        logger.info(`HTTP server listening on port ${this.port}`);
        resolve();
      });
    });
  }
}
