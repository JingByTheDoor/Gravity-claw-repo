import type { ArtifactRef, ArtifactStore } from "./contracts.js";
import { TaskStore } from "./task-store.js";

export class SqliteArtifactStore implements ArtifactStore {
  constructor(private readonly taskStore: TaskStore) {}

  recordArtifact(taskId: string, artifact: Omit<ArtifactRef, "createdAt">): ArtifactRef {
    return this.taskStore.recordArtifact(taskId, artifact);
  }

  listArtifacts(taskId: string): ArtifactRef[] {
    return this.taskStore.listArtifacts(taskId);
  }
}
