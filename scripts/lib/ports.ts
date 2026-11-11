import { type AddressInfo, createServer } from "node:net";

/** Ports this process already handed out: each is free only until its server binds it. */
const given = new Set<number>();

export function portAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Marks `ports` as taken, such as ports another program has configured but not bound yet. */
export function reservePorts(ports: Iterable<number>) {
  for (const port of ports) given.add(port);
}

/** The first free port on `host` from `preferred` up to 100 above it, or exactly `override`. */
export async function freePort(
  host: string,
  preferred: number,
  override?: string,
): Promise<number> {
  const first = override === undefined ? preferred : Number(override);
  if (!Number.isInteger(first) || first < 1024 || first > 65535) {
    throw new Error(`Invalid port: ${override ?? preferred}`);
  }
  const last = override === undefined ? Math.min(first + 100, 65535) : first;
  for (let port = first; port <= last; port++) {
    if (!given.has(port) && (await portAvailable(host, port))) {
      given.add(port);
      return port;
    }
  }
  throw new Error(`No available port on ${host} in ${first}–${last}.`);
}

/** A free port on `host` that the system picks, so two programs starting at once get different
    ones; a port this process was already given is skipped. */
export async function systemPort(host = "127.0.0.1"): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, host, () => {
        const { port } = server.address() as AddressInfo;
        server.close(() => resolve(port));
      });
    });
    if (!given.has(port)) {
      given.add(port);
      return port;
    }
  }
  throw new Error(`The system gave no new free port on ${host}.`);
}
