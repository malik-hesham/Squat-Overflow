// Cross-device check (run.mjs starts this): the real API server (server/dist) on 127.0.0.1:18765
// with a real Postgres (XD_DATABASE_URL). Only Google's key check is replaced, by a local test key,
// so each client gets a real session from the server's own /auth/google, written to
// <out dir>/session-<device>.json. All three sessions are the same test account.
//   node api.mjs <server dir> <out dir>
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [serverDir, outDir] = process.argv.slice(2);
const require = createRequire(join(serverDir, "package.json"));
const CLIENT_ID = "xd-test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
process.env.AUTH_JWT_SECRET = "xd-test-secret-at-least-32-bytes-long!!";
process.env.DATABASE_URL = process.env.XD_DATABASE_URL;

const { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } = await import(require.resolve("jose"));
const { Test } = require("@nestjs/testing");
const { AppModule } = require(join(serverDir, "dist/app.module.js"));
const { GOOGLE_KEYS } = require(join(serverDir, "dist/auth/auth.module.js"));
const { configureApp } = require(join(serverDir, "dist/main.js"));

const { publicKey, privateKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_KEYS).useValue(keys).compile();
const app = configureApp(moduleRef.createNestApplication({ logger: ["error", "warn"] }));
await app.listen(18765, "127.0.0.1");

const NONCE = "xd-raw-nonce";
for (const device of ["chrome", "phone", "mac"]) {
  const idToken = await new SignJWT({
    email: "cross.device@squat-test.dev",
    email_verified: true,
    name: "Cross Device",
    nonce: createHash("sha256").update(NONCE).digest("hex"),
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("xd-google-sub")
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  const res = await fetch("http://127.0.0.1:18765/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken, nonce: NONCE }),
  });
  if (res.status !== 200) throw new Error(`sign-in for ${device}: ${res.status} ${await res.text()}`);
  writeFileSync(join(outDir, `session-${device}.json`), JSON.stringify(await res.json()));
}
console.log("api up on 127.0.0.1:18765; sessions written");
