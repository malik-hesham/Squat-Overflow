#!/usr/bin/env bash
# Creates the AWS side of the single-host deploy (docs/aws-free-plan.md) with the AWS CLI.
# The account is on the Free plan and stays there (CLAUDE.md): this script never upgrades it.
#
#   aws sso login --profile squat-overflow
#   BUDGET_EMAIL=you@example.com bash deploy/aws-provision.sh
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-squat-overflow}"
AWS_REGION="${AWS_REGION:-$(aws configure get region || true)}"
export AWS_REGION
NAME=squat-overflow-pose
KEY_NAME=squat-overflow
KEY_FILE="${KEY_FILE:-$HOME/.ssh/squat-overflow.pem}"

die() { echo "error: $*" >&2; exit 1; }
# --output text prints "None" for a query that matched nothing.
missing() { [ -z "$1" ] || [ "$1" = "None" ]; }

# Every lookup is captured with $(...) so that a failed aws call stops the script (set -e) instead
# of reading as "not there yet" and creating a duplicate that costs money.

# The Free plan API lives in us-east-1 whatever region the server runs in.
plan=$(aws freetier get-account-plan-state --region us-east-1 --output text \
  --query '[accountPlanType, accountPlanStatus, accountPlanRemainingCredits.amount, accountPlanExpirationDate]') ||
  die "can't read the account plan. Sign in first: aws sso login --profile $AWS_PROFILE"
read -r plan_type plan_status credits expires <<<"$plan"
echo "Account plan: $plan_type $plan_status, \$$credits credits left, ends $expires"
[ "$plan_status" = "ACTIVE" ] || die "the Free plan is $plan_status; the account can't run the server (and we don't upgrade it)."

# Only instance types the Free plan offers. t4g.small (2 GB) leaves room for the image build next
# to Postgres; the server no longer runs a pose model, so this is the same cost as before, not more.
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
type_info=$(aws ec2 describe-instance-types --instance-types "$INSTANCE_TYPE" --output text \
  --query 'InstanceTypes[0].[FreeTierEligible, ProcessorInfo.SupportedArchitectures[0]]')
read -r eligible arch <<<"$type_info"
[ "$eligible" = "True" ] || die "$INSTANCE_TYPE is not Free tier eligible in $AWS_REGION. Try t4g.small or t3.small."

# Budget alert first, before anything that costs money: email at 80% of $25 spent and when the
# month is forecast to pass $25. Free for the first two budgets.
BUDGET=squat-overflow-monthly
account=$(aws sts get-caller-identity --query Account --output text)
if ! aws budgets describe-budget --account-id "$account" --budget-name "$BUDGET" >/dev/null 2>&1; then
  [ -n "${BUDGET_EMAIL:-}" ] || die "set BUDGET_EMAIL to the address that gets the \$25/month budget alert."
  aws budgets create-budget --account-id "$account" \
    --budget "BudgetName=$BUDGET,BudgetLimit={Amount=25,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST" \
    --notifications-with-subscribers \
    "Notification={NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=80,ThresholdType=PERCENTAGE},Subscribers=[{SubscriptionType=EMAIL,Address=$BUDGET_EMAIL}]" \
    "Notification={NotificationType=FORECASTED,ComparisonOperator=GREATER_THAN,Threshold=100,ThresholdType=PERCENTAGE},Subscribers=[{SubscriptionType=EMAIL,Address=$BUDGET_EMAIL}]"
  echo "Created budget $BUDGET (\$25/month, alerts to $BUDGET_EMAIL)"
fi

# SSH key pair. AWS keeps only the public half, so the .pem is saved once, here.
if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  [ ! -e "$KEY_FILE" ] || die "$KEY_FILE already exists. Move it away or set KEY_FILE to a new path."
  mkdir -p "$(dirname "$KEY_FILE")"
  (umask 077 && aws ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text >"$KEY_FILE")
  chmod 600 "$KEY_FILE"
  echo "Created key pair $KEY_NAME, saved to $KEY_FILE"
fi

# Security group in the default VPC: SSH from this machine only, HTTP/HTTPS for Caddy.
sg=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" \
  --query 'SecurityGroups[0].GroupId' --output text)
if missing "$sg"; then
  MY_IP="${MY_IP:-$(curl -fsS https://checkip.amazonaws.com)}"
  sg=$(aws ec2 create-security-group --group-name "$NAME" \
    --description "Squat Overflow pose server: SSH from admin, HTTP/HTTPS" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$sg" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MY_IP/32}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" >/dev/null
  echo "Created security group $sg (SSH from $MY_IP)"
fi

# One instance, found by its Name tag, so running this again changes nothing.
instance=$(aws ec2 describe-instances --output text --query 'Reservations[0].Instances[0].InstanceId' \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped")
if ! missing "$instance"; then
  echo "Using existing instance $instance"
else
  # Ubuntu 24.04 LTS for the instance type's architecture, from Canonical's public SSM parameters.
  [ "$arch" = "arm64" ] && ubuntu_arch=arm64 || ubuntu_arch=amd64
  ami=$(aws ssm get-parameter --output text --query Parameter.Value \
    --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/$ubuntu_arch/hvm/ebs-gp3/ami-id")

  # CpuCredits=standard: T instances default to "unlimited", which bills for bursting past baseline.
  instance=$(aws ec2 run-instances --instance-type "$INSTANCE_TYPE" --image-id "$ami" \
    --key-name "$KEY_NAME" --security-group-ids "$sg" \
    --credit-specification CpuCredits=standard \
    --metadata-options HttpTokens=required \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)
  echo "Launched $INSTANCE_TYPE instance $instance"
  aws ec2 wait instance-running --instance-ids "$instance"
fi

# Elastic IP, so the address (and the DNS A record) survives stop/start. About $3.60/month, like
# every public IPv4 address; release it if the instance goes away, an idle one is still billed.
address=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" --output text \
  --query 'Addresses[0].[AllocationId, PublicIp, InstanceId]')
read -r allocation ip attached_to <<<"$address"
if missing "$allocation"; then
  address=$(aws ec2 allocate-address --domain vpc --output text --query '[AllocationId, PublicIp]' \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]")
  read -r allocation ip <<<"$address"
  attached_to=None
  echo "Allocated Elastic IP $ip"
fi
if [ "$attached_to" != "$instance" ]; then
  aws ec2 associate-address --allocation-id "$allocation" --instance-id "$instance" >/dev/null
  echo "Attached $ip to $instance"
fi

cat <<NEXT

Instance $instance ($INSTANCE_TYPE) is at Elastic IP $ip.
Next (docs/aws-free-plan.md, steps 1 and 3):
  1. At your DNS provider, point an A record for the server's hostname at $ip.
  2. ssh -i $KEY_FILE ubuntu@$ip
     git clone <repository URL> squat-overflow && bash squat-overflow/deploy/ec2-setup.sh
  3. Log back in, fill in deploy/.env, then: VERSION=<tag> docker compose up -d --build
NEXT
