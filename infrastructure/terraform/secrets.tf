# Everything secret is generated here and stored in Secrets Manager; ECS injects it into the
# containers at start-up. Nothing secret is baked into images or GitHub.
# Note: these values are also in the Terraform state, which is why the state bucket is private
# and encrypted (docs/DEPLOYMENT.md).

resource "random_password" "db_master" {
  length  = 40
  special = false
}

resource "random_password" "db_app" {
  length  = 40
  special = false
}

resource "random_password" "db_platform" {
  length  = 40
  special = false
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_bytes" "encryption_key" {
  length = 32
}

locals {
  db_host = aws_db_instance.main.address
  db_url  = "${local.db_host}:5432/${aws_db_instance.main.db_name}?sslmode=require"
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.prefix}/app"
  description             = "API runtime secrets (database URLs, signing and encryption keys, SMTP)"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL          = "postgresql://lms_app:${random_password.db_app.result}@${local.db_url}"
    DATABASE_URL_PLATFORM = "postgresql://lms_platform:${random_password.db_platform.result}@${local.db_url}"
    DATABASE_URL_MIGRATE  = "postgresql://${aws_db_instance.main.username}:${random_password.db_master.result}@${local.db_url}"
    LMS_APP_PASSWORD      = random_password.db_app.result
    LMS_PLATFORM_PASSWORD = random_password.db_platform.result
    JWT_SECRET            = random_password.jwt.result
    ENCRYPTION_KEY        = random_bytes.encryption_key.base64
    SMTP_URL              = "smtps://${aws_iam_access_key.ses_smtp.id}:${urlencode(aws_iam_access_key.ses_smtp.ses_smtp_password_v4)}@email-smtp.${var.region}.amazonaws.com:465"
  })
}

# Razorpay keys come from your Razorpay dashboard. Terraform creates the secret with placeholders;
# set the real values in the AWS console (Secrets Manager) and Terraform will leave them alone.
resource "aws_secretsmanager_secret" "razorpay" {
  name                    = "${local.prefix}/razorpay"
  description             = "Razorpay API keys and webhook secret (set in the console)"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "razorpay" {
  secret_id = aws_secretsmanager_secret.razorpay.id
  secret_string = jsonencode({
    RAZORPAY_KEY_ID         = "rzp_live_REPLACE_ME"
    RAZORPAY_KEY_SECRET     = "REPLACE_ME"
    RAZORPAY_WEBHOOK_SECRET = "REPLACE_ME"
  })
  lifecycle {
    ignore_changes = [secret_string]
  }
}
