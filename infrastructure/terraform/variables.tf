variable "name" {
  description = "Short name used in resource names."
  type        = string
  default     = "lms"
}

variable "environment" {
  description = "production, staging, …"
  type        = string
  default     = "production"
}

variable "region" {
  description = "AWS region. Mumbai keeps student data in India."
  type        = string
  default     = "ap-south-1"
}

variable "domain_name" {
  description = "Platform domain, e.g. yourplatform.in. Institutes get <slug>.<domain>. Its Route 53 hosted zone must already exist."
  type        = string
}

variable "github_repository" {
  description = "owner/repo allowed to deploy through GitHub Actions (OIDC)."
  type        = string
}

variable "alarm_email" {
  description = "Where CloudWatch alarms are emailed (confirm the subscription email AWS sends)."
  type        = string
}

variable "mail_from" {
  description = "Sender for platform emails. Must be on domain_name (verified in SES by this config)."
  type        = string
  default     = ""
}

variable "db_instance_class" {
  description = "RDS size. db.t4g.small is fine for a pilot; scale up as institutes join."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_max_storage_gb" {
  description = "Storage autoscaling ceiling."
  type        = number
  default     = 200
}

variable "db_multi_az" {
  description = "Standby in a second AZ (roughly doubles the database cost). Turn on before relying on it for many institutes."
  type        = bool
  default     = false
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "image_tag" {
  description = "Image tag the task definitions start with. Deploys from GitHub Actions replace it with the commit SHA."
  type        = string
  default     = "latest"
}

variable "max_upload_mb" {
  type    = number
  default = 500
}

variable "log_retention_days" {
  description = "CERT-In directions ask for 180 days of logs kept in India."
  type        = number
  default     = 180
}

variable "waf_rate_limit_per_5min" {
  description = "Requests per IP per 5 minutes before WAF blocks. Whole schools can share one IP, so keep it generous."
  type        = number
  default     = 3000
}
