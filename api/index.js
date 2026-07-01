// Vercel serverless entrypoint. Imports the Express app and hands each
// incoming request to it. server.js already skips `app.listen()` when
// VERCEL=1 is present in the environment.
import app from '../src/server.js';

export default function handler(req, res) {
  return app(req, res);
}
