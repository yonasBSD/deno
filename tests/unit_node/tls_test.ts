// Copyright 2018-2025 the Deno authors. MIT license.

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { delay } from "@std/async/delay";
import { dirname, fromFileUrl, join } from "@std/path";
import * as tls from "node:tls";
import * as net from "node:net";
import * as stream from "node:stream";
import { execCode } from "../unit/test_util.ts";
import console from "node:console";

const tlsTestdataDir = fromFileUrl(
  new URL("../testdata/tls", import.meta.url),
);
const key = Deno.readTextFileSync(join(tlsTestdataDir, "localhost.key"));
const cert = Deno.readTextFileSync(join(tlsTestdataDir, "localhost.crt"));
const rootCaCert = Deno.readTextFileSync(join(tlsTestdataDir, "RootCA.pem"));

for (
  const [alpnServer, alpnClient, expected] of [
    [["a", "b"], ["a"], ["a"]],
    [["a", "b"], ["b"], ["b"]],
    [["a", "b"], ["a", "b"], ["a"]],
    [["a", "b"], [], []],
    [[], ["a", "b"], []],
  ]
) {
  Deno.test(`tls.connect sends correct ALPN: '${alpnServer}' + '${alpnClient}' = '${expected}'`, async () => {
    const listener = Deno.listenTls({
      port: 0,
      key,
      cert,
      alpnProtocols: alpnServer,
    });
    const outgoing = tls.connect({
      host: "localhost",
      port: listener.addr.port,
      ALPNProtocols: alpnClient,
      secureContext: {
        ca: rootCaCert,
        // deno-lint-ignore no-explicit-any
      } as any,
    });

    const conn = await listener.accept();
    const handshake = await conn.handshake();
    assertEquals(handshake.alpnProtocol, expected[0] || null);
    conn.close();
    outgoing.destroy();
    listener.close();
    await new Promise((resolve) => outgoing.on("close", resolve));
  });
}

Deno.test("tls.connect makes tls connection", async () => {
  const ctl = new AbortController();
  let port;
  const serve = Deno.serve({
    port: 0,
    key,
    cert,
    signal: ctl.signal,
    onListen: (listen) => port = listen.port,
  }, () => new Response("hello"));

  await delay(200);

  const conn = tls.connect({
    port,
    secureContext: {
      ca: rootCaCert,
      // deno-lint-ignore no-explicit-any
    } as any,
  });
  conn.write(`GET / HTTP/1.1
Host: localhost
Connection: close

`);

  const chunk = Promise.withResolvers<Uint8Array>();
  conn.on("data", (received) => {
    conn.destroy();
    ctl.abort();
    chunk.resolve(received);
  });

  await serve.finished;

  const text = new TextDecoder().decode(await chunk.promise);
  const bodyText = text.split("\r\n\r\n").at(-1)?.trim();
  assertEquals(bodyText, "hello");
});

// https://github.com/denoland/deno/pull/20120
Deno.test("tls.connect mid-read tcp->tls upgrade", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const ctl = new AbortController();
  const serve = Deno.serve({
    port: 8443,
    key,
    cert,
    signal: ctl.signal,
  }, () => new Response("hello"));

  await delay(200);

  const conn = tls.connect({
    host: "localhost",
    port: 8443,
    secureContext: {
      ca: rootCaCert,
      // deno-lint-ignore no-explicit-any
    } as any,
  });

  conn.setEncoding("utf8");
  conn.write(`GET / HTTP/1.1\nHost: www.google.com\n\n`);

  conn.on("data", (_) => {
    conn.destroy();
    ctl.abort();
  });
  conn.on("close", resolve);

  await serve.finished;
  await promise;
});

