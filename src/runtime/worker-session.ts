import type { WorkerSession } from "./contracts.js";

interface LocalWorkerSessionOptions extends WorkerSession {}

export class LocalWorkerSession implements WorkerSession {
  readonly label: string;
  readonly mode: "local" | "vm";
  readonly hostProfileRoot?: string;
  readonly browserProfileDir?: string;
  readonly pathAccessPolicy: WorkerSession["pathAccessPolicy"];
  readonly toolRegistry: WorkerSession["toolRegistry"];
  readonly browserController: WorkerSession["browserController"];
  readonly desktopController: WorkerSession["desktopController"];
  readonly shellRunner: WorkerSession["shellRunner"];
  readonly logger: WorkerSession["logger"];

  constructor(options: LocalWorkerSessionOptions) {
    this.label = options.label;
    this.mode = options.mode;
    if (options.hostProfileRoot) {
      this.hostProfileRoot = options.hostProfileRoot;
    }
    if (options.browserProfileDir) {
      this.browserProfileDir = options.browserProfileDir;
    }
    this.pathAccessPolicy = options.pathAccessPolicy;
    this.toolRegistry = options.toolRegistry;
    this.browserController = options.browserController;
    this.desktopController = options.desktopController;
    this.shellRunner = options.shellRunner;
    this.logger = options.logger;
  }
}
