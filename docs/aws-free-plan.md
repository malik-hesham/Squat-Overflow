# Running the pose server on the AWS Free plan

This guide runs the pose server, its Postgres database and HTTPS on **one EC2 instance**, from [`deploy/`](../deploy). Everything else (releases, the Chrome Web Store, migrations) is in [deployment.md](deployment.md).

```
extension ── wss://<DOMAIN>/ws, https://<DOMAIN> ──▶ EC2 instance (Elastic IP)
                                                      ├─ caddy  :80/:443  Let's Encrypt TLS → pose:8080
                                                      ├─ pose   server/Dockerfile (NestJS + BlazePose)
                                                      └─ db     postgres:17, volume pgdata
```

## What the Free plan covers

AWS accounts on the **Free plan** get $100 in credits, plus up to $100 more for sign-up activities (launching EC2, creating a budget, …). The plan ends after **6 months or when the credits run out**, whichever comes first, and the account then closes unless you upgrade to the Paid plan. Check your own credit balance and end date under **Billing and Cost Management → Credits**.

| Item | Choice | About per month |
|------|--------|-----------------|
| Instance | `t4g.small` (2 vCPU burstable, 2 GB, ARM) | $12–14 |
| Public IP | Elastic IP (AWS charges for every public IPv4 address) | $3.60 |
| Disk | 20 GB gp3 | $2 |
| TLS, database | Caddy and Postgres on the same instance | $0 |
| **Total** | | **~$20** |

