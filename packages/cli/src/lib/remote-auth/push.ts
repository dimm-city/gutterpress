/**
 * Send one ref to the online copy (smart-HTTP receive-pack).
 *
 * Ours, not isomorphic-git's `push`: that one picks the versions to send by
 * walking back from the new tip until it meets a commit the server advertised.
 * After a combine (a merge whose local side starts below the online tip) that
 * walk never meets one and runs down to the first version, so every object the
 * book ever had was sent: 945 MB for a two-line edit in a large book. Here the
 * walk also marks everything the online copy has, newest first, and stops
 * where the two meet; only what the online copy lacks goes into the pack.
 *
 * Built from isomorphic-git's public pieces (`getRemoteInfo2`, `packObjects`,
 * `readCommit`, `readTree`, `isDescendent`). Failures keep its error types
 * (HttpError, PushRejectedError, GitPushError), so the sync messages read
 * them unchanged.
 */
import { gitFs as fs } from "../git-fs.ts";

import git from "isomorphic-git";
import type httpNode from "isomorphic-git/http/node";

import { onAuthFor } from "./transport.ts";
import type { GitCache, RemoteTransport } from "./sync-types.ts";

const ZERO = "0".repeat(40);

export interface PushStats {
  /** Versions sent. */
  commits: number;
  /** Objects in the pack. */
  objects: number;
  /** Bytes of the request body. */
  bytes: number;
}

/**
 * Make `remoteRef` online point where `ref` points here, or remove it.
 * Refuses (PushRejectedError "not-fast-forward") when the online tip is not in
 * this computer's history of `ref`. Updates the tracking ref on success.
 */
export async function pushRef(args: {
  dir: string;
  http: typeof httpNode;
  transport: RemoteTransport;
  cache: GitCache;
  /** What to send: a local ref (any ref resolvable here). */
  ref: string;
  /** Full ref name online, e.g. `refs/heads/main`. */
  remoteRef: string;
  remove?: boolean;
}): Promise<PushStats> {
  const { dir, http, transport, cache, ref, remoteRef, remove = false } = args;
  const url = transport.url.replace(/\/+$/, "");

  // What the online copy has. The sign-in used for it is reused for the POST.
  const { onAuth } = onAuthFor(transport.credential);
  let auth: { username?: string; password?: string } | undefined;
  const info = await git.getRemoteInfo2({
    http,
    url,
    forPush: true,
    protocolVersion: 1,
    ...(onAuth ? { onAuth: (u: string) => (auth = onAuth(u)) } : {}),
  });
  if (info.protocolVersion !== 1) throw new Error("The online copy answered in an unexpected way.");
  const advertised = (info.refs ?? []).filter((r) => r.oid !== ZERO);
  const old = advertised.find((r) => r.ref === remoteRef)?.oid ?? ZERO;
  const tip = remove ? ZERO : await git.resolveRef({ fs, dir, ref });

  let stats: PushStats = { commits: 0, objects: 0, bytes: 0 };
  if (tip !== old) {
    if (!remove && old !== ZERO) {
      const ahead = await git
        .isDescendent({ fs, dir, cache, oid: tip, ancestor: old, depth: -1 })
        .catch(() => false); // the online tip is not here at all
      if (!ahead) throw new git.Errors.PushRejectedError("not-fast-forward");
    }
    const sideBand = "side-band-64k" in info.capabilities;
    const caps = ["report-status", ...(sideBand ? ["side-band-64k"] : [])].join(" ");
    const parts: Uint8Array[] = [pkt(`${old} ${tip} ${remoteRef}\0 ${caps}\n`), Buffer.from("0000")];
    if (!remove) {
      const { commits, objects } = await objectsToSend(dir, cache, tip, advertised.map((r) => r.oid));
      const { packfile } = await git.packObjects({ fs, dir, cache, oids: objects });
      parts.push(packfile!);
      stats = { commits, objects: objects.length, bytes: 0 };
    }
    stats.bytes = parts.reduce((n, p) => n + p.length, 0);

    const res = await http.request({
      method: "POST",
      url: `${url}/git-receive-pack`,
      headers: {
        "content-type": "application/x-git-receive-pack-request",
        accept: "application/x-git-receive-pack-result",
        ...(auth ? { authorization: `Basic ${Buffer.from(`${auth.username ?? ""}:${auth.password ?? ""}`).toString("base64")}` } : {}),
      },
      body: (async function* () {
        yield* parts;
      })(),
    });
    const body = await collect(res.body);
    if (res.statusCode !== 200) {
      throw new git.Errors.HttpError(res.statusCode, res.statusMessage, Buffer.from(body).toString("utf8"));
    }
    checkReport(sideBand ? demux(body) : body, remoteRef);
  }

  // What this computer last heard from the online copy follows the change.
  if (remoteRef.startsWith("refs/heads/")) {
    const tracking = `refs/remotes/${transport.remote}/${remoteRef.slice("refs/heads/".length)}`;
    if (remove) await git.deleteRef({ fs, dir, ref: tracking });
    else await git.writeRef({ fs, dir, ref: tracking, value: tip, force: true });
  }
  return stats;
}

