// Vercel serverless function: GET /api/freeserp?<params> -> FreeSerp Main. See lib/proxy.js.
import { handleProxy } from '../lib/proxy.js';

export default handleProxy;
