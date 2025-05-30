import { complex } from "./complex.ts";

Deno.test("complex", function () {
  complex("foo", "bar", "baz");
});

Deno.test("sub process with stdin", async () => {
  // ensure launching deno run with stdin doesn't affect coverage
  const code = "console.log('5')";
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-"],
    stdin: "piped",
    stdout: "piped",
  });
  await using child = command.spawn();
  await ReadableStream.from([code])
    .pipeThrough(new TextEncoderStream())
    .pipeTo(child.stdin);
  const { stdout } = await child.output();
  const output = new TextDecoder().decode(stdout);
  if (output.trim() !== "5") {
    throw new Error("Failed");
  }
});

Deno.test("sub process with deno eval", () => {
  // ensure launching deno eval doesn't affect coverage
  const code = "console.log('5')";
  const { stdout } = new Deno.Command(Deno.execPath(), {
    args: ["eval", code],
  }).outputSync();
  const output = new TextDecoder().decode(stdout);
  if (output.trim() !== "5") {
    throw new Error("Failed");
  }
});

Deno.test("DENO_COVERAGE_DIR is set and passed down to child process", () => {
  const coverageDir = Deno.env.get("DENO_COVERAGE_DIR");
  if (coverageDir === undefined) {
    throw new Error("DENO_COVERAGE_DIR is not set");
  }
  const code = "console.log(Deno.env.get('DENO_COVERAGE_DIR'))";
  const { stdout } = new Deno.Command(Deno.execPath(), {
    args: ["eval", code],
  }).outputSync();
  const output = new TextDecoder().decode(stdout);
  if (output.trim() !== coverageDir) {
    throw new Error("Failed");
  }
});
