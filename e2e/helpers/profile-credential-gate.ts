type ListenerVerification = {
  inodes: string[];
  ownerPids: number[];
  pid: number;
  processTreePids?: number[];
};

type GateOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  assertOwnedListener?: (input: {
    host: string;
    pid: number;
    port: string | number;
  }) => ListenerVerification;
  cleanupOnFailure?: boolean;
};

type LiveGate = (options: {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  assertOwnedListener?: GateOptions["assertOwnedListener"];
  cleanupOnFailure?: boolean;
}) => Promise<unknown>;

type VerifiedProxyResponse = {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  status: number;
  statusText: string;
  url: string;
};

type VerifiedProxySend = (options: {
  body?: Buffer;
  env: NodeJS.ProcessEnv;
  headers?: Record<string, string>;
  method?: string;
  timeoutMs?: number;
  url: string;
}) => Promise<VerifiedProxyResponse>;

export async function assertProfileCredentialGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: GateOptions = {},
): Promise<void> {
  if (env.E2E_PROFILE !== "1") return undefined;
  const { assertLiveE2ECredentialGate } =
    await import("../../scripts/e2e-credential-gate.mjs");
  const runLiveGate = assertLiveE2ECredentialGate as unknown as LiveGate;
  await runLiveGate({
    env: env as NodeJS.ProcessEnv,
    ...options,
  });
}

export async function sendProfileRequestOverVerifiedProxy(options: {
  body?: Buffer;
  headers?: Record<string, string>;
  method?: string;
  timeoutMs?: number;
  url: string;
}): Promise<VerifiedProxyResponse> {
  const { sendE2ERequestOverVerifiedProxy } =
    await import("../../scripts/e2e-credential-gate.mjs");
  const send = sendE2ERequestOverVerifiedProxy as unknown as VerifiedProxySend;
  return send({ ...options, env: process.env });
}
