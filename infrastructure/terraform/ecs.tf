resource "aws_ecs_cluster" "main" {
  name = local.prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "web", "migrate"])
  name              = "/ecs/${local.prefix}/${each.key}"
  retention_in_days = var.log_retention_days
}

# The web tasks reach the API privately at api.<name>.internal:4000.
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = local.internal_ns
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  # ECS reports task health to Cloud Map; unhealthy tasks drop out of DNS.
  health_check_custom_config {}
}

locals {
  mail_from = var.mail_from != "" ? var.mail_from : "Coaching LMS <no-reply@${var.domain_name}>"

  api_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(local.api_port) },
    { name = "PLATFORM_HOST", value = var.domain_name },
    { name = "APP_URL_TEMPLATE", value = "https://{slug}.${var.domain_name}" },
    { name = "PLATFORM_URL", value = "https://${var.domain_name}" },
    { name = "CORS_ORIGINS", value = "https://${var.domain_name}" },
    { name = "MAIL_FROM", value = local.mail_from },
    { name = "STORAGE_DRIVER", value = "s3" },
    { name = "S3_BUCKET", value = aws_s3_bucket.files.bucket },
    { name = "S3_REGION", value = var.region },
    { name = "MAX_UPLOAD_MB", value = tostring(var.max_upload_mb) },
  ]

  # name → JSON key in a Secrets Manager secret
  api_secrets = concat(
    [for k in ["DATABASE_URL", "DATABASE_URL_PLATFORM", "JWT_SECRET", "ENCRYPTION_KEY", "SMTP_URL"] :
    { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [for k in ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] :
    { name = k, valueFrom = "${aws_secretsmanager_secret.razorpay.arn}:${k}::" }],
  )

  log_config = { for k, g in aws_cloudwatch_log_group.app : k => {
    logDriver = "awslogs"
    options   = { "awslogs-group" = g.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = k }
  } }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "api"
    image                  = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
    essential              = true
    portMappings           = [{ containerPort = local.api_port, protocol = "tcp" }]
    environment            = local.api_environment
    secrets                = local.api_secrets
    logConfiguration       = local.log_config["api"]
    readonlyRootFilesystem = false
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:${local.api_port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

# Release step: migrations + row-level security + role passwords (packages/db/scripts/migrate.mjs).
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  container_definitions = jsonencode([{
    name             = "migrate"
    image            = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
    essential        = true
    command          = ["node", "node_modules/@lms/db/scripts/migrate.mjs"]
    logConfiguration = local.log_config["migrate"]
    secrets = [for k in ["DATABASE_URL_MIGRATE", "LMS_APP_PASSWORD", "LMS_PLATFORM_PASSWORD"] :
    { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }]
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "web"
    image        = "${aws_ecr_repository.app["web"].repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = local.web_port, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(local.web_port) },
      { name = "API_URL", value = "http://api.${local.internal_ns}:${local.api_port}" },
      { name = "PLATFORM_HOST", value = var.domain_name },
    ]
    logConfiguration = local.log_config["web"]
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = local.api_port
  }
  service_registries {
    registry_arn = aws_service_discovery_service.api.arn
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  # Deploys from GitHub Actions register new task definitions; Terraform shouldn't undo them.
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "web" {
  name                              = "web"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.web.arn
  desired_count                     = var.web_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = local.web_port
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.https]
}

# Everything the deploy workflow needs, in one place, so GitHub only needs the role ARN.
resource "aws_ssm_parameter" "deploy_config" {
  name = "/${local.prefix}/deploy-config"
  type = "String"
  value = jsonencode({
    cluster         = aws_ecs_cluster.main.name
    apiService      = aws_ecs_service.api.name
    webService      = aws_ecs_service.web.name
    apiTaskFamily   = aws_ecs_task_definition.api.family
    webTaskFamily   = aws_ecs_task_definition.web.family
    migrateFamily   = aws_ecs_task_definition.migrate.family
    apiRepository   = aws_ecr_repository.app["api"].repository_url
    webRepository   = aws_ecr_repository.app["web"].repository_url
    subnets         = aws_subnet.private[*].id
    securityGroup   = aws_security_group.api.id
    migrateLogGroup = aws_cloudwatch_log_group.app["migrate"].name
  })
}
