// Turns off zod's compiled fast path for this realm. The web page's CSP refuses `eval`, so zod
// could never use it there, but without this zod probes with a caught `new Function("")` when it
// builds its first object schema, and the browser reports that as a security-policy violation
// on every load. The probe and the fast path read the same global config, so this must run
// before any schema module: the page imports it first (src/lua/bridge.ts).

import { config } from "zod";

config({ jitless: true });
