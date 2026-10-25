resource "aws_db_subnet_group" "main" {
  name       = local.prefix
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.prefix}-pg17"
  family = "postgres17"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # log queries slower than 1 s
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
}

resource "aws_db_instance" "main" {
  identifier     = local.prefix
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  db_name  = "lms"
  username = "lms_owner"
  password = random_password.db_master.result

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_max_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = var.db_multi_az
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  backup_retention_period   = 14            # point-in-time restore to any second in the last 14 days
  backup_window             = "20:30-21:30" # 02:00-03:00 IST
  maintenance_window        = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.prefix}-final"

  auto_minor_version_upgrade            = true
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql"]
}