These are estimates; check them in the [AWS Pricing Calculator](https://calculator.aws/) for your region. There is no load balancer (~$18/month) and no RDS (~$15/month); together they would use up $100 of credits in about two months.

> **Before month 6**, upgrade the account to the Paid plan or move the server (see [Moving off the instance](#moving-off-the-instance)). Store builds of the extension have the server's hostname built in, so if the account closes, every installed extension shows "offline".

**Capacity:** every open break holds one WebSocket and one BlazePose detector. On this instance, plan for **2–4 breaks at the same time**, not the 4–6 of a dedicated 2 GB machine, because the CPU is burstable and Postgres shares the memory. `FORMCOACH_MAX_SESSIONS` in `.env` (3 by default here) enforces that: past it, new clients are closed with "server busy" and the break page shows "Coach busy". Raise it only if `latency_ms` in frame results stays low with that many breaks running.

## 1. Choose a hostname

Caddy needs a DNS name for the certificate, and the store build of the extension points at that name. **Use a domain you control** (e.g. `pose.yourcompany.com`). When the server moves later, you change one DNS record and installed extensions keep working with no store update. A name tied to the instance's IP can't move.

## 2. Launch the instance

In the AWS console, in one region (e.g. **eu-central-1, Frankfurt**):

1. **EC2 → Launch instance**
   - AMI: **Ubuntu Server 24.04 LTS, 64-bit (Arm)**.
   - Instance type: **t4g.small**. Only types labeled *Free tier eligible* are offered on the Free plan. If `t4g.small` isn't one of them, use **t3.small** with the **64-bit (x86)** Ubuntu AMI. `t3.micro` (1 GB) is too small for BlazePose.
   - Key pair: create one and keep the `.pem` file.
   - Network: create a security group allowing **SSH (22) from My IP**, **HTTP (80)** and **HTTPS (443)** from anywhere.
   - Storage: **20 GB gp3**.
2. **EC2 → Elastic IPs → Allocate**, then **Associate** it with the instance. The address then survives stop/start.
3. At your DNS provider, add an **A record** from your hostname to the Elastic IP.
4. **Billing → Budgets → Create budget**: a monthly cost budget (e.g. $25) with an email alert. Creating one also earns Free-plan bonus credits.

## 3. Install and start

```bash
ssh -i <key>.pem ubuntu@<elastic-ip>
git clone <this repository's URL> squat-overflow   # a private repo needs a deploy key or token
cd squat-overflow
bash deploy/ec2-setup.sh                           # 2 GB swap + Docker with the Compose plugin
exit                                               # log back in so docker works without sudo
```

```bash
ssh -i <key>.pem ubuntu@<elastic-ip>
cd squat-overflow/deploy
cp .env.example .env
nano .env                                          # DOMAIN, ACME_EMAIL, AUTH_JWT_SECRET, POSTGRES_PASSWORD
VERSION=v0.4.0 docker compose up -d --build        # first build takes a few minutes
```

Generate `AUTH_JWT_SECRET` and `POSTGRES_PASSWORD` with `openssl rand -hex 32` (hex keeps the password safe inside `DATABASE_URL`). The `.env` variables are described in [`deploy/.env.example`](../deploy/.env.example) and [deployment.md](deployment.md#running-the-pose-server).

Check it from your own machine:

```bash
curl https://<DOMAIN>/health
```

`version` should be the `VERSION` you built. Also open `https://<DOMAIN>/privacy`. If HTTPS fails, run `docker compose logs caddy`: the A record must point at the Elastic IP and port 80 must be open before Caddy can get a certificate.

Then point the extension at `wss://<DOMAIN>/ws`: follow [One-time setup → 1](deployment.md#1-point-the-extension-at-your-server) in deployment.md.

## Updating

Deploy the server before tagging an extension release that needs its new behaviour.

```bash
cd ~/squat-overflow
git fetch --tags && git checkout v0.5.0
cd deploy
VERSION=v0.5.0 docker compose up -d --build
docker image prune -f                              # optional; keeps tagged versions for rollback
```

The new image builds while the old container keeps serving. Breaks open at the moment the container is swapped are cut off.

To change a `.env` value (e.g. adding the store extension ID to `FORMCOACH_ALLOWED_ORIGINS`), edit `.env` and run `VERSION=<current> docker compose up -d`.

## Rollback

Each version is kept as a local image (`squat-overflow-pose:<VERSION>`), so going back needs no rebuild:

```bash
cd ~/squat-overflow/deploy
docker image ls squat-overflow-pose
VERSION=v0.4.0 docker compose up -d --no-build pose
```

Database changes are never rolled back by an older image; see [Rollback](deployment.md#rollback) in deployment.md.

## Backups

The database lives in the `pgdata` Docker volume on the instance's disk. If the instance or its disk is lost, accounts, the leaderboard and sync data go with it. Dump it regularly and copy the file somewhere off the instance:

```bash
cd ~/squat-overflow/deploy
docker compose exec -T db pg_dump -U squat -Fc squat > ~/squat-$(date +%F).dump
```

From your machine: `scp -i <key>.pem ubuntu@<elastic-ip>:squat-*.dump .`

Restore into an empty database:

```bash
docker compose exec -T db pg_restore -U squat -d squat --clean --if-exists < squat-2026-11-09.dump
```

EBS snapshots (**EC2 → Volumes → Create snapshot**) back up the whole disk too, for a few cents per GB per month.

## Operating it

| Task | Command (in `~/squat-overflow/deploy`) |
|------|----------------------------------------|
| Status and health | `docker compose ps` |
| Server logs | `docker compose logs -f pose` |
| Memory use | `docker stats --no-stream` |
| Restart everything | `VERSION=<current> docker compose up -d` |
| Postgres shell | `docker compose exec db psql -U squat squat` |

All containers restart on their own after a crash or an instance reboot.

## Moving off the instance

To upgrade to a bigger host, a managed setup (ECS on Fargate + ALB + RDS) or another provider, before the Free plan ends:

1. Start the server on the new host with the same `AUTH_JWT_SECRET`, `GOOGLE_CLIENT_ID` and `FORMCOACH_ALLOWED_ORIGINS`, so users stay signed in.
2. Take a backup (above) and restore it into the new database.
3. Change the DNS A record to the new host. Installed extensions follow the hostname, so no store update is needed.
4. Once traffic has moved, stop the old instance and release its Elastic IP (an unattached Elastic IP is still charged).

## Known limits

- **One instance, no failover.** A reboot or deploy takes the server down for a few seconds to a minute.
- **Full means no coaching for that break.** At the session cap, the break page says "Coach busy" and the user does the moves without the camera. Extensions released before the busy message show "Coach offline" instead.
- **No per-IP limit.** The pose stream has no login, so a script that fakes the extension's Origin can fill every slot. Stock Caddy has no connection limit; a per-IP limit needs a Caddy plugin or a proxy in front.
- **SSH is the only deploy path.** The release workflow doesn't deploy the server.
