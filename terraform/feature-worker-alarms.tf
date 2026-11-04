resource "aws_cloudwatch_metric_alarm" "feature_worker" {
  for_each            = var.feature_worker_enabled ? toset(["Errors", "Throttles", "DestinationDeliveryFailures", "AsyncEventsDropped"]) : toset([])
  alarm_name          = "${local.feature_name}-${lower(each.value)}"
  namespace           = "AWS/Lambda"
  metric_name         = each.value
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.feature_worker[0].function_name }
  alarm_actions       = sort(tolist(var.alarm_action_arns))
}

resource "aws_cloudwatch_metric_alarm" "feature_scheduler" {
  for_each            = var.feature_worker_enabled ? toset(["TargetErrorCount", "InvocationDroppedCount"]) : toset([])
  alarm_name          = "${local.feature_name}-schedule-${lower(each.value)}"
  namespace           = "AWS/Scheduler"
  metric_name         = each.value
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  dimensions          = { ScheduleGroup = aws_scheduler_schedule_group.feature_worker[0].name }
  alarm_actions       = sort(tolist(var.alarm_action_arns))
}

resource "aws_cloudwatch_metric_alarm" "feature_failures" {
  count               = var.feature_worker_enabled ? 1 : 0
  alarm_name          = "${local.feature_name}-queued-failures"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.feature_failures[0].name }
  alarm_actions       = sort(tolist(var.alarm_action_arns))
}
