// deploy/aws-provision.sh against a fake AWS CLI (deploy/tests/fake-aws/aws): no network, no account.
// Run: node --test deploy/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "aws-provision.sh");
const FAKE_BIN = join(here, "fake-aws");
chmodSync(join(FAKE_BIN, "aws"), 0o755);

// A Free-plan account with nothing provisioned yet. Values are what `--output text` prints.
const FRESH_ACCOUNT = {
  "freetier_get-account-plan-state": "FREE\tACTIVE\t142.5\t2027-05-01T00:00:00+00:00",
  "ec2_describe-instance-types": "True\tarm64",
  "ec2_describe-instances": "None",
  "ec2_describe-key-pairs": { exit: 254 },
  "ec2_create-key-pair": "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
  "ec2_describe-security-groups": "None",
  "ec2_create-security-group": "sg-0new",
  "ssm_get-parameter": "ami-0ubuntu",
  "ec2_run-instances": "i-0new",
  "ec2_describe-addresses": "None",
  "ec2_allocate-address": "eipalloc-0new\t198.51.100.4",
  "sts_get-caller-identity": "323036354551",
  "budgets_describe-budget": { exit: 254 },
};

function provision(overrides = {}, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aws-provision-"));
  for (const [key, value] of Object.entries({ ...FRESH_ACCOUNT, ...overrides })) {
    if (value === undefined) continue;
    const { out = "", exit } = typeof value === "string" ? { out: value } : value;
    writeFileSync(join(dir, `${key}.out`), out ? `${out}\n` : "");
    if (exit !== undefined) writeFileSync(join(dir, `${key}.exit`), String(exit));
  }
  const keyFile = join(dir, "squat-overflow.pem");
  const result = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: `${FAKE_BIN}:/usr/bin:/bin`,
      HOME: dir,
      FAKE_AWS_DIR: dir,
      AWS_REGION: "eu-central-1",
      MY_IP: "203.0.113.7",
      KEY_FILE: keyFile,
      BUDGET_EMAIL: "ops@example.com",
      ...env,
    },
  });
  const log = join(dir, "calls.log");
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  assert.ok(!calls.some((c) => c.includes("upgrade-account-plan")), "must never upgrade the account plan");
  return { ...result, calls, keyFile, output: result.stdout + result.stderr };
}

const called = (calls, prefix) => calls.filter((c) => c.startsWith(prefix));

test("stops before creating anything when the Free plan has expired", () => {
  const r = provision({ "freetier_get-account-plan-state": "FREE\tEXPIRED\t0\t2026-10-01T00:00:00+00:00" });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /Free plan.*EXPIRED/i);
  assert.deepEqual(called(r.calls, "ec2 run-instances"), []);
  assert.deepEqual(called(r.calls, "ec2 create-"), []);
});

test("refuses an instance type that is not Free tier eligible", () => {
  const r = provision({ "ec2_describe-instance-types": "False\tx86_64" }, { INSTANCE_TYPE: "m5.large" });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /m5\.large is not Free tier eligible/);
  assert.equal(called(r.calls, "ec2 describe-instance-types --instance-types m5.large").length, 1);
  assert.deepEqual(called(r.calls, "ec2 run-instances"), []);
});

