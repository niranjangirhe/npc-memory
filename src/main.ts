import { createApp } from "./server.ts";

const port = Number(process.env.PORT ?? 4321);
createApp(process.cwd()).listen(port, "127.0.0.1", () => {
  console.log(`Mira's stall is open on http://localhost:${port}`);
});
