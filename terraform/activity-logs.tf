resource "aws_cloudwatch_log_group" "activity_api" {
  name              = "/aws/lambda/${local.activity_name}"
  retention_in_days = 7
}

# No access-log body dumps, SQL logs, or API credentials are configured here.
resource "aws_cloudwatch_metric_alarm" "activity_api" {
  for_each = var.activity_api_enabled ? toset(["Errors", "Throttles"]) : toset([])

  alarm_name          = "${local.activity_name}-${lower(each.value)}"
  alarm_description   = "Activity API ${each.value} detected; inspect redacted service errors"
  namespace           = "AWS/Lambda"
  metric_name         = each.value
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.activity_api[0].function_name }
  alarm_actions       = sort(tolist(var.alarm_action_arns))
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${var.db_identifier}-low-free-storage"
  alarm_description   = "RDS has less than 1 GiB of free storage; storage autoscaling is disabled"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 1073741824
  treat_missing_data  = "missing"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.database.identifier }
  alarm_actions       = sort(tolist(var.alarm_action_arns))
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  alarm_name          = "${var.db_identifier}-high-connections"
  alarm_description   = "RDS connection use exceeds the initial micro-instance service budget"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 40
  treat_missing_data  = "missing"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.database.identifier }
  alarm_actions       = sort(tolist(var.alarm_action_arns))
}
