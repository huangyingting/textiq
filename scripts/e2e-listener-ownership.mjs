import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import process from "node:process";

const IPV4_LOOPBACK = "127.0.0.1";

export function assertE2EListenerOwnedByProcess({
  host,
  port,
  pid = process.pid,
  platform = process.platform,
  readFile = readFileSync,
  readDirectory = readdirSync,
  readLink = readlinkSync,
} = {}) {
  if (host !== IPV4_LOOPBACK) {
    throw new Error(
      `E2E listener ownership verification requires IPv4 loopback ${IPV4_LOOPBACK}.`,
    );
  }
  if (platform !== "linux") {
    throw new Error(
      `E2E listener ownership verification is unavailable on ${platform}; refusing to send profile credentials.`,
    );
  }
  const numericPid = Number(pid);
  const numericPort = Number(port);
  if (
    !Number.isSafeInteger(numericPid) ||
    numericPid < 1 ||
    !Number.isSafeInteger(numericPort) ||
    numericPort < 1 ||
    numericPort > 65_535
  ) {
    throw new Error(
      "E2E listener ownership verification received invalid input.",
    );
  }

  let listeners;
  try {
    listeners = linuxIpv4ListenerInodes(
      readFile("/proc/net/tcp", "utf8"),
      numericPort,
    );
  } catch (error) {
    throw new Error(
      "Unable to inspect Linux TCP listeners; refusing to send profile credentials.",
      { cause: error },
    );
  }
  if (listeners.length === 0) {
    const error = new Error(
      `The spawned E2E process has not bound ${host}:${numericPort}.`,
    );
    error.code = "E2E_LISTENER_NOT_READY";
    throw error;
  }

  const processTreePids = linuxProcessTreePids(numericPid, { readFile });
  const ownedInodes = new Map();
  const inspectionErrors = [];
  for (const processPid of processTreePids) {
    let descriptors;
    try {
      descriptors = readDirectory(`/proc/${processPid}/fd`);
    } catch (error) {
      if (processPid !== numericPid) {
        inspectionErrors.push(error);
        continue;
      }
      throw new Error(
        "Unable to inspect the spawned E2E process tree descriptors; refusing to send profile credentials.",
        { cause: error },
      );
    }
    for (const descriptor of descriptors) {
      try {
        const target = readLink(`/proc/${processPid}/fd/${descriptor}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match) {
          const owners = ownedInodes.get(match[1]) ?? [];
          owners.push(processPid);
          ownedInodes.set(match[1], owners);
        }
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          continue;
        }
        if (
          processPid === numericPid &&
          (!error || typeof error !== "object")
        ) {
          throw new Error(
            "Unable to inspect the spawned E2E process tree socket descriptors; refusing to send profile credentials.",
            { cause: error },
          );
        }
        inspectionErrors.push(error);
      }
    }
  }
  const foreignInodes = listeners.filter((inode) => !ownedInodes.has(inode));
  if (foreignInodes.length > 0) {
    if (inspectionErrors.length > 0) {
      throw new Error(
        "Unable to prove listener ownership because a spawned E2E process-tree descriptor could not be inspected; refusing to send profile credentials.",
        { cause: inspectionErrors[0] },
      );
    }
    throw new Error(
      `The listener on ${host}:${numericPort} is not owned by spawned E2E process ${numericPid}; refusing to send profile credentials.`,
    );
  }
  return {
    inodes: listeners,
    ownerPids: [
      ...new Set(listeners.flatMap((inode) => ownedInodes.get(inode) ?? [])),
    ].sort((left, right) => left - right),
    pid: numericPid,
    processTreePids,
  };
}

export function assertE2EConnectionOwnedByProcess({
  clientPort,
  host,
  includeDescendants = true,
  ownerPids,
  port,
  pid = process.pid,
  platform = process.platform,
  readFile = readFileSync,
  readDirectory = readdirSync,
  readLink = readlinkSync,
} = {}) {
  if (host !== IPV4_LOOPBACK || platform !== "linux") {
    throw new Error(
      "Descriptor-safe E2E connection ownership verification is unavailable; refusing credentials.",
    );
  }
  const numericPid = Number(pid);
  const numericPort = Number(port);
  const numericClientPort = Number(clientPort);
  if (
    !Number.isSafeInteger(numericPid) ||
    numericPid < 1 ||
    !validPort(numericPort) ||
    !validPort(numericClientPort)
  ) {
    throw new Error(
      "E2E connection ownership verification received invalid input.",
    );
  }

  let connectionInodes;
  try {
    connectionInodes = linuxIpv4ConnectionInodes(
      readFile("/proc/net/tcp", "utf8"),
      numericPort,
      numericClientPort,
    );
  } catch (error) {
    throw new Error(
      "Unable to inspect Linux TCP connections; refusing credentials.",
      { cause: error },
    );
  }
  if (connectionInodes.length === 0) {
    const error = new Error(
      "The accepted E2E upstream connection is not yet inspectable.",
    );
    error.code = "E2E_CONNECTION_NOT_READY";
    throw error;
  }

  const processTreePids = Array.isArray(ownerPids)
    ? ownerPids
    : includeDescendants
      ? linuxProcessTreePids(numericPid, { readFile })
      : [numericPid];
  const { inspectionErrors, ownedInodes } = processSocketInodeOwners(
    processTreePids,
    numericPid,
    { readDirectory, readLink },
  );
  const foreignInodes = connectionInodes.filter(
    (inode) => !ownedInodes.has(inode),
  );
  if (foreignInodes.length > 0) {
    if (inspectionErrors.length > 0) {
      throw new Error(
        "Unable to prove accepted E2E connection ownership; refusing credentials.",
        { cause: inspectionErrors[0] },
      );
    }
    const error = new Error(
      `The accepted E2E connection inodes ${connectionInodes.join(",")} are not owned by checked PIDs ${processTreePids.join(",")}; refusing credentials.`,
    );
    error.code = "E2E_CONNECTION_NOT_READY";
    throw error;
  }
  return {
    inodes: connectionInodes,
    ownerPids: [
      ...new Set(
        connectionInodes.flatMap((inode) => ownedInodes.get(inode) ?? []),
      ),
    ].sort((left, right) => left - right),
    pid: numericPid,
    processTreePids,
  };
}

export function linuxProcessTreePids(
  rootPid,
  { readFile = readFileSync } = {},
) {
  const pending = [Number(rootPid)];
  const visited = new Set();
  while (pending.length > 0) {
    const pid = pending.shift();
    if (!Number.isSafeInteger(pid) || pid < 1 || visited.has(pid)) continue;
    visited.add(pid);
    let rawChildren;
    try {
      rawChildren = readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    } catch (error) {
      if (
        pid !== Number(rootPid) &&
        error &&
        typeof error === "object" &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw new Error(
        "Unable to inspect the spawned E2E process tree; refusing to send profile credentials.",
        { cause: error },
      );
    }
    for (const child of rawChildren.trim().split(/\s+/)) {
      if (/^[1-9]\d*$/.test(child)) pending.push(Number(child));
    }
  }
  return [...visited].sort((left, right) => left - right);
}

export async function waitForOwnedE2EListener({
  timeoutMs,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  verify = assertE2EListenerOwnedByProcess,
  ...listener
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return verify(listener);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        error.code !== "E2E_LISTENER_NOT_READY"
      ) {
        throw error;
      }
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(
    `The spawned E2E process did not own ${listener.host}:${listener.port} within ${timeoutMs}ms.`,
    { cause: lastError },
  );
}

export async function waitForOwnedE2EConnection({
  timeoutMs = 500,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  verify = assertE2EConnectionOwnedByProcess,
  ...connection
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return verify(connection);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        error.code !== "E2E_CONNECTION_NOT_READY"
      ) {
        throw error;
      }
      lastError = error;
    }
    await delay(10);
  }
  throw new Error(
    `The accepted E2E connection could not be attributed to the spawned process tree: ${
      lastError instanceof Error ? lastError.message : "unknown ownership state"
    }`,
    { cause: lastError },
  );
}

function processSocketInodeOwners(
  processTreePids,
  rootPid,
  { readDirectory, readLink },
) {
  const ownedInodes = new Map();
  const inspectionErrors = [];
  for (const processPid of processTreePids) {
    let descriptors;
    try {
      descriptors = readDirectory(`/proc/${processPid}/fd`);
    } catch (error) {
      if (processPid !== rootPid) {
        inspectionErrors.push(error);
        continue;
      }
      throw new Error(
        "Unable to inspect the spawned E2E process tree descriptors; refusing to send profile credentials.",
        { cause: error },
      );
    }
    for (const descriptor of descriptors) {
      try {
        const target = readLink(`/proc/${processPid}/fd/${descriptor}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match) {
          const owners = ownedInodes.get(match[1]) ?? [];
          owners.push(processPid);
          ownedInodes.set(match[1], owners);
        }
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          continue;
        }
        if (processPid === rootPid && (!error || typeof error !== "object")) {
          throw new Error(
            "Unable to inspect the spawned E2E process tree socket descriptors; refusing to send profile credentials.",
            { cause: error },
          );
        }
        inspectionErrors.push(error);
      }
    }
  }
  return { inspectionErrors, ownedInodes };
}

function linuxIpv4ListenerInodes(tcpTable, port) {
  const expectedAddress = `0100007F:${port.toString(16).toUpperCase().padStart(4, "0")}`;
  return tcpTable
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (fields) =>
        fields.length >= 10 &&
        fields[1] === expectedAddress &&
        fields[3] === "0A" &&
        /^\d+$/.test(fields[9]),
    )
    .map((fields) => fields[9]);
}

function linuxIpv4ConnectionInodes(tcpTable, serverPort, clientPort) {
  const local = ipv4LoopbackAddress(serverPort);
  const remote = ipv4LoopbackAddress(clientPort);
  return tcpTable
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (fields) =>
        fields.length >= 10 &&
        fields[1] === local &&
        fields[2] === remote &&
        fields[3] === "01" &&
        /^\d+$/.test(fields[9]),
    )
    .map((fields) => fields[9]);
}

function ipv4LoopbackAddress(port) {
  return `0100007F:${port.toString(16).toUpperCase().padStart(4, "0")}`;
}

function validPort(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 65_535;
}
