import dns from "node:dns";
import net from "node:net";

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

export function lookupUpstream(
  hostname: string,
  options: dns.LookupOptions | LookupCallback,
  callback?: LookupCallback
): void {
  const cb = typeof options === "function" ? options : callback;
  if (!cb) {
    throw new TypeError("lookup callback is required");
  }

  const lookupOptions = typeof options === "function" ? {} : options;
  const ipFamily = net.isIP(hostname);
  if (ipFamily) {
    if (lookupOptions.all) {
      cb(null, [{ address: hostname, family: ipFamily }]);
    } else {
      cb(null, hostname, ipFamily);
    }
    return;
  }

  const family = lookupOptions.family === 6 ? 6 : 4;
  const resolver = family === 6 ? dns.resolve6 : dns.resolve4;
  resolver(hostname, (error, addresses) => {
    if (error) {
      cb(error, lookupOptions.all ? [] : "", family);
      return;
    }
    const results = addresses.map((address) => ({ address, family }));
    if (results.length === 0) {
      const notFound = new Error(`No DNS result for ${hostname}`) as NodeJS.ErrnoException;
      notFound.code = "ENOTFOUND";
      cb(notFound, lookupOptions.all ? [] : "", family);
      return;
    }
    if (lookupOptions.all) {
      cb(null, results);
    } else {
      cb(null, results[0].address, family);
    }
  });
}