Deno.test("tls.createServer creates a TLS server", async () => {
  const deferred = Promise.withResolvers<void>();
  const server = tls.createServer(
    // deno-lint-ignore no-explicit-any
    { host: "0.0.0.0", key, cert } as any,
    (socket: net.Socket) => {
      socket.write("welcome!\n");
      socket.setEncoding("utf8");
      socket.pipe(socket).on("data", (data) => {
        if (data.toString().trim() === "goodbye") {
          socket.destroy();
        }
      });
      socket.on("close", () => deferred.resolve());
    },
  );
  server.listen(0, async () => {
    const tcpConn = await Deno.connect({
      // deno-lint-ignore no-explicit-any
      port: (server.address() as any).port,
    });
    const conn = await Deno.startTls(tcpConn, {
      hostname: "localhost",
      caCerts: [rootCaCert],
    });

    const buf = new Uint8Array(100);
    await conn.read(buf);
    let text: string;
    text = new TextDecoder().decode(buf);
    assertEquals(text.replaceAll("\0", ""), "welcome!\n");
    buf.fill(0);

    await conn.write(new TextEncoder().encode("hey\n"));
    await conn.read(buf);
    text = new TextDecoder().decode(buf);
    assertEquals(text.replaceAll("\0", ""), "hey\n");
    buf.fill(0);

    await conn.write(new TextEncoder().encode("goodbye\n"));
    await conn.read(buf);
    text = new TextDecoder().decode(buf);
    assertEquals(text.replaceAll("\0", ""), "goodbye\n");

    conn.close();
    server.close();
  });
  await deferred.promise;
});

Deno.test("TLSSocket can construct without options", () => {
  // deno-lint-ignore no-explicit-any
  new tls.TLSSocket(new stream.PassThrough() as any);
});

Deno.test("tlssocket._handle._parentWrap is set", () => {
  // Note: This feature is used in popular 'http2-wrapper' module
  // https://github.com/szmarczak/http2-wrapper/blob/51eeaf59ff9344fb192b092241bfda8506983620/source/utils/js-stream-socket.js#L6
  const parentWrap =
    // deno-lint-ignore no-explicit-any
    ((new tls.TLSSocket(new stream.PassThrough() as any, {}) as any)
      // deno-lint-ignore no-explicit-any
      ._handle as any)!
      ._parentWrap;
  assertInstanceOf(parentWrap, stream.PassThrough);
});

Deno.test("tls.connect() throws InvalidData when there's error in certificate", async () => {
  // Uses execCode to avoid `--unsafely-ignore-certificate-errors` option applied
  const [status, output] = await execCode(`
    import tls from "node:tls";
    const conn = tls.connect({
      host: "localhost",
      port: 4557,
    });

    conn.on("error", (err) => {
      console.log(err);
    });
  `);

  assertEquals(status, 0);
  assertStringIncludes(
    output,
    "InvalidData: invalid peer certificate: UnknownIssuer",
  );
});

Deno.test("tls.rootCertificates is not empty", () => {
  assert(tls.rootCertificates.length > 0);
  assert(Object.isFrozen(tls.rootCertificates));
  assert(tls.rootCertificates instanceof Array);
  assert(tls.rootCertificates.every((cert) => typeof cert === "string"));
  assertThrows(() => {
    (tls.rootCertificates as string[]).push("new cert");
  }, TypeError);
});

Deno.test("TLSSocket.alpnProtocol is set for client", async () => {
  const listener = Deno.listenTls({
    hostname: "localhost",
    port: 0,
    key,
    cert,
    alpnProtocols: ["a"],
  });
  const outgoing = tls.connect({
    host: "::1",
    servername: "localhost",
    port: listener.addr.port,
    ALPNProtocols: ["a"],
    secureContext: {
      ca: rootCaCert,
      // deno-lint-ignore no-explicit-any
    } as any,
  });

  const conn = await listener.accept();
  const handshake = await conn.handshake();
  assertEquals(handshake.alpnProtocol, "a");
  conn.close();
  outgoing.destroy();
  listener.close();
  await new Promise((resolve) => outgoing.on("close", resolve));
});

Deno.test("tls connect upgrade tcp", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();

  const socket = new net.Socket();
  socket.connect(443, "google.com");
  socket.on("connect", () => {
    const secure = tls.connect({ socket });
    secure.on("secureConnect", () => resolve());
  });

  await promise;
  socket.destroy();
});

