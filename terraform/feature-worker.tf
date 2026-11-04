variable "feature_worker_enabled" {
  description = "Enable the tested cloud feature worker with the same immutable release as the API."
  type        = bool
  default     = false
}

locals {
  feature_name              = "${substr(var.db_identifier, 0, 40)}-feature-worker"
  integration_secret_prefix = "${substr(var.db_identifier, 0, 40)}-integrations/"
  integration_secret_arn    = "arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${local.integration_secret_prefix}*"
}

resource "aws_cloudwatch_log_group" "feature_worker" {
  count             = var.feature_worker_enabled ? 1 : 0
  name              = "${local.feature_name}-logs"
  retention_in_days = 7
}

resource "aws_sqs_queue" "feature_failures" {
  count                     = var.feature_worker_enabled ? 1 : 0
  name                      = "${local.feature_name}-failures"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = { Name = "${local.feature_name}-failures" }
}

resource "aws_lambda_function" "feature_worker" {
  count                          = var.feature_worker_enabled ? 1 : 0
  function_name                  = local.feature_name
  description                    = "ICB leased external integration jobs"
  role                           = aws_iam_role.feature_worker[0].arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "src/worker/index.handler"
  memory_size                    = 256
  timeout                        = 15
  reserved_concurrent_executions = 1
  s3_bucket                      = aws_s3_bucket.activity_artifacts.id
  s3_key                         = var.activity_release == null ? null : var.activity_release.key
  s3_object_version              = var.activity_release == null ? null : var.activity_release.version_id
  source_code_hash               = var.activity_release == null ? null : var.activity_release.sha256
  environment {
    variables = merge({ for key, value in local.activity_environment : key => value if startswith(key, "DB_") }, {
      NODE_ENV                  = "production"
      INTEGRATION_SECRET_PREFIX = local.integration_secret_prefix
    })
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.feature_worker[0].name
  }
  tags       = { Name = local.feature_name }
  depends_on = [aws_iam_role_policy.feature_worker, aws_secretsmanager_secret_version.activity_database, aws_s3_bucket_versioning.activity_artifacts]
  lifecycle {
    precondition {
      condition     = var.activity_api_enabled && var.activity_database_ready && var.activity_release != null
      error_message = "The worker requires a tested release and upgraded service database."
    }
  }
}

resource "aws_lambda_function_event_invoke_config" "feature_worker" {
  count                        = var.feature_worker_enabled ? 1 : 0
  function_name                = aws_lambda_function.feature_worker[0].function_name
  maximum_event_age_in_seconds = 300
  maximum_retry_attempts       = 1
  destination_config {
    on_failure { destination = aws_sqs_queue.feature_failures[0].arn }
  }
  depends_on = [aws_iam_role_policy.feature_worker]
}

resource "aws_scheduler_schedule_group" "feature_worker" {
  count = var.feature_worker_enabled ? 1 : 0
  name  = local.feature_name
  tags  = { Name = local.feature_name }
}

resource "aws_scheduler_schedule" "feature_worker" {
  count               = var.feature_worker_enabled ? 1 : 0
  name                = local.feature_name
  group_name          = aws_scheduler_schedule_group.feature_worker[0].name
  schedule_expression = "rate(1 minute)"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.feature_worker[0].arn
    role_arn = aws_iam_role.feature_scheduler[0].arn
    input    = jsonencode({ version = 1, kind = "tick" })
    retry_policy {
      maximum_event_age_in_seconds = 120
      maximum_retry_attempts       = 1
    }
    dead_letter_config { arn = aws_sqs_queue.feature_failures[0].arn }
  }
  depends_on = [aws_iam_role_policy.feature_scheduler, aws_lambda_function_event_invoke_config.feature_worker]
}

output "feature_worker_name" {
  value = var.feature_worker_enabled ? aws_lambda_function.feature_worker[0].function_name : null
}

output "feature_failure_queue_url" {
  value = var.feature_worker_enabled ? aws_sqs_queue.feature_failures[0].url : null
}