/**
 * The commits `tip` has that none of `online` has, and the objects to send
 * for them: each new commit's tree, less what the trees of the online commits
 * it starts from already hold.
 */
async function objectsToSend(
  dir: string,
  cache: GitCache,
  tip: string,
  online: string[],
): Promise<{ commits: number; objects: string[] }> {
  // Walked newest first, so the online copy's ancestors are marked before the
  // walk from the tip can reach them.
  const mine = new Set<string>();
  const theirs = new Set<string>();
  const queue: Array<{ oid: string; time: number; parents: string[] }> = [];
  const add = async (oid: string, isTheirs: boolean) => {
    if (theirs.has(oid) || (!isTheirs && mine.has(oid))) return;
    const { commit } = await git.readCommit({ fs, dir, cache, oid });
    if (isTheirs) {
      theirs.add(oid);
      mine.delete(oid);
    } else mine.add(oid);
    queue.push({ oid, time: commit.committer.timestamp, parents: commit.parent });
  };
  for (const oid of online) await add(oid, true).catch(() => {}); // not here, or not a commit
  await add(tip, false);
  while (queue.some((e) => !theirs.has(e.oid))) {
    let newest = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.time > queue[newest]!.time) newest = i;
    const { oid, parents } = queue.splice(newest, 1)[0]!;
    const isTheirs = theirs.has(oid);
    for (const parent of parents) {
      if (isTheirs) await add(parent, true).catch(() => {});
      else await add(parent, false);
    }
  }

  // What the online copy already holds: the trees of the commits the new ones start from.
  const have = new Set<string>();
  const haveTree = async (oid: string): Promise<void> => {
    if (have.has(oid)) return;
    have.add(oid);
    for (const e of (await git.readTree({ fs, dir, cache, oid })).tree) {
      if (e.type === "tree") await haveTree(e.oid);
      else have.add(e.oid);
    }
  };
  const send = new Set<string>();
  const sendTree = async (oid: string): Promise<void> => {
    if (have.has(oid) || send.has(oid)) return;
    send.add(oid);
    for (const e of (await git.readTree({ fs, dir, cache, oid })).tree) {
      if (e.type === "tree") await sendTree(e.oid);
      else if (e.type === "blob" && !have.has(e.oid)) send.add(e.oid);
    }
  };
  const commits = await Promise.all([...mine].map((oid) => git.readCommit({ fs, dir, cache, oid })));
  for (const { commit } of commits) {
    for (const parent of commit.parent) {
      if (theirs.has(parent)) await haveTree((await git.readCommit({ fs, dir, cache, oid: parent })).commit.tree);
    }
  }
  for (const { oid, commit } of commits) {
    send.add(oid);
    await sendTree(commit.tree);
  }
  return { commits: mine.size, objects: [...send] };
}

function pkt(line: string): Uint8Array {
  const data = Buffer.from(line);
  return Buffer.concat([Buffer.from((data.length + 4).toString(16).padStart(4, "0")), data]);
}

/** The payloads of a pkt-line stream (flushes dropped). */
function pktLines(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + 4 <= buf.length; ) {
    const len = parseInt(Buffer.from(buf.subarray(i, i + 4)).toString(), 16);
    if (!Number.isFinite(len)) break;
    if (len === 0) {
      i += 4;
      continue;
    }
    out.push(buf.subarray(i + 4, i + len));
    i += len;
  }
  return out;
}

/** Channel 1 of a side-band response; channel 3 is the server refusing outright. */
function demux(body: Uint8Array): Uint8Array {
  const data: Uint8Array[] = [];
  for (const line of pktLines(body)) {
    if (line[0] === 1) data.push(line.subarray(1));
    else if (line[0] === 3) {
      const msg = Buffer.from(line.subarray(1)).toString("utf8").trim();
      throw new git.Errors.GitPushError(msg, { ok: false, error: msg, refs: {} });
    }
  }
  return Buffer.concat(data);
}

/** Throw GitPushError unless the report says the pack unpacked and `ref` moved. */
function checkReport(report: Uint8Array, ref: string): void {
  const lines = pktLines(report).map((l) => Buffer.from(l).toString("utf8").replace(/\n$/, ""));
  const unpack = lines.find((l) => l.startsWith("unpack ")) ?? "unpack (no report)";
  const status = lines.find((l) => l.startsWith(`ok ${ref}`) || l.startsWith(`ng ${ref} `));
  const ok = unpack === "unpack ok" && status?.startsWith("ok ") === true;
  if (ok) return;
  const error = status?.startsWith("ng ") ? status.slice(`ng ${ref} `.length) : unpack.slice("unpack ".length);
  throw new git.Errors.GitPushError(` - ${ref}: ${error}`, {
    ok: unpack === "unpack ok",
    error: unpack === "unpack ok" ? null : unpack.slice("unpack ".length),
    refs: { [ref]: { ok: false, error } },
  });
}

async function collect(body: AsyncIterable<Uint8Array> | undefined): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  if (body) for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}