Deno.test({
  name: "[node/tls] tls.Server.unref() works",
  ignore: Deno.build.os === "windows",
}, async () => {
  const { stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `
        import * as tls from "node:tls";
        
        const key = Deno.readTextFileSync("${
        join(tlsTestdataDir, "localhost.key")
      }");
        const cert = Deno.readTextFileSync("${
        join(tlsTestdataDir, "localhost.crt")
      }");
        
        const server = tls.createServer({ key, cert }, (socket) => {
          socket.end("hello\\n");
        });

        server.unref();
        server.listen(0, () => {});
      `,
    ],
    cwd: dirname(fromFileUrl(import.meta.url)),
  }).output();

  if (stderr.length > 0) {
    throw new Error(`stderr: ${new TextDecoder().decode(stderr)}`);
  }
  assertEquals(new TextDecoder().decode(stdout), "");
});

// TODO(bartlomieju): this test currently doesn't pass, because server-side
// socket doesn't handle TLS correctly.
Deno.test({
  name: "tls.connect over unix socket works",
  ignore: true,
  // ignore: Deno.build.os === "windows",
  permissions: { read: true, write: true },
}, async () => {
  const socketPath = "/tmp/tls_unix_test.sock";

  try {
    await Deno.remove(socketPath);
  } catch {
    // pass
  }

  let serverError: unknown = null;
  let clientError: unknown = null;

  const { promise: serverReady, resolve: resolveServerReady } = Promise
    .withResolvers<void>();
  const { promise: testComplete, resolve: resolveTestComplete } = Promise
    .withResolvers<void>();
  const { promise: clientDataReceived, resolve: resolveClientDataReceived } =
    Promise.withResolvers<string>();

  const netServer = net.createServer((rawSocket) => {
    try {
      console.log("before create");
      const secureSocket = new tls.TLSSocket(rawSocket, {
        key,
        cert,
        isServer: true,
      });

      secureSocket.on("secureConnect", () => {
        console.log("secure socket on secureConnect");
        secureSocket.write("hello from server");
      });

      secureSocket.on("data", (data) => {
        console.log(
          "secure socket on data",
          data.byteLength,
          data.toString(),
        );
        assertEquals(data.toString(), "hello from client");
        secureSocket.end();
      });

      secureSocket.on("close", () => {
        console.log("secure socket on close");
        resolveTestComplete();
      });

      secureSocket.on("error", (err) => {
        console.log("secure socket on error");
        serverError = err;
        resolveTestComplete();
      });
    } catch (err) {
      serverError = err;
      resolveTestComplete();
    }
  });

  netServer.on("error", (err) => {
    serverError = err;
    resolveTestComplete();
  });

  netServer.listen(socketPath, () => {
    resolveServerReady();
  });
  console.log("before server ready");
  await serverReady;
  console.log("after server ready");
  try {
    const rawSocket = net.connect(socketPath);

    const secureSocket = tls.connect({
      socket: rawSocket,
      rejectUnauthorized: false,
    });

    rawSocket.on("error", (err) => {
      console.log("raw socket on err", err);
      clientError = err;
      resolveTestComplete();
    });

    secureSocket.on("secureConnect", () => {
      console.log("secure socket on secureConnect");
      secureSocket.write("hello from client");
    });

    secureSocket.on("data", (data) => {
      console.log("secure socket on data");
      resolveClientDataReceived(data.toString());
    });

    secureSocket.on("error", (err) => {
      console.log("secure socket on error");
      clientError = err;
      resolveTestComplete();
    });

    console.log("before client data received");
    const receivedData = await clientDataReceived;
    console.log("after client data received");
    assertEquals(receivedData, "hello from server");
    console.log("before test complete");
    await testComplete;
    console.log("after test complete");
    if (serverError) {
      console.error("Server error:", serverError);
    }
    if (clientError) {
      console.error("Client error:", clientError);
    }

    secureSocket.destroy();
  } catch (err) {
    clientError = err;
    console.error("Test setup error:", err);
  }

  netServer.close();

  try {
    await Deno.remove(socketPath);
  } catch {
    // pass
  }
});
