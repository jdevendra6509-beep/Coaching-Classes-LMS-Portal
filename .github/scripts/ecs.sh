# Helpers for .github/workflows/deploy.yml. Expects deploy-config.json in the working directory.
set -euo pipefail

cfg() { jq -r ".$1" deploy-config.json; }

# Copies the latest revision of a task definition family with a new image; prints the new ARN.
register_with_image() {
  aws ecs describe-task-definition --task-definition "$1" --query taskDefinition --output json \
    | jq --arg image "$2" '.containerDefinitions[0].image = $image
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
    > taskdef.json
  aws ecs register-task-definition --cli-input-json file://taskdef.json \
    --query taskDefinition.taskDefinitionArn --output text
}

# Rolls a service onto a new image and waits until it is stable. A deployment that can't
# get healthy is rolled back by ECS (circuit breaker), and this step then fails.
deploy_service() {
  local arn
  arn=$(register_with_image "$2" "$3")
  echo "Deploying $1 → $arn"
  aws ecs update-service --cluster "$(cfg cluster)" --service "$1" --task-definition "$arn" > /dev/null
  aws ecs wait services-stable --cluster "$(cfg cluster)" --services "$1"
  local running
  running=$(aws ecs describe-services --cluster "$(cfg cluster)" --services "$1" \
    --query 'services[0].deployments[?status==`PRIMARY`].taskDefinition | [0]' --output text)
  if [ "$running" != "$arn" ]; then
    echo "::error::$1 rolled back to $running"
    exit 1
  fi
}
