output "deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN variable in GitHub (Settings → Secrets and variables → Actions → Variables)."
  value       = aws_iam_role.deploy.arn
}

output "platform_url" {
  value = "https://${var.domain_name}"
}

output "api_url" {
  description = "Razorpay webhook URL: <api_url>/webhooks/razorpay"
  value       = "https://${local.api_host}"
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}

output "razorpay_secret_name" {
  description = "Put your Razorpay keys here (Secrets Manager console)."
  value       = aws_secretsmanager_secret.razorpay.name
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "private_subnets" {
  value = aws_subnet.private[*].id
}

output "api_security_group" {
  value = aws_security_group.api.id
}
