resource "aws_sns_topic" "alarms" {
  name = "${local.prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    "alb-5xx" = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 20, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }, description = "More than 20 server errors in 5 minutes"
    }
    "api-unhealthy" = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }, description = "An API task is failing health checks"
    }
    "web-unhealthy" = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }, description = "A web task is failing health checks"
    }
    "db-cpu" = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, description = "Database CPU above 80%"
    }
    "db-storage" = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 2 * 1024 * 1024 * 1024, op = "LessThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, description = "Less than 2 GB of database storage left"
    }
    "db-memory" = {
      namespace = "AWS/RDS", metric = "FreeableMemory", stat = "Minimum", threshold = 128 * 1024 * 1024, op = "LessThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, description = "Database is low on memory"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${local.prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dims
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
