import { bootstrap } from "./app/bootstrap.js";

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "app.bootstrap.failed",
      meta: {
        error: message
      }
    })
  );
  process.exitCode = 1;
});
