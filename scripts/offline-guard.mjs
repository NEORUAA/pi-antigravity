/** Test preload: permit loopback mock servers only; never contact Google/the internet.
 * Individual tests replace fetch or the Undici dispatcher with their own mocks. */
import { MockAgent, setGlobalDispatcher } from "undici";
const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error(`Offline test blocked outbound fetch to ${url.hostname}`);
  return nativeFetch(input, init);
};