test("launches t4g.small with 20 GB gp3, the Name tag and SSH open only to my IP on a fresh account", () => {
  const r = provision();
  assert.equal(r.status, 0, r.output);

  assert.match(called(r.calls, "ssm get-parameter")[0], /ubuntu\/server\/24\.04\/stable\/current\/arm64\//);

  const [ingress, ...more] = called(r.calls, "ec2 authorize-security-group-ingress");
  assert.equal(more.length, 0);
  assert.match(ingress, /--group-id sg-0new/);
  assert.match(ingress, /FromPort=22,ToPort=22,IpRanges=\[\{CidrIp=203\.0\.113\.7\/32\}\]/);
  assert.match(ingress, /FromPort=80,ToPort=80,IpRanges=\[\{CidrIp=0\.0\.0\.0\/0\}\]/);
  assert.match(ingress, /FromPort=443,ToPort=443,IpRanges=\[\{CidrIp=0\.0\.0\.0\/0\}\]/);

  const runs = called(r.calls, "ec2 run-instances");
  assert.equal(runs.length, 1);
  for (const part of [
    "--instance-type t4g.small",
    "--image-id ami-0ubuntu",
    "--key-name squat-overflow",
    "--security-group-ids sg-0new",
    "VolumeSize=20,VolumeType=gp3",
    "Key=Name,Value=squat-overflow-pose",
    // T instances default to "unlimited" credits, billed when the CPU bursts past baseline.
    "--credit-specification CpuCredits=standard",
  ]) {
    assert.ok(runs[0].includes(part), `run-instances is missing ${part}: ${runs[0]}`);
  }

  assert.match(readFileSync(r.keyFile, "utf8"), /BEGIN RSA PRIVATE KEY/);
  assert.equal(statSync(r.keyFile).mode & 0o777, 0o600);
});

test("reuses the tagged instance instead of launching a second one", () => {
  const r = provision({
    "ec2_describe-instances": "i-0old",
    "ec2_describe-key-pairs": "key-0old",
    "ec2_describe-security-groups": "sg-0old",
  });
  assert.equal(r.status, 0, r.output);
  const [lookup] = called(r.calls, "ec2 describe-instances");
  assert.match(lookup, /Name=tag:Name,Values=squat-overflow-pose/);
  assert.match(lookup, /Name=instance-state-name,Values=pending,running,stopping,stopped/);
  assert.deepEqual(called(r.calls, "ec2 run-instances"), []);
  assert.deepEqual(called(r.calls, "ec2 create-"), []);
  assert.match(r.output, /Using existing instance i-0old/);
});

test("allocates a tagged Elastic IP and attaches it to a new instance", () => {
  const r = provision();
  assert.equal(r.status, 0, r.output);
  const [allocate, ...more] = called(r.calls, "ec2 allocate-address");
  assert.equal(more.length, 0);
  assert.match(allocate, /ResourceType=elastic-ip,Tags=\[\{Key=Name,Value=squat-overflow-pose\}\]/);
  const [associate] = called(r.calls, "ec2 associate-address");
  assert.match(associate, /--allocation-id eipalloc-0new/);
  assert.match(associate, /--instance-id i-0new/);
  assert.match(r.output, /198\.51\.100\.4/);
});

test("keeps the Elastic IP that is already attached", () => {
  const r = provision({
    "ec2_describe-instances": "i-0old",
    "ec2_describe-addresses": "eipalloc-0old\t198.51.100.9\ti-0old",
  });
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(called(r.calls, "ec2 allocate-address"), []);
  assert.deepEqual(called(r.calls, "ec2 associate-address"), []);
  assert.match(r.output, /198\.51\.100\.9/);
});

test("creates the $25 monthly budget alert, emailed to BUDGET_EMAIL, when it is missing", () => {
  const r = provision();
  assert.equal(r.status, 0, r.output);
  const [create, ...more] = called(r.calls, "budgets create-budget");
  assert.equal(more.length, 0);
  assert.match(create, /--account-id 323036354551/);
  assert.match(create, /BudgetName=squat-overflow-monthly,BudgetLimit=\{Amount=25,Unit=USD\},TimeUnit=MONTHLY,BudgetType=COST/);
  assert.match(create, /Address=ops@example\.com/);
  // The alert exists before anything that costs money.
  assert.ok(r.calls.indexOf(create) < r.calls.findIndex((c) => c.startsWith("ec2 run-instances")));
});

test("needs BUDGET_EMAIL before creating anything when there is no budget yet", () => {
  const r = provision({}, { BUDGET_EMAIL: "" });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /BUDGET_EMAIL/);
  assert.deepEqual(called(r.calls, "ec2 create-"), []);
  assert.deepEqual(called(r.calls, "ec2 run-instances"), []);
});

test("leaves an existing budget alone and then needs no BUDGET_EMAIL", () => {
  const r = provision({ "budgets_describe-budget": "squat-overflow-monthly" }, { BUDGET_EMAIL: "" });
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(called(r.calls, "budgets create-budget"), []);
});

test("takes the region from the CLI profile when AWS_REGION is not set", () => {
  const r = provision(
    { "configure_get": "eu-central-1", "ec2_describe-instance-types": "False\tx86_64" },
    { AWS_REGION: undefined, INSTANCE_TYPE: "m5.large" },
  );
  assert.match(r.output, /m5\.large is not Free tier eligible in eu-central-1/);
});

// CLAUDE.md: the account stays on the Free plan. Scan everything that can run against AWS.
test("nothing in the repository upgrades the AWS account plan", () => {
  const root = join(here, "..", "..");
  const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard",
    "deploy", "scripts", ".github", "server/src", "server/scripts"], { cwd: root, encoding: "utf8" })
    .stdout.split("\n")
    .filter((f) => f && !f.startsWith("deploy/tests/") && /\.(sh|m?js|ts|ya?ml|json)$|Dockerfile|Caddyfile/.test(f));
  assert.ok(files.includes("deploy/aws-provision.sh"));
  const offenders = files.filter((f) => /upgrade-account-plan|UpgradeAccountPlan/.test(readFileSync(join(root, f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("won't overwrite an existing key file when it creates the key pair", () => {
  const dir = mkdtempSync(join(tmpdir(), "aws-key-"));
  const keyFile = join(dir, "old.pem");
  writeFileSync(keyFile, "my old key");
  const r = provision({}, { KEY_FILE: keyFile });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /already exists/);
  assert.equal(readFileSync(keyFile, "utf8"), "my old key");
  assert.deepEqual(called(r.calls, "ec2 create-key-pair"), []);
  assert.deepEqual(called(r.calls, "ec2 run-instances"), []);
});

test("stops when an AWS lookup fails instead of creating a duplicate", () => {
  const r = provision({
    "ec2_describe-instances": "i-0old",
    "ec2_describe-key-pairs": "key-0old",
    "ec2_describe-security-groups": "sg-0old",
    "ec2_describe-addresses": { out: "", exit: 255 },
  });
  assert.notEqual(r.status, 0);
  assert.deepEqual(called(r.calls, "ec2 allocate-address"), []);
});

test("says to sign in when the Free plan lookup fails", () => {
  const r = provision({ "freetier_get-account-plan-state": { out: "", exit: 255 } });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /aws sso login --profile squat-overflow/);
  assert.deepEqual(called(r.calls, "ec2 "), []);
});
